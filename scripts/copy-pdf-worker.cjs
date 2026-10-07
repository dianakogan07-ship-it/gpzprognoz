// Копирует обработчик pdf.js в public/ — нужен для разбора больших PDF прямо в браузере
const fs = require("node:fs");
const path = require("node:path");
const src = path.join(__dirname, "../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs");
const dst = path.join(__dirname, "../public/pdf.worker.min.mjs");
if (fs.existsSync(src)) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
