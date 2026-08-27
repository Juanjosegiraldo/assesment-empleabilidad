/**
 * Turns text into vectors.
 *
 * Deliberately separate from ChatProvider. They are two different services here, chat on
 * a hosted API and embeddings on a local model, and even when one vendor serves both,
 * indexing a corpus has nothing in common with answering a question. A use case that
 * embeds a query should not be handed the ability to spend money on completions.
 *
 * Nothing from any SDK appears in this file. That is what makes the provider
 * interchangeable: swapping it is a new class in infrastructure and one line in main.ts.
 */
export interface EmbeddingProvider {
  /**
   * Retrieval models encode a question and a document differently, so the caller has to
   * say which it is. Providers that do not distinguish simply ignore it.
   */
  embed(texts: string[], kind: "query" | "passage"): Promise<number[][]>;

  readonly model: string;
  readonly dimensions: number;
}
