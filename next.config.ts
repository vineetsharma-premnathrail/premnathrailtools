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
