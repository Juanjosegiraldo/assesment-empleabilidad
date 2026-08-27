import OpenAI from "openai";
import type { ChatProvider } from "../../domain/ports/ChatProvider.js";
import type { TokenUsage } from "../../domain/entities/Copilot.js";

/**
 * Chat completions over any OpenAI compatible endpoint. Configured against NVIDIA NIM.
 *
 * Two settings that are not decoration:
 *
 * temperature 0.2  a copilot that has to quote its sources should be close to
 *                  deterministic. Higher values start paraphrasing the context, and a
 *                  paraphrase is where a citation stops matching what was actually said.
 *
 * maxTokens 1024   openai/gpt-oss-20b is a reasoning model: it spends completion tokens
 *                  thinking before it writes anything. Measured against this endpoint,
 *                  a 64 token budget came back with an EMPTY content field and all 64
 *                  tokens consumed by reasoning. The budget has to cover the thinking
 *                  plus the answer, and reasoning_effort keeps the thinking short.
 */
export class OpenAiCompatibleChatProvider implements ChatProvider {
  private readonly client: OpenAI;

  constructor(
    options: { baseUrl: string; apiKey: string },
    readonly model: string,
    private readonly maxTokens = 1024,
  ) {
    this.client = new OpenAI({ baseURL: options.baseUrl, apiKey: options.apiKey });
  }

  async complete(input: { system: string; user: string }): Promise<{ text: string; usage: TokenUsage }> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      temperature: 0.2,
      max_tokens: this.maxTokens,
      // Bounds how long the model thinks before writing. Part of the OpenAI schema for
      // reasoning models; providers that do not know the field ignore it.
      reasoning_effort: "low",
    });

    const choice = response.choices[0];
    const text = choice?.message?.content?.trim() ?? "";

    if (!text) {
      // Almost always means the token budget ran out during reasoning. Saying so beats
      // returning an empty answer that looks like the model had nothing to say.
      throw new Error(
        `Model ${this.model} returned no content (finish_reason: ${choice?.finish_reason ?? "unknown"}). The token budget may be too small for a reasoning model.`,
      );
    }

    return {
      text,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }
}
