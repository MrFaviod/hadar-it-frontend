(function () {
  'use strict';
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
  const SECTIONS = [['panel','Dashboard','activity'],['inventory','Inventario','inventory'],['people','Personas','user'],['map','Mapa de infraestructura','map-pin'],['graph','Grafo de relaciones','network'],['maintenance','Mantenimiento e incidentes','refresh'],['monitoring','Supervisión','gauge'],['reports','Reportes','file-text'],['warranties','Garantías','shield'],['labels','Etiquetas','printer']];
  function record(kind,id,label,subtitle,icon,tokens,target) { return {key:kind+':'+id,type:({asset:'Activos',person:'Personas',site:'Sedes',location:'Ubicaciones',incident:'Incidentes',intervention:'Intervenciones',plan:'Mantenimientos',report:'Reportes',section:'Secciones',view:'Vistas guardadas',action:'Acciones'})[kind],label:label||id,subtitle:subtitle||'',icon:icon||'box',tokens:(tokens||[]).filter(Boolean),target:target||{kind,id}}; }
  function actions(app) {
    const asset=app.currentAsset || (app.assets||[]).find(a=>a.id===(app.route?.assetId||app.route?.focusId||app.explorerSelection));
    const rows=[],add=(id,label,icon,assetId)=>rows.push(record('action',id,label,assetId?'Para '+asset.name:'Ir a la sección',''+icon,[],{kind:'action',action:id,id:assetId||''}));
    const can=permission=>!app.can||app.can(permission);
    if(can('assets.edit')) add('create-asset','Registrar un activo','plus');
    if(can('assets.view')) { add('inventory','Abrir el inventario','inventory');add('reports','Acceder a reportes','file-text');add('map','Abrir ubicación en el mapa','map-pin',asset?.id);add('graph','Explorar relaciones en el grafo','network',asset?.id); }
    if(can('assets.edit')) {add('intervention','Registrar una intervención','refresh',asset?.id);add('incident','Crear un incidente','bell',asset?.id);}
    if(asset&&can('assets.view')) {add('consult','Consultar '+asset.name,'box',asset.id);if(can('assets.remote')&&app.settings?.anydeskEnabled&&asset.anydeskId)add('remote-anydesk','Abrir AnyDesk','remote',asset.id);if(can('assets.remote')&&app.settings?.rmmEnabled&&asset.rmmAgentId)add('remote-rmm','Abrir Tactical RMM','remote',asset.id);}
    return rows;
  }
  function buildIndex(app) {
    const out=[],categories=app.categories||app.config?.categories||[],sites=app.sites||app.config?.sites||[],people=app.people||[];
    const label=(list,id)=>list.find(x=>x.id===id)?.label||id||'';
    if(!app.can||app.can('assets.view')) {
      (app.assets||[]).forEach(a=>{const person=people.find(p=>p.id===a.assigneeId);out.push(record('asset',a.id,a.name,[a.code,a.id,a.ip].filter(Boolean).join(' · '),'box',[a.id,a.permanentId,a.code,a.name,a.model,a.brand,a.ip,a.type,label(categories,a.category),label(sites,a.site),person?.name,...Object.values(a.tech||{})]));});
      sites.forEach(s=>{out.push(record('site',s.id,s.label,'Sede · Mapa','building',[s.short]));(s.locations||[]).forEach(l=>out.push(record('location',s.id+':'+l.id,l.label,s.label,'map-pin',[s.label],{kind:'location',id:l.id,siteId:s.id})));});
      const m=app.maintenance||{};
      // Plans carry no title of their own: name them after their template and asset.
      const planName=r=>{const t=(m.templates||[]).find(x=>x.id===r.templateId),a=(app.assets||[]).find(x=>x.id===r.assetId);return t&&a?t.label+' · '+a.name:'';};
      [['incidents','incident'],['interventions','intervention'],['plans','plan']].forEach(([list,kind])=>(m[list]||[]).forEach(r=>out.push(record(kind,r.id,r.title||r.name||r.label||(kind==='plan'&&planName(r))||r.id,[r.id,r.assetId,r.state].filter(Boolean).join(' · '),kind==='incident'?'bell':'refresh',[r.description,r.assetId,kind==='plan'&&planName(r)],{kind,id:r.id,assetId:r.assetId}))));
      (app.phase9?.templates?.items||[]).forEach(t=>out.push(record('report',t.id,t.name,'Plantilla · '+({inventory:'Inventario',history:'Historial',warranty:'Garantías'}[t.family]||t.family),'file-text',[t.description,t.family])));
    }
    if(!app.can||app.can('people.view'))people.forEach(p=>out.push(record('person',p.id,p.name,[p.role,p.email].filter(Boolean).join(' · '),'user',[p.id,p.departmentId,label(sites,p.siteId),p.phone])));
    SECTIONS.forEach(([id,name,icon])=>{if(!app.can||app.can(id==='people'?'people.view':'assets.view'))out.push(record('section',id,name,'Sección de la aplicación',icon,[],{kind:'section',id,route:{name:id}}));});
    (app.permittedConfigSections||app.configSections||[]).forEach(s=>{out.push(record('section','config-'+s.id,s.label,'Configuración','sliders',[s.hint],{kind:'section',id:'config-'+s.id,route:{name:'config',section:s.id}}));});
    return out.concat(actions(app));
  }
  function search(index,query,options={}) {
    const q=normalize(query),parts=q.split(/\s+/).filter(Boolean),favorites=options.favorites||[],usage=options.usage||{};
    return index.map((r,i)=>{const label=normalize(r.label),fields=[r.label,r.subtitle,...(r.tokens||[])].map(normalize),hay=fields.join(' ');if(parts.some(p=>!hay.includes(p)))return null;const exact=q&&fields.some(f=>f===q),prefix=q&&fields.some(f=>f.startsWith(q));const score=(exact?10000:prefix?5000:q?1000:0)+(favorites.includes(r.key)?100:0)+Math.min(80,Number(usage[r.key]||0)*5)+(r.type==='Acciones'?10:0);return {r,i,score,label};}).filter(Boolean).sort((a,b)=>b.score-a.score||a.i-b.i).map(x=>x.r);
  }
  window.AssetSearch={normalize,record,buildIndex,actions,search};
})();
