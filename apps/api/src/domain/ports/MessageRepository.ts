import type { Message, MessagePage } from "../entities/Message.js";

/** A search hit: a message plus the body with the matched term marked up. */
export type SearchHit = Message & {
  channelName: string;
  /** The body with matches wrapped in <mark>. Rendered as text, never as HTML. */
  headline: string;
};

export type SearchPage = {
  items: SearchHit[];
  nextCursor: string | null;
};

export interface MessageRepository {
  /** One message, if the actor is allowed to see it. Used by the realtime stream. */
  findById(messageId: number): Promise<Message | null>;
  listByChannel(input: { channelId: number; cursor: string | null; limit: number }): Promise<MessagePage>;
  send(input: { channelId: number; body: string }): Promise<Message>;
  edit(input: { messageId: number; body: string }): Promise<Message>;
  /** Soft delete. Returns the id, because there is no row left to return. */
  softDelete(messageId: number): Promise<number>;
  markRead(input: { channelId: number; upToMessageId: number }): Promise<number>;
  search(input: { term: string; cursor: string | null; limit: number }): Promise<SearchPage>;
}
