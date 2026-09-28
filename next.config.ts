import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent Next.js/Turbopack from bundling server-side PDF packages.
  // pdf-parse v2 uses pdfjs-dist which tries to resolve a compiled worker
  // chunk from the Next.js build output — this fails in dev (Turbopack) mode.
  // By marking them as external, they are loaded as plain Node.js modules.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
