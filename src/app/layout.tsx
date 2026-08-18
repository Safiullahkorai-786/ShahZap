import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "ShahZap — Meet someone new",
    template: "%s | ShahZap",
  },
  description:
    "ShahZap is a privacy-first social discovery experience for meeting someone new through intelligent random matching.",
  applicationName: "ShahZap",
  metadataBase: new URL("https://shahzap.com"),
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
