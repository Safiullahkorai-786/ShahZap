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
      // Dynamic APIs must never be cached by browsers or the edge.
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
