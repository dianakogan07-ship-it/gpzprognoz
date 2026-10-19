import { readFile } from "node:fs/promises";
import path from "node:path";

export interface ArchiveFile { name: string; data: Uint8Array }

/** Распаковка архива (.7z, .zip, .rar) в памяти — так МЭР публикует таблицы к прогнозу */
export async function unpackArchive(data: Uint8Array): Promise<ArchiveFile[]> {
  const { default: SevenZip } = await import("7z-wasm");
  const wasmBinary = await readFile(path.join(process.cwd(), "node_modules/7z-wasm/7zz.wasm"));
  const sz = await SevenZip({ wasmBinary: wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength) as ArrayBuffer, print: () => {}, printErr: () => {} });
  const stream = sz.FS.open("/in.archive", "w+");
  sz.FS.write(stream, data, 0, data.length);
  sz.FS.close(stream);
  sz.FS.mkdir("/out");
  sz.callMain(["x", "/in.archive", "-o/out", "-y", "-bso0", "-bsp0"]);
  const out: ArchiveFile[] = [];
  const walk = (dir: string) => {
    for (const name of sz.FS.readdir(dir) as string[]) {
      if (name === "." || name === "..") continue;
      const full = `${dir}/${name}`;
      if (sz.FS.isDir(sz.FS.stat(full).mode)) walk(full);
      else out.push({ name: full.slice(5), data: sz.FS.readFile(full) as Uint8Array });
    }
  };
  walk("/out");
  return out;
}

/**
 * Из архива МЭР берём таблицы с индексами цен (дефляторы/ИЦП, ИПЦ) и макропараметрами (зарплата, курс доллара) —
 * базовый и консервативный варианты отдельно.
 */
export function pickMerFiles(files: ArchiveFile[]): { base: ArchiveFile[]; cons: ArchiveFile[] } {
  const tables = files.filter((f) => /\.(xlsx|xls|pdf)$/i.test(f.name));
  const relevant = tables.filter((f) => /дефлятор|ипц|инфляц|цен|макро/i.test(f.name));
  const list = relevant.length ? relevant : tables;
  return { base: list.filter((f) => !/консерв/i.test(f.name)), cons: list.filter((f) => /консерв/i.test(f.name)) };
}
