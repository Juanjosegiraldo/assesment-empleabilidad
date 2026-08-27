import { pool, type DbClient } from "./pool.js";
import { mapDatabaseError } from "./mapDatabaseError.js";

/**
 * Runs a unit of work as a specific user.
 *
 * This is the single point where the authenticated identity crosses from the API into
 * the database, and it is the reason row level security works at all:
 *
 *   1. take a connection out of the pool
 *   2. open a transaction
 *   3. pin the actor with set_config('app.current_user_id', id, true)
 *   4. run the work
 *   5. commit, or roll back if anything threw
 *
 * The third argument of set_config is `true`, which makes the setting transaction local.
 * That detail is load bearing. Pooled connections are reused across requests, and a
 * session level setting would survive the commit and leak the previous user's identity
 * into whoever picks up that connection next. Transaction local means it disappears with
 * the transaction, every time.
 *
 * The actor id comes from the verified access token and from nowhere else. No route
 * accepts a user id in a path, a query string or a body.
 */
export async function withActor<T>(
  actorId: number,
  work: (client: DbClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query("select set_config('app.current_user_id', $1, true)", [String(actorId)]);

    const result = await work(client);

    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {
      // The rollback can itself fail if the connection died. The original error is the
      // interesting one, so swallow this and let it propagate below.
    });
    throw mapDatabaseError(error);
  } finally {
    // Always, on every path. A leaked client is a connection the pool never gets back.
    client.release();
  }
}

/**
 * Runs a unit of work with no actor pinned, inside a transaction.
 *
 * Only for the paths that run before anyone is authenticated: signing in and refreshing
 * a session. Any query touching an RLS protected table will fail loudly here, because
 * rw_current_actor_id() raises when the setting is missing. That is intentional: it means
 * this helper cannot be used by accident to skip the security model.
 */
export async function withoutActor<T>(work: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw mapDatabaseError(error);
  } finally {
    client.release();
  }
}
