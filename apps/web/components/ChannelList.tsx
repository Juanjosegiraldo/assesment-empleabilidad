"use client";

import { useT } from "@/lib/i18n";
import type { Conversation } from "@/lib/types";

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
    return <p className="p-4 text-sm text-slate-500">{t("channels.empty")}</p>;
  }

  return (
    <ul className="divide-y divide-slate-100">
      {conversations.map((conversation) => {
        const selected = conversation.id === selectedId;
        return (
          <li key={conversation.id}>
            <button
              type="button"
              onClick={() => onSelect(conversation.id)}
              aria-current={selected ? "true" : undefined}
              className={`w-full px-4 py-3 text-left transition ${
                selected ? "bg-brand-soft" : "hover:bg-slate-50"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{conversation.name}</span>
                {conversation.unreadCount > 0 ? (
                  <span
                    className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-white"
                    aria-label={t("channels.unread", { count: conversation.unreadCount })}
                  >
                    {conversation.unreadCount}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {conversation.isPrivate ? `${t("channels.private")} · ` : ""}
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
