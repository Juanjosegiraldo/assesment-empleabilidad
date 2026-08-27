# Riwi Messaging Platform

Internal messaging platform for Riwi Co. S.A.S.: channels, messages, read states, search
and an AI copilot that can only answer with information the signed in user is allowed to
see.

The requirement everything else is built around is a negative one: **no user can read,
search or reach through the copilot any content they do not have access to.** That rule is
enforced by PostgreSQL row level security, not by the API, so a bug in a controller cannot
leak a private channel.

| Layer | Choice |
| --- | --- |
| Database | PostgreSQL 16 with `pgvector` and a custom `rw_spanish` text search configuration |
| API | Node 22, TypeScript, Express 5, `pg` (no ORM), clean architecture |
| Web | Next.js 16, React 19, Tailwind CSS 4 |
| Chat model | NVIDIA NIM, `openai/gpt-oss-20b` |
| Embeddings | Ollama running locally, `nomic-embed-text` (768 dimensions) |
| Realtime | `pg_notify` → `LISTEN` → server sent events |

Further reading: [`docs/ERD.md`](docs/ERD.md) for the data model and the normalization
walkthrough, [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the layering, and
[`DECISIONS.md`](DECISIONS.md) for why each choice was made and what was cut.

## Requirements

- Docker and Docker Compose
- Node.js 22 or newer
- `psql` client 15 or newer (the migration runner uses it)
- [Ollama](https://ollama.com) on the host, for embeddings
- An API key from [build.nvidia.com](https://build.nvidia.com), for the chat model

## Setup on a clean machine

```bash
# 1. Configuration. Fill in AI_CHAT_API_KEY; the rest works as it comes.
cp .env.example .env

# 2. The embedding model runs locally, so the corpus is never sent anywhere to be indexed.
ollama pull nomic-embed-text

# 3. Dependencies
npm install

# 4. Database
npm run db:up          # PostgreSQL 16 + pgvector, waits until healthy
npm run db:migrate     # every file in db/migrations, in order
npm run db:seed        # loads db/seed.json
npm run db:index       # builds the embeddings the copilot retrieves from

# 5. Run it
npm run api:dev        # http://localhost:4000
npm run web:dev        # http://localhost:3000
```

Open <http://localhost:3000>.

### Signing in

Every seeded account uses the password `Riwi2026*`.

| Account | Belongs to | Use it to see |
| --- | --- | --- |
| `juan.jose.giraldo@riwi.io` | 3 public channels | the normal experience, and the copilot refusing |
| `daniela.pineda@riwi.io` | + Dirección Financiera (private) | the same question, answered |
| `andres.quintero@riwi.io` | + Incidentes de Seguridad (private) | a different private channel |

Signing in as the first two and asking the copilot **the same question** is the fastest way
to see the whole design at work. Details in [`docs/EVIDENCE.md`](docs/EVIDENCE.md).

## Commands

| Command | What it does |
| --- | --- |
| `npm run db:up` / `db:down` | start / stop PostgreSQL |
| `npm run db:migrate` | apply migrations; safe to rerun |
| `npm run db:seed` | load the corpus; `-- --reset` wipes and reloads |
| `npm run db:index` | embed messages that have no vector; `-- --reset` rebuilds all |
| `npm run db:psql` | a psql shell inside the container |
| `npm run api:dev` / `web:dev` | run the API / the web app |
| `npm test` | integration tests against the real database |
| `npm run evidence` | regenerate the screenshots in `docs/evidence/` |

## Tests

```bash
npm test
```

Thirteen tests against real PostgreSQL. Nothing is mocked, because what is under test is
whether the **database** refuses. Each rule is asserted twice, once through HTTP and once
by calling the database directly with the actor pinned, and each has a positive control so
a policy that denied everything to everybody could not pass.

They run against the seeded development database. Every assertion is read only or expected
to fail, so the corpus is left as found; `npm run db:seed -- --reset` restores it.

## API documentation

With the API running:

- Swagger UI: <http://localhost:4000/docs>
- Raw spec: <http://localhost:4000/openapi.yaml>, also at
  [`docs/openapi.yaml`](docs/openapi.yaml)

Worth knowing before reading it: a channel the caller does not belong to is **invisible**,
not forbidden. Reading its history returns an empty list rather than 403, because answering
403 would confirm the channel exists.

## Seeing the security model directly

The clearest demonstration is not in the interface. Two actors, one query:

```bash
set -a && source .env && set +a
psql "postgresql://rw_app:$APP_DB_PASSWORD@localhost:$POSTGRES_PORT/$POSTGRES_DB"
```

```sql
-- Looking the id up through rw_users would fail here, and that is the point: without an
-- actor pinned, rw_current_actor_id() raises. rw_find_login_identity is the audited
-- SECURITY DEFINER function the sign in path uses, and the only way in before anyone is
-- authenticated.
select set_config('app.current_user_id',
    (select id::text from rw_find_login_identity('juan.jose.giraldo@riwi.io')), false);

select count(*) from rw_messages;          -- 38
select slug from rw_channels order by 1;   -- two channels are simply absent

-- Now as somebody who is a member of Dirección Financiera
select set_config('app.current_user_id',
    (select id::text from rw_find_login_identity('daniela.pineda@riwi.io')), false);

select count(*) from rw_messages;          -- 26
select slug from rw_channels order by 1;   -- a different set

-- Forging a sender is rejected by the policy, not by the API
insert into rw_messages (channel_id, sender_id, body)
values ((select id from rw_channels limit 1), 999, 'nope');
```

The API connects as this same `rw_app` role, which has `NOBYPASSRLS`. It has no privilege
the psql session above does not have.

## Repository layout

```
apps/api     backend: domain / application / infrastructure / interfaces
apps/web     frontend: app router, components, i18n catalogues
db           migrations, seed corpus, scripts, and the four required queries
docs         data model, architecture, OpenAPI spec, evidence
scripts      the screenshot capture used for docs/evidence
```
