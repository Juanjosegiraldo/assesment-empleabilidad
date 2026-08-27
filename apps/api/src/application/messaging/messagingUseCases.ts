/**
 * Use cases for channels and messages.
 *
 * They are deliberately thin. The permission rules and the transactional writes live in
 * PostgreSQL, so what is left for this layer is what an application layer is actually
 * for: validate the input before it reaches the database, choose sensible bounds, and
 * hand back domain types.
 *
 * Pretending otherwise, by re-checking membership here, would create a second copy of a
 * rule that already exists in an RLS policy. Two copies of a security rule drift.
 */
import { invalidInput } from "../../domain/errors.js";
import type { Conversation } from "../../domain/entities/Channel.js";
import type { Message, MessagePage } from "../../domain/entities/Message.js";
import type { ChannelRepository } from "../../domain/ports/ChannelRepository.js";
import type { MessageRepository, SearchPage } from "../../domain/ports/MessageRepository.js";

/** Matches the CHECK constraint on rw_messages.body, so the two can never disagree. */
const MAX_BODY_LENGTH = 4000;
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

export const clampLimit = (raw: unknown): number => {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_PAGE_SIZE;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw invalidInput("limit must be a positive integer");
  return Math.min(value, MAX_PAGE_SIZE);
};

export const requireId = (raw: unknown, field: string): number => {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw invalidInput(`${field} must be a positive integer`);
  return value;
};

const requireBody = (raw: unknown): string => {
  if (typeof raw !== "string") throw invalidInput("body must be a string");
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw invalidInput("body cannot be empty");
  if (trimmed.length > MAX_BODY_LENGTH) {
    throw invalidInput(`body cannot exceed ${MAX_BODY_LENGTH} characters`);
  }
  return trimmed;
};

export const listConversations = (channels: ChannelRepository): Promise<Conversation[]> =>
  channels.listConversations();

export const listChannelMessages = (
  messages: MessageRepository,
  input: { channelId: number; cursor: string | null; limit: number },
): Promise<MessagePage> => messages.listByChannel(input);

export const sendMessage = (
  messages: MessageRepository,
  input: { channelId: number; body: unknown },
): Promise<Message> => messages.send({ channelId: input.channelId, body: requireBody(input.body) });

export const editMessage = (
  messages: MessageRepository,
  input: { messageId: number; body: unknown },
): Promise<Message> => messages.edit({ messageId: input.messageId, body: requireBody(input.body) });

export const deleteMessage = (messages: MessageRepository, messageId: number): Promise<number> =>
  messages.softDelete(messageId);

export const markChannelRead = (
  messages: MessageRepository,
  input: { channelId: number; upToMessageId: number },
): Promise<number> => messages.markRead(input);

export const searchMessages = (
  messages: MessageRepository,
  input: { term: unknown; cursor: string | null; limit: number },
): Promise<SearchPage> => {
  if (typeof input.term !== "string" || input.term.trim().length < 2) {
    throw invalidInput("Search term must be at least 2 characters");
  }
  return messages.search({ term: input.term.trim(), cursor: input.cursor, limit: input.limit });
};
