import type { TokenUsage } from "../entities/Copilot.js";

export interface ChatProvider {
  complete(input: { system: string; user: string }): Promise<{ text: string; usage: TokenUsage }>;
  readonly model: string;
}
