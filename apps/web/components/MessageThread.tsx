"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useT } from "@/lib/i18n";
import { Avatar } from "@/components/BrandMark";
import type { ThreadMessage } from "@/lib/types";

type Props = {
  messages: ThreadMessage[];
  currentUserId: number;
  hasMore: boolean;
  loadingOlder: boolean;
  error: boolean;
  onLoadOlder: () => void;
  onRetry: (message: ThreadMessage) => void;
  onReload: () => void;
};

export function MessageThread({
  messages,
  currentUserId,
  hasMore,
  loadingOlder,
  error,
  onLoadOlder,
  onRetry,
  onReload,
}: Props) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  /**
   * Scroll preservation.
   *
   * Older messages are prepended above what the user is reading, which pushes everything
   * down by the height of the new block. Without correction the view jumps and the person
   * loses their place, which is the single most annoying bug in an infinite scroll.
   *
   * The fix is to record scrollHeight before the new messages paint and add the growth
   * back to scrollTop after. It runs in useLayoutEffect, not useEffect, because it has to
   * happen in the same frame as the paint: useEffect runs after the browser has already
   * shown the jump.
   */
  const previousHeight = useRef(0);
  const previousCount = useRef(0);
  const pinnedToBottom = useRef(true);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const grew = messages.length > previousCount.current;
    const prependedOlder = grew && previousHeight.current > 0 && !pinnedToBottom.current;

    if (prependedOlder) {
      container.scrollTop += container.scrollHeight - previousHeight.current;
    } else if (pinnedToBottom.current) {
      // Following the live conversation: stay at the newest message.
      container.scrollTop = container.scrollHeight;
    }

    previousHeight.current = container.scrollHeight;
    previousCount.current = messages.length;
  }, [messages]);

  const onScroll = () => {
    const container = containerRef.current;
    if (!container) return;
    // "At the bottom" with a small tolerance, because sub pixel layout means the numbers
    // rarely match exactly.
    pinnedToBottom.current =
      container.scrollHeight - container.scrollTop - container.clientHeight < 40;
  };

  // Loading older messages is triggered by a sentinel above the list rather than by a
  // scroll handler: the observer only fires when the element is actually visible, so
  // there is no scroll maths to get wrong and no work on every scroll event.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingOlder) {
          pinnedToBottom.current = false;
          onLoadOlder();
        }
      },
      { root: containerRef.current, rootMargin: "120px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingOlder, onLoadOlder]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-stone-600">{t("thread.error")}</p>
        <button
          type="button"
          onClick={onReload}
          className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium hover:border-brand hover:text-brand"
        >
          {t("thread.reload")}
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="scroll-slim flex-1 overflow-y-auto px-4 py-4 sm:px-6"
      role="log"
      aria-live="polite"
    >
      <div ref={sentinelRef} />

      {loadingOlder ? (
        <p className="py-2 text-center text-xs text-stone-400">{t("thread.loadingOlder")}</p>
      ) : null}
      {!hasMore && messages.length > 0 ? (
        <p className="py-3 text-center text-[11px] font-medium uppercase tracking-wider text-stone-400">
          {t("thread.startOfHistory")}
        </p>
      ) : null}

      {messages.length === 0 && !loadingOlder ? (
        <p className="py-10 text-center text-sm text-stone-500">{t("thread.empty")}</p>
      ) : null}

      <ul className="space-y-3">
        {messages.map((message) => {
          const mine = message.senderId === currentUserId;
          return (
            <li
              key={message.localId ?? message.id}
              id={`message-${message.id}`}
              className={`flex gap-2.5 ${mine ? "justify-end" : "justify-start"}`}
            >
              {/* An initial in a colour derived from the name, so a long thread is
                  scannable without reading every author line. */}
              {!mine ? <Avatar name={message.senderName || "?"} /> : null}

              <div
                className={`max-w-[86%] px-3.5 py-2.5 sm:max-w-[68%] ${
                  mine
                    ? "rounded-2xl rounded-br-md bg-brand text-white"
                    : "rounded-2xl rounded-bl-md border border-stone-200 bg-white text-stone-900"
                } ${message.status === "failed" ? "ring-2 ring-red-400" : ""} ${
                  message.status === "pending" ? "opacity-60" : ""
                }`}
              >
                {!mine ? (
                  <p className="mb-1 text-xs font-semibold text-brand-strong">
                    {message.senderName}
                    <span className="ml-1.5 font-normal text-stone-400">{message.senderJobTitle}</span>
                  </p>
                ) : null}

                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.body}</p>

                <p
                  className={`mt-1.5 flex items-center gap-2 text-[11px] ${
                    mine ? "text-white/70" : "text-stone-400"
                  }`}
                >
                  <time dateTime={message.createdAt}>
                    {new Date(message.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                  {message.editedAt ? <span>· {t("thread.edited")}</span> : null}
                  {message.status === "pending" ? <span>· {t("thread.status.pending")}</span> : null}
                  {message.status === "failed" ? (
                    <>
                      <span className="text-red-100">· {t("thread.status.failed")}</span>
                      <button
                        type="button"
                        onClick={() => onRetry(message)}
                        className="font-semibold underline underline-offset-2"
                      >
                        {t("thread.retry")}
                      </button>
                    </>
                  ) : null}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
