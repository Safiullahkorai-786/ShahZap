import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaRegister } from "@/components/PwaRegister";

export const viewport: Viewport = {
  themeColor: "#06b6d4",
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
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><PwaRegister />{children}</body>
    </html>
  );
}
