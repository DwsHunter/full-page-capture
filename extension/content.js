// Injected on demand. Finds what to capture, hides overlays, scrolls, and asks the service worker
// to grab + stitch only the rows that are new in each step.
(() => {
  if (window.__cleanCaptureLoaded) return;
  window.__cleanCaptureLoaded = true;

  const ROOT_ID = '__clean_capture_root__';
  const WIN = document.scrollingElement || document.documentElement;
  // Content-area selectors for apps whose layout needs a hint, checked before the generic heuristics.
  // Add an entry here when an app's content area isn't found by <main> / the largest-scroller rule.
  const KNOWN_CONTENT_AREAS = [
    '[data-test-subj="dshDashboardViewport"]',
    '.dshDashboardViewport',
    '[data-test-subj="dashboardViewport"]'
  ];
  // "Still loading" markers: the ARIA standard, render-complete flags, and common spinner/skeleton classes.
  const PENDING = [
    '[aria-busy="true"]',
    '[data-render-complete="false"]',
    '.euiLoadingChart', '.euiLoadingSpinner', '.euiLoadingElastic', '.euiLoadingLogo',
    '.euiSkeletonRectangle', '.euiSkeletonText'
  ].join(',');

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  let busy = false;
  let aborted = false;
  // Loading markers that never cleared within one timeout (e.g. a permanent aria-busy): ignored for
  // the rest of the capture so they can't slow down every step.
  let stuck = new WeakSet();

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'run') return;
    if (busy) {
      sendResponse({ error: 'A capture is already running on this page.' });
      return;
    }
    busy = true;
    aborted = false;
    sendResponse({ ok: true });
    run(msg.mode, msg.settings)
      .catch((err) => {
        chrome.runtime.sendMessage({ type: 'abort' }).catch(() => {});
        toast(err?.message || String(err), true);
      })
      .finally(() => { busy = false; });
  });

  async function send(msg) {
    const res = await chrome.runtime.sendMessage(msg);
    if (res?.error) throw new Error(res.error);
    return res;
  }

  // ---------------------------------------------------------------- flow

  async function run(mode, settings) {
    let target;
    if (mode === 'pick') {
      const picked = await pickElement(settings);
      if (!picked) return;
      target = picked.el;
      if (picked.remember) {
        await chrome.storage.local.set({ [siteKey()]: buildSelector(target) });
      }
    } else {
      target = (await savedTarget()) || knownTarget() || mainTarget() || autoTarget();
    }
    await capture(target, settings);
  }

  const siteKey = () => `area:${location.host}`;

  async function savedTarget() {
    const key = siteKey();
    const { [key]: sel } = await chrome.storage.local.get(key);
    if (!sel) return null;
    try {
      const el = document.querySelector(sel);
      if (el && visibleSize(el)) return el;
    } catch { /* stale selector */ }
    return null;
  }

  function knownTarget() {
    for (const sel of KNOWN_CONTENT_AREAS) {
      const el = document.querySelector(sel);
      if (el && visibleSize(el)) return el;
    }
    return null;
  }

  // The page's main content area (<main> / role="main"), which by definition leaves out the site
  // header, navigation and footer. Ignored when it is too narrow to be the real content.
  function mainTarget() {
    let best = null;
    let bestArea = 0;
    for (const el of document.querySelectorAll('main, [role="main"]')) {
      const r = el.getBoundingClientRect();
      if (r.width < innerWidth * 0.4 || r.height < 50 || getComputedStyle(el).visibility === 'hidden') continue;
      const area = visibleArea(el);
      if (area > bestArea) { bestArea = area; best = el; }
    }
    return best;
  }

  function autoTarget() {
    const inner = largestScroller(document);
    if (windowScrolls()) {
      if (inner && visibleArea(inner) > 0.5 * innerWidth * innerHeight) return inner;
      return WIN;
    }
    return inner || WIN;
  }

  // ---------------------------------------------------------------- geometry helpers

  const isWindow = (s) => s === WIN;

  function visibleSize(el) {
    const r = el.getBoundingClientRect();
    return r.width > 20 && r.height > 20;
  }

  function visibleArea(el) {
    const r = el.getBoundingClientRect();
    const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
    const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    return w > 0 && h > 0 ? w * h : 0;
  }

  function windowScrolls() {
    return WIN.scrollHeight > document.documentElement.clientHeight + 1;
  }

  function isElementScroller(e) {
    if (e === document.documentElement || e === WIN) return false;
    if (e.scrollHeight <= e.clientHeight + 1 || e.clientHeight < 50) return false;
    if (e === document.body && getComputedStyle(document.documentElement).overflowY === 'visible') return false;
    const oy = getComputedStyle(e).overflowY;
    return oy === 'auto' || oy === 'scroll' || oy === 'overlay';
  }

  function largestScroller(within) {
    const list = within === document ? document.querySelectorAll('body, body *') : within.querySelectorAll('*');
    let best = null;
    let bestArea = 0;
    for (const el of list) {
      if (!isElementScroller(el)) continue;
      const area = visibleArea(el);
      if (area > bestArea) { bestArea = area; best = el; }
    }
    return best;
  }

  function scrollerFor(el) {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      if (isElementScroller(e)) return e;
    }
    return WIN;
  }

  // Visible client box of the scroller, in viewport CSS px.
  function viewRect(S) {
    if (isWindow(S)) {
      const de = document.documentElement;
      return { left: 0, top: 0, width: de.clientWidth, height: de.clientHeight, innerTop: 0 };
    }
    const r = S.getBoundingClientRect();
    const innerTop = r.top + S.clientTop;
    const innerLeft = r.left + S.clientLeft;
    const top = Math.max(innerTop, 0);
    const bottom = Math.min(innerTop + S.clientHeight, innerHeight);
    const left = Math.max(innerLeft, 0);
    const right = Math.min(innerLeft + S.clientWidth, document.documentElement.clientWidth);
    return { left, top, width: right - left, height: bottom - top, innerTop };
  }

  // Target box: vertical in scroll-content coordinates of S, horizontal in viewport px.
  function targetGeom(target, S, v) {
    if (target === S || (isWindow(S) && (target === document.body || target === document.documentElement))) {
      return { top: 0, height: S.scrollHeight, left: v.left, width: v.width };
    }
    const r = target.getBoundingClientRect();
    const oy = getComputedStyle(target).overflowY;
    const height = oy === 'visible' ? Math.max(r.height, target.scrollHeight) : r.height;
    const left = Math.max(r.left, v.left);
    const right = Math.min(r.right, v.left + v.width);
    return { top: r.top - v.innerTop + S.scrollTop, height, left, width: right - left };
  }

  // ---------------------------------------------------------------- page preparation

  function setStyle(changes, el, prop, val) {
    changes.push([el, prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
    el.style.setProperty(prop, val, 'important');
  }

  function restoreStyles(changes) {
    for (let i = changes.length - 1; i >= 0; i--) {
      const [el, prop, val, prio] = changes[i];
      if (val) el.style.setProperty(prop, val, prio);
      else el.style.removeProperty(prop);
    }
  }

  // A position:fixed element inside a transformed/filtered/contained ancestor scrolls with it,
  // so it is real content (e.g. inside a grid panel), not an overlay.
  function fixedToViewport(el) {
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none' ||
          /paint|layout|strict|content/.test(cs.contain) || /transform|filter/.test(cs.willChange)) {
        return false;
      }
    }
    return true;
  }

  function intersects(r, v) {
    return r.width > 0 && r.height > 0 &&
      r.right > v.left && r.left < v.left + v.width && r.bottom > v.top && r.top < v.top + v.height;
  }

  // Hide fixed headers / navs / bottom bars and anything overlaying the scroller; un-stick sticky rows
  // so they are not repeated in every strip.
  function hideOverlays(S, target, changes) {
    const win = isWindow(S);
    const v = viewRect(S);
    for (const el of document.querySelectorAll('body *')) {
      const pos = getComputedStyle(el).position;
      if (pos !== 'fixed' && pos !== 'sticky' && pos !== 'absolute') continue;
      if (el.contains(target) || el.contains(S)) continue; // ancestors of what we capture stay

      if (pos === 'sticky') {
        if (win || S.contains(el)) {
          setStyle(changes, el, 'position', 'relative');
          setStyle(changes, el, 'inset', 'auto');
        }
        continue;
      }

      const overlay = pos === 'fixed'
        ? fixedToViewport(el)
        : !win && !S.contains(el) && intersects(el.getBoundingClientRect(), v);
      if (!overlay) continue;
      setStyle(changes, el, 'visibility', 'hidden');
      setStyle(changes, el, 'opacity', '0');
      setStyle(changes, el, 'transition', 'none');
      setStyle(changes, el, 'animation', 'none');
    }
  }

  // Transparent full-screen shield: stops stray hover tooltips / user scrolling while capturing.
  // It is invisible, so it never shows up in the screenshot. Esc cancels.
  function mountShield() {
    const shield = document.createElement('div');
    shield.id = ROOT_ID;
    shield.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;background:transparent;cursor:progress;';
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    const onKey = (e) => { if (e.key === 'Escape') aborted = true; stop(e); };
    shield.addEventListener('wheel', stop, { passive: false });
    shield.addEventListener('mousedown', stop);
    window.addEventListener('keydown', onKey, true);
    document.documentElement.appendChild(shield);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      shield.remove();
    };
  }

  function pendingInView() {
    const vh = innerHeight;
    const vw = innerWidth;
    const pending = [];
    for (const el of document.querySelectorAll(PENDING)) {
      if (stuck.has(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
      if (getComputedStyle(el).visibility === 'hidden') continue;
      pending.push(el);
    }
    return pending;
  }

  async function waitForRender(settings, maxMs) {
    await raf2();
    if (!settings.waitRender) return;
    const t0 = performance.now();
    let pending = pendingInView();
    while (pending.length && performance.now() - t0 < maxMs) {
      if (aborted) return;
      await sleep(120);
      pending = pendingInView();
    }
    pending.forEach((el) => stuck.add(el));
    await raf2();
  }

  // Quick pass through the whole scroller so lazily rendered content (charts, panels, images) loads first.
  async function preload(S, settings) {
    const clientH = () => (isWindow(S) ? document.documentElement.clientHeight : S.clientHeight);
    const step = Math.max(200, clientH() * 0.9);
    let y = 0;
    for (let i = 0; i < 400; i++) {
      if (aborted) throw new Error('Capture cancelled.');
      const max = S.scrollHeight - clientH();
      if (max <= 0) break;
      S.scrollTop = Math.min(y, max);
      await sleep(120);
      await waitForRender(settings, 5000);
      if (y >= max) break;
      y += step;
    }
    S.scrollTop = 0;
    await sleep(150);
  }

  function captureName(target) {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    let name = clean((target.querySelector?.('h1') || {}).textContent);
    if (!name) {
      // current breadcrumb item (ARIA pattern), then a common breadcrumb class
      const current = document.querySelector('nav[aria-label*="breadcrumb" i] [aria-current="page"]');
      const crumbs = document.querySelectorAll('.euiBreadcrumb');
      name = clean(current?.textContent) || clean(crumbs[crumbs.length - 1]?.textContent);
    }
    if (!name) name = clean(document.title);
    return (name || location.hostname).slice(0, 120);
  }

  // ---------------------------------------------------------------- capture loop

  async function capture(target, settings) {
    let S = scrollerFor(target);
    if (isWindow(S) && !windowScrolls()) {
      // Picked a container that holds the real scroller (e.g. the whole app frame).
      const inner = largestScroller(target === WIN ? document : target);
      if (inner) { S = inner; target = inner; }
    }

    stuck = new WeakSet();
    const unmount = mountShield();
    const origScroll = S.scrollTop;
    const changes = [];
    let ok = false;
    try {
      setStyle(changes, isWindow(S) ? document.documentElement : S, 'scroll-behavior', 'auto');
      await sleep(60);
      if (settings.preload) await preload(S, settings);
      if (settings.hideOverlays) hideOverlays(S, target, changes);
      await raf2();

      const v = viewRect(S);
      if (v.width < 20 || v.height < 20) throw new Error('The capture area is not visible on screen.');
      const g = targetGeom(target, S, v);
      if (g.width < 5 || g.height < 5) throw new Error('The selected area is empty or off-screen.');

      await send({ type: 'begin', width: g.width, height: g.height, viewportW: innerWidth, name: captureName(target) });

      const lead = v.top - v.innerTop; // visible top relative to the scroller's client top
      let covered = 0;
      let stuck = 0;
      while (covered < g.height - 0.01) {
        if (aborted) throw new Error('Capture cancelled.');
        // Ask for 1 CSS px of overlap: at 125%/150% scaling the browser snaps scroll offsets to whole
        // device pixels and may land slightly past the request, which would skip a sliver of rows.
        S.scrollTop = g.top + covered - lead - 1;
        await sleep(settings.delay);
        await waitForRender(settings, 10000);
        if (aborted) throw new Error('Capture cancelled.');

        const first = S.scrollTop + lead - g.top;        // target row now at the visible top
        const start = Math.max(covered, first, 0);
        // Normal strips stop 1 CSS px above the viewport bottom (spare room for device-pixel rounding).
        // The final strip takes everything left: at 125%/175% the browser can stop the maximum scroll a
        // fraction of a pixel short, and that sliver must not be dropped.
        const limit = first + v.height;
        const maxScroll = S.scrollHeight - (isWindow(S) ? document.documentElement.clientHeight : S.clientHeight);
        const atEnd = S.scrollTop >= maxScroll - 1;
        const end = (limit >= g.height - 1 || atEnd) ? Math.min(g.height, limit + 1) : limit - 1;
        if (end - start < 0.01) {
          if (++stuck >= 3) break;
          continue;
        }
        stuck = 0;
        // Only rows [start, end) are new — near the bottom the browser can't scroll a full step,
        // so the already-captured part of this frame is skipped instead of duplicated.
        await send({
          type: 'frame',
          sx: g.left,
          sw: g.width,
          sy: v.top + (start - first),
          sh: end - start,
          dy: start,
          viewportW: innerWidth,
          progress: end / g.height
        });
        covered = end;
      }
      ok = true;
    } finally {
      restoreStyles(changes);
      S.scrollTop = origScroll;
      unmount();
    }
    if (ok) await send({ type: 'finish' });
  }

  // ---------------------------------------------------------------- area picker

  function pickElement(settings) {
    return new Promise((resolve) => {
      const host = document.createElement('div');
      host.id = ROOT_ID;
      host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = `
        .box{position:fixed;pointer-events:none;border:2px solid #3b82f6;background:rgba(59,130,246,.14);box-sizing:border-box;border-radius:2px}
        .tag{position:fixed;pointer-events:none;background:#3b82f6;color:#fff;font:12px/1.5 system-ui,sans-serif;padding:1px 7px;border-radius:3px;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis}
        .bar{position:fixed;top:12px;left:50%;transform:translateX(-50%);pointer-events:auto;background:#0f172a;color:#e2e8f0;
             font:13px/1.45 system-ui,sans-serif;padding:9px 14px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.45);
             display:flex;gap:14px;align-items:center;border:1px solid #334155}
        .bar b{color:#fff}
        kbd{font:11px ui-monospace,monospace;background:#1e293b;border:1px solid #475569;border-radius:4px;padding:0 5px;color:#f8fafc}
        label{display:flex;gap:6px;align-items:center;cursor:pointer;color:#cbd5e1;white-space:nowrap}
        .sep{width:1px;align-self:stretch;background:#334155}`;
      const box = document.createElement('div'); box.className = 'box';
      const tag = document.createElement('div'); tag.className = 'tag';
      const bar = document.createElement('div'); bar.className = 'bar';

      const hint = document.createElement('span');
      const parts = [['b', 'Click the area to capture'], ['t', '  '], ['k', '↑'], ['t', ' bigger '], ['k', '↓'],
        ['t', ' smaller  '], ['k', 'Enter'], ['t', ' capture  '], ['k', 'Esc'], ['t', ' cancel']];
      for (const [t, text] of parts) {
        const n = t === 'b' ? document.createElement('b') : t === 'k' ? document.createElement('kbd') : document.createTextNode(text);
        if (t !== 't') n.textContent = text;
        hint.appendChild(n);
      }
      const sep = document.createElement('span'); sep.className = 'sep';
      const label = document.createElement('label');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!settings.rememberPick;
      label.append(cb, document.createTextNode(`Remember for ${location.host}`));
      bar.append(hint, sep, label);
      shadow.append(style, box, tag, bar);
      document.documentElement.appendChild(host);

      let current = null;
      let stack = [];

      const draw = () => {
        if (!current) { box.style.display = tag.style.display = 'none'; return; }
        const r = current.getBoundingClientRect();
        box.style.display = tag.style.display = 'block';
        Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        const dts = current.getAttribute('data-test-subj');
        tag.textContent = `${current.localName}${dts ? ` [${dts}]` : ''}  ${Math.round(r.width)}×${Math.round(current.scrollHeight > r.height ? current.scrollHeight : r.height)}`;
        const top = r.top > 26 ? r.top - 24 : Math.max(r.top + 4, 4);
        Object.assign(tag.style, { left: `${Math.max(4, r.left)}px`, top: `${top}px` });
      };

      const onBar = (e) => e.composedPath().includes(bar);

      const onMove = (e) => {
        if (onBar(e)) return;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || el === host || el === current) return;
        current = el;
        stack = [];
        draw();
      };
      const block = (e) => {
        if (onBar(e)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.type === 'click' && current) finish(current);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish(null); return; }
        if (!current) return;
        if (e.key === 'ArrowUp') {
          const p = current.parentElement;
          if (p && p !== document.documentElement) { stack.push(current); current = p; draw(); }
        } else if (e.key === 'ArrowDown') {
          if (stack.length) { current = stack.pop(); draw(); }
        } else if (e.key === 'Enter') {
          finish(current);
        } else {
          return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      const onScroll = () => draw();

      const events = ['mousedown', 'mouseup', 'click', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu'];
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('scroll', onScroll, true);
      events.forEach((t) => window.addEventListener(t, block, true));

      async function finish(el) {
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('scroll', onScroll, true);
        // Keep swallowing the trailing mouseup/click of the selecting click for a moment.
        setTimeout(() => events.forEach((t) => window.removeEventListener(t, block, true)), 300);
        host.remove();
        await raf2();
        resolve(el ? { el, remember: cb.checked } : null);
      }
    });
  }

  // Stable CSS selector for remembering the picked area: anchors on id / data-test-subj when possible.
  function buildSelector(el) {
    if (el === document.body) return 'body';
    const chain = [];
    for (let e = el; e && e.nodeType === 1 && e !== document.documentElement; e = e.parentElement) {
      let part;
      let anchored = false;
      const dts = e.getAttribute('data-test-subj');
      if (e.id && !/\d{4,}|[0-9a-f]{8}-/i.test(e.id)) {
        part = `#${CSS.escape(e.id)}`;
        anchored = true;
      } else if (dts) {
        part = `${e.localName}[data-test-subj=${JSON.stringify(dts)}]`;
        anchored = true;
      } else {
        part = e.localName;
        const parent = e.parentElement;
        if (parent) {
          const same = [...parent.children].filter((c) => c.localName === e.localName);
          if (same.length > 1) part += `:nth-of-type(${same.indexOf(e) + 1})`;
        }
      }
      chain.unshift(part);
      if (anchored) {
        const sel = chain.join(' > ');
        try { if (document.querySelectorAll(sel).length === 1) return sel; } catch { /* keep walking */ }
      }
    }
    return chain.join(' > ');
  }

  // ---------------------------------------------------------------- toast

  function toast(text, isError) {
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'open' });
    const box = document.createElement('div');
    box.textContent = `Clean Capture: ${text}`;
    box.style.cssText = `font:13px/1.45 system-ui,sans-serif;color:#fff;background:${isError ? '#b91c1c' : '#1e293b'};` +
      'padding:10px 14px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.35);max-width:420px;';
    shadow.appendChild(box);
    document.documentElement.appendChild(host);
    setTimeout(() => host.remove(), 6000);
  }
})();
