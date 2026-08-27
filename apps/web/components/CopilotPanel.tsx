"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { request } from "@/lib/api";
import type { CopilotAnswer, CopilotUsage } from "@/lib/types";

const REFUSAL_LABEL = {
  insufficient_context: "copilot.refusal.insufficient_context",
  no_permission: "copilot.refusal.no_permission",
  out_of_scope: "copilot.refusal.out_of_scope",
} as const;

export function CopilotPanel({ onOpenMessage }: { onOpenMessage: (messageId: number) => void }) {
  const t = useT();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<CopilotAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [usage, setUsage] = useState<CopilotUsage | null>(null);

  // Consumption is shown next to the thing that spends it, and refreshed after every
  // question so the number the user sees is the one they just changed.
  const loadUsage = useCallback(() => {
    request<CopilotUsage>("/copilot/usage")
      .then(setUsage)
      .catch(() => setUsage(null));
  }, []);

  useEffect(loadUsage, [loadUsage]);

  const ask = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (trimmed.length < 5) return;

    setAsking(true);
    setFailed(false);
    setAnswer(null);
    try {
      setAnswer(await request<CopilotAnswer>("/copilot/ask", { method: "POST", body: { question: trimmed } }));
    } catch {
      setFailed(true);
    } finally {
      setAsking(false);
      loadUsage();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-stone-200 px-4 py-3.5">
        <h2 className="flex items-center gap-2 font-semibold">
          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-brand" />
          {t("copilot.title")}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-stone-500">{t("copilot.intro")}</p>
      </div>

      <form onSubmit={ask} className="flex gap-2 border-b border-stone-200 p-3">
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={t("copilot.placeholder")}
          aria-label={t("copilot.placeholder")}
          className="flex-1 rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-4 focus:ring-brand-ring/40"
        />
        <button
          type="submit"
          disabled={asking || question.trim().length < 5}
          className="rounded-xl bg-brand px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-strong disabled:opacity-40"
        >
          {t("copilot.ask")}
        </button>
      </form>

      <div className="scroll-slim flex-1 overflow-y-auto p-4">
        {asking ? <p className="flex items-center gap-2 text-sm text-stone-500"><span aria-hidden="true" className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand" />{t("copilot.thinking")}</p> : null}
        {failed ? (
          <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            {t("copilot.error")}
          </p>
        ) : null}

        {answer ? (
          <div className="space-y-3">
            {answer.refusal ? (
              <span className="inline-block rounded-full border border-brand-ring bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand-strong">
                {t(REFUSAL_LABEL[answer.refusal])}
              </span>
            ) : null}

            <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-800">{answer.answer}</p>

            {answer.citations.length > 0 ? (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400">{t("copilot.sources")}</p>
                <ul className="space-y-1">
                  {answer.citations.map((citation) => (
                    <li key={citation.messageId}>
                      {/* Clicking a source scrolls the thread to the message it came from,
                          so a claim can be checked against what was actually written. */}
                      <button
                        type="button"
                        onClick={() => onOpenMessage(citation.messageId)}
                        className="w-full rounded-xl border border-stone-200 bg-white p-2.5 text-left text-xs transition hover:border-brand-ring hover:bg-brand-soft"
                      >
                        <span className="font-semibold text-brand">#{citation.messageId}</span>
                        <span className="text-stone-400">
                          {" "}
                          · {citation.channelName} · {citation.authorName}
                        </span>
                        <p className="mt-1 leading-relaxed text-stone-600">{citation.excerpt}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="text-[11px] text-stone-400">
              {answer.model} · prompt {answer.promptVersion} ·{" "}
              {answer.usage.promptTokens + answer.usage.completionTokens} tokens
            </p>
          </div>
        ) : null}
      </div>

      {usage && usage.call_count > 0 ? (
        <p className="border-t border-stone-200 px-4 py-2 text-[11px] text-stone-400">
          {t("copilot.usage", { total: usage.total_tokens, calls: usage.call_count })}
        </p>
      ) : null}
    </div>
  );
}
