import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      // Content-hashed build output never changes — cache for a year.
      {
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      // App icons / favicon — stable for a week.
      {
        source: "/favicon.ico",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800" }],
      },
      {
        source: "/favicon-16x16.png",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800" }],
      },
      {
        source: "/favicon-32x32.png",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800" }],
      },
      {
        source: "/android-chrome-192x192.png",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800" }],
      },
      {
        source: "/android-chrome-512x512.png",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800" }],
      },
      {
        source: "/apple-touch-icon.png",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800" }],
      },
      // Dynamic APIs must never be cached by browsers or the edge.
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
