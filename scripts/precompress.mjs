import { gzipSync } from "node:zlib";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const root = new URL("../dist/web/", import.meta.url);
const compressible = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".svg",
  ".txt",
  ".webmanifest",
]);
let fileCount = 0;
let sourceBytes = 0;
let compressedBytes = 0;

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    if (!compressible.has(extname(entry.name))) continue;

    const { size } = await stat(path);
    if (size < 1024) continue;

    const source = await readFile(path);
    const compressed = gzipSync(source, { level: 9 });
    if (compressed.length >= source.length) continue;

    await writeFile(`${path}.gz`, compressed);
    fileCount += 1;
    sourceBytes += source.length;
    compressedBytes += compressed.length;
  }
}

await walk(root.pathname);
process.stdout.write(
  `Precompressed ${fileCount} files: ${sourceBytes} → ${compressedBytes} bytes\n`,
);
