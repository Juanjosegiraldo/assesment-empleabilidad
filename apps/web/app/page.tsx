"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { useT } from "@/lib/i18n";

export default function HomePage() {
  const { user, loading } = useSession();
  const router = useRouter();
  const t = useT();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? "/chat" : "/login");
  }, [user, loading, router]);

  return (
    <main className="flex h-full items-center justify-center">
      <p className="text-sm text-slate-500">{t("common.loading")}</p>
    </main>
  );
}
