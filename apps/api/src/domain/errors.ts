/**
 * The vocabulary the domain uses to describe a failure.
 *
 * Note what is missing: HTTP status codes. The domain does not know it is being served
 * over HTTP. Translating these into 401/403/404 is the job of the HTTP layer, in
 * interfaces/http/middleware/errorHandler.ts.
 */
export type DomainErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid_input"
  | "conflict";

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const unauthorized = (message = "Authentication required") =>
  new DomainError("unauthorized", message);

export const forbidden = (message = "Not allowed") => new DomainError("forbidden", message);

export const notFound = (message = "Not found") => new DomainError("not_found", message);

export const invalidInput = (message: string) => new DomainError("invalid_input", message);

export const conflict = (message: string) => new DomainError("conflict", message);
