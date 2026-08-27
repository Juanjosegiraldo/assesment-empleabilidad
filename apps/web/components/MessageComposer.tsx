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
    <form onSubmit={submit} className="flex gap-2 border-t border-slate-200 bg-white p-3">
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={t("composer.placeholder")}
        aria-label={t("composer.placeholder")}
        disabled={disabled}
        className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand disabled:bg-slate-100"
      />
      <button
        type="submit"
        disabled={disabled || draft.trim().length === 0}
        className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
      >
        {t("composer.send")}
      </button>
    </form>
  );
}
