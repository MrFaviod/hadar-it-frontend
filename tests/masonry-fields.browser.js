(() => {
  const fail = message => { throw new Error(message); };
  if (document.documentElement.scrollWidth > innerWidth) fail('Document overflow');
  const grid = document.querySelector('.noc-grid');
  if (grid) {
    if (!grid.classList.contains('noc-grid--masonry')) fail('Masonry is not active');
    const boxes = [...grid.children].map(el => ({id:el.dataset.odId,...Object.fromEntries(['x','y','width','height','bottom','right'].map(key=>[key,el.getBoundingClientRect()[key]]))}));
    for (let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++) {
      const a=boxes[i],b=boxes[j];
      if (Math.min(a.right,b.right)-Math.max(a.x,b.x)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1) fail('Overlapping panels');
    }
    const style = getComputedStyle(grid);
    const gap = parseFloat(style.gridTemplateColumns.split(' ').length === 1 ? style.rowGap : style.columnGap);
    for (const box of boxes) {
      const above = boxes.filter(other=>other.bottom<=box.y+1 && Math.abs(other.x-box.x)<1).sort((a,b)=>b.bottom-a.bottom)[0];
      if (above && Math.abs(box.y-above.bottom-gap)>1.1) fail('Row-height hole remains');
    }
    return {kind:'masonry',columns:getComputedStyle(grid).gridTemplateColumns,boxes};
  }
  const engine=document.getElementById('agent-engine-instance'),model=document.getElementById('agent-engine-model');
  if (!engine || !model) fail('Engine fields missing');
  const a=engine.getBoundingClientRect(),b=model.getBoundingClientRect();
  if(Math.abs(a.height-b.height)>1 || a.height<44) fail('Unequal control heights');
  if(Math.abs(a.x-b.x)>2 && Math.abs(a.y-b.y)>1) fail('Control baselines differ');
  return {kind:'fields',engine:{y:a.y,h:a.height},model:{y:b.y,h:b.height}};
})()
