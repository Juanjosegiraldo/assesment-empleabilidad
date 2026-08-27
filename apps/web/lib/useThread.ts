"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "@/lib/api";
import type { Message, MessagePage, ThreadMessage } from "@/lib/types";

const PAGE_SIZE = 25;

/**
 * Loads and maintains one channel's thread.
 *
 * The API returns messages newest first, because that is the direction keyset pagination
 * reads. The UI shows them oldest first, so every page is reversed on arrival and older
 * pages are prepended.
 */
export function useThread(channelId: number | null, currentUserId: number) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState(false);

  // Guards against a second page being requested while the first is still in flight,
  // which the intersection observer will happily do.
  const inFlight = useRef(false);

  const asSent = (message: Message): ThreadMessage => ({ ...message, status: "sent" });

  const loadFirstPage = useCallback(async () => {
    if (channelId === null) return;
    setError(false);
    setLoadingOlder(true);
    try {
      const page = await request<MessagePage>(`/channels/${channelId}/messages?limit=${PAGE_SIZE}`);
      setMessages(page.items.map(asSent).reverse());
      setCursor(page.nextCursor);
      setHasMore(page.nextCursor !== null);
    } catch {
      setError(true);
    } finally {
      setLoadingOlder(false);
    }
  }, [channelId]);

  useEffect(() => {
    setMessages([]);
    setCursor(null);
    setHasMore(false);
    void loadFirstPage();
  }, [loadFirstPage]);

  const loadOlder = useCallback(async () => {
    if (channelId === null || !cursor || inFlight.current) return;
    inFlight.current = true;
    setLoadingOlder(true);
    try {
      const page = await request<MessagePage>(
        `/channels/${channelId}/messages?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`,
      );
      setMessages((current) => [...page.items.map(asSent).reverse(), ...current]);
      setCursor(page.nextCursor);
      setHasMore(page.nextCursor !== null);
    } catch {
      setError(true);
    } finally {
      setLoadingOlder(false);
      inFlight.current = false;
    }
  }, [channelId, cursor]);

  /**
   * Optimistic send.
   *
   * The message appears immediately as "pending" with a temporary local id, and is
   * replaced by the server's version once it is confirmed. If the request fails it turns
   * "failed" and keeps its retry button rather than vanishing, so nothing the user typed
   * is ever silently lost.
   */
  const send = useCallback(
    async (body: string, localId = crypto.randomUUID()) => {
      if (channelId === null) return;

      const optimistic: ThreadMessage = {
        id: -Date.now(),
        localId,
        channelId,
        senderId: currentUserId,
        senderName: "",
        senderJobTitle: "",
        body,
        createdAt: new Date().toISOString(),
        editedAt: null,
        readByActor: true,
        status: "pending",
      };

      setMessages((current) => [...current.filter((m) => m.localId !== localId), optimistic]);

      try {
        const { message } = await request<{ message: Message }>(`/channels/${channelId}/messages`, {
          method: "POST",
          body: { body },
        });
        setMessages((current) =>
          current
            // The realtime stream may have delivered this very message already, since it
            // announces every insert including our own. Drop that copy before promoting
            // the optimistic one, or the same id ends up on screen twice.
            .filter((m) => !(m.id === message.id && m.localId !== localId))
            .map((m) => (m.localId === localId ? { ...asSent(message), localId } : m)),
        );
      } catch {
        setMessages((current) =>
          current.map((m) => (m.localId === localId ? { ...m, status: "failed" } : m)),
        );
      }
    },
    [channelId, currentUserId],
  );

  const retry = useCallback(
    (message: ThreadMessage) => {
      if (message.localId) void send(message.body, message.localId);
    },
    [send],
  );

  /** Adds a message that arrived from somewhere else, ignoring one already on screen. */
  const receive = useCallback((message: Message) => {
    setMessages((current) =>
      current.some((existing) => existing.id === message.id) ? current : [...current, asSent(message)],
    );
  }, []);

  return {
    messages,
    hasMore,
    loadingOlder,
    error,
    loadOlder,
    send,
    retry,
    receive,
    reload: loadFirstPage,
  };
}
