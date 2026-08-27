import { Router, type RequestHandler } from "express";
import { forbidden } from "../../../domain/errors.js";
import { requireId } from "../../../application/messaging/messagingUseCases.js";
import { withActor } from "../../../infrastructure/db/withActor.js";
import { PostgresMessageRepository } from "../../../infrastructure/repositories/PostgresMessageRepository.js";
import type { MessageNotifier } from "../../../infrastructure/realtime/MessageNotifier.js";

/** Long enough to be cheap, short enough to beat the 60s idle timeout of most proxies. */
const KEEPALIVE_MS = 25_000;

export function buildStreamRouter(notifier: MessageNotifier, requireAuth: RequestHandler): Router {
  const router = Router();

  router.get("/channels/:channelId/stream", requireAuth, async (req, res) => {
    const channelId = requireId(req.params.channelId, "channelId");
    const actorId = req.actor.userId;

    // Membership is checked before a single byte of the stream is written. Opening it
    // first and filtering later would mean an unauthorised subscriber is already attached
    // when the decision is made.
    const isMember = await withActor(actorId, async (client) => {
      const result = await client.query<{ ok: boolean }>(
        `select exists (
             select 1 from rw_channel_members
             where channel_id = $1 and user_id = rw_current_actor_id() and left_at is null
         ) as ok`,
        [channelId],
      );
      return result.rows[0]?.ok ?? false;
    });

    if (!isMember) throw forbidden("You are not a member of this channel");

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Tells nginx not to buffer the response. Without it a proxy can hold the events
      // until the connection closes, which is the opposite of real time.
      "x-accel-buffering": "no",
    });
    res.flushHeaders();

    // A comment line. It gets the response committed immediately so the browser stops
    // waiting on headers.
    res.write(": connected\n\n");

    const keepalive = setInterval(() => res.write(": keepalive\n\n"), KEEPALIVE_MS);

    const unsubscribe = notifier.subscribe(channelId, (event) => {
      // The notification carried only ids. The message is read here, inside this
      // subscriber's own actor transaction, so row level security decides again at
      // delivery time. Somebody removed from the channel a second ago gets null.
      void withActor(actorId, (client) => new PostgresMessageRepository(client).findById(event.messageId))
        .then((message) => {
          if (message) res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
        })
        .catch(() => {
          // One undeliverable event must not tear down a live stream.
        });
    });

    // Fires when the tab closes, the network drops or the user navigates away. Without
    // this the interval and the subscriber leak, one per connection, forever.
    req.on("close", () => {
      clearInterval(keepalive);
      unsubscribe();
      res.end();
    });
  });

  return router;
}
