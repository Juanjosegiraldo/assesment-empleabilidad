"use client";

import { useEffect, useRef } from "react";
import { getAccessToken, refreshSession } from "@/lib/api";
import type { Message } from "@/lib/types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const RECONNECT_DELAY_MS = 2_000;

/**
 * Subscribes to a channel's server sent events.
 *
 * Why not EventSource
 * -------------------
 * EventSource is the obvious tool and it is not used here, for one concrete reason: it
 * cannot send an Authorization header. The usual workaround is to put the access token in
 * the query string, and a token in a URL ends up in the server access log, in the browser
 * history and in any Referer the page sends. That is a real credential leak in exchange
 * for saving thirty lines.
 *
 * So the stream is read with fetch, which does send headers, and the SSE frames are
 * parsed here. The wire format is still text/event-stream: only the client differs.
 *
 * What EventSource gives away with that choice is automatic reconnection, so this
 * reconnects itself, including refreshing the access token when the server rejects the
 * subscription as expired.
 */
export function useMessageStream(channelId: number | null, onMessage: (message: Message) => void) {
  // Kept in a ref so a new callback identity does not tear the connection down and open
  // a fresh one on every render of the parent.
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    if (channelId === null) return;

    const controller = new AbortController();
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = async (): Promise<void> => {
      if (closed) return;

      try {
        const response = await fetch(`${BASE_URL}/channels/${channelId}/stream`, {
          headers: { authorization: `Bearer ${getAccessToken() ?? ""}` },
          credentials: "include",
          signal: controller.signal,
        });

        if (response.status === 401) {
          // The access token aged out while the stream was open. Mint a new one and
          // reconnect rather than dropping the user to the login screen.
          const restored = await refreshSession();
          if (restored) scheduleReconnect();
          return;
        }

        // 403 means this user is not a member. Retrying would just fail forever.
        if (!response.ok || !response.body) return;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line. Anything after the last separator
          // is a partial frame still arriving, so it stays in the buffer.
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            // Lines starting with ':' are comments, which is what the keepalive uses.
            const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
            if (!dataLine) continue;
            try {
              handlerRef.current(JSON.parse(dataLine.slice("data:".length).trim()) as Message);
            } catch {
              // A frame that does not parse is skipped; the stream keeps going.
            }
          }
        }

        scheduleReconnect();
      } catch (error) {
        // An aborted fetch is this effect cleaning up, not a failure.
        if ((error as Error).name !== "AbortError") scheduleReconnect();
      }
    };

    const scheduleReconnect = () => {
      if (closed) return;
      reconnectTimer = setTimeout(() => void connect(), RECONNECT_DELAY_MS);
    };

    void connect();

    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      controller.abort();
    };
  }, [channelId]);
}
