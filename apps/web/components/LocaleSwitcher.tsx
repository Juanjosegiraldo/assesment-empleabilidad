"use client";

import { useI18n, type Locale } from "@/lib/i18n";

const OPTIONS: Locale[] = ["es", "en"];

export function LocaleSwitcher({ tone = "light" }: { tone?: "light" | "dark" }) {
  const { locale, setLocale } = useI18n();

  const container = tone === "dark" ? "bg-rail-soft" : "bg-stone-100";
  const inactive = tone === "dark" ? "text-stone-400 hover:text-white" : "text-stone-500 hover:text-stone-800";

  return (
    <div className={`flex rounded-lg p-0.5 ${container}`} role="group">
      {OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setLocale(option)}
          aria-pressed={locale === option}
          className={`rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wide transition ${
            locale === option ? "bg-brand text-white shadow-sm" : inactive
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
