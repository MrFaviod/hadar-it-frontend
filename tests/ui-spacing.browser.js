/* Evaluate in a logged-in operational route after it has loaded.
 * Uses rendered geometry, not stylesheet token spelling. Throws on regression.
 * No Playwright dependency; usable through CDP Runtime.evaluate. */
(() => {
  const rect = selector => {
    const node = document.querySelector(selector);
    if (!node) throw new Error('Missing ' + selector);
    return node.getBoundingClientRect();
  };
  const gap = (before, after) => rect(after).top - rect(before).bottom;
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  check(document.documentElement.scrollWidth <= innerWidth + 1, 'Body overflows horizontally');
  const route = location.hash;
  const result = { route, width: innerWidth };
  if (route === '#/inventario') {
    const section = gap('.inventory-page > .page-head', '.inventory-query');
    const group = gap('.toolbar--inventory', '.category-rail');
    const attached = gap('.inventory-results > .results-bar', '.inventory-results > .results-surface');
    check(group >= 0 && group < section, 'Categories are not grouped with query controls');
    check(attached >= 0 && attached < group, 'Count is not attached to results');
    const edges = ['.inventory-page > .page-head', '.inventory-query', '.inventory-results'].map(s => rect(s).left);
    check(Math.max(...edges) - Math.min(...edges) < 1, 'Inventory content edges differ');
    Object.assign(result, { section, group, attached, surfaceTop: rect('.results-surface').top });
  }
  if (route === '#/garantias') {
    const section = gap('.warranty-metrics', '.warranty-results');
    const attached = gap('.warranty-results > .results-bar', '.warranty-results > .table-panel');
    check(attached >= 0 && attached < section, 'Warranty count is detached from its table');
    check(getComputedStyle(document.querySelector('.warranty-metrics')).marginTop === '0px', 'Metrics add outer spacing');
    Object.assign(result, { section, attached, surfaceTop: rect('.warranty-table').top });
  }
  if (route === '#/reportes') {
    const section = gap('.report-selection', '.doc-workspace');
    const group = gap('.doc-tabs', '.doc-family-grid');
    check(group >= 0 && group < section, 'Report selection is not grouped');
    Object.assign(result, { section, group, surfaceTop: rect('.doc-workspace').top });
  }
  return result;
})()
