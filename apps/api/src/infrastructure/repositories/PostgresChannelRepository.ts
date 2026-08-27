import type { DbClient } from "../db/pool.js";
import type { Conversation } from "../../domain/entities/Channel.js";
import type { ChannelRepository } from "../../domain/ports/ChannelRepository.js";

type ConversationRow = {
  channel_id: number;
  channel_slug: string;
  channel_name: string;
  channel_topic: string | null;
  is_private: boolean;
  last_message_id: number | null;
  last_message_body: string | null;
  last_message_at: Date | null;
  last_message_author: string | null;
  unread_count: number;
};

export class PostgresChannelRepository implements ChannelRepository {
  constructor(private readonly client: DbClient) {}

  async listConversations(): Promise<Conversation[]> {
    // rw_user_conversations is declared with security_invoker = true, so it runs under
    // the actor's policies rather than the view owner's. Without that the view would
    // return every channel in the company.
    const result = await this.client.query<ConversationRow>(
      `select channel_id, channel_slug, channel_name, channel_topic, is_private,
              last_message_id, last_message_body, last_message_at, last_message_author,
              unread_count
       from rw_user_conversations
       order by last_message_at desc nulls last, channel_name`,
    );

    return result.rows.map((row) => ({
      id: row.channel_id,
      slug: row.channel_slug,
      name: row.channel_name,
      topic: row.channel_topic,
      isPrivate: row.is_private,
      lastMessageId: row.last_message_id,
      lastMessageBody: row.last_message_body,
      lastMessageAt: row.last_message_at,
      lastMessageAuthor: row.last_message_author,
      unreadCount: Number(row.unread_count),
    }));
  }
}
