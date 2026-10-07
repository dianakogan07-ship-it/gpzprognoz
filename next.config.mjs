import { execSync } from "node:child_process";

/** Номер сборки — коммит. По нему открытые вкладки узнают об обновлении сайта */
function buildId() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try { return execSync("git rev-parse HEAD").toString().trim(); } catch { return "dev"; }
}
const BUILD_ID = buildId();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  // pdf.js читается на сервере как обычный пакет Node, без сборки
  experimental: {
    serverComponentsExternalPackages: ["pdfjs-dist", "7z-wasm"],
    // Обработчик pdf.js подключается динамически — без этого Vercel не кладёт его в функцию
    outputFileTracingIncludes: { "/api/indices/mer/parse": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", "./node_modules/7z-wasm/7zz.wasm"] },
  },
};
export default nextConfig;
