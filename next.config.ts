import type { NextConfig } from "next";

// Static export for GitHub Pages: `next build` writes the whole site into `out/`.
// PAGES_BASE_PATH is set by the GitHub Actions workflow (e.g. "/stiff-lab" for a project page);
// locally it is empty, so `npm run dev` and a local build keep serving from the root.
const basePath = process.env.PAGES_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  // cacheComponents / partialPrefetching are not used by the app and are incompatible with `output: "export"`
  // ("Invariant: PPR cannot be enabled in export mode").
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
