"use client";

import { useT } from "@/lib/i18n";
import type { Conversation } from "@/lib/types";

/** Rendered on the dark rail, so its colours are fixed rather than inherited. */
export function ChannelList({
  conversations,
  selectedId,
  onSelect,
}: {
  conversations: Conversation[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const t = useT();

  if (conversations.length === 0) {
    return <p className="px-4 py-6 text-sm text-stone-400">{t("channels.empty")}</p>;
  }

  return (
    <ul className="space-y-0.5 px-2 pb-4">
      {conversations.map((conversation) => {
        const selected = conversation.id === selectedId;
        return (
          <li key={conversation.id}>
            <button
              type="button"
              onClick={() => onSelect(conversation.id)}
              aria-current={selected ? "true" : undefined}
              className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
                selected ? "bg-brand text-white" : "text-rail-text hover:bg-rail-soft"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={selected ? "text-white/70" : "text-stone-500"} aria-hidden="true">
                  {conversation.isPrivate ? "🔒" : "#"}
                </span>
                <span className="truncate text-sm font-medium">{conversation.name}</span>
                {conversation.unreadCount > 0 ? (
                  <span
                    className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                      selected ? "bg-white/25 text-white" : "bg-brand text-white"
                    }`}
                    aria-label={t("channels.unread", { count: conversation.unreadCount })}
                  >
                    {conversation.unreadCount}
                  </span>
                ) : null}
              </div>
              <p
                className={`mt-0.5 truncate pl-5 text-xs ${
                  selected ? "text-white/70" : "text-stone-500"
                }`}
              >
                {conversation.lastMessageAuthor
                  ? `${conversation.lastMessageAuthor}: ${conversation.lastMessageBody ?? ""}`
                  : (conversation.topic ?? "")}
              </p>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
