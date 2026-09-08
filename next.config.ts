import type { NextConfig } from "next";

const mammothRuntimeFiles = [
  "./node_modules/mammoth/**/*",
  "./node_modules/@xmldom/xmldom/**/*",
  "./node_modules/mammoth/node_modules/argparse/**/*",
  "./node_modules/sprintf-js/**/*",
  "./node_modules/base64-js/**/*",
  "./node_modules/bluebird/**/*",
  "./node_modules/dingbat-to-unicode/**/*",
  "./node_modules/jszip/**/*",
  "./node_modules/lie/**/*",
  "./node_modules/immediate/**/*",
  "./node_modules/pako/**/*",
  "./node_modules/readable-stream/**/*",
  "./node_modules/setimmediate/**/*",
  "./node_modules/core-util-is/**/*",
  "./node_modules/inherits/**/*",
  "./node_modules/isarray/**/*",
  "./node_modules/process-nextick-args/**/*",
  "./node_modules/safe-buffer/**/*",
  "./node_modules/string_decoder/**/*",
  "./node_modules/util-deprecate/**/*",
  "./node_modules/lop/**/*",
  "./node_modules/duck/**/*",
  "./node_modules/option/**/*",
  "./node_modules/path-is-absolute/**/*",
  "./node_modules/underscore/**/*",
  "./node_modules/xmlbuilder/**/*",
  "./package-lock.json",
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Showcase build: static export onto GitHub Pages under /showcase-daisyyleung-solo-company-os.
  output: "export",
  basePath: "/showcase-daisyyleung-solo-company-os",
  trailingSlash: true,
  images: { unoptimized: true },
  // tests/ still import the API route handlers this static build drops.
  typescript: { ignoreBuildErrors: true },
  serverExternalPackages: ["mammoth"],
  outputFileTracingIncludes: {
    "/api/cases/intake": mammothRuntimeFiles,
    "/api/cases/\\[id\\]/sources": mammothRuntimeFiles,
    "/api/imports/classify": mammothRuntimeFiles,
  },
};

export default nextConfig;
