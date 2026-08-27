/**
 * The copilot inherits the same permissions as reading a channel.
 *
 * This is the claim the whole retrieval design rests on, so it gets an automated test
 * rather than a demo. It runs against the real database and the real embedding model.
 *
 * Note what it does not need: the chat model. Asking about a private channel as somebody
 * who cannot see it returns no passages at all, so the refusal happens before any
 * completion is requested. The assertion on zero tokens is what proves that.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app, closeDatabase, MEMBER, NON_MEMBER, signIn } from "./helpers.js";

const PRIVATE_QUESTION = "cual fue el ajuste salarial del segundo semestre?";

let nonMemberToken: string;
let memberToken: string;

beforeAll(async () => {
  nonMemberToken = await signIn(NON_MEMBER);
  memberToken = await signIn(MEMBER);
});

afterAll(closeDatabase);

describe("copilot retrieval respects channel membership", () => {
  it("refuses, without calling the model, for someone outside the channel", async () => {
    const response = await request(app)
      .post("/copilot/ask")
      .set("authorization", `Bearer ${nonMemberToken}`)
      .send({ question: PRIVATE_QUESTION })
      .expect(200);

    expect(response.body.refusal).toBe("insufficient_context");
    expect(response.body.citations).toHaveLength(0);

    // Zero tokens means the language model was never asked. The refusal is structural:
    // there was nothing to answer from, so there was no chance to invent something.
    expect(response.body.usage.promptTokens).toBe(0);
    expect(response.body.usage.completionTokens).toBe(0);

    // And the answer must not leak the thing it is refusing to talk about.
    expect(response.body.answer).not.toMatch(/8[.,]5/);
  });

  it("answers the same question for a member, with a citation", async () => {
    // The positive control. Without it, a copilot that refused everything would pass.
    const response = await request(app)
      .post("/copilot/ask")
      .set("authorization", `Bearer ${memberToken}`)
      .send({ question: PRIVATE_QUESTION })
      .expect(200);

    expect(response.body.refusal).toBeNull();
    expect(response.body.citations.length).toBeGreaterThan(0);
    expect(response.body.citations[0].channelName).toContain("Financiera");
    expect(response.body.usage.promptTokens).toBeGreaterThan(0);
  });

  it("rejects a question that is too short before spending anything", async () => {
    await request(app)
      .post("/copilot/ask")
      .set("authorization", `Bearer ${nonMemberToken}`)
      .send({ question: "hm" })
      .expect(422);
  });

  it("requires authentication", async () => {
    await request(app).post("/copilot/ask").send({ question: PRIVATE_QUESTION }).expect(401);
  });
});
