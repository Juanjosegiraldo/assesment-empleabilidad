"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";

export function MessageComposer({ onSend, disabled }: { onSend: (body: string) => void; disabled: boolean }) {
  const t = useT();
  const [draft, setDraft] = useState("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    // Cleared immediately: the send is optimistic, so the message is already on screen.
    setDraft("");
    onSend(body);
  };

  return (
    <form onSubmit={submit} className="flex gap-2 border-t border-stone-200 bg-white p-3 sm:px-6 sm:py-4">
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={t("composer.placeholder")}
        aria-label={t("composer.placeholder")}
        disabled={disabled}
        className="flex-1 rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand focus:ring-4 focus:ring-brand-ring/40 disabled:bg-stone-100"
      />
      <button
        type="submit"
        disabled={disabled || draft.trim().length === 0}
        className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-strong disabled:opacity-40"
      >
        {t("composer.send")}
      </button>
    </form>
  );
}
