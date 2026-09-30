// Minimal dependency-free PDF writer for stitched screenshots.
// - "continuous": one tall page at the capture's real size (split only past the 200-inch PDF page limit)
// - "a4-portrait" / "a4-landscape": fit to width, page breaks moved to blank gutters between panels

const enc = new TextEncoder();
const PT_PER_CSS_PX = 0.75;   // 96 CSS px = 72 pt
const MAX_PAGE_PT = 14400;    // PDF implementation limit (200 in)
const PAGES = { 'a4-portrait': [595.28, 841.89], 'a4-landscape': [841.89, 595.28] };
const MARGIN = 18;
const BAND_ROWS = 1024;

const f = (n) => (Math.round(n * 100) / 100).toString();

function pdfDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function pdfText(s) {
  // UTF-16BE hex string with BOM, safe for any language (e.g. Arabic titles).
  let hex = 'FEFF';
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    const units = cp > 0xffff
      ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)]
      : [cp];
    for (const u of units) hex += u.toString(16).padStart(4, '0').toUpperCase();
  }
  return `<${hex}>`;
}

class Writer {
  constructor() {
    this.parts = [];
    this.length = 0;
    this.offsets = [];
    this.write('%PDF-1.4\n');
    this.write(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  }
  write(x) {
    const b = typeof x === 'string' ? enc.encode(x) : x;
    this.parts.push(b);
    this.length += b.byteLength;
  }
  object(n, dict, stream) {
    this.offsets[n] = this.length;
    if (stream) {
      this.write(`${n} 0 obj\n<< ${dict} /Length ${stream.byteLength} >>\nstream\n`);
      this.write(stream);
      this.write('\nendstream\nendobj\n');
    } else {
      this.write(`${n} 0 obj\n${dict}\nendobj\n`);
    }
  }
  finish(count) {
    const xref = this.length;
    let s = `xref\n0 ${count + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= count; i++) s += `${String(this.offsets[i]).padStart(10, '0')} 00000 n \n`;
    s += `trailer\n<< /Size ${count + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    this.write(s);
    return new Blob(this.parts, { type: 'application/pdf' });
  }
}

// Row y is "blank" when every pixel matches the first one (panel gutters / background).
function blankRow(data, width, y) {
  const o = y * width * 4;
  const r = data[o], g = data[o + 1], b = data[o + 2];
  for (let x = 1; x < width; x++) {
    const i = o + x * 4;
    if (Math.abs(data[i] - r) > 8 || Math.abs(data[i + 1] - g) > 8 || Math.abs(data[i + 2] - b) > 8) return false;
  }
  return true;
}

// Choose a cut <= ideal, preferring a blank row in the last 35% of the page.
function findBreak(bitmap, start, ideal) {
  const lo = Math.max(start + 1, Math.floor(ideal - (ideal - start) * 0.35));
  const h = ideal - lo + 1;
  if (h <= 1) return ideal;
  const c = new OffscreenCanvas(bitmap.width, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, lo, bitmap.width, h, 0, 0, bitmap.width, h);
  const { data } = ctx.getImageData(0, 0, bitmap.width, h);
  for (let y = h - 1; y >= 0; y--) {
    if (blankRow(data, bitmap.width, y)) return lo + y;
  }
  return ideal;
}

function planSlices(bitmap, maxRows, smart) {
  const slices = [];
  let y = 0;
  while (y < bitmap.height) {
    let end = Math.min(bitmap.height, y + maxRows);
    if (end < bitmap.height && smart) end = Math.max(y + 1, findBreak(bitmap, y, end));
    slices.push([y, end]);
    y = end;
  }
  return slices;
}

async function encodeSlice(bitmap, y0, y1, mode) {
  const w = bitmap.width;
  const h = y1 - y0;
  if (mode === 'jpeg') {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, y0, w, h, 0, 0, w, h);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    return { filter: 'DCTDecode', bytes: new Uint8Array(await blob.arrayBuffer()) };
  }
  // Lossless: raw RGB rows through zlib (FlateDecode), streamed in bands to keep memory low.
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  const out = new Response(cs.readable).arrayBuffer();
  const band = new OffscreenCanvas(w, Math.min(BAND_ROWS, h));
  const ctx = band.getContext('2d', { willReadFrequently: true });
  for (let y = y0; y < y1; y += BAND_ROWS) {
    const bh = Math.min(BAND_ROWS, y1 - y);
    ctx.clearRect(0, 0, w, band.height);
    ctx.drawImage(bitmap, 0, y, w, bh, 0, 0, w, bh);
    const { data } = ctx.getImageData(0, 0, w, bh);
    const rgb = new Uint8Array(w * bh * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      const a = data[i + 3] / 255; // composite any transparency over white
      rgb[j] = data[i] * a + 255 * (1 - a);
      rgb[j + 1] = data[i + 1] * a + 255 * (1 - a);
      rgb[j + 2] = data[i + 2] * a + 255 * (1 - a);
    }
    await writer.write(rgb);
  }
  await writer.close();
  return { filter: 'FlateDecode', bytes: new Uint8Array(await out) };
}

/**
 * @param {ImageBitmap} bitmap  stitched capture
 * @param {{cssWidth:number, layout:string, image:string, title:string, onProgress?:(p:number)=>void}} opts
 * @returns {Promise<Blob>}
 */
export async function buildPdf(bitmap, opts) {
  const W = bitmap.width;
  const pxPerCss = W / opts.cssWidth;
  const page = PAGES[opts.layout];

  let ptPerPx;
  let maxRows;
  if (page) {
    ptPerPx = (page[0] - 2 * MARGIN) / W;
    maxRows = Math.floor((page[1] - 2 * MARGIN) / ptPerPx);
  } else {
    ptPerPx = Math.min(PT_PER_CSS_PX / pxPerCss, MAX_PAGE_PT / W);
    maxRows = Math.floor(MAX_PAGE_PT / ptPerPx);
  }

  const slices = planSlices(bitmap, maxRows, true);
  const pdf = new Writer();
  const kids = [];

  for (let i = 0; i < slices.length; i++) {
    const [y0, y1] = slices[i];
    const pageObj = 4 + i * 3;
    const contentObj = pageObj + 1;
    const imageObj = pageObj + 2;
    const img = await encodeSlice(bitmap, y0, y1, opts.image);

    const drawW = W * ptPerPx;
    const drawH = (y1 - y0) * ptPerPx;
    const [pw, ph] = page || [drawW, drawH];
    const x = page ? MARGIN : 0;
    const y = page ? ph - MARGIN - drawH : 0;

    pdf.object(imageObj,
      `/Type /XObject /Subtype /Image /Width ${W} /Height ${y1 - y0} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${img.filter}`,
      img.bytes);
    pdf.object(contentObj, '', enc.encode(`q ${f(drawW)} 0 0 ${f(drawH)} ${f(x)} ${f(y)} cm /Im0 Do Q`));
    pdf.object(pageObj,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(pw)} ${f(ph)}] ` +
      `/Resources << /XObject << /Im0 ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>`);
    kids.push(`${pageObj} 0 R`);
    opts.onProgress?.((i + 1) / slices.length);
  }

  pdf.object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  pdf.object(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`);
  pdf.object(3, `<< /Title ${pdfText(opts.title || 'Capture')} /CreationDate (${pdfDate(new Date())}) >>`);
  return pdf.finish(3 + slices.length * 3);
}
