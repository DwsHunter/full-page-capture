// Static checks: syntax, manifest integrity, MV3 rules, and repo hygiene (no secrets / real IPs).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'extension');
const errors = [];
const fail = (msg) => errors.push(msg);
const rel = (p) => relative(ROOT, p).replaceAll('\\', '/');

function walk(dir, skip = new Set(['node_modules', '.git', 'dist'])) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, skip));
    else out.push(p);
  }
  return out;
}

const extFiles = walk(EXT);
const extJs = extFiles.filter((f) => extname(f) === '.js');

// 1. Syntax
for (const f of [...extJs, ...walk(ROOT).filter((f) => /\.(mjs|js)$/.test(f) && !f.startsWith(EXT))]) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) fail(`syntax: ${rel(f)}\n${r.stderr.trim()}`);
}

// 2. Manifest
const manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
if (manifest.manifest_version !== 3) fail('manifest: manifest_version must be 3');
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) fail(`manifest: invalid version "${manifest.version}"`);
if (manifest.version !== pkg.version) fail(`version mismatch: manifest ${manifest.version} vs package.json ${pkg.version}`);

const referenced = new Set([
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {})
].filter(Boolean));

// files referenced from code/html: imports, executeScript files, src/href, extension pages
for (const f of extFiles.filter((f) => /\.(js|html)$/.test(f))) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/from\s+'\.\/([^']+)'|files:\s*\['([^']+)'\]|(?:src|href)="(?!https?:|data:|#)([^"]+)"|url:\s*`([a-z]+\.html)/g)) {
    referenced.add(m[1] || m[2] || m[3] || m[4]);
  }
  if (/\beval\s*\(|new\s+Function\s*\(/.test(src)) fail(`MV3: ${rel(f)} uses eval/new Function`);
  if (/<script[^>]+src="https?:/i.test(src)) fail(`MV3: ${rel(f)} loads remote script`);
}
for (const r of referenced) {
  if (!existsSync(join(EXT, r))) fail(`missing file referenced by extension: extension/${r}`);
}

// 3. Hygiene: no secrets, no real IP addresses (only RFC 5737 documentation ranges and loopback)
const allowedIp = (ip) => /^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d+$/.test(ip) || ip === '127.0.0.1' || ip === '0.0.0.0';
const secretPatterns = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/\bglpat-[A-Za-z0-9_-]{20,}/, 'GitLab token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token']
];
for (const f of walk(ROOT).filter((f) => /\.(js|mjs|json|md|html|yml|yaml|txt|css)$/.test(f) && !f.endsWith('package-lock.json'))) {
  const src = readFileSync(f, 'utf8');
  for (const [re, what] of secretPatterns) if (re.test(src)) fail(`hygiene: ${what} in ${rel(f)}`);
  for (const m of src.matchAll(/(?<![\d.])(\d{1,3}(?:\.\d{1,3}){3})(?![\d.])/g)) {
    const ip = m[1];
    if (ip.split('.').every((o) => Number(o) <= 255) && !allowedIp(ip)) {
      fail(`hygiene: IP address ${ip} in ${rel(f)} (use 192.0.2.x / 198.51.100.x / 203.0.113.x in examples)`);
    }
  }
}

if (errors.length) {
  console.error(`✖ ${errors.length} problem(s):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`✔ check passed — ${extJs.length} extension scripts, ${referenced.size} referenced files, manifest v${manifest.version}`);
