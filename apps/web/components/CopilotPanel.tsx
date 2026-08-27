"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";
import { request } from "@/lib/api";
import type { CopilotAnswer } from "@/lib/types";

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
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 p-4">
        <h2 className="font-semibold">{t("copilot.title")}</h2>
        <p className="mt-1 text-xs text-slate-500">{t("copilot.intro")}</p>
      </div>

      <form onSubmit={ask} className="flex gap-2 border-b border-slate-200 p-3">
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={t("copilot.placeholder")}
          aria-label={t("copilot.placeholder")}
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <button
          type="submit"
          disabled={asking || question.trim().length < 5}
          className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {t("copilot.ask")}
        </button>
      </form>

      <div className="flex-1 overflow-y-auto p-4">
        {asking ? <p className="text-sm text-slate-500">{t("copilot.thinking")}</p> : null}
        {failed ? (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {t("copilot.error")}
          </p>
        ) : null}

        {answer ? (
          <div className="space-y-3">
            {answer.refusal ? (
              <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                {t(REFUSAL_LABEL[answer.refusal])}
              </span>
            ) : null}

            <p className="whitespace-pre-wrap text-sm text-slate-800">{answer.answer}</p>

            {answer.citations.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-500">{t("copilot.sources")}</p>
                <ul className="space-y-1">
                  {answer.citations.map((citation) => (
                    <li key={citation.messageId}>
                      {/* Clicking a source scrolls the thread to the message it came from,
                          so a claim can be checked against what was actually written. */}
                      <button
                        type="button"
                        onClick={() => onOpenMessage(citation.messageId)}
                        className="w-full rounded-md border border-slate-200 p-2 text-left text-xs hover:bg-slate-50"
                      >
                        <span className="font-medium text-brand">#{citation.messageId}</span>
                        <span className="text-slate-400">
                          {" "}
                          · {citation.channelName} · {citation.authorName}
                        </span>
                        <p className="mt-0.5 text-slate-600">{citation.excerpt}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="text-[11px] text-slate-400">
              {answer.model} · prompt {answer.promptVersion} ·{" "}
              {answer.usage.promptTokens + answer.usage.completionTokens} tokens
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
