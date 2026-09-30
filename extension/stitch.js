// Pure stitching logic (no chrome.* APIs) — used by the service worker and by the test harness.

// Chromium canvas limits: 32767 px per side, ~268M px total.
const MAX_SIDE = 32000;
const MAX_AREA = 250_000_000;

// Chrome snaps painted edges half-up; a tiny bias keeps float noise (1.4999…) from rounding the other way.
const snap = (v) => Math.round(v + 1e-3);

export function createSession({ width, height, viewportW, name }) {
  return { cssW: width, cssH: height, viewportW, name, canvas: null, ctx: null, outScale: 1, scale: 1, lastCapture: 0 };
}

function initCanvas(s, scale) {
  let o = scale;
  if (s.cssH * o > MAX_SIDE) o = MAX_SIDE / s.cssH;
  if (s.cssW * o > MAX_SIDE) o = Math.min(o, MAX_SIDE / s.cssW);
  if (s.cssW * o * s.cssH * o > MAX_AREA) o = Math.sqrt(MAX_AREA / (s.cssW * s.cssH));
  s.outScale = o;
  s.scale = scale;
  s.canvas = new OffscreenCanvas(Math.max(1, snap(s.cssW * o)), Math.max(1, snap(s.cssH * o)));
  s.ctx = s.canvas.getContext('2d');
  s.ctx.imageSmoothingEnabled = o !== scale;
  s.ctx.imageSmoothingQuality = 'high';
}

/**
 * Draw rows [dy, dy+sh) of the target (CSS px) taken from viewport rect (sx, sy, sw, sh) of one screenshot.
 * @param {ReturnType<typeof createSession>} s
 * @param {ImageBitmap} bmp  full viewport screenshot
 * @param {{sx:number, sy:number, sw:number, sh:number, dy:number, viewportW:number}} m
 */
export function drawFrame(s, bmp, m) {
  // Device pixels per CSS pixel (covers Windows display scaling and browser zoom).
  const scale = bmp.width / m.viewportW;
  if (!s.canvas) initCanvas(s, scale);
  const o = s.outScale;

  // Round both edges in output pixels so consecutive strips tile with no gap and no overlap.
  const dy0 = snap(m.dy * o);
  const dy1 = snap((m.dy + m.sh) * o);
  const sx0 = Math.max(0, snap(m.sx * scale));
  const sw = Math.min(bmp.width - sx0, snap(m.sw * scale));
  let sy0 = Math.max(0, snap(m.sy * scale));
  let sh = Math.min(bmp.height - sy0, snap((m.sy + m.sh) * scale) - sy0);
  let dh = dy1 - dy0;
  if (o === scale) {
    // 1:1 copy: take exactly as many source rows as destination rows (no stretching by a rounding pixel).
    // If rounding pushes the strip past the screenshot's bottom edge, slide it up by that pixel instead
    // of leaving an empty row.
    if (sy0 + dh > bmp.height) sy0 = Math.max(0, bmp.height - dh);
    sh = Math.min(dh, bmp.height - sy0);
    dh = sh;
  }

  if (sw > 0 && sh > 0 && dh > 0) {
    s.ctx.drawImage(bmp, sx0, sy0, sw, sh, 0, dy0, s.canvas.width, dh);
  }
}

export async function toPng(s) {
  if (!s?.canvas) throw new Error('Nothing was captured.');
  return s.canvas.convertToBlob({ type: 'image/png' });
}
