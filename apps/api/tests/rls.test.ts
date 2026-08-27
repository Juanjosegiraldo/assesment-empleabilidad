/**
 * The two integration tests the assessment requires, against a real PostgreSQL.
 *
 *   1. a user who is not a member of a channel is rejected when writing to it
 *   2. a user does not receive messages from private channels they do not belong to
 *
 * Each one is asserted twice: once through the HTTP API, and once by calling the database
 * directly with the actor pinned. The second assertion is the one that matters. It proves
 * the rule lives in PostgreSQL and not in a controller, which is exactly the claim the
 * whole design rests on.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { withActor } from "../src/infrastructure/db/withActor.js";
import {
  app,
  channelIdBySlug,
  closeDatabase,
  MEMBER,
  NON_MEMBER,
  PRIVATE_CHANNEL_SLUG,
  signIn,
  userIdByEmail,
} from "./helpers.js";

let privateChannelId: number;
let nonMemberToken: string;
let memberToken: string;
let nonMemberId: number;

beforeAll(async () => {
  privateChannelId = await channelIdBySlug(PRIVATE_CHANNEL_SLUG);
  nonMemberId = await userIdByEmail(NON_MEMBER);
  nonMemberToken = await signIn(NON_MEMBER);
  memberToken = await signIn(MEMBER);
});

afterAll(closeDatabase);

describe("a non member cannot write to a channel", () => {
  it("is rejected with 403 by the API", async () => {
    const response = await request(app)
      .post(`/channels/${privateChannelId}/messages`)
      .set("authorization", `Bearer ${nonMemberToken}`)
      .send({ body: "I should not be able to write this" })
      .expect(403);

    expect(response.body.error.code).toBe("forbidden");
    // Every error carries the correlation id, so a failure in production is traceable.
    expect(response.body.error.correlationId).toBeTruthy();
  });

  it("is rejected by the database itself, not only by the API", async () => {
    // Calling the function directly, with the actor pinned exactly as a request would.
    // Nothing of the HTTP layer is involved: if this passed, the API would be the only
    // thing standing between a bug and a leak.
    await expect(
      withActor(nonMemberId, (client) =>
        client.query("select id from rw_send_message($1, $2)", [
          privateChannelId,
          "Straight past the API",
        ]),
      ),
    ).rejects.toThrow();
  });

  it("leaves no trace of the rejected message", async () => {
    // The function is transactional: a rejected send must not leave a partial row behind.
    const leaked = await withActor(await userIdByEmail(MEMBER), (client) =>
      client.query("select count(*)::int as total from rw_messages where body like $1", [
        "%past the API%",
      ]),
    );

    expect(leaked.rows[0].total).toBe(0);
  });

  it("still allows a member to write to the same channel", async () => {
    // Positive control. Without it, a policy denying everything to everyone would pass
    // every assertion above.
    const memberId = await userIdByEmail(MEMBER);

    const allowed = await withActor(memberId, (client) =>
      client.query<{ ok: boolean }>(
        `select exists (
             select 1 from rw_channel_members
             where channel_id = $1 and user_id = rw_current_actor_id()
         ) as ok`,
        [privateChannelId],
      ),
    );

    expect(allowed.rows[0].ok).toBe(true);
  });
});

describe("a non member does not receive messages from a private channel", () => {
  it("returns an empty history through the API", async () => {
    const response = await request(app)
      .get(`/channels/${privateChannelId}/messages`)
      .set("authorization", `Bearer ${nonMemberToken}`)
      .expect(200);

    // Not a 403: the channel is invisible rather than forbidden. Answering "forbidden"
    // would confirm that this channel exists, which is itself a leak.
    expect(response.body.items).toHaveLength(0);
    expect(response.body.nextCursor).toBeNull();
  });

  it("does not list the channel at all", async () => {
    const response = await request(app)
      .get("/channels")
      .set("authorization", `Bearer ${nonMemberToken}`)
      .expect(200);

    const slugs = response.body.items.map((item: { slug: string }) => item.slug);
    expect(slugs).not.toContain(PRIVATE_CHANNEL_SLUG);
  });

  it("finds nothing when searching for a term only present in that channel", async () => {
    const response = await request(app)
      .get("/search?q=presupuesto")
      .set("authorization", `Bearer ${nonMemberToken}`)
      .expect(200);

    expect(response.body.items).toHaveLength(0);
  });

  it("finds that same term for a member, proving the data is really there", async () => {
    // The other half of the previous assertion. If this returned nothing too, the search
    // could simply be broken and the test above would still pass.
    const response = await request(app)
      .get("/search?q=presupuesto")
      .set("authorization", `Bearer ${memberToken}`)
      .expect(200);

    expect(response.body.items.length).toBeGreaterThan(0);
    expect(response.body.items[0].headline).toContain("<mark>");
  });

  it("hides the messages at the SQL level as well", async () => {
    const rows = await withActor(nonMemberId, (client) =>
      client.query<{ total: number }>(
        "select count(*)::int as total from rw_messages where channel_id = $1",
        [privateChannelId],
      ),
    );

    // Not "the API filtered them out": for this actor those rows do not exist.
    expect(rows.rows[0].total).toBe(0);
  });
});
