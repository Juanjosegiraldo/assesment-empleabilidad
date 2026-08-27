import type { NextFunction, Request, Response } from "express";
import { DomainError, type DomainErrorCode } from "../../../domain/errors.js";

/**
 * The single place where a failure becomes an HTTP response.
 *
 * This is the other half of the translation that started in mapDatabaseError: a
 * PostgreSQL SQLSTATE became a DomainError there, and becomes a status code here. The
 * domain never learns what HTTP is.
 */
const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_input: 422,
  conflict: 409,
};

export type ErrorBody = {
  error: {
    code: string;
    message: string;
    correlationId: string;
  };
};

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  // Express only recognises a middleware as an error handler if it declares four
  // parameters, so next has to stay even though it is unused.
  _next: NextFunction,
): void {
  if (error instanceof DomainError) {
    res.status(STATUS_BY_CODE[error.code]).json({
      error: { code: error.code, message: error.message, correlationId: req.correlationId },
    } satisfies ErrorBody);
    return;
  }

  // Anything reaching this point is a bug. Log it in full, and tell the client nothing
  // beyond the correlation id: an unexpected error message can carry a SQL fragment, a
  // file path or a column name.
  console.error(
    JSON.stringify({
      level: "error",
      correlationId: req.correlationId,
      method: req.method,
      path: req.originalUrl,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }),
  );

  res.status(500).json({
    error: {
      code: "internal_error",
      message: "Something went wrong",
      correlationId: req.correlationId,
    },
  } satisfies ErrorBody);
}

/** 404 for anything no route matched, in the same envelope as every other error. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: "not_found",
      message: `No route for ${req.method} ${req.path}`,
      correlationId: req.correlationId,
    },
  } satisfies ErrorBody);
}
