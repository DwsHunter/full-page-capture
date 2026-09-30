// End-to-end tests: runs the real content.js + stitch.js + pdf.js + viewer/popup pages in headless
// Chromium against dashboard-like fixture pages and checks the output pixel by pixel.
//
//   npm test                      all scaling factors (100 %, 125 %, 150 %, 200 %)
//   DPRS=1,1.25 npm test          selected scaling factors
//   KEEP_OUTPUT=1 npm test        write captures/PDFs to tests/output/
//   CHROME_PATH=/path/chrome ...  use a local Chrome/Chromium instead of the bundled one (Linux x64 bundled)
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { PNG } from 'pngjs';
import http from 'node:http';
import { inflateSync } from 'node:zlib';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname, resolve, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DPRS = (process.env.DPRS || '1,1.25,1.5,2').split(',').map(Number);
const KEEP = !!process.env.KEEP_OUTPUT;
const OUT = join(ROOT, 'tests', 'output');
const SETTINGS = { delay: 150, waitRender: true, preload: true, hideOverlays: true, rememberPick: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snap = (v) => Math.round(v + 1e-3); // same rounding as extension/stitch.js

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// ------------------------------------------------------------------ static server

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

async function launch(dpr) {
  const common = {
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-gpu', `--force-device-scale-factor=${dpr}`, '--window-size=1280,800']
  };
  if (process.env.CHROME_PATH) return puppeteer.launch({ ...common, executablePath: process.env.CHROME_PATH, headless: true });
  return puppeteer.launch({ ...common, executablePath: await chromium.executablePath(), headless: 'shell' });
}

// ------------------------------------------------------------------ pixel verification

const FORBIDDEN = { red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255], yellow: [255, 255, 0], magenta: [255, 0, 255], cyan: [0, 255, 255] };
const near = (px, c, tol = 2) => Math.abs(px[0] - c[0]) <= tol && Math.abs(px[1] - c[1]) <= tol && Math.abs(px[2] - c[2]) <= tol;

function verifyCapture(png, dpr, begin, spec) {
  const problems = [];
  const at = (x, y) => { const i = (y * png.width + x) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]]; };

  const expW = snap(begin.width * dpr);
  const expH = snap(begin.height * dpr);
  if (png.width !== expW || png.height !== expH) problems.push(`size ${png.width}x${png.height}, expected ${expW}x${expH}`);

  // Decode the encoded column: every CSS row once, in order.
  const x = Math.round((spec.enc.left + 10) * dpr);
  const y0 = Math.round(spec.enc.top * dpr);
  const y1 = Math.min(png.height, Math.round((spec.enc.top + spec.enc.h) * dpr));
  const rows = spec.enc.h;
  const count = new Array(rows).fill(0);
  let prev = -1; let backwards = 0; let jumps = 0; let bigJumps = 0; let badInner = 0;
  for (let y = y0; y < y1; y++) {
    const [r, g, b] = at(x, y);
    if (Math.abs(b - 77) > 1) { if (y > y0 && y < y1 - 2) badInner++; continue; }
    const v = g * 256 + (g % 2 ? 255 - r : r);
    if (v >= 0 && v < rows) count[v]++;
    if (prev >= 0) {
      if (v < prev) backwards++;
      if (v - prev > 1) jumps++;
      if (v - prev > 2) bigJumps++;
    }
    prev = v;
  }
  const missing = count.filter((c) => c === 0).length;
  const maxRep = Math.max(...count);
  if (Number.isInteger(dpr)) {
    if (missing || backwards || jumps || badInner || maxRep > dpr) {
      problems.push(`rows: missing=${missing} backwards=${backwards} jumps=${jumps} bad=${badInner} maxRep=${maxRep}`);
    }
  } else if (backwards || bigJumps || badInner || missing > 20 || maxRep > Math.ceil(dpr) + 1) {
    problems.push(`rows: missing=${missing} backwards=${backwards} bigJumps=${bigJumps} bad=${badInner} maxRep=${maxRep}`);
  }

  // Lazy panel must be rendered (not the grey placeholder); footer present; last row is footer.
  const mid = (el) => Math.round((el.top + el.h / 2) * dpr);
  if (!near(at(x, mid(spec.lazy)), [0x33, 0x66, 0x99])) problems.push(`lazy panel not rendered: ${at(x, mid(spec.lazy))}`);
  if (!near(at(x, mid(spec.foot)), [0x12, 0x34, 0x56])) problems.push(`footer missing: ${at(x, mid(spec.foot))}`);
  if (!near(at(x, png.height - 1), [0x12, 0x34, 0x56])) problems.push(`last row is not the footer: ${at(x, png.height - 1)}`);

  // No header / nav / bottom bar / overlay pixels. Magenta (sticky bar) only where it really sits.
  const allow = spec.allowMagenta && [Math.round(spec.allowMagenta[0] * dpr) - 1, Math.round(spec.allowMagenta[1] * dpr) + 1];
  const leaks = {};
  for (let y = 0; y < png.height; y++) {
    for (let xx = 0; xx < png.width; xx += 2) {
      const px = at(xx, y);
      for (const [name, c] of Object.entries(FORBIDDEN)) {
        if (!near(px, c)) continue;
        if (name === 'magenta' && allow && y >= allow[0] && y < allow[1]) continue;
        leaks[name] = (leaks[name] || 0) + 1;
      }
    }
  }
  for (const [name, n] of Object.entries(leaks)) problems.push(`leaked ${name} pixels: ${n}`);
  return problems;
}

// ------------------------------------------------------------------ PDF verification

function verifyPdf(buf, { pages, lossless, png }) {
  const problems = [];
  const text = buf.toString('latin1');
  if (!text.startsWith('%PDF-1.4')) problems.push('bad header');
  const sx = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
  if (!(sx > 0) || text.slice(sx, sx + 4) !== 'xref') problems.push('startxref does not point at xref');
  else {
    const [, n] = /^xref\n0 (\d+)\n/.exec(text.slice(sx)) || [];
    const entries = text.slice(sx).split('\n').slice(3, 2 + Number(n));
    entries.forEach((e, i) => {
      const off = Number(e.slice(0, 10));
      if (!text.startsWith(`${i + 1} 0 obj`, off)) problems.push(`xref entry ${i + 1} is wrong`);
    });
  }
  const pageCount = (text.match(/\/Type \/Page\b(?!s)/g) || []).length;
  if (pages === 1 ? pageCount !== 1 : pageCount < 2) problems.push(`page count ${pageCount}`);
  if (Number(/\/Count (\d+)/.exec(text)?.[1]) !== pageCount) problems.push('/Count does not match pages');
  if (/\/Producer|Clean Full-Page|Clean Capture/i.test(text)) problems.push('tool name / Producer found in PDF');
  if (!/\/Title <FEFF/.test(text)) problems.push('missing UTF-16 title');

  if (lossless && pages === 1) {
    // The single image must be byte-identical to the stitched PNG (RGB).
    const m = /\/Width (\d+) \/Height (\d+) [^>]*\/FlateDecode \/Length (\d+) >>\nstream\n/.exec(text);
    if (!m) problems.push('image stream not found');
    else {
      const start = m.index + m[0].length;
      const rgb = inflateSync(buf.subarray(start, start + Number(m[3])));
      let diff = 0;
      for (let i = 0, j = 0; i < png.data.length; i += 4, j += 3) {
        if (png.data[i] !== rgb[j] || png.data[i + 1] !== rgb[j + 1] || png.data[i + 2] !== rgb[j + 2]) diff++;
      }
      if (Number(m[1]) !== png.width || Number(m[2]) !== png.height || diff) problems.push(`lossless image differs (${diff} px)`);
    }
  }
  return problems;
}

// ------------------------------------------------------------------ capture scenarios

async function blobToBuffer(page, expr) {
  const b64 = await page.evaluate(async (e) => {
    const blob = await (0, eval)(e);
    return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
  }, expr);
  return Buffer.from(b64, 'base64');
}

function specFor(page, target) {
  return page.evaluate((target) => {
    const box = (el) => el.getBoundingClientRect();
    const origin = target === 'document' ? { top: -scrollY, left: -scrollX } : box(document.querySelector(target));
    const rel = (el) => { const r = box(el); return { top: r.top - origin.top, left: r.left - origin.left, h: r.height }; };
    const bar = rel(document.getElementById('sticky') || document.getElementById('query'));
    return {
      enc: rel(document.getElementById('enc')),
      lazy: rel(document.querySelector('.lazy')),
      foot: rel(document.getElementById('foot')),
      allowMagenta: bar.top >= 0 ? [bar.top, bar.top + bar.h] : null
    };
  }, target);
}

async function capture(browser, dpr, { name, page: file, target, drive, expectAbort = false, maxSeconds = 0, store }) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await page.createCDPSession();
  await page.exposeFunction('__capture', async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data);
  await page.exposeFunction('__persist', (s) => Object.assign(store, JSON.parse(s)));
  await page.goto(`${BASE}/tests/pages/${file}`, { waitUntil: 'load' });
  await page.evaluate((s) => { window.__store = s; }, store);
  await page.addScriptTag({ path: join(ROOT, 'tests', 'shim.js') });
  await page.addScriptTag({ path: join(ROOT, 'extension', 'content.js') });
  const spec = await specFor(page, target);

  // Start mid-page to prove the original scroll position is restored afterwards.
  const scrollBefore = await page.evaluate(() => {
    const a = document.getElementById('app');
    if (a) a.scrollTop = 777; else scrollTo(0, 555);
    return [scrollY, a?.scrollTop ?? null];
  });
  const run = (mode) => page.evaluate((m, s) => window.__listeners[0]({ type: 'run', mode: m, settings: s }, {}, () => {}), mode, SETTINGS);
  const started = Date.now();
  await drive(page, run);
  await page.waitForFunction(() => window.__done || window.__aborted, { timeout: 180000 });

  const state = await page.evaluate(() => ({
    done: !!window.__done,
    begin: window.__begin,
    scroll: [scrollY, document.getElementById('app')?.scrollTop ?? null],
    leftover: document.querySelectorAll('[style*="important"]').length,
    shield: !!document.getElementById('__clean_capture_root__')
  }));
  const problems = [...errors.map((e) => `page error: ${e}`)];
  const seconds = (Date.now() - started) / 1000;
  if (maxSeconds && seconds > maxSeconds) problems.push(`took ${seconds.toFixed(1)} s (limit ${maxSeconds} s)`);
  if (JSON.stringify(state.scroll) !== JSON.stringify(scrollBefore)) problems.push(`scroll not restored ${JSON.stringify(state.scroll)}`);
  if (state.leftover) problems.push(`${state.leftover} inline style overrides left behind`);
  if (state.shield) problems.push('capture shield left on page');

  let png = null;
  if (expectAbort) {
    if (state.done) problems.push('capture was not cancelled');
  } else if (!state.done) {
    problems.push('capture did not finish');
  } else {
    const buf = await blobToBuffer(page, 'window.__result');
    png = PNG.sync.read(buf);
    problems.push(...verifyCapture(png, dpr, state.begin, spec));
    if (KEEP) await writeFile(join(OUT, `dpr${dpr}-${name}.png`), buf);
  }
  record(`[${dpr * 100}%] ${name}`, problems.length === 0, problems.join('; '));
  return { page, png, begin: state.begin };
}

const scenarios = [
  { name: 'inner scroll container, auto → <main>', page: 'inner.html', target: '#dash', drive: (p, run) => run('auto') },
  { name: 'window scroll, auto → whole page', page: 'window.html', target: 'document', drive: (p, run) => run('auto') },
  { name: 'window scroll, auto → known app content area', page: 'window.html?known', target: '#dash', drive: (p, run) => run('auto') },
  // Without the stuck-marker guard this takes ~75 s (every step waits for the full timeout).
  { name: 'never-clearing loading marker is skipped', page: 'window.html?stuck', target: 'document', maxSeconds: 25, drive: (p, run) => run('auto') },
  {
    name: 'window scroll, pick with ↑ + Enter', page: 'window.html', target: '#dash',
    drive: async (p, run) => { await run('pick'); await sleep(200); await p.mouse.move(300, 300); await sleep(150); await p.keyboard.press('ArrowUp'); await p.keyboard.press('Enter'); }
  },
  { name: 'window scroll, remembered area', page: 'window.html', target: '#dash', drive: (p, run) => run('auto') },
  {
    name: 'inner scroller, pick with click', page: 'inner.html', target: '#dash',
    drive: async (p, run) => { await run('pick'); await sleep(200); await p.mouse.move(1000, 400); await p.mouse.click(1000, 400); }
  },
  {
    name: 'Esc cancels a running capture', page: 'inner.html', target: '#dash', expectAbort: true,
    drive: async (p, run) => { await run('auto'); await sleep(1200); await p.keyboard.press('Escape'); }
  }
];

if (KEEP) await mkdir(OUT, { recursive: true });

for (const dpr of DPRS) {
  const browser = await launch(dpr);
  const store = {};
  try {
    for (const sc of scenarios) {
      const { page, png, begin } = await capture(browser, dpr, { ...sc, store });
      if (sc === scenarios[0] && png && dpr === DPRS[0]) {
        for (const [layout, image] of [['continuous', 'lossless'], ['a4-landscape', 'lossless'], ['a4-portrait', 'jpeg']]) {
          const pdf = await blobToBuffer(page, `(async () => {
            const { buildPdf } = await import('/extension/pdf.js');
            return buildPdf(await createImageBitmap(window.__result),
              { cssWidth: ${begin.width}, layout: '${layout}', image: '${image}', title: 'Weekly Sales — المبيعات الأسبوعية' });
          })()`);
          const problems = verifyPdf(pdf, { pages: layout === 'continuous' ? 1 : 2, lossless: image === 'lossless', png });
          record(`[${dpr * 100}%] PDF ${layout} / ${image}`, problems.length === 0, problems.join('; ') || `${(pdf.length / 1024).toFixed(0)} KB`);
          if (KEEP) await writeFile(join(OUT, `dpr${dpr}-${layout}-${image}.pdf`), pdf);
        }
      }
      await page.close();
    }
    if (store['area:127.0.0.1:' + server.address().port] !== '#dash') record(`[${dpr * 100}%] picked area remembered`, false, JSON.stringify(store));
  } finally {
    await browser.close();
  }
}

// ------------------------------------------------------------------ viewer + popup pages

{
  const browser = await launch(1);
  try {
    // Viewer: loads the stored capture and auto-saves the PDF through chrome.downloads.
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.evaluateOnNewDocument(() => {
      window.__dl = [];
      window.chrome = {
        storage: { local: { get: async () => ({}), set: async () => {} } },
        downloads: { download: async (o) => { window.__dl.push(o); return window.__dl.length; }, onChanged: { addListener() {}, removeListener() {} } }
      };
    });
    await page.goto(`${BASE}/extension/viewer.html`);
    await page.evaluate(async () => {
      const { saveShot } = await import('/extension/db.js');
      const c = new OffscreenCanvas(1200, 2400);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#0d1a30'; ctx.fillRect(0, 0, 1200, 2400);
      await saveShot({ id: '1', blob: await c.convertToBlob({ type: 'image/png' }), name: 'Demo: report / 1', cssWidth: 1200, cssHeight: 2400, pxPerCss: 1, created: '2026-01-02T03:04:05.000Z' });
    });
    await page.goto(`${BASE}/extension/viewer.html#1`);
    await page.reload();
    await page.waitForFunction(() => /Saved|failed/.test(document.getElementById('status').textContent), { timeout: 60000 });
    const v = await page.evaluate(async () => ({
      status: document.getElementById('status').textContent,
      dl: await Promise.all(window.__dl.map(async (d) => ({ filename: d.filename, head: new TextDecoder().decode((await (await fetch(d.url)).arrayBuffer()).slice(0, 8)) })))
    }));
    const ok = !errors.length && v.dl.length === 1 && /^CleanCaptures\/Demo report 1_\d{4}-\d\d-\d\d_\d{6}\.pdf$/.test(v.dl[0].filename) && v.dl[0].head === '%PDF-1.4';
    record('viewer auto-saves PDF with a safe file name', ok, ok ? v.dl[0].filename : JSON.stringify({ errors, v }));

    // Popup: renders settings and sends the right start message.
    const popup = await browser.newPage();
    const perr = [];
    popup.on('pageerror', (e) => perr.push(e.message));
    await popup.evaluateOnNewDocument(() => {
      window.__sent = [];
      window.close = () => { window.__closed = true; };
      window.chrome = {
        tabs: { query: async () => [{ id: 42, url: 'https://app.example/reports/weekly' }] },
        runtime: { sendMessage: async (m) => { window.__sent.push(m); return { ok: true }; } },
        storage: { local: { get: async (k) => (k === 'area:app.example' ? { [k]: '#content' } : {}), set: async () => {}, remove: async () => {} } }
      };
    });
    await popup.goto(`${BASE}/extension/popup.html`);
    await popup.waitForFunction(() => document.getElementById('saved').style.display === 'block');
    await popup.click('#auto');
    await popup.waitForFunction(() => window.__closed);
    const p = await popup.evaluate(() => ({ sent: window.__sent, hint: document.getElementById('autoHint').textContent }));
    const pok = !perr.length && p.sent.length === 1 && p.sent[0].type === 'start' && p.sent[0].tabId === 42 && p.sent[0].mode === 'auto';
    record('popup shows saved area and starts capture', pok, pok ? p.hint : JSON.stringify({ perr, p }));
  } finally {
    await browser.close();
  }
}

server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
