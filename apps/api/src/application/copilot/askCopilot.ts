import { invalidInput } from "../../domain/errors.js";
import type { Citation, CopilotAnswer, RefusalReason } from "../../domain/entities/Copilot.js";
import type { ChatProvider } from "../../domain/ports/ChatProvider.js";
import type { CopilotContextRepository } from "../../domain/ports/CopilotContextRepository.js";
import type { EmbeddingProvider } from "../../domain/ports/EmbeddingProvider.js";
import {
  COPILOT_PROMPT_VERSION,
  REFUSAL_PREFIX,
  buildSystemPrompt,
  buildUserPrompt,
  type PromptActor,
} from "../../infrastructure/ai/prompts/copilotPrompt.v1.js";

export type AskCopilotDependencies = {
  embeddings: EmbeddingProvider;
  chat: ChatProvider;
  context: CopilotContextRepository;
};

/** How many passages to retrieve before filtering. */
const RETRIEVE_LIMIT = 8;

/**
 * Cosine distance above which a passage is treated as unrelated.
 *
 * Measured, not guessed. Against this corpus with nomic-embed-text, the closest match for
 * a question the corpus can answer landed between 0.16 and 0.28, while questions with no
 * answer here ("what is the recipe for bandeja paisa") bottomed out at 0.375 and 0.394.
 * 0.35 sits in that gap.
 *
 * It is specific to this model and this corpus. Changing the embedding model means
 * measuring again.
 */
const MAX_DISTANCE = 0.35;

const MIN_QUESTION_LENGTH = 5;
const MAX_QUESTION_LENGTH = 500;

export async function askCopilot(
  deps: AskCopilotDependencies,
  input: { question: unknown; actor: PromptActor },
): Promise<CopilotAnswer> {
  const question = requireQuestion(input.question);

  // "query", not "passage": retrieval models encode a question differently from a
  // document, and using the wrong one quietly degrades every result.
  const [embedding] = await deps.embeddings.embed([question], "query");

  // This is where permissions are enforced, and the only place they are. The retrieval
  // runs inside the actor's transaction, so the RLS policies decide which passages exist.
  // Two people asking the same question get context built from different rows, with no
  // application code choosing that.
  const retrieved = await deps.context.retrieve({
    embedding: embedding!,
    limit: RETRIEVE_LIMIT,
  });

  const relevant = retrieved.filter((passage) => passage.distance <= MAX_DISTANCE);

  // No usable context means no call to the model at all. It saves tokens, but the real
  // reason is that it makes the refusal structural: there is nothing to answer from, so
  // there is no opportunity to invent something.
  //
  // Note this is also what happens when the answer lives in a channel the actor cannot
  // read: the passages simply were not returned. The refusal says "insufficient context"
  // rather than "you lack permission", and that is deliberate. Confirming that the
  // information exists somewhere would itself be the leak.
  if (relevant.length === 0) {
    return {
      answer:
        "No encontré mensajes en tus canales que respondan esa pregunta, así que prefiero no responder.",
      citations: [],
      refusal: "insufficient_context",
      usage: { promptTokens: 0, completionTokens: 0 },
      promptVersion: COPILOT_PROMPT_VERSION,
      model: deps.chat.model,
    };
  }

  const completion = await deps.chat.complete({
    system: buildSystemPrompt(input.actor),
    user: buildUserPrompt(question, relevant),
  });

  await deps.context.recordUsage({
    model: deps.chat.model,
    promptVersion: COPILOT_PROMPT_VERSION,
    usage: completion.usage,
  });

  const { refusal, answer } = parseRefusal(completion.text);

  return {
    answer,
    citations: refusal ? [] : resolveCitations(answer, relevant),
    refusal,
    usage: completion.usage,
    promptVersion: COPILOT_PROMPT_VERSION,
    model: deps.chat.model,
  };
}

function requireQuestion(raw: unknown): string {
  if (typeof raw !== "string") throw invalidInput("question must be a string");
  const trimmed = raw.trim();
  if (trimmed.length < MIN_QUESTION_LENGTH) {
    throw invalidInput(`question must be at least ${MIN_QUESTION_LENGTH} characters`);
  }
  if (trimmed.length > MAX_QUESTION_LENGTH) {
    throw invalidInput(`question cannot exceed ${MAX_QUESTION_LENGTH} characters`);
  }
  return trimmed;
}

const REFUSAL_REASONS: RefusalReason[] = ["insufficient_context", "no_permission", "out_of_scope"];

/** Splits the "REFUSAL: reason" marker off the front of a reply, if there is one. */
function parseRefusal(text: string): { refusal: RefusalReason | null; answer: string } {
  const trimmed = text.trim();
  if (!trimmed.startsWith(REFUSAL_PREFIX)) return { refusal: null, answer: trimmed };

  const withoutPrefix = trimmed.slice(REFUSAL_PREFIX.length).trim();
  const reason = REFUSAL_REASONS.find((candidate) => withoutPrefix.startsWith(candidate));

  if (!reason) return { refusal: "out_of_scope", answer: withoutPrefix };

  return {
    refusal: reason,
    answer: withoutPrefix.slice(reason.length).replace(/^[\s:.\-]+/, "").trim(),
  };
}

/**
 * Resolves the [#id] markers in an answer back to the passages they refer to.
 *
 * Ids that were not in the retrieved context are dropped rather than reported. A model
 * that cites a message it was never shown has invented it, and a fabricated citation
 * rendered as a real one is worse than no citation at all.
 */
function resolveCitations(answer: string, passages: ContextPassageLike[]): Citation[] {
  const byId = new Map(passages.map((passage) => [passage.messageId, passage]));
  const cited = new Set<number>();

  for (const match of answer.matchAll(/\[#(\d+)\]/g)) {
    cited.add(Number(match[1]));
  }

  return [...cited]
    .map((id) => byId.get(id))
    .filter((passage): passage is ContextPassageLike => passage !== undefined)
    .map((passage) => ({
      messageId: passage.messageId,
      channelName: passage.channelName,
      authorName: passage.authorName,
      excerpt: passage.body.length > 160 ? `${passage.body.slice(0, 157)}...` : passage.body,
    }));
}

type ContextPassageLike = {
  messageId: number;
  channelName: string;
  authorName: string;
  body: string;
};
