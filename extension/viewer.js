import { loadShot } from './db.js';
import { getSettings, setSettings } from './settings.js';
import { buildPdf } from './pdf.js';

const $ = (id) => document.getElementById(id);
const status = (text, cls = '') => { $('status').textContent = text; $('status').className = cls; };

function safeName(s) {
  const cleaned = String(s || 'capture')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  return (cleaned || 'capture').slice(0, 100);
}

function stamp(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function save(blob, ext, settings, rec) {
  const url = URL.createObjectURL(blob);
  const folder = safeName(settings.folder || '').replace(/ /g, '_');
  const file = `${safeName(rec.name)}_${stamp(rec.created)}.${ext}`;
  const id = await chrome.downloads.download({
    url,
    filename: folder ? `${folder}/${file}` : file,
    saveAs: !!settings.saveAs,
    conflictAction: 'uniquify'
  });
  const onChanged = (d) => {
    if (d.id === id && d.state && d.state.current !== 'in_progress') {
      chrome.downloads.onChanged.removeListener(onChanged);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };
  chrome.downloads.onChanged.addListener(onChanged);
  return file;
}

const id = location.hash.slice(1);
const rec = id ? await loadShot(id) : null;

if (!rec) {
  $('title').textContent = 'Capture not found';
  $('main').innerHTML = '<p class="empty">This capture is no longer stored. Take a new one from the toolbar button.</p>';
  document.querySelectorAll('button, select').forEach((b) => { b.disabled = true; });
} else {
  const settings = await getSettings();
  const bitmap = await createImageBitmap(rec.blob);
  document.title = rec.name;
  $('title').textContent = rec.name;
  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = `${bitmap.width} × ${bitmap.height} px · ${(rec.blob.size / 1048576).toFixed(1)} MB PNG`;
  $('title').appendChild(meta);

  const img = document.createElement('img');
  img.alt = rec.name;
  img.src = URL.createObjectURL(rec.blob);
  img.style.width = `${Math.min(rec.cssWidth, bitmap.width)}px`;
  $('main').appendChild(img);

  $('layout').value = settings.pdfLayout;
  $('layout').addEventListener('change', () => setSettings({ pdfLayout: $('layout').value }));

  const savePdf = async () => {
    $('pdf').disabled = true;
    try {
      status('Building PDF…');
      const pdf = await buildPdf(bitmap, {
        cssWidth: rec.cssWidth,
        layout: $('layout').value,
        image: settings.pdfImage,
        title: rec.name,
        onProgress: (p) => status(`Building PDF… ${Math.round(p * 100)}%`)
      });
      const file = await save(pdf, 'pdf', settings, rec);
      status(`Saved ${file}`, 'ok');
    } catch (e) {
      status(`PDF failed: ${e.message || e}`, 'err');
    } finally {
      $('pdf').disabled = false;
    }
  };

  $('pdf').addEventListener('click', savePdf);
  $('png').addEventListener('click', async () => {
    try { status(`Saved ${await save(rec.blob, 'png', settings, rec)}`, 'ok'); }
    catch (e) { status(`PNG failed: ${e.message || e}`, 'err'); }
  });
  $('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': rec.blob })]);
      status('Copied to clipboard', 'ok');
    } catch (e) {
      status(`Copy failed: ${e.message || e}`, 'err');
    }
  });

  if (settings.alsoPng) save(rec.blob, 'png', settings, rec).catch(() => {});
  if (settings.pdfAuto) await savePdf();
}
