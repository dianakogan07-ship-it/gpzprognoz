/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pdf.js читается на сервере как обычный пакет Node, без сборки
  experimental: { serverComponentsExternalPackages: ["pdfjs-dist"] },
};
export default nextConfig;
