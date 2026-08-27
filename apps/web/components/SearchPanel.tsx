"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { request } from "@/lib/api";
import { Highlighted } from "@/components/Highlighted";
import type { SearchPage } from "@/lib/types";

export function SearchPanel({ onOpenMessage }: { onOpenMessage: (channelId: number, messageId: number) => void }) {
  const t = useT();
  const [term, setTerm] = useState("");
  const [page, setPage] = useState<SearchPage | null>(null);
  const [loading, setLoading] = useState(false);

  // Debounced, so typing does not fire a request per keystroke.
  useEffect(() => {
    const trimmed = term.trim();
    if (trimmed.length < 2) {
      setPage(null);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        setPage(await request<SearchPage>(`/search?q=${encodeURIComponent(trimmed)}&limit=20`));
      } catch {
        setPage({ items: [], nextCursor: null });
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [term]);

  return (
    <div className="border-b border-rail-soft p-3">
      <input
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder={t("search.placeholder")}
        aria-label={t("search.placeholder")}
        className="w-full rounded-lg border border-rail-soft bg-rail-soft px-3 py-2 text-sm text-white placeholder:text-stone-500 outline-none transition focus:border-brand"
      />

      {term.trim().length === 1 ? (
        <p className="mt-2 text-xs text-stone-500">{t("search.hint")}</p>
      ) : null}

      {loading ? <p className="mt-2 text-xs text-stone-500">{t("common.loading")}</p> : null}

      {page ? (
        <div className="mt-2">
          <p className="mb-1 text-xs text-stone-500">
            {t("search.results", { count: page.items.length })}
          </p>
          {page.items.length === 0 ? (
            <p className="text-xs text-stone-500">{t("search.empty")}</p>
          ) : (
            <ul className="scroll-slim max-h-64 space-y-1 overflow-y-auto">
              {page.items.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => onOpenMessage(hit.channelId, hit.id)}
                    className="w-full rounded-lg p-2 text-left text-xs text-rail-text transition hover:bg-rail-soft"
                  >
                    <span className="font-semibold text-brand-ring">{hit.channelName}</span>
                    <span className="text-stone-500"> · {hit.senderName}</span>
                    <p className="mt-0.5 text-stone-300">
                      <Highlighted text={hit.headline} />
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
