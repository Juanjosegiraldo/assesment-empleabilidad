import { DomainError, conflict, forbidden, invalidInput, notFound, unauthorized } from "../../domain/errors.js";

/**
 * Turns a PostgreSQL error into a domain error.
 *
 * The database is where the permission rules live, so it is also where most of the
 * meaningful failures come from. This is the adapter that stops "SQLSTATE RW403" from
 * reaching a controller and becoming a generic 500.
 *
 * RW4xx are this project's own codes, raised by the functions in 003_functions.sql.
 * The rest are standard PostgreSQL classes.
 */
const CODE_MAP: Record<string, (message: string) => DomainError> = {
  RW401: () => unauthorized(),
  RW403: () => forbidden("You do not have access to this resource"),
  RW404: () => notFound(),
  RW422: (message) => invalidInput(message),

  // insufficient_privilege: an RLS policy rejected the row, or rw_app tried a statement
  // it holds no grant for, such as a physical DELETE. Both mean "not allowed", not
  // "the server broke", so they are a 403 rather than a 500.
  "42501": () => forbidden("You do not have access to this resource"),
  // unique_violation
  "23505": () => conflict("That value already exists"),
  // check_violation, e.g. an empty message body or a password that is not a bcrypt hash
  "23514": (message) => invalidInput(message),
  // foreign_key_violation
  "23503": () => invalidInput("References a record that does not exist"),
};

type PostgresError = { code?: string; message?: string };

const isPostgresError = (error: unknown): error is PostgresError =>
  typeof error === "object" && error !== null && "code" in error;

export function mapDatabaseError(error: unknown): unknown {
  // Already translated, or thrown by a use case. Leave it alone.
  if (error instanceof DomainError) return error;
  if (!isPostgresError(error) || !error.code) return error;

  const build = CODE_MAP[error.code];
  if (!build) return error;

  return build(error.message ?? "Database error");
}
