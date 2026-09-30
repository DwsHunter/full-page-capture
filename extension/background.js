import { getSettings } from './settings.js';
import { saveShot } from './db.js';
import { createSession, drawFrame, toPng } from './stitch.js';

// captureVisibleTab is limited to ~2 calls/second per extension.
const MIN_CAPTURE_GAP_MS = 550;

const sessions = new Map(); // tabId -> capture session

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(
    (res) => sendResponse(res ?? { ok: true }),
    (err) => sendResponse({ error: String(err?.message || err) })
  );
  return true; // async response
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab?.id) return;
  start(tab.id, command === 'capture-pick' ? 'pick' : 'auto').catch((e) => flashBadge(tab.id, 'ERR', e));
});

async function handle(msg, sender) {
  const tab = sender.tab;
  switch (msg.type) {
    case 'start':  return start(msg.tabId, msg.mode);
    case 'begin':  return begin(tab, msg);
    case 'frame':  return frame(tab, msg);
    case 'finish': return finish(tab, msg);
    case 'abort':
      sessions.delete(tab?.id);
      if (tab?.id) setBadge(tab.id, '');
      return { ok: true };
    default:
      return undefined;
  }
}

async function start(tabId, mode) {
  const settings = await getSettings();
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (e) {
    throw new Error("This page can't be captured (browser pages, the Web Store and the PDF viewer are off-limits to extensions).");
  }
  const res = await chrome.tabs.sendMessage(tabId, { type: 'run', mode, settings });
  if (res?.error) throw new Error(res.error);
  return { ok: true };
}

function begin(tab, m) {
  sessions.set(tab.id, createSession(m));
  setBadge(tab.id, '0%');
  return { ok: true };
}

async function captureWithRetry(windowId) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    } catch (e) {
      if (attempt < 3 && /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|quota/i.test(String(e?.message))) {
        await sleep(700);
        continue;
      }
      throw e;
    }
  }
}

async function frame(tab, m) {
  const s = sessions.get(tab.id);
  if (!s) throw new Error('No capture in progress.');

  const wait = s.lastCapture + MIN_CAPTURE_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);

  const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (!active || active.id !== tab.id) {
    throw new Error('The tab was switched during capture. Keep the tab visible until it finishes.');
  }

  const dataUrl = await captureWithRetry(tab.windowId);
  s.lastCapture = Date.now();
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());

  drawFrame(s, bmp, m);
  bmp.close();
  setBadge(tab.id, `${Math.min(99, Math.round((m.progress || 0) * 100))}%`);
  return { ok: true };
}

async function finish(tab, m) {
  const s = sessions.get(tab.id);
  sessions.delete(tab.id);
  const blob = await toPng(s);
  const id = `${Date.now()}`;
  await saveShot({
    id,
    blob,
    name: s.name || tab.title || 'capture',
    cssWidth: s.cssW,
    cssHeight: s.cssH,
    pxPerCss: s.outScale,
    created: new Date().toISOString()
  });
  setBadge(tab.id, '');
  await chrome.tabs.create({ url: `viewer.html#${id}`, index: tab.index + 1, openerTabId: tab.id });
  return { ok: true, id };
}

function setBadge(tabId, text) {
  chrome.action.setBadgeBackgroundColor({ color: '#2563eb' }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
}

function flashBadge(tabId, text, err) {
  console.warn('[clean-capture]', err);
  chrome.action.setBadgeBackgroundColor({ color: '#dc2626' }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {}), 4000);
}
