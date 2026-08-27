"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { BrandMark } from "@/components/BrandMark";

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
    <main className="flex min-h-full">
      {/* The statement panel. Hidden on small screens, where the form is all there is
          room for. */}
      <section className="relative hidden w-1/2 flex-col justify-between bg-rail p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <BrandMark size="lg" />
          <span className="text-lg font-semibold">{t("app.name")}</span>
        </div>

        <div className="max-w-md">
          <p className="text-3xl leading-snug font-semibold">{t("app.tagline")}</p>
          <p className="mt-4 text-sm leading-relaxed text-stone-400">{t("login.pitch")}</p>
        </div>

        <p className="text-xs text-stone-500">Riwi Co. S.A.S. · Medellín</p>

        {/* Decoration only, and marked as such so a screen reader skips it. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 top-1/3 h-72 w-72 rounded-full bg-brand/25 blur-3xl"
        />
      </section>

      <section className="flex flex-1 items-center justify-center bg-canvas px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center justify-between">
            <div className="flex items-center gap-2 lg:hidden">
              <BrandMark />
              <span className="font-semibold">{t("app.name")}</span>
            </div>
            <div className="ml-auto">
              <LocaleSwitcher />
            </div>
          </div>

          <h1 className="text-2xl font-semibold text-stone-900">{t("login.title")}</h1>
          <p className="mt-1 text-sm text-stone-500">{t("login.subtitle")}</p>

          <form onSubmit={onSubmit} className="mt-8 space-y-5">
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-stone-700">{t("login.email")}</span>
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 outline-none transition focus:border-brand focus:ring-4 focus:ring-brand-ring/40"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-stone-700">{t("login.password")}</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 outline-none transition focus:border-brand focus:ring-4 focus:ring-brand-ring/40"
              />
            </label>

            {failed ? (
              <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                {t("login.failed")}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-brand px-3.5 py-2.5 font-semibold text-white shadow-sm transition hover:bg-brand-strong disabled:opacity-50"
            >
              {submitting ? t("login.submitting") : t("login.submit")}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
