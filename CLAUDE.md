# Riwi Messaging Platform — working rules

Internal messaging platform for Riwi Co. S.A.S. Read these rules before writing any code.

## Language

- All code, identifiers, comments, commit messages and documentation: **English**.
- The conversation with me (the developer) is in Spanish.
- User facing text lives in `apps/web/messages/{es,en}.json`. Never hardcode a visible
  string inside a component.

## Git

- Never add "Generated with Claude Code", "Co-Authored-By: Claude" or any similar
  trailer to a commit message. Ever.
- Commit messages: conventional commits, one short lowercase line, no emoji.
  Example: `feat(db): add row level security policies for channels and messages`
- Do not run `git commit` unless I explicitly ask for it. I review the diff and commit
  myself.

## Code style

- Plain, boring, readable TypeScript. No clever tricks, no premature abstraction.
- Small files. One use case per file.
- Comments explain *why*, not *what*. Comment every non obvious SQL clause.
- No ORM. Database access goes through `pg` with **parameterized queries only**.
  Building SQL by string concatenation is forbidden by the assessment.
- Never `SELECT *` in production queries.
- No DI containers, no decorators, no metaprogramming.

## Architecture (apps/api)

```
domain/          entities and ports (interfaces). Never imports express, pg or openai.
application/     use cases. Depend on ports only.
infrastructure/  adapters: PostgresRepositories, NvidiaLlmProvider, JwtTokenService.
interfaces/http/ express routers, controllers, middlewares, error handler.
main.ts          composition root: builds the concrete adapters and injects them.
```

Dependencies always point inwards, towards the domain.

## Database rules (non negotiable, taken from the assessment)

- Every table and column name is in English and prefixed with `rw_`.
- All timestamps are `timestamptz` stored in UTC.
- No physical deletes. Use a `deleted_at` column.
- No `OFFSET` pagination. Use keyset pagination over `(created_at, id)`.
- The application connects as role `rw_app`, which has **no** `BYPASSRLS`.
- Every request opens a transaction and pins the actor with
  `SELECT set_config('app.current_user_id', $1, true)` before running any query.
- Permissions are enforced in the database (RLS plus functions), not only in the API.

## Testing

- `vitest` against a real PostgreSQL container. The database is never mocked.

## Scope discipline

- Do exactly what the current step asks. Do not scaffold future steps.
- If something is ambiguous, ask me instead of inventing.
