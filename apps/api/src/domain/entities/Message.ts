export type Message = {
  id: number;
  channelId: number;
  senderId: number;
  senderName: string;
  senderJobTitle: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  readByActor: boolean;
};

/**
 * A page of messages plus the cursor that fetches the next one.
 *
 * The cursor is an opaque string to everyone above the repository. Encoding it that way
 * means the pagination key can change without touching the API contract or the frontend.
 */
export type MessagePage = {
  items: Message[];
  nextCursor: string | null;
};
