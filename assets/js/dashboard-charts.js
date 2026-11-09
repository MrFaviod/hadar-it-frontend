(function () {
  'use strict';
  const valid = value => typeof value === 'number' && Number.isFinite(value);
  function isTimeline(points) {
    if (!Array.isArray(points) || points.length < 2) return false;
    if (points.some(p => !valid(p.value) || !p.at || !Number.isFinite(Date.parse(p.at)))) return false;
    const windows = new Set(points.map(p => p.label).filter(label => /^(24h|7d|30d)$/.test(label || '')));
    if (windows.size > 1) return false;
    return new Set(points.map(p => Date.parse(p.at))).size > 1;
  }
  function segments(rows) {
    const measured = (rows || []).filter(r => valid(r.count) && r.count > 0);
    const total = measured.reduce((n, r) => n + r.count, 0);
    let offset = 0;
    return measured.map(r => { const share = r.count / total * 100; const arc = { ...r, share, offset: -offset }; offset += share; return arc; });
  }
  function latencyRows(rows) {
    return (rows || []).filter(r => valid(r.latencyMs) && r.latencyMs >= 0).slice().sort((a,b) => b.latencyMs - a.latencyMs);
  }
  const DashboardDonut = {
    props: { rows: { type: Array, default: () => [] }, label: String },
    computed: { arcs() { return segments(this.rows); }, total() { return this.arcs.reduce((n,r) => n+r.count,0); } },
    template: `<figure class="ops-donut" :aria-label="label"><svg viewBox="0 0 160 160" role="img" :aria-label="rows.map(r=>r.label+': '+r.count).join(', ')"><circle class="ops-donut-track" cx="80" cy="80" r="62"></circle><circle v-for="arc in arcs" :key="arc.id" cx="80" cy="80" r="62" pathLength="100" :class="'ops-stroke--'+arc.id" :stroke-dasharray="arc.share+' '+(100-arc.share)" :stroke-dashoffset="arc.offset" transform="rotate(-90 80 80)"><title>{{ arc.label }}: {{ arc.count }}</title></circle><text x="80" y="79" class="ops-donut-number">{{ total }}</text><text x="80" y="101" class="ops-donut-label">{{ label }}</text></svg><figcaption><div v-for="row in rows" :key="row.id"><i :class="'noc-state--'+row.id" aria-hidden="true"></i><span>{{row.label}}</span><b>{{row.count}}</b></div></figcaption></figure>`
  };
  // Grid row spans provide masonry in stable DOM/tab order, without experimental CSS.
  const masonryStates = new WeakMap();
  const masonrySpan = (height, gap) => Math.max(1, Math.ceil(height + gap));
  const masonry = {
    mounted(el) {
      if (!window.ResizeObserver || !el.classList || !window.requestAnimationFrame) return;
      const state = { frame: null, items: new Set(), disposed: false };
      const layout = () => {
        state.frame = null;
        if (state.disposed) return;
        const items = Array.from(el.children);
        for (const item of state.items) if (!items.includes(item)) { state.observer.unobserve(item); state.items.delete(item); }
        for (const item of items) if (!state.items.has(item)) { state.items.add(item); state.observer.observe(item); }
        const style = window.getComputedStyle(el);
        const columns = style.gridTemplateColumns.split(' ').filter(Boolean).length;
        const gap = parseFloat(style.columnGap) || 0;
        for (const item of items) {
          if (columns < 2) item.style.removeProperty('grid-row-end');
          else item.style.gridRowEnd = 'span ' + masonrySpan(item.getBoundingClientRect().height, gap);
        }
      };
      state.schedule = () => { if (!state.disposed && state.frame === null) state.frame = window.requestAnimationFrame(layout); };
      state.observer = new window.ResizeObserver(state.schedule);
      masonryStates.set(el, state);
      el.classList.add('noc-grid--masonry');
      state.observer.observe(el);
      state.schedule();
      if (document.fonts) document.fonts.ready.then(state.schedule);
    },
    updated(el) { const state = masonryStates.get(el); if (state) state.schedule(); },
    unmounted(el) {
      const state = masonryStates.get(el);
      if (!state) return;
      state.disposed = true;
      state.observer.disconnect();
      if (state.frame !== null) window.cancelAnimationFrame(state.frame);
      for (const item of state.items) item.style.removeProperty('grid-row-end');
      el.classList.remove('noc-grid--masonry');
      masonryStates.delete(el);
    }
  };
  window.AssetDashboardCharts = { isTimeline, segments, latencyRows, DashboardDonut, masonrySpan, masonry };
})();
