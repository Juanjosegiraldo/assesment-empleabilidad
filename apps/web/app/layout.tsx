import type { Metadata } from "next";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n";
import { SessionProvider } from "@/lib/session";

export const metadata: Metadata = {
  title: "Riwi Messaging",
  description: "Internal messaging platform for Riwi Co. S.A.S.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // lang is fixed here and switched client side by the locale selector. Rendering the
  // stored preference on the server is not possible without a cookie, and a cookie for a
  // display preference is not worth the round trip.
  return (
    <html lang="es">
      <body className="h-full bg-slate-100 text-slate-900 antialiased">
        <I18nProvider>
          <SessionProvider>{children}</SessionProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
