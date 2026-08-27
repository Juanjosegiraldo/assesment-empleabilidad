"use client";

import { useEffect } from "react";
import { useI18n, useT } from "@/lib/i18n";
import type { SessionUser } from "@/lib/api";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

export function ProfilePanel({ user, onSignOut }: { user: SessionUser; onSignOut: () => void }) {
  const t = useT();
  const { setLocale } = useI18n();

  // The account language is a default for a device that has never been used before, not
  // an override. Applying it unconditionally would undo the choice the user made with the
  // switcher the last time they were here.
  useEffect(() => {
    let alreadyChosen = false;
    try {
      alreadyChosen = window.localStorage.getItem("rw_locale") !== null;
    } catch {
      // Storage unavailable: treat it as no stored choice.
    }
    if (!alreadyChosen) setLocale(user.locale);
  }, [user.locale, setLocale]);


  return (
    <div className="flex h-full flex-col p-4">
      <h2 className="mb-4 font-semibold">{t("profile.title")}</h2>

      <div className="flex items-center gap-3">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand text-lg font-semibold text-white"
          aria-hidden="true"
        >
          {user.fullName.charAt(0)}
        </div>
        <div className="min-w-0">
          <p className="truncate font-medium">{user.fullName}</p>
          <p className="truncate text-sm text-slate-500">{user.jobTitle}</p>
        </div>
      </div>

      <dl className="mt-5 space-y-3 text-sm">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
            {t("profile.email")}
          </dt>
          <dd className="truncate text-slate-700">{user.email}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
            {t("profile.role")}
          </dt>
          <dd className="text-slate-700">{user.jobTitle}</dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
            {t("profile.language")}
          </dt>
          <dd>
            <LocaleSwitcher />
          </dd>
        </div>
      </dl>


      <button
        type="button"
        onClick={onSignOut}
        className="mt-6 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
      >
        {t("nav.signOut")}
      </button>
    </div>
  );
}
