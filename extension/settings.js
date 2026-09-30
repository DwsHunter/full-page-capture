// Shared settings (popup, service worker, viewer). The content script receives them by message.
export const DEFAULTS = {
  delay: 400,               // ms to wait after each scroll step before capturing
  waitRender: true,         // wait for loading markers (aria-busy, data-render-complete, spinners)
  preload: true,            // quick scroll pass first so lazily-rendered panels load
  hideOverlays: true,       // hide fixed headers / side navs / bottom bars, un-stick sticky rows
  rememberPick: true,       // remember the picked area per site
  pdfAuto: true,            // save a PDF automatically when the capture finishes
  pdfLayout: 'continuous',  // 'continuous' | 'a4-portrait' | 'a4-landscape'
  pdfImage: 'lossless',     // 'lossless' (sharp text) | 'jpeg' (smaller file)
  alsoPng: false,           // also save the PNG automatically
  saveAs: false,            // ask where to save each file
  folder: 'CleanCaptures'   // sub-folder inside Downloads
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(settings || {}) };
}

export async function setSettings(patch) {
  const current = await getSettings();
  await chrome.storage.local.set({ settings: { ...current, ...patch } });
}
