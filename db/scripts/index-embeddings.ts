/**
 * Builds the vector index the copilot retrieves from.
 *
 * Embeddings are derived data: every one of them can be rebuilt from the message body it
 * came from. That is why this script is resumable rather than transactional. It only
 * looks at messages that have no vector yet, so an interrupted run is continued by
 * running it again, and a finished run is a no op.
 *
 * It connects as the database owner on purpose. Indexing has to cover every channel,
 * including ones no single user can read, and rw_app is bound by row level security by
 * design. Permission filtering belongs on the retrieval side, where an actor exists.
 *
 * Usage:
 *   npm run db:index              index whatever is missing
 *   npm run db:index -- --reset   drop every vector and rebuild
 */
import { Client } from "pg";
import { OpenAiCompatibleEmbeddingProvider } from "../../apps/api/src/infrastructure/ai/OpenAiCompatibleEmbeddingProvider.js";
import "dotenv/config";

/** Small enough to stay responsive, large enough that the HTTP overhead disappears. */
const BATCH_SIZE = 32;

async function main() {
  const reset = process.argv.includes("--reset");

  const connectionString = process.env.DATABASE_ADMIN_URL;
  if (!connectionString) throw new Error("DATABASE_ADMIN_URL is not set. See .env.example.");

  const model = process.env.AI_EMBEDDING_MODEL ?? "nomic-embed-text";
  const dimensions = Number(process.env.AI_EMBEDDING_DIMENSIONS ?? 768);

  const embeddings = new OpenAiCompatibleEmbeddingProvider(
    {
      baseUrl: process.env.AI_EMBEDDING_BASE_URL ?? "http://localhost:11434/v1",
      apiKey: process.env.AI_EMBEDDING_API_KEY ?? "ollama",
    },
    model,
    dimensions,
  );

  const client = new Client({ connectionString });
  await client.connect();

  try {
    if (reset) {
      await client.query("delete from rw_message_embeddings");
      console.log("Existing vectors removed.");
    }

    const pending = await client.query<{ id: number; body: string }>(
      `select m.id, m.body
       from rw_messages m
       left join rw_message_embeddings e on e.message_id = m.id
       where m.deleted_at is null
         and e.message_id is null
       order by m.id`,
    );

    if (pending.rowCount === 0) {
      console.log("Every message already has an embedding.");
      return;
    }

    console.log(`Indexing ${pending.rowCount} messages with ${model} (${dimensions} dimensions).`);

    let done = 0;
    for (let offset = 0; offset < pending.rows.length; offset += BATCH_SIZE) {
      const batch = pending.rows.slice(offset, offset + BATCH_SIZE);
      const vectors = await embeddings.embed(
        batch.map((row) => row.body),
        // These are documents being stored, not a question being asked.
        "passage",
      );

      // One transaction per batch, so an interruption loses at most one batch and the
      // next run picks up exactly where this one stopped.
      await client.query("begin");
      for (const [index, row] of batch.entries()) {
        await client.query(
          `insert into rw_message_embeddings (message_id, embedding, model)
           values ($1, $2::vector, $3)
           on conflict (message_id) do update set embedding = excluded.embedding, model = excluded.model`,
          [row.id, `[${vectors[index]!.join(",")}]`, model],
        );
      }
      await client.query("commit");

      done += batch.length;
      process.stdout.write(`\r  ${done}/${pending.rowCount}`);
    }

    process.stdout.write("\n");
    console.log("Done.");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
