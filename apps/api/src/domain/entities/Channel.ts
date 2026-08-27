export type Channel = {
  id: number;
  slug: string;
  name: string;
  topic: string | null;
  isPrivate: boolean;
};

/** A channel as it appears in the conversation list, with its last message and unread count. */
export type Conversation = Channel & {
  lastMessageId: number | null;
  lastMessageBody: string | null;
  lastMessageAt: Date | null;
  lastMessageAuthor: string | null;
  unreadCount: number;
};
