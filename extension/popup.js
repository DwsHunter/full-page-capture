import { getSettings, setSettings } from './settings.js';

const $ = (id) => document.getElementById(id);
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

let host = '';
try { host = new URL(tab.url).host; } catch { /* no url access */ }

// Saved area for this site
const key = `area:${host}`;
async function renderSaved() {
  const { [key]: sel } = host ? await chrome.storage.local.get(key) : {};
  $('saved').style.display = sel ? 'block' : 'none';
  $('savedSel').textContent = sel || '';
  $('autoHint').textContent = sel ? 'Uses the saved area for this site' : 'Auto-detects the scrolling content';
}
$('forget').addEventListener('click', async () => {
  await chrome.storage.local.remove(key);
  renderSaved();
});
renderSaved();

// Settings
const settings = await getSettings();
for (const el of document.querySelectorAll('[data-k]')) {
  const k = el.dataset.k;
  if (el.type === 'checkbox') el.checked = !!settings[k];
  else el.value = settings[k];
  el.addEventListener('change', () => {
    const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Math.max(0, Number(el.value) || 0) : el.value;
    setSettings({ [k]: v });
  });
}

// Actions
async function start(mode) {
  $('err').style.display = 'none';
  const res = await chrome.runtime.sendMessage({ type: 'start', tabId: tab.id, mode }).catch((e) => ({ error: e.message }));
  if (res?.error) {
    $('err').textContent = res.error;
    $('err').style.display = 'block';
    return;
  }
  window.close();
}
$('auto').addEventListener('click', () => start('auto'));
$('pick').addEventListener('click', () => start('pick'));
