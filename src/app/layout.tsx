import type { Metadata } from "next";
import "./globals.css";
import { PwaRegister } from "@/components/PwaRegister";

export const metadata: Metadata = {
  title: {
    default: "ShahZap — Meet someone new",
    template: "%s | ShahZap",
  },
  description: "ShahZap is a privacy-first social discovery experience for meeting someone new through intelligent random matching.",
  applicationName: "ShahZap",
  metadataBase: new URL("https://shahzap.com"),
  manifest: "/manifest.webmanifest",
  themeColor: "#06b6d4",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><PwaRegister />{children}</body>
    </html>
  );
}
