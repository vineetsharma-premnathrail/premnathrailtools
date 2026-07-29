import type { NextConfig } from "next";

// Teams runs the portal inside an iframe (top-level site is teams.microsoft.com),
// so the frontend must explicitly allow framing from Teams' domains. No
// X-Frame-Options header is set — ALLOW-FROM is unsupported in Chromium
// (Teams desktop) and would silently block the iframe; framing is controlled
// exclusively by CSP frame-ancestors.
const FRAME_ANCESTORS = [
  "'self'",
  "https://teams.microsoft.com",
  "https://*.teams.microsoft.com",
  "https://teams.cloud.microsoft",
  "https://*.teams.cloud.microsoft",
].join(" ");

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  devIndicators: false,
  images: {
    unoptimized: true,
  },
  experimental: {
    optimizePackageImports: ["@/"],
  },
  onDemandEntries: {
    maxInactiveAge: 25 * 1000,
    pagesBufferLength: 5,
  },
  // In production both apps run in the same container — the backend binds
  // only to 127.0.0.1:8000 (not exposed externally) and this server-side
  // rewrite forwards same-origin /api/* calls to it, so the browser only
  // ever talks to one origin (no CORS, no separate backend domain/build-arg
  // needed). In local dev this is a no-op unless the frontend code makes a
  // relative /api/* request instead of using NEXT_PUBLIC_API_URL directly.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: "http://127.0.0.1:8000/api/:path*" },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: `frame-ancestors ${FRAME_ANCESTORS};` },
        ],
      },
    ];
  },
};

export default nextConfig;
