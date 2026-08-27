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
    <div className="border-b border-slate-200 bg-white p-3">
      <input
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder={t("search.placeholder")}
        aria-label={t("search.placeholder")}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
      />

      {term.trim().length === 1 ? (
        <p className="mt-2 text-xs text-slate-400">{t("search.hint")}</p>
      ) : null}

      {loading ? <p className="mt-2 text-xs text-slate-400">{t("common.loading")}</p> : null}

      {page ? (
        <div className="mt-2">
          <p className="mb-1 text-xs text-slate-500">
            {t("search.results", { count: page.items.length })}
          </p>
          {page.items.length === 0 ? (
            <p className="text-xs text-slate-400">{t("search.empty")}</p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {page.items.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => onOpenMessage(hit.channelId, hit.id)}
                    className="w-full rounded-md p-2 text-left text-xs hover:bg-slate-50"
                  >
                    <span className="font-medium text-brand">{hit.channelName}</span>
                    <span className="text-slate-400"> · {hit.senderName}</span>
                    <p className="mt-0.5 text-slate-700">
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
