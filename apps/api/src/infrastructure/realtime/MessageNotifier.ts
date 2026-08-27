import pg from "pg";
import { config } from "../../config.js";

export type MessageEvent = { messageId: number; channelId: number };
type Handler = (event: MessageEvent) => void;

const CHANNEL = "rw_message_created";
const RECONNECT_DELAY_MS = 2_000;

/**
 * Bridges PostgreSQL NOTIFY to the SSE streams the browsers are holding open.
 *
 * One dedicated connection for the whole process, deliberately outside the pool. A
 * LISTEN belongs to a session and has to stay open for as long as the process runs;
 * borrowing a pooled client would either pin it forever, starving the pool, or lose the
 * subscription when the client is released.
 *
 * Subscribers are kept in memory, keyed by channel. That is the honest limit of this
 * design: it works because there is one API process. Running several would need each of
 * them to LISTEN, which they would, since NOTIFY reaches every listening session, so it
 * scales further than it looks. What it does not survive is the process restarting, and
 * the browser reconnects for exactly that reason.
 */
export class MessageNotifier {
  private client: pg.Client | null = null;
  private readonly subscribers = new Map<number, Set<Handler>>();
  private stopped = false;

  async start(): Promise<void> {
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    const client = new pg.Client({ connectionString: config.database.url });

    client.on("notification", (message) => {
      if (message.channel !== CHANNEL || !message.payload) return;
      try {
        const parsed = JSON.parse(message.payload) as { message_id: number; channel_id: number };
        this.dispatch({ messageId: parsed.message_id, channelId: parsed.channel_id });
      } catch {
        // A payload this process cannot parse is not worth taking the listener down for.
      }
    });

    // A dropped connection means silently missing every message from then on, which
    // looks exactly like "real time stopped working" with nothing in the logs.
    client.on("error", () => {
      this.client = null;
      setTimeout(() => void this.connect(), RECONNECT_DELAY_MS);
    });

    await client.connect();
    await client.query(`listen ${CHANNEL}`);
    this.client = client;
  }

  private dispatch(event: MessageEvent): void {
    for (const handler of this.subscribers.get(event.channelId) ?? []) {
      handler(event);
    }
  }

  /** Registers a handler for one channel. Call the returned function to stop listening. */
  subscribe(channelId: number, handler: Handler): () => void {
    const handlers = this.subscribers.get(channelId) ?? new Set<Handler>();
    handlers.add(handler);
    this.subscribers.set(channelId, handlers);

    return () => {
      handlers.delete(handler);
      // Dropping the empty set keeps the map from growing by one entry per channel ever
      // visited by anyone.
      if (handlers.size === 0) this.subscribers.delete(channelId);
    };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.subscribers.clear();
    await this.client?.end();
    this.client = null;
  }
}
