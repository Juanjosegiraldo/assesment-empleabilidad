import type { DbClient } from "../db/pool.js";
import type { ContextPassage, TokenUsage } from "../../domain/entities/Copilot.js";
import type { CopilotContextRepository } from "../../domain/ports/CopilotContextRepository.js";

type ContextRow = {
  message_id: number;
  body: string;
  created_at: Date;
  channel_name: string;
  author_name: string;
  author_job_title: string;
  distance: number;
};

export class PostgresCopilotContextRepository implements CopilotContextRepository {
  constructor(private readonly client: DbClient) {}

  async retrieve(input: { embedding: number[]; limit: number }): Promise<ContextPassage[]> {
    // pgvector accepts its literal form, "[0.1,0.2,...]". It goes in as a bound
    // parameter, never concatenated into the statement.
    const literal = `[${input.embedding.join(",")}]`;

    const result = await this.client.query<ContextRow>(
      `select message_id, body, created_at, channel_name, author_name, author_job_title, distance
       from rw_copilot_context($1::vector, $2)`,
      [literal, input.limit],
    );

    return result.rows.map((row) => ({
      messageId: row.message_id,
      body: row.body,
      createdAt: row.created_at,
      channelName: row.channel_name,
      authorName: row.author_name,
      authorJobTitle: row.author_job_title,
      distance: Number(row.distance),
    }));
  }

  async recordUsage(input: {
    model: string;
    promptVersion: string;
    usage: TokenUsage;
  }): Promise<void> {
    // user_id comes from rw_current_actor_id(), not from a parameter, so a call cannot
    // be charged to somebody else's account. The insert policy checks it again anyway.
    await this.client.query(
      `insert into rw_copilot_usage (user_id, model, prompt_version, prompt_tokens, completion_tokens)
       values (rw_current_actor_id(), $1, $2, $3, $4)`,
      [input.model, input.promptVersion, input.usage.promptTokens, input.usage.completionTokens],
    );
  }
}
