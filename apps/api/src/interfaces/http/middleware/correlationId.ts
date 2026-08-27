import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const CORRELATION_HEADER = "x-correlation-id";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId: string;
    }
  }
}

/**
 * Gives every request an id, reusing the caller's if it sent one.
 *
 * The same id goes into every log line for the request and into the error response body,
 * so a user reporting "it failed" can hand over one string that finds the exact request
 * in the logs.
 */
export function correlationId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(CORRELATION_HEADER);
  req.correlationId = incoming && incoming.length <= 100 ? incoming : randomUUID();
  res.setHeader(CORRELATION_HEADER, req.correlationId);
  next();
}
