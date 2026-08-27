import type { DbClient } from "../db/pool.js";
import type { Message, MessagePage } from "../../domain/entities/Message.js";
import type { MessageRepository, SearchHit, SearchPage } from "../../domain/ports/MessageRepository.js";
import { decodeCursor, encodeCursor } from "../db/cursor.js";

type MessageRow = {
  id: number;
  channel_id: number;
  sender_id: number;
  sender_name: string;
  sender_job_title: string;
  body: string;
  created_at: Date;
  edited_at: Date | null;
  read_by_actor: boolean;
};

type SearchRow = MessageRow & { channel_name: string; headline: string };

const toMessage = (row: MessageRow): Message => ({
  id: row.id,
  channelId: row.channel_id,
  senderId: row.sender_id,
  senderName: row.sender_name,
  senderJobTitle: row.sender_job_title,
  body: row.body,
  createdAt: row.created_at,
  editedAt: row.edited_at,
  readByActor: row.read_by_actor,
});

/**
 * Every method here runs inside a transaction that already pinned the actor, so none of
 * them filters by channel membership. That filtering is done by the row level security
 * policies, once, for every statement. A WHERE clause repeating it would be a second copy
 * of the rule that could drift from the first.
 */
export class PostgresMessageRepository implements MessageRepository {
  constructor(private readonly client: DbClient) {}

  async listByChannel(input: {
    channelId: number;
    cursor: string | null;
    limit: number;
  }): Promise<MessagePage> {
    const keyset = decodeCursor(input.cursor);

    const result = await this.client.query<MessageRow>(
      `select m.id, m.channel_id, m.sender_id,
              u.full_name as sender_name, u.job_title as sender_job_title,
              m.body, m.created_at, m.edited_at,
              exists (
                  select 1 from rw_message_reads r
                  where r.message_id = m.id and r.user_id = rw_current_actor_id()
              ) as read_by_actor
       from rw_messages m
       join rw_users u on u.id = m.sender_id
       where m.channel_id = $1
         and m.deleted_at is null
         -- Row comparison rather than three OR'd predicates, so PostgreSQL can turn it
         -- into a single index range scan on (channel_id, created_at desc, id desc).
         and ($2::timestamptz is null or (m.created_at, m.id) < ($2::timestamptz, $3::bigint))
       order by m.created_at desc, m.id desc
       limit $4`,
      [input.channelId, keyset?.createdAt ?? null, keyset?.id ?? null, input.limit],
    );

    const items = result.rows.map(toMessage);
    return { items, nextCursor: nextCursorFor(items, input.limit) };
  }

  async send(input: { channelId: number; body: string }): Promise<Message> {
    // The insert goes through rw_send_message, never through a bare INSERT. The function
    // checks membership, records the author's own read receipt and does both in one
    // transaction, so a partial send cannot exist.
    const result = await this.client.query<MessageRow>(
      `with sent as (
           select * from rw_send_message($1, $2)
       )
       select s.id, s.channel_id, s.sender_id,
              u.full_name as sender_name, u.job_title as sender_job_title,
              s.body, s.created_at, s.edited_at, true as read_by_actor
       from sent s
       join rw_users u on u.id = s.sender_id`,
      [input.channelId, input.body],
    );

    return toMessage(result.rows[0]!);
  }

  async edit(input: { messageId: number; body: string }): Promise<Message> {
    const result = await this.client.query<MessageRow>(
      `with edited as (
           select * from rw_edit_message($1, $2)
       )
       select e.id, e.channel_id, e.sender_id,
              u.full_name as sender_name, u.job_title as sender_job_title,
              e.body, e.created_at, e.edited_at, true as read_by_actor
       from edited e
       join rw_users u on u.id = e.sender_id`,
      [input.messageId, input.body],
    );

    return toMessage(result.rows[0]!);
  }

  async softDelete(messageId: number): Promise<number> {
    const result = await this.client.query<{ deleted_id: number }>(
      "select rw_delete_message($1) as deleted_id",
      [messageId],
    );
    return result.rows[0]!.deleted_id;
  }

  async markRead(input: { channelId: number; upToMessageId: number }): Promise<number> {
    const result = await this.client.query<{ receipts: number }>(
      "select rw_mark_channel_read($1, $2) as receipts",
      [input.channelId, input.upToMessageId],
    );
    return result.rows[0]!.receipts;
  }

  async search(input: { term: string; cursor: string | null; limit: number }): Promise<SearchPage> {
    const keyset = decodeCursor(input.cursor);

    const result = await this.client.query<SearchRow>(
      `select s.message_id as id, s.channel_id, s.channel_name,
              s.sender_id, s.sender_name, '' as sender_job_title,
              s.body, s.headline, s.created_at,
              null::timestamptz as edited_at, true as read_by_actor
       from rw_search_messages($1, $2, $3, $4) s`,
      [input.term, input.limit, keyset?.createdAt ?? null, keyset?.id ?? null],
    );

    const items: SearchHit[] = result.rows.map((row) => ({
      ...toMessage(row),
      channelName: row.channel_name,
      headline: row.headline,
    }));

    return { items, nextCursor: nextCursorFor(items, input.limit) };
  }
}

/**
 * A next cursor is only offered when the page came back full.
 *
 * A short page means the end was reached, and handing out a cursor there would make the
 * client fire one more request that can only return nothing.
 */
function nextCursorFor(items: Message[], limit: number): string | null {
  if (items.length < limit) return null;
  const last = items[items.length - 1]!;
  return encodeCursor({ createdAt: last.createdAt, id: last.id });
}
