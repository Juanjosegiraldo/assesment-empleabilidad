"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

export default function LoginPage() {
  const t = useT();
  const router = useRouter();
  const { user, loading, signIn } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/chat");
  }, [user, loading, router]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setFailed(false);
    try {
      await signIn(email, password);
      router.replace("/chat");
    } catch {
      // The API answers the same way for a wrong password and an unknown address, and
      // this screen keeps that promise: one message for both.
      setFailed(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{t("app.name")}</h1>
            <p className="text-sm text-slate-500">{t("app.tagline")}</p>
          </div>
          <LocaleSwitcher />
        </div>

        <form onSubmit={onSubmit} className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
          <div>
            <h2 className="text-lg font-medium">{t("login.title")}</h2>
            <p className="text-sm text-slate-500">{t("login.subtitle")}</p>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">{t("login.email")}</span>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-brand"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">{t("login.password")}</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-brand"
            />
          </label>

          {failed ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {t("login.failed")}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-brand px-3 py-2 font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? t("login.submitting") : t("login.submit")}
          </button>
        </form>
      </div>
    </main>
  );
}
