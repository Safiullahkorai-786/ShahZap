import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { PwaRegister } from "@/components/PwaRegister";
import { PresenceHeartbeat } from "@/components/presence-heartbeat";
import { GlobalNotificationListener } from "@/components/global-notification-listener";
import { NotificationBanner } from "@/components/notification-banner";
import { CallProvider } from "@/components/call-provider";
import { BottomNav } from "@/components/bottom-nav";
import { ClientProviders } from "@/lib/i18n/provider";

export const viewport: Viewport = {
  themeColor: "#06b6d4",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export const metadata: Metadata = {
  title: {
    default: "ShahZap — Meet someone new",
    template: "%s | ShahZap",
  },
  description: "ShahZap is a privacy-first social discovery experience for meeting someone new through intelligent random matching.",
  applicationName: "ShahZap",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://shahzap.safiullahkorai.com"),
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script
          id="shahzap-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: "try{var s=JSON.parse(localStorage.getItem('shahzap:theme')||'{}');var b=s.base==='white'?'white':'dark';document.documentElement.dataset.base=b;document.documentElement.dataset.accent=s.accent||'none'}catch(e){}",
          }}
        />
        <div className="w-full min-h-dvh bg-slate-950">
          <ClientProviders>
            <PwaRegister />
            <PresenceHeartbeat />
            <GlobalNotificationListener />
            <CallProvider>
              <NotificationBanner />
              {children}
              <BottomNav />
            </CallProvider>
          </ClientProviders>
        </div>
      </body>
    </html>
  );
}
