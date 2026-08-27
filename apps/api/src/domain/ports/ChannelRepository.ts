import type { Conversation } from "../entities/Channel.js";

export interface ChannelRepository {
  /** The actor's conversation list. Channels they do not belong to simply are not there. */
  listConversations(): Promise<Conversation[]>;
}
