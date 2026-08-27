import OpenAI from "openai";
import type { EmbeddingProvider } from "../../domain/ports/EmbeddingProvider.js";

/**
 * Embeddings over any OpenAI compatible endpoint.
 *
 * Configured against Ollama running locally, which means the corpus never leaves the
 * machine to be indexed. Pointing baseUrl at a hosted provider is a change in .env, not
 * in code, because the wire format is the same.
 *
 * One provider specific detail worth knowing: NVIDIA's retrieval models require an extra
 * "input_type" field of "query" or "passage" and reject the request without it, while
 * Ollama ignores it. It is sent unconditionally, through the SDK's escape hatch for
 * fields it does not model, so this class works against both.
 */
export class OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider {
  private readonly client: OpenAI;

  constructor(
    options: { baseUrl: string; apiKey: string },
    readonly model: string,
    readonly dimensions: number,
  ) {
    this.client = new OpenAI({ baseURL: options.baseUrl, apiKey: options.apiKey });
  }

  async embed(texts: string[], kind: "query" | "passage"): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
      // @ts-expect-error input_type is not part of the OpenAI schema. NVIDIA requires it,
      // Ollama ignores it, and the SDK forwards unknown fields untouched.
      input_type: kind,
    });

    // The API is documented to return the vectors in request order, but it also returns
    // an index on each one. Sorting by it costs nothing and removes the assumption.
    return response.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((item) => {
        if (item.embedding.length !== this.dimensions) {
          // A silent dimension mismatch would fail later as an opaque insert error, far
          // from its cause.
          throw new Error(
            `Model ${this.model} returned ${item.embedding.length} dimensions, expected ${this.dimensions}. Check AI_EMBEDDING_DIMENSIONS.`,
          );
        }
        return item.embedding;
      });
  }
}
