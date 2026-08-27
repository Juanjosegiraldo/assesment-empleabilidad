export type Conversation = {
  id: number;
  slug: string;
  name: string;
  topic: string | null;
  isPrivate: boolean;
  lastMessageId: number | null;
  lastMessageBody: string | null;
  lastMessageAt: string | null;
  lastMessageAuthor: string | null;
  unreadCount: number;
};

export type Message = {
  id: number;
  channelId: number;
  senderId: number;
  senderName: string;
  senderJobTitle: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  readByActor: boolean;
};

/**
 * A message the user just sent, before the server has confirmed it.
 *
 * pending / sent / failed are client side states of an optimistic send. They are not in
 * the database on purpose: a message only reaches it once the send succeeded, so
 * persisting "pending" would store a state nobody else could ever observe.
 */
export type DeliveryStatus = "pending" | "sent" | "failed";

export type ThreadMessage = Message & {
  status: DeliveryStatus;
  /** Present only while optimistic, so the real message can replace it on confirmation. */
  localId?: string;
};

export type MessagePage = { items: Message[]; nextCursor: string | null };

export type SearchHit = Message & { channelName: string; headline: string };
export type SearchPage = { items: SearchHit[]; nextCursor: string | null };

export type Citation = {
  messageId: number;
  channelName: string;
  authorName: string;
  excerpt: string;
};

export type RefusalReason = "insufficient_context" | "no_permission" | "out_of_scope";

export type CopilotAnswer = {
  answer: string;
  citations: Citation[];
  refusal: RefusalReason | null;
  usage: { promptTokens: number; completionTokens: number };
  promptVersion: string;
  model: string;
};

export type CopilotUsage = {
  call_count: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};
