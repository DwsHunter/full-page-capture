// Stands in for the extension runtime so the real content.js + stitch.js run in a plain page.
// Screenshots come from CDP Page.captureScreenshot (viewport only, device pixels), which is what
// chrome.tabs.captureVisibleTab returns in the real extension.
window.__store = window.__store || {};
window.__listeners = [];
window.__log = [];
window.chrome = {
  runtime: {
    onMessage: { addListener: (f) => window.__listeners.push(f) },
    sendMessage: (msg) => window.__bg(msg)
  },
  storage: {
    local: {
      get: async (k) => (typeof k === 'string' ? { [k]: window.__store[k] } : { ...window.__store }),
      set: async (o) => { Object.assign(window.__store, o); window.__persist?.(JSON.stringify(window.__store)); }
    }
  }
};
window.__bg = async (msg) => {
  const st = await import('/extension/stitch.js');
  if (msg.type === 'begin') { window.__session = st.createSession(msg); window.__begin = msg; return { ok: true }; }
  if (msg.type === 'frame') {
    const b64 = await window.__capture();
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    st.drawFrame(window.__session, bmp, msg);
    bmp.close();
    window.__log.push(msg);
    return { ok: true };
  }
  if (msg.type === 'finish') { window.__result = await st.toPng(window.__session); window.__done = true; return { ok: true }; }
  if (msg.type === 'abort') { window.__aborted = true; return { ok: true }; }
  return undefined;
};
