import { invalidInput } from "../../domain/errors.js";

/**
 * Keyset cursors.
 *
 * A cursor encodes the (created_at, id) of the last row of a page, which is exactly the
 * anchor the next page's WHERE clause needs. It is base64 so callers treat it as opaque:
 * the pagination key can change without breaking the API contract or the frontend.
 *
 * It is encoding, not encryption, and it is not meant to be either. A tampered cursor can
 * only move the reading position inside data row level security already allows; it cannot
 * reach another channel.
 */
export type Keyset = { createdAt: Date; id: number };

export function encodeCursor(keyset: Keyset): string {
  return Buffer.from(`${keyset.createdAt.toISOString()}|${keyset.id}`).toString("base64url");
}

export function decodeCursor(cursor: string | null): Keyset | null {
  if (!cursor) return null;

  const [rawDate, rawId] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const createdAt = new Date(rawDate ?? "");
  const id = Number(rawId);

  if (Number.isNaN(createdAt.getTime()) || !Number.isInteger(id)) {
    throw invalidInput("Malformed pagination cursor");
  }

  return { createdAt, id };
}
