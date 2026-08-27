"use client";

import { useI18n, type Locale } from "@/lib/i18n";

const OPTIONS: Locale[] = ["es", "en"];

export function LocaleSwitcher() {
  const { locale, setLocale } = useI18n();

  return (
    <div className="flex rounded-md border border-slate-300 bg-white p-0.5" role="group">
      {OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setLocale(option)}
          aria-pressed={locale === option}
          className={`rounded px-2 py-0.5 text-xs font-medium uppercase transition ${
            locale === option ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
