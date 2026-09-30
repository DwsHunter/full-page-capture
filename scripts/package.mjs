// Builds dist/clean-full-page-capture-v<version>.zip (manifest at the zip root: ready for
// "Load unpacked" after extracting, or for Chrome Web Store upload) plus a SHA256SUMS file.
import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'extension');
const DIST = join(ROOT, 'dist');
const { version } = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
const name = `clean-full-page-capture-v${version}.zip`;

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const zip = new AdmZip();
zip.addLocalFolder(EXT, '', (file) => !/(^|[\\/])\.|\.DS_Store$|Thumbs\.db$/.test(file));
const buf = zip.toBuffer();
writeFileSync(join(DIST, name), buf);

const sha = createHash('sha256').update(buf).digest('hex');
writeFileSync(join(DIST, 'SHA256SUMS.txt'), `${sha}  ${name}\n`);

console.log(`✔ dist/${name} (${(buf.length / 1024).toFixed(1)} KB, ${zip.getEntries().length} entries)`);
console.log(`  sha256 ${sha}`);
