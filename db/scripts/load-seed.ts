/**
 * Loads db/seed.json into the database.
 *
 * seed.json is deliberately denormalized: one record per message, with the sender and
 * the channel repeated on every row, and channel_members and read_by as lists inside a
 * single field. That is the raw shape the business hands over. This script is where the
 * normalization documented in docs/ERD.md actually happens:
 *
 *   lists inside a field   -> rw_channel_members and rw_message_reads   (1NF)
 *   message attributes     -> rw_messages                               (2NF)
 *   sender and channel     -> rw_users and rw_channels                  (3NF)
 *
 * Everything runs inside a single transaction, so a failure halfway leaves no partial
 * corpus behind.
 *
 * Usage:
 *   npm run db:seed             load, skipping if the corpus is already there
 *   npm run db:seed -- --reset  wipe the tables first, then load
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import bcrypt from "bcryptjs";
import "dotenv/config";

const BCRYPT_ROUNDS = 10;

type SeedRecord = {
  message_id: number;
  channel_slug: string;
  channel_name: string;
  channel_topic: string;
  channel_is_private: boolean;
  channel_members: string[];
  sender_email: string;
  sender_full_name: string;
  sender_job_title: string;
  body: string;
  sent_at: string;
  read_by: string[];
};

type Seed = {
  default_password: string;
  records: SeedRecord[];
};

async function main() {
  const reset = process.argv.includes("--reset");

  // The seed loader connects as the database owner, not as rw_app. rw_app has no
  // DELETE privilege on purpose, and --reset needs one.
  const connectionString = process.env.DATABASE_ADMIN_URL;
  if (!connectionString) {
    throw new Error("DATABASE_ADMIN_URL is not set. Copy .env.example to .env first.");
  }

  const seedPath = resolve(import.meta.dirname, "..", "seed.json");
  const seed: Seed = JSON.parse(readFileSync(seedPath, "utf8"));

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query("begin");

    const existing = await client.query<{ count: string }>("select count(*) from rw_messages");
    if (Number(existing.rows[0].count) > 0) {
      if (!reset) {
        console.log("The corpus is already loaded. Run with --reset to reload it.");
        await client.query("rollback");
        return;
      }
      // Child tables first: the foreign keys to rw_messages and rw_users are RESTRICT
      // precisely so an accidental delete cannot silently drop history.
      await client.query("delete from rw_message_reads");
      await client.query("delete from rw_message_revisions");
      await client.query("delete from rw_message_embeddings");
      await client.query("delete from rw_messages");
      await client.query("delete from rw_channel_members");
      await client.query("delete from rw_channels");
      await client.query("delete from rw_refresh_tokens");
      await client.query("delete from rw_copilot_usage");
      await client.query("delete from rw_users");
      console.log("Previous corpus removed.");
    }

    // --- 3NF: one row per person, no matter how many messages they wrote -------
    const people = new Map<string, { fullName: string; jobTitle: string }>();
    for (const record of seed.records) {
      people.set(record.sender_email, {
        fullName: record.sender_full_name,
        jobTitle: record.sender_job_title,
      });
      // Members who never wrote a message still exist as users.
      for (const email of record.channel_members) {
        if (!people.has(email)) {
          people.set(email, { fullName: email, jobTitle: "Colaborador" });
        }
      }
    }

    const userIdByEmail = new Map<string, number>();
    for (const [email, person] of people) {
      // Every seed account shares the same demo password, documented in the README.
      // It is hashed here: the schema rejects anything that is not a bcrypt digest.
      const passwordHash = bcrypt.hashSync(seed.default_password, BCRYPT_ROUNDS);
      const inserted = await client.query<{ id: number }>(
        `insert into rw_users (email, password_hash, full_name, job_title, locale)
         values ($1, $2, $3, $4, 'es')
         on conflict (lower(email)) where deleted_at is null do nothing
         returning id`,
        [email, passwordHash, person.fullName, person.jobTitle],
      );

      if (inserted.rowCount === 1) {
        userIdByEmail.set(email, inserted.rows[0].id);
      } else {
        // Already present from a previous partial run: read the existing id back.
        const found = await client.query<{ id: number }>(
          "select id from rw_users where lower(email) = lower($1) and deleted_at is null",
          [email],
        );
        userIdByEmail.set(email, found.rows[0].id);
      }
    }

    // --- 3NF: one row per channel, not one per message ------------------------
    const channels = new Map<string, SeedRecord>();
    for (const record of seed.records) {
      if (!channels.has(record.channel_slug)) {
        channels.set(record.channel_slug, record);
      }
    }

    const channelIdBySlug = new Map<string, number>();
    for (const [slug, record] of channels) {
      // The first member listed is treated as the channel owner.
      const ownerId = userIdByEmail.get(record.channel_members[0])!;
      const inserted = await client.query<{ id: number }>(
        `insert into rw_channels (slug, name, topic, is_private, created_by)
         values ($1, $2, $3, $4, $5)
         on conflict (slug) do nothing
         returning id`,
        [slug, record.channel_name, record.channel_topic, record.channel_is_private, ownerId],
      );

      const channelId =
        inserted.rowCount === 1
          ? inserted.rows[0].id
          : (await client.query<{ id: number }>("select id from rw_channels where slug = $1", [slug]))
              .rows[0].id;
      channelIdBySlug.set(slug, channelId);
    }

    // --- 1NF: the channel_members list becomes one row per membership ---------
    let membershipCount = 0;
    for (const [slug, record] of channels) {
      const channelId = channelIdBySlug.get(slug)!;
      for (const [index, email] of record.channel_members.entries()) {
        const result = await client.query(
          `insert into rw_channel_members (channel_id, user_id, member_role)
           values ($1, $2, $3)
           on conflict (channel_id, user_id) do nothing`,
          [channelId, userIdByEmail.get(email), index === 0 ? "owner" : "member"],
        );
        membershipCount += result.rowCount ?? 0;
      }
    }

    // --- 2NF: message attributes live once, keyed by the message alone --------
    // Inserted in chronological order so the generated ids stay monotonic with
    // created_at, which is what keyset pagination relies on to break ties.
    const ordered = [...seed.records].sort((a, b) => a.sent_at.localeCompare(b.sent_at));

    const messageIdBySeedId = new Map<number, number>();
    for (const record of ordered) {
      const inserted = await client.query<{ id: number }>(
        `insert into rw_messages (channel_id, sender_id, body, created_at)
         values ($1, $2, $3, $4)
         returning id`,
        [
          channelIdBySlug.get(record.channel_slug),
          userIdByEmail.get(record.sender_email),
          record.body,
          record.sent_at,
        ],
      );
      messageIdBySeedId.set(record.message_id, inserted.rows[0].id);
    }

    // --- 1NF: the read_by list becomes one row per (message, reader) ----------
    let readCount = 0;
    for (const record of seed.records) {
      const messageId = messageIdBySeedId.get(record.message_id)!;
      for (const email of record.read_by) {
        const result = await client.query(
          `insert into rw_message_reads (message_id, user_id, read_at)
           values ($1, $2, $3)
           on conflict (message_id, user_id) do nothing`,
          [messageId, userIdByEmail.get(email), record.sent_at],
        );
        readCount += result.rowCount ?? 0;
      }
    }

    await client.query("commit");

    console.log("Corpus loaded:");
    console.log(`  users        ${userIdByEmail.size}`);
    console.log(`  channels     ${channelIdBySlug.size}`);
    console.log(`  memberships  ${membershipCount}`);
    console.log(`  messages     ${messageIdBySeedId.size}`);
    console.log(`  read states  ${readCount}`);
    console.log(`\nDemo password for every seeded account: ${seed.default_password}`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
