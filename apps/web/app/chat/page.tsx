"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { request } from "@/lib/api";
import { useThread } from "@/lib/useThread";
import { useMessageStream } from "@/lib/useMessageStream";
import { ChannelList } from "@/components/ChannelList";
import { MessageThread } from "@/components/MessageThread";
import { MessageComposer } from "@/components/MessageComposer";
import { CopilotPanel } from "@/components/CopilotPanel";
import { ProfilePanel } from "@/components/ProfilePanel";
import { SearchPanel } from "@/components/SearchPanel";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import type { Conversation } from "@/lib/types";

/**
 * The three zones the assessment asks for.
 *
 * On a desktop all three are visible at once, side by side. On a phone there is not room,
 * so they become tabs and one shows at a time. Same components either way: the layout
 * changes, the code does not fork.
 */
type Zone = "conversation" | "copilot" | "profile";

export default function ChatPage() {
  const t = useT();
  const router = useRouter();
  const { user, loading, signOut } = useSession();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [channelId, setChannelId] = useState<number | null>(null);
  const [zone, setZone] = useState<Zone>("conversation");

  const thread = useThread(channelId, user?.id ?? 0);

  // Live delivery. thread.receive ignores a message already on screen, so our own
  // optimistic send does not appear twice when the stream echoes it back.
  useMessageStream(channelId, thread.receive);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  const loadConversations = useCallback(async () => {
    const { items } = await request<{ items: Conversation[] }>("/channels");
    setConversations(items);
    setChannelId((current) => current ?? items[0]?.id ?? null);
  }, []);

  useEffect(() => {
    if (user) void loadConversations();
  }, [user, loadConversations]);

  /** Marks the channel read once its newest message is on screen, then refreshes badges. */
  const markRead = useCallback(async () => {
    if (channelId === null) return;
    const newest = thread.messages.at(-1);
    if (!newest || newest.id < 0) return;
    try {
      await request(`/channels/${channelId}/read`, {
        method: "POST",
        body: { upToMessageId: newest.id },
      });
      await loadConversations();
    } catch {
      // A failed read receipt is cosmetic. It corrects itself on the next visit.
    }
  }, [channelId, thread.messages, loadConversations]);

  const openMessage = useCallback(
    (messageId: number) => {
      setZone("conversation");
      // The element only exists once the message is rendered, so wait a frame.
      requestAnimationFrame(() => {
        const element = document.getElementById(`message-${messageId}`);
        element?.scrollIntoView({ behavior: "smooth", block: "center" });
        element?.classList.add("ring-2", "ring-brand");
        setTimeout(() => element?.classList.remove("ring-2", "ring-brand"), 2000);
      });
    },
    [],
  );

  if (loading || !user) {
    return (
      <main className="flex h-full items-center justify-center">
        <p className="text-sm text-slate-500">{t("common.loading")}</p>
      </main>
    );
  }

  const selected = conversations.find((conversation) => conversation.id === channelId) ?? null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
        <h1 className="text-sm font-semibold">{t("app.name")}</h1>
        <div className="flex items-center gap-3">
          <LocaleSwitcher />
          <span className="hidden text-sm text-slate-600 sm:inline">{user.fullName}</span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Channels: a sidebar on desktop, folded into the conversation tab on mobile. */}
        <aside
          className={`w-full shrink-0 overflow-y-auto border-r border-slate-200 bg-white sm:w-64 lg:w-72 ${
            zone === "conversation" ? "hidden sm:block" : "hidden sm:block"
          }`}
        >
          <SearchPanel
            onOpenMessage={(hitChannelId, messageId) => {
              setChannelId(hitChannelId);
              openMessage(messageId);
            }}
          />
          <h2 className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {t("channels.title")}
          </h2>
          <ChannelList conversations={conversations} selectedId={channelId} onSelect={setChannelId} />
        </aside>

        <main
          className={`flex min-w-0 flex-1 flex-col ${zone === "conversation" ? "flex" : "hidden lg:flex"}`}
        >
          {selected ? (
            <>
              <div className="border-b border-slate-200 bg-white px-4 py-2">
                <h2 className="font-medium">{selected.name}</h2>
                {selected.topic ? <p className="text-xs text-slate-500">{selected.topic}</p> : null}
              </div>

              <MessageThread
                messages={thread.messages}
                currentUserId={user.id}
                hasMore={thread.hasMore}
                loadingOlder={thread.loadingOlder}
                error={thread.error}
                onLoadOlder={thread.loadOlder}
                onRetry={thread.retry}
                onReload={thread.reload}
              />

              <MessageComposer
                disabled={channelId === null}
                onSend={(body) => {
                  void thread.send(body).then(markRead);
                }}
              />
            </>
          ) : (
            <p className="m-auto text-sm text-slate-500">{t("thread.selectChannel")}</p>
          )}
        </main>

        {/* Right column. On desktop it shows the profile above the copilot, so all three
            zones are on screen at once. On mobile each half is a separate tab. */}
        <aside
          className={`w-full shrink-0 flex-col border-l border-slate-200 bg-white lg:flex lg:w-80 xl:w-96 ${
            zone === "copilot" || zone === "profile" ? "flex" : "hidden"
          }`}
        >
          <div
            className={`shrink-0 overflow-y-auto border-b border-slate-200 lg:max-h-80 ${
              zone === "profile" ? "flex flex-1 lg:flex-none" : "hidden lg:flex"
            }`}
          >
            <ProfilePanel user={user} onSignOut={() => void signOut()} />
          </div>

          <div className={`min-h-0 flex-1 ${zone === "copilot" ? "block" : "hidden lg:block"}`}>
            <CopilotPanel onOpenMessage={openMessage} />
          </div>
        </aside>
      </div>

      {/* Tab bar: the only way to reach the copilot and the profile on a small screen. */}
      <nav className="flex border-t border-slate-200 bg-white lg:hidden" aria-label={t("app.name")}>
        {(["conversation", "copilot", "profile"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setZone(option)}
            aria-current={zone === option ? "page" : undefined}
            className={`flex-1 py-2.5 text-xs font-medium ${
              zone === option ? "border-t-2 border-brand text-brand" : "text-slate-500"
            }`}
          >
            {t(`nav.${option}` as "nav.conversation")}
          </button>
        ))}
      </nav>
    </div>
  );
}
