(() => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  assert(location.hash === '#/inventario', 'Category navigation must end at Inventory');
  const selected = [...document.querySelectorAll('.side-category.is-active')].map(el => el.textContent.trim());
  assert(selected.includes('Virtualización'), 'Virtualización must remain selected');
  const requests = performance.getEntriesByType('resource').filter(entry => entry.name.includes('/assets/search?'));
  const categoryRequest = requests.filter(entry => new URL(entry.name).searchParams.get('category') === 'virtualizacion').at(-1);
  assert(categoryRequest, 'A canonical Virtualización request must be made after reentry');
  assert(new URL(categoryRequest.name).searchParams.get('offset') === '0', 'Category reentry starts at the first page');
  const rows = [...document.querySelectorAll('.asset-table tbody tr')].map(el => el.textContent.trim());
  assert(rows.length > 0, 'The populated demo category must render rows');
  assert(rows.every(row => /máquina virtual/i.test(row)), 'Previous-category rows must be replaced');
  assert(!document.querySelector('.results-surface[aria-busy="true"]'), 'Wait for the completed collection');
  assert(document.documentElement.scrollWidth <= innerWidth, 'No document overflow');
  return { hash: location.hash, selected, rows, request: categoryRequest.name };
})()
