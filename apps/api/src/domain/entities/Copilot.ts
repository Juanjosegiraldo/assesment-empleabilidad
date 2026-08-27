/** A message retrieved as context for an answer. */
export type ContextPassage = {
  messageId: number;
  body: string;
  createdAt: Date;
  channelName: string;
  authorName: string;
  authorJobTitle: string;
  /** Cosine distance to the question: 0 identical, 1 unrelated. */
  distance: number;
};

/** A passage the model actually cited, resolved back to its message. */
export type Citation = {
  messageId: number;
  channelName: string;
  authorName: string;
  excerpt: string;
};

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
};

/**
 * Why an answer could not be given.
 *
 * The assessment requires three explicit refusals. Modelling them as data rather than as
 * free text means the frontend can react to each one, and means "I don't know" can never
 * be mistaken for an answer.
 */
export type RefusalReason = "no_permission" | "out_of_scope" | "insufficient_context";

export type CopilotAnswer = {
  answer: string;
  citations: Citation[];
  refusal: RefusalReason | null;
  usage: TokenUsage;
  promptVersion: string;
  model: string;
};
