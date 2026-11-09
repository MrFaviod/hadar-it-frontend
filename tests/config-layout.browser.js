/* Evaluate against the real, settled configuration page in a browser. */
(() => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const content = document.querySelector('.config-content');
  assert(content, 'Configuration content is not ready');
  assert(document.documentElement.scrollWidth <= innerWidth, 'Document overflows horizontally');
  const nav = document.querySelector('.config-nav');
  const picker = document.querySelector('.config-section-picker');
  if (innerWidth <= 1080) {
    assert(getComputedStyle(nav).display === 'none', 'Navigation grid pushes settings below the fold');
    assert(getComputedStyle(picker).display !== 'none', 'Section navigation is unavailable');
  }
  const tabs = [...document.querySelectorAll('.config-assets__tab')];
  tabs.forEach(tab => {
    const r = tab.getBoundingClientRect();
    assert(r.height >= 44, 'Asset tab touch target is too small');
    assert(r.left >= 0 && r.right <= innerWidth, 'Asset tab label is clipped');
  });
  const rail = document.querySelector('.config-assets__tabs');
  if (rail && innerWidth <= 760) assert(rail.scrollWidth <= rail.clientWidth, 'Hidden asset tabs require lateral discovery');
  return { overflow: false, contentY: content.getBoundingClientRect().y, tabs: tabs.length };
})();
