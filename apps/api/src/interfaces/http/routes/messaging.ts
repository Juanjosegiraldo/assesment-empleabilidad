import { Router, type RequestHandler } from "express";
import { withActor } from "../../../infrastructure/db/withActor.js";
import { PostgresChannelRepository } from "../../../infrastructure/repositories/PostgresChannelRepository.js";
import { PostgresMessageRepository } from "../../../infrastructure/repositories/PostgresMessageRepository.js";
import {
  clampLimit,
  deleteMessage,
  editMessage,
  listChannelMessages,
  listConversations,
  markChannelRead,
  requireId,
  searchMessages,
  sendMessage,
} from "../../../application/messaging/messagingUseCases.js";

/**
 * Every route below follows the same shape:
 *
 *     requireAuth  →  withActor(req.actor.userId)  →  repository  →  PostgreSQL
 *
 * The actor id comes from the verified token. No handler reads a user id from the path,
 * the query string or the body, so no request can act as somebody else.
 *
 * Errors are not caught here. A missing channel raises RW404 in the database,
 * mapDatabaseError turns it into a DomainError, and the error handler renders it. Express
 * 5 forwards rejected promises on its own.
 */
export function buildMessagingRouter(requireAuth: RequestHandler): Router {
  const router = Router();
  router.use(requireAuth);

  const asString = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

  router.get("/channels", async (req, res) => {
    const conversations = await withActor(req.actor.userId, (client) =>
      listConversations(new PostgresChannelRepository(client)),
    );
    res.json({ items: conversations });
  });

  router.get("/channels/:channelId/messages", async (req, res) => {
    const channelId = requireId(req.params.channelId, "channelId");
    const limit = clampLimit(req.query.limit);

    const page = await withActor(req.actor.userId, (client) =>
      listChannelMessages(new PostgresMessageRepository(client), {
        channelId,
        cursor: asString(req.query.cursor),
        limit,
      }),
    );

    res.json(page);
  });

  router.post("/channels/:channelId/messages", async (req, res) => {
    const channelId = requireId(req.params.channelId, "channelId");

    const message = await withActor(req.actor.userId, (client) =>
      sendMessage(new PostgresMessageRepository(client), { channelId, body: req.body?.body }),
    );

    res.status(201).json({ message });
  });

  router.post("/channels/:channelId/read", async (req, res) => {
    const channelId = requireId(req.params.channelId, "channelId");
    const upToMessageId = requireId(req.body?.upToMessageId, "upToMessageId");

    const receipts = await withActor(req.actor.userId, (client) =>
      markChannelRead(new PostgresMessageRepository(client), { channelId, upToMessageId }),
    );

    res.json({ receiptsCreated: receipts });
  });

  router.patch("/messages/:messageId", async (req, res) => {
    const messageId = requireId(req.params.messageId, "messageId");

    const message = await withActor(req.actor.userId, (client) =>
      editMessage(new PostgresMessageRepository(client), { messageId, body: req.body?.body }),
    );

    res.json({ message });
  });

  router.delete("/messages/:messageId", async (req, res) => {
    const messageId = requireId(req.params.messageId, "messageId");

    await withActor(req.actor.userId, (client) =>
      deleteMessage(new PostgresMessageRepository(client), messageId),
    );

    // 204: the message still exists in the table with deleted_at set, but there is
    // nothing meaningful to hand back.
    res.sendStatus(204);
  });

  router.get("/search", async (req, res) => {
    const limit = clampLimit(req.query.limit);

    const page = await withActor(req.actor.userId, (client) =>
      searchMessages(new PostgresMessageRepository(client), {
        term: req.query.q,
        cursor: asString(req.query.cursor),
        limit,
      }),
    );

    res.json(page);
  });

  return router;
}
