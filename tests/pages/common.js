// Test fixtures: an encoded canvas (every CSS row has a unique colour, so duplicated or missing
// rows are detectable in the stitched output) and lazily rendered panels.
function drawEncoded(canvas){
  // Snake encoding: neighbouring CSS rows differ in exactly one channel by 1, so any resampling blend
  // still decodes to one of the two neighbours (monotonic). Drawn per device row, opaque.
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  for (let dy = 0; dy < canvas.height; dy++) {
    const y = Math.min(h - 1, Math.floor(dy / dpr)), hi = y >> 8, lo = y & 255;
    ctx.fillStyle = `rgb(${hi % 2 ? 255 - lo : lo},${hi},77)`; ctx.fillRect(0, dy, canvas.width, 1);
  }
}
// Panels render only once scrolled into view, flagging "loading" with either the ARIA standard
// (aria-busy) or a render-complete attribute, plus a spinner while loading.
function lazyPanels(marker = 'render-complete'){
  const set = (el, loading) => marker === 'aria-busy'
    ? el.setAttribute('aria-busy', String(loading))
    : el.setAttribute('data-render-complete', String(!loading));
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting || e.target.dataset.done) return;
    e.target.dataset.done = 1;
    set(e.target, true);
    e.target.innerHTML = '<div class="spinner" style="width:40px;height:20px;background:#888"></div>';
    setTimeout(() => { e.target.innerHTML = ''; e.target.style.background = '#336699'; set(e.target, false); }, 700);
  }));
  document.querySelectorAll('.lazy').forEach(p => io.observe(p));
}
