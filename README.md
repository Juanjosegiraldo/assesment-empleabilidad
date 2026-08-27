# Riwi Messaging Platform

Internal messaging platform for Riwi Co. S.A.S.: channels, messages, read states,
search, and an AI copilot that can only answer with information the authenticated
user is allowed to see.

Work in progress. This file grows with each step; the full setup guide lands at the end.

## Stack

| Layer | Choice |
| --- | --- |
| Database | PostgreSQL 16 with the `pgvector` extension |
| API | Node 22, TypeScript, Express, `pg` (no ORM) |
| Web | Next.js 15, React, Tailwind CSS |
| AI | NVIDIA NIM through the OpenAI compatible SDK |

## Requirements

- Docker and Docker Compose
- Node.js 22 or newer

## Getting started

```bash
cp .env.example .env      # then fill in the real values
npm run db:up             # starts PostgreSQL on the port set in .env
```

Check that the database is up:

```bash
docker compose ps
psql "$DATABASE_ADMIN_URL" -c "select version();"
```

## Repository layout

```
apps/api    backend, clean architecture
apps/web    frontend
db          migrations, seed corpus and required SQL queries
docs        assessment brief, data model and architecture notes
```
