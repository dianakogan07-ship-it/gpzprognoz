/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pdf.js читается на сервере как обычный пакет Node, без сборки
  experimental: {
    serverComponentsExternalPackages: ["pdfjs-dist"],
    // Обработчик pdf.js подключается динамически — без этого Vercel не кладёт его в функцию
    outputFileTracingIncludes: { "/api/indices/mer/parse": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"] },
  },
};
export default nextConfig;
