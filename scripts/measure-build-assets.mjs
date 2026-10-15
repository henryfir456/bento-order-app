import { readdir, readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join, relative } from 'node:path';
const root = new URL('../dist/', import.meta.url).pathname;
async function list(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const file = join(dir, entry.name);
    return entry.isDirectory() ? list(file) : [file];
  }))).flat();
}
const files = await list(root);
const assets = [];
for (const file of files) {
  const bytes = (await stat(file)).size;
  const gzipped = gzipSync(await readFile(file), { level: 9 }).length;
  assets.push({ file: relative(root, file), bytes, gzipBytes: gzipped });
}
const javascript = assets.filter((x) => x.file.endsWith('.js'));
const styles = assets.filter((x) => x.file.endsWith('.css'));
const sum = (items, key) => items.reduce((acc, x) => acc + x[key], 0);
console.log(JSON.stringify({
  label: 'built-asset-size-observation-not-runtime-performance',
  totalFiles: assets.length,
  jsFiles: javascript.length,
  jsRawBytes: sum(javascript, 'bytes'),
  jsGzipBytes: sum(javascript, 'gzipBytes'),
  cssRawBytes: sum(styles, 'bytes'),
  cssGzipBytes: sum(styles, 'gzipBytes'),
  largestJs: javascript.sort((a, b) => b.gzipBytes - a.gzipBytes).slice(0, 5)
}, null, 2));
