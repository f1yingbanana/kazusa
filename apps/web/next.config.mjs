/** @type {import("next").NextConfig} */
const nextConfig = {
  // A second dev server (a lab world beside the live one) needs its own build
  // folder: Next allows one dev server per folder.
  distDir: process.env.KAZUSA_DIST_DIR || ".next",
  // `use cache`: what visitors read is kept in this server's memory
  // (`lib/proxy/visitor-read.ts`).
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ["@kazusa/client"],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
