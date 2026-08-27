# Architecture

How the API is put together, why the layers sit in that order, and where each SOLID
principle is visible in an actual file.

This document grows with the project. Everything described here exists in the repository
today; anything not yet built is listed at the end.

## The layers

```
              ┌─────────────────────────────────────────────┐
              │  interfaces/http                            │
              │  express routers, middlewares, controllers  │
              └───────────────────┬─────────────────────────┘
                                  │ calls
              ┌───────────────────▼─────────────────────────┐
              │  application                                │
              │  use cases: validate, orchestrate, map      │
              └───────────────────┬─────────────────────────┘
                                  │ depends on interfaces from
              ┌───────────────────▼─────────────────────────┐
              │  domain                          ← the core │
              │  entities, ports, errors                    │
              │  imports nothing from the outside           │
              └───────────────────▲─────────────────────────┘
                                  │ implements
              ┌───────────────────┴─────────────────────────┐
              │  infrastructure                             │
              │  pg repositories, AI provider, JWT, bcrypt   │
              └─────────────────────────────────────────────┘

              main.ts  builds the concrete adapters and injects them
```

Arrows point inwards. `infrastructure` sits at the bottom of the drawing but depends
*upwards* on the domain: it implements interfaces the domain declares. That inversion is
the whole point of the shape, and it is what makes the AI provider swappable and the
domain testable without a database.

### The rule, stated so it can be checked

`apps/api/src/domain/` must not import `express`, `pg`, `openai`, or anything else from
outside the project. It is verifiable in one command:

```bash
grep -rE "from \"(express|pg|openai|jsonwebtoken|bcryptjs)" apps/api/src/domain/
```

An empty result means the rule holds.

## The path of a request

Sending a message, end to end:

```
browser
  │  POST /channels/12/messages   Authorization: Bearer <access token>
  ▼
correlationId          assigns x-correlation-id, echoes it on the response
  ▼
requireAuth            verifies the JWT, sets req.actorId
  │                    the actor comes from the token and from nowhere else
  ▼
controller             parses and validates the body
  ▼
use case               orchestrates, depends only on ports
  ▼
withActor(actorId)     begin
  │                    select set_config('app.current_user_id', $1, true)
  ▼
repository             select * from rw_send_message($1, $2)
  ▼
PostgreSQL             the function checks membership       → RW403 if not a member
  │                    RLS policies filter every statement
  ▼                    commit
mapDatabaseError       SQLSTATE RW403 → DomainError("forbidden")
  ▼
errorHandler           DomainError("forbidden") → HTTP 403, uniform envelope
```

Two things are worth pausing on.

**Security is checked twice, by two different systems.** The API knows who the actor is
because it verified a signature. The database knows because the actor was pinned into the
transaction, and it enforces membership through RLS regardless of what the API believes.
Neither trusts the other. A bug in a controller cannot leak a private channel, because
the query that would leak it returns nothing.

**`withActor` is the only door between them.** It lives in
`infrastructure/db/withActor.ts` and does four things in order: take a pooled connection,
open a transaction, pin `app.current_user_id` as a **transaction local** setting, run the
work. That `true` in `set_config(..., true)` is load bearing. Pooled connections are
reused between requests; a session level setting would survive the commit and hand the
previous user's identity to whoever picks the connection up next.

## Error translation

A failure crosses two boundaries and is renamed at each one:

| Layer | Representation | Example |
| --- | --- | --- |
| PostgreSQL | SQLSTATE | `RW403` raised by `rw_send_message` |
| Domain | `DomainError` | `DomainError("forbidden")` |
| HTTP | status + envelope | `403 {"error":{"code":"forbidden","correlationId":"..."}}` |

`infrastructure/db/mapDatabaseError.ts` does the first translation,
`interfaces/http/middleware/errorHandler.ts` the second. The domain never learns that
HTTP exists, and the HTTP layer never learns that PostgreSQL exists.

Every error response uses the same envelope, including the 500, whose message is
deliberately generic: an unexpected error string can carry a SQL fragment or a column
name. The correlation id is what connects the user's report to the log line.

## SOLID, in files

Not a checklist recited from a textbook. Each of these points at a file in this
repository.

**Single responsibility.** `middleware/correlationId.ts` assigns an id and nothing else.
`db/mapDatabaseError.ts` translates errors and nothing else. `db/withActor.ts` manages a
transaction and nothing else. Each is short enough to read in one sitting, and each has
exactly one reason to change.

**Open/closed.** `mapDatabaseError.ts` holds a `CODE_MAP` table. Supporting a new
SQLSTATE means adding one entry; no caller changes, no conditional grows. The same shape
appears in `errorHandler.ts` with `STATUS_BY_CODE`.

**Liskov substitution.** `DomainError` extends `Error` and adds a `code`. Anywhere the
runtime expects an `Error` — a rejected promise, a `catch`, a stack trace — it behaves
like one. The error handler narrows with `instanceof` and falls through to the generic
path otherwise, so an unrecognised error type degrades to a 500 instead of crashing.

**Interface segregation.** Ports are defined by what a caller needs, not by what an
implementation offers. The copilot's `LlmProvider` will expose `embed` and `chat`, not
the surface of the OpenAI SDK, so a use case cannot reach for a capability it has no
business using.

**Dependency inversion.** `withActor` takes a callback rather than returning a client,
which means callers cannot forget to commit or to release. `main.ts` is the only file
that knows about every layer at once; it constructs the concrete adapters and injects
them, so nothing above infrastructure ever names a concrete class.

## Design patterns: what is used, and what is deliberately not

The assessment asks whether a pattern is necessary and, if applied, why.

**Used**

- **Repository.** Persistence hides behind an interface the domain declares, so a use
  case is written against `MessageRepository`, not against `pg`. It is what allows the
  RLS tests to exercise the real database while a use case test does not need one.
- **Adapter.** `NvidiaLlmProvider` will translate between the domain's `LlmProvider` port
  and the OpenAI compatible SDK. The assessment requires the AI provider to be
  interchangeable; an adapter is the pattern that requirement describes.

**Deliberately not used**

- **No dependency injection container.** With one composition root and fewer than a dozen
  adapters, a container adds a configuration language and runtime indirection to solve a
  problem that `main.ts` solves in twenty readable lines.
- **No Strategy for the AI provider.** A port with one adapter *is* the seam. Adding a
  strategy interface on top of an interface would be indirection with no second
  implementation to justify it.
- **No Unit of Work.** PostgreSQL transactions already are one, and `withActor` already
  scopes them to a request. Rebuilding that in TypeScript would duplicate a guarantee the
  database gives for free.
- **No ORM.** The assessment requires the critical logic to live in PostgreSQL:
  functions, policies, procedures, triggers. An ORM's value is hiding SQL, which is
  precisely what must stay visible here. Written up in DECISIONS.md.

## Not built yet

Authentication, the channel and message endpoints, the copilot and the realtime stream
land in later commits. Their shape is described above so the layering can be checked as
they arrive.
