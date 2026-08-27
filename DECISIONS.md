# Decisions

Every entry is a decision that could reasonably have gone the other way. Context, what was
chosen, what was rejected, and what it costs. The cuts made under the eight hour limit are
in their own section at the end, because a scope decision is still a decision.

---

## 1. No ORM

**Context.** The assessment requires the critical logic to live inside PostgreSQL:
transactional functions, row level security, stored procedures, triggers, views.

**Decision.** Direct `pg` with parameterised queries. No Prisma, no TypeORM, no query
builder.

**Alternatives.** Prisma would have given typed models and migrations for free.

**Consequences.** An ORM's whole value is hiding SQL, and here the SQL is the deliverable.
Calling `rw_send_message` through Prisma means `$queryRaw`, which is the ORM's escape
hatch: all of the dependency, none of the benefit. Writing every query by hand also means
every query can be explained during the defence, which the assessment explicitly requires.
The cost is manual row-to-object mapping in each repository, which is why that mapping is
confined to `infrastructure/repositories/` and appears nowhere else.

---

## 2. Vectors inside PostgreSQL, not in a dedicated vector store

**Context.** The copilot needs semantic retrieval over messages, and must never retrieve a
message the asker could not read.

**Decision.** `pgvector` in the same database, in `rw_message_embeddings`.

**Alternatives.** Qdrant, Pinecone or Chroma, all better at pure vector search at scale.

**Consequences.** This is the single most load bearing decision in the project. With an
external store, the permission model would have to be reimplemented on the retrieval path
and kept in sync with the channel memberships, and that synchronisation is exactly where
copilots leak. Keeping vectors in PostgreSQL makes retrieval an ordinary `SELECT`, so the
same RLS policies that govern reading a channel govern what the copilot can see. There is
no second permission system, because there is no second store. The cost is that HNSW in
PostgreSQL will not match a specialised engine at tens of millions of vectors, which this
system is nowhere near.

---

## 3. Row level security, not permission checks in the API

**Context.** The non negotiable requirement is that no user can read, search, or reach
through the copilot any content they do not have access to.

**Decision.** Policies in the database, with the API connecting as `rw_app`, a role with
`NOBYPASSRLS`, pinning the actor per transaction with
`set_config('app.current_user_id', $1, true)`.

**Alternatives.** Filtering by membership in every query, which is faster to write and
easier to read.

**Consequences.** A check in the API protects only the paths that remember to run it. One
forgotten `WHERE` clause, one new endpoint, one script connecting straight to the database,
and the rule is gone. In the database the rule is unconditional. It also means a whole
class of code does not exist: no repository filters by membership, because doing so would
be a second copy of a rule that already exists, and two copies drift.

The cost is that failures are less obvious. A policy denial surfaces as an empty result or
a generic error, which is why the write paths go through functions that check first and
raise a specific `RW403`, and why `rw_current_actor_id()` raises rather than returning null
when the actor was never pinned.

---

## 4. The security policy says nothing about `deleted_at`

**Context.** Found while testing the soft delete: `rw_delete_message` failed with
`new row violates row-level security policy`, on a statement that was plainly legal.

**Decision.** The `SELECT` policy on `rw_messages` filters by channel membership only. The
lifecycle filter lives in the queries: the conversations view, the history query, the search
function and the copilot retrieval each filter `deleted_at is null`.

**Alternatives.** Keeping `and deleted_at is null` in the policy, which reads as defence in
depth and means no query has to remember.

**Consequences.** It cannot work. PostgreSQL applies the `SELECT` policy to the row an
`UPDATE` produces, so a policy demanding `deleted_at is null` makes the very statement that
sets `deleted_at` illegal. Verified by removing the clause and watching the update succeed.

The general principle is worth more than the fix: **a security policy answers "is this row
yours to see", not "is this row still active".** Mixing authorisation with lifecycle breaks
both. The cost is that a new read path has to remember the filter, so the requirement is
stated at the top of `002_rls.sql` where anyone editing the policies will read it.

---

## 5. Two AI providers, one interface

**Context.** The assessment requires the AI provider to be interchangeable through a
specific interface such as the OpenAI SDK.

**Decision.** Two ports in the domain, `ChatProvider` and `EmbeddingProvider`. Chat runs on
NVIDIA NIM (`openai/gpt-oss-20b`), embeddings on Ollama locally (`nomic-embed-text`). Both
adapters use the OpenAI SDK against different base URLs.

**Alternatives.** One provider for both, and a single `LlmProvider` port.

**Consequences.** Interchangeability is demonstrated rather than promised: two
implementations of the same wire format, one remote and one local, run at the same time.
The corpus never leaves the machine to be indexed. Splitting the port is interface
segregation applied literally: a use case that embeds a query is not handed the ability to
spend money on completions.

The cost is two sets of credentials and two failure modes. The embedding dimension is also
now a property of the chosen model rather than a free choice, which is why
`AI_EMBEDDING_DIMENSIONS` exists and why the provider validates every vector against it.

---

## 6. `gpt-oss-20b` reasons before answering

**Context.** The first call to the chat model returned an empty `content` field and a full
`reasoning_content`.

**Decision.** `max_tokens: 1024` and `reasoning_effort: "low"`. The adapter throws an
explicit error when `content` comes back empty.

**Consequences.** Measured on this endpoint: with a 64 token budget, all 64 were spent on
reasoning and the answer was empty; at 512 the answer arrived using 57. The budget has to
cover the thinking as well as the answer.

This is the honest edge of "the provider is interchangeable". The interface is portable;
the operating characteristics of a specific model are not, and pretending otherwise
produces a system that silently returns empty answers. Hence the explicit error rather than
a shrug.

---

## 7. Retrieval threshold of 0.35 cosine distance

**Context.** Retrieving the top 8 passages always returns 8, however unrelated the question.
Feeding those to the model invites invention.

**Decision.** Discard passages beyond 0.35, and when none survive, refuse without calling
the model at all.

**Consequences.** Measured against this corpus with `nomic-embed-text`: questions the corpus
can answer had a closest match between 0.162 and 0.279; questions it cannot ("what is the
recipe for bandeja paisa") bottomed out at 0.375 and 0.394. 0.35 sits in the gap.

The refusal becomes structural rather than behavioural: there is nothing to answer from, so
there is no opportunity to invent. It also costs zero tokens, which is visible in the
response and asserted in the tests.

The number is specific to this model and this corpus. Changing the embedding model means
measuring again, and that is written next to the constant.

---

## 8. "Insufficient context", never "you lack permission"

**Context.** When someone asks the copilot about a channel they do not belong to, retrieval
returns nothing.

**Decision.** Answer `insufficient_context`.

**Alternatives.** `no_permission`, which is more informative and arguably more honest.

**Consequences.** Distinguishing "does not exist" from "exists but is not yours" is itself
the leak. Confirming that a conversation about a salary adjustment exists somewhere is most
of what an attacker wanted. The same reasoning is why reading an inaccessible channel
returns an empty list rather than 403, and why the API's `RW404` covers both cases.

`no_permission` is still one of the three refusals, produced when someone explicitly demands
another channel's contents, where no existence is confirmed by saying so.

---

## 9. Keyset pagination, not `OFFSET`

**Context.** Required by the assessment, but it is worth stating why.

**Decision.** Cursors over `(created_at, id)`, encoded base64.

**Consequences.** `OFFSET` makes the database read and discard every skipped row, so page
fifty costs fifty times page one. Worse in a chat: if somebody posts while the user scrolls
up, every later row shifts by one and the next page repeats or skips a message. A cursor is
anchored to a row, so concurrent inserts cannot move it.

Measured with 50,000 messages in one channel: the keyset query returns in 0.69 ms with
`actual rows=10`, using `Index Only Scan` and no `Sort` node. The same page via
`OFFSET 40000` also uses the index but has to walk all 40,010 rows to return 10.

The `id` in the cursor is not decoration: two messages can share a `created_at`, and without
a tiebreaker the cursor is ambiguous.

---

## 10. Search ordered by recency, not relevance

**Context.** Search must be paginated, and `OFFSET` is forbidden.

**Decision.** Order by `created_at desc, id desc`, keyset paginated, exactly like the
history.

**Alternatives.** Ordering by `ts_rank`.

**Consequences.** A keyset cursor over a computed rank means carrying a float through the
client and recomputing the rank inside the `WHERE` clause on every page, which breaks the
moment the ranking weights change. For a chat search, newest first is also what people
expect. The cost is that an old, highly relevant message ranks below a recent, marginal one.

---

## 11. A custom `rw_spanish` text search configuration

**Context.** Searching `paginacion` returned nothing, because the corpus says `paginación`.
The seeded corpus contains a message where this is reported as a real bug, which turned out
to be accurate.

**Decision.** A configuration copying `spanish` with `unaccent` inserted before the stemmer,
applied to both the stored vector and the query.

**Consequences.** In a Spanish corpus where people type both ways, this is not an edge case,
it is the normal case. Both spellings now find each other, in both directions, case
insensitively.

Note that `unaccent()` on its own is `STABLE`, not `IMMUTABLE`, so it cannot be used
directly in an index expression. Inside a text search configuration mapping it is fine,
because `to_tsvector('rw_spanish', body)` is immutable when the configuration is a literal.
The cost is that changing the configuration requires recomputing every stored vector, which
is why the backfill in `004_search.sql` runs unconditionally.

---

## 12. A trigger for the search vector, when a generated column would work

**Context.** The assessment requires at least one trigger keeping the search vector
consistent.

**Decision.** A `BEFORE INSERT OR UPDATE OF body` trigger.

**Alternatives.** `GENERATED ALWAYS AS (to_tsvector('rw_spanish', body)) STORED`, which
would work: the two argument `to_tsvector` is immutable with a literal configuration.

**Consequences.** Stated plainly because it will be asked: a generated column is a valid
alternative here. The trigger is used because the assessment asks for one, and because it
leaves room to index more than the body later, a channel name or an attachment caption,
without rewriting the column definition and rebuilding the table. `BEFORE` rather than
`AFTER` means the value is assigned on the way in, with no second write and no window where
a message exists without its vector.

---

## 13. Server sent events, not WebSockets

**Context.** Messaging has to work in real time.

**Decision.** A trigger calling `pg_notify`, one `LISTEN` connection in the API, and SSE to
the browser. Sending a message stays an ordinary `POST`.

**Alternatives.** WebSockets, or Socket.IO.

**Consequences.** The traffic is one directional, server to browser. SSE runs over ordinary
HTTP, crosses proxies without special configuration, and adds no dependency and no second
protocol to defend. A WebSocket would buy bidirectional capability this system does not use.

`NOTIFY` delivers at `COMMIT`, not when `pg_notify` runs, so a message inserted in a
transaction that later rolls back is never announced. A browser cannot show a message that
does not exist.

The cost is a per process connection limit and no built in backpressure, neither of which
binds at this scale.

---

## 14. The notification payload carries only identifiers

**Context.** `pg_notify` allows up to 8000 bytes, easily enough for a message body.

**Decision.** Send `{message_id, channel_id}` and nothing else. Each subscriber re-reads the
message as its own actor.

**Consequences.** This is a security decision, not a size one. The API holds one connection
listening for every channel in the company. If bodies rode along, that process would hold
content it must not hand to the wrong subscriber, and correctness would depend on the
dispatch code filtering right. Sending only ids means row level security decides again, per
person, at delivery time: someone removed from a channel a second ago receives nothing.

The cost is one query per subscriber per message.

---

## 15. `fetch` for the event stream, not `EventSource`

**Context.** `EventSource` is the browser's native SSE client.

**Decision.** Read the stream with `fetch` and parse the frames by hand.

**Consequences.** `EventSource` cannot send an `Authorization` header. The usual workaround
puts the access token in the query string, and a token in a URL ends up in the server access
log, in browser history, and in any `Referer` the page sends. That is a real credential leak
in exchange for saving thirty lines.

The wire format is unchanged, still `text/event-stream`; only the client differs. What is
given up is automatic reconnection, so the hook reconnects itself, including refreshing the
access token when the server rejects an expired subscription.

---

## 16. bcrypt for passwords, SHA-256 for refresh tokens

**Context.** Both are secrets stored as digests.

**Decision.** bcrypt at cost 10 for passwords; a plain SHA-256 of 32 random bytes for
refresh tokens.

**Consequences.** bcrypt is slow deliberately, because a human password has little entropy
and each guess must be made expensive. A refresh token carries 256 bits from the system
random source: there is no dictionary to run against it, and no cost factor makes brute
force less impossible than it already is. What hashing buys there is that a database dump
contains no usable tokens. SHA-256 is also fast, which matters because every refresh
performs a lookup by hash.

---

## 17. Refresh rotation with reuse detection, and where the revocation commits

**Context.** An access token cannot be revoked once issued, so it is short lived, and
continuity comes from a refresh token that can be.

**Decision.** Every refresh consumes its token and writes a replacement recording
`rotated_from_id`. Presenting an already consumed token revokes every token of the account.

**Consequences.** A valid token can be presented exactly once, so a stolen one and the real
one cannot both keep working: the second use trips the detector and ends every session. The
legitimate user signs in again; the thief gets nothing.

The subtlety is where the revocation commits. The first implementation threw an exception on
the reuse path, which travelled out through `withoutActor`, rolled the transaction back, and
undid the revocation. The attack was detected and quietly forgiven. Caught by the test that
inspected the token chain afterwards.

The fix is that `refreshSession` returns a typed outcome instead of throwing. The caller
commits the transaction and then renders the refusal. **Reuse detection is a successful
transaction with an unhappy outcome, not a failure.**

---

## 18. The application role holds no `DELETE` grant

**Context.** Physical deletion of messages is forbidden.

**Decision.** `rw_app` is granted `SELECT`, `INSERT` and `UPDATE`. Never `DELETE`, never
`TRUNCATE`.

**Consequences.** The ban is not a convention a developer has to remember. `DELETE FROM
rw_users` as `rw_app` answers `permission denied for table rw_users`. Three independent
mechanisms have to be defeated to physically remove a message: the missing grant, the
absence of a delete policy, and the fact that no code path issues one.

The cost is that the seed loader and the embedding indexer connect as the owner instead,
which is correct: they are administrative tools, not the application.

---

## 19. `bigint identity` keys, not `uuid`

**Context.** Every entity needs a primary key, and the choice has to be justified.

**Decision.** `bigint generated always as identity` for entities, composite natural keys for
the associative tables, and an identifying key for `rw_message_embeddings`.

**Consequences.** Keyset pagination needs a monotonic tiebreaker: two messages can share a
`created_at`, and a random `uuid` would order arbitrarily inside the tie, skipping or
repeating rows across pages. `bigint` is also 8 bytes against 16 and appends to the right
edge of the B-tree instead of scattering writes.

The usual argument for `uuid` is preventing id enumeration, and it does not apply: a guessed
id is worthless because row level security makes the row invisible unless the actor is a
member, and the API never accepts a user id from the client. Security lives in RLS, not in
key opacity.

---

## 20. Delivery status is not in the database

**Context.** The interface has to show `pending`, `sent` and `failed`.

**Decision.** Those are client side states of an optimistic send. Read state, which is
shared, does live in the database, in `rw_message_reads`.

**Consequences.** A message only reaches the database once the send succeeded, so persisting
`pending` would store a state nobody else could ever observe. The distinction is between
state that belongs to one browser and state that belongs to the conversation.

---

## What was cut, and why

The assessment asks for the MVP to be prioritised and the cuts to be justified. These were
decided during the eight hours, not afterwards.

**Creating and administering channels.** Channels and memberships come from the seed and are
managed through the owner connection. There is no `INSERT` policy on `rw_channels` and no
endpoint. Adding them means an invitation flow, a membership role model and an
administrative interface, none of which the assessment asks for, while the security
requirement it does ask for is fully exercised by the seeded channels.

**Presence and typing indicators.** Real time delivery of messages is required; knowing who
is online is not. Both would need a second class of ephemeral event and a heartbeat.

**File attachments.** Would require object storage, upload limits, content type validation
and a separate authorisation path for downloads. A large surface for no requirement.

**Reactions and threads.** Ordinary chat features, absent from the brief.

**Relevance ranked search.** Explained in decision 10.

**Rate limiting on login.** The seeded corpus itself contains an incident report proposing
it. A brute force attempt is slowed by bcrypt but not stopped, and a per IP and per account
limit is what production needs. It is the first thing to add after this.

**Refresh token cleanup.** Revoked and expired rows accumulate forever. A scheduled job to
prune them past their expiry is a few lines, and irrelevant at this scale.

**A separate test database.** The integration tests run against the seeded development
database. Every assertion is read only or expected to fail, so the corpus is left as found,
and `npm run db:seed -- --reset` restores it. A dedicated database with per test transactions
rolled back would be cleaner and was not worth the setup time here.
