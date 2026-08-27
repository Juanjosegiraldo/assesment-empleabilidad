import type { ContextPassage } from "../entities/Copilot.js";
import type { TokenUsage } from "../entities/Copilot.js";

export interface CopilotContextRepository {
  /** Nearest passages the actor is allowed to read. Permission filtering happens in SQL. */
  retrieve(input: { embedding: number[]; limit: number }): Promise<ContextPassage[]>;
  recordUsage(input: { model: string; promptVersion: string; usage: TokenUsage }): Promise<void>;
}
