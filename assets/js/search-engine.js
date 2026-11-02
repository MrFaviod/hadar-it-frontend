(function () {
  'use strict';
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
  // Copy is resolved on read through the runtime; without it the engine shows
  // nothing instead of a second, untranslated copy of the catalog.
  function tr(key, params) {
    if (!window.ItsmI18n) return '';
    if (window.ItsmI18n.version) window.ItsmI18n.version.value;
    return window.ItsmI18n.t(key, params);
  }
  // Record kinds and there route ids are stable; labels are resolved on read.
  const SECTIONS = [['panel','ui.search.section_panel','activity'],['inventory','ui.search.section_inventory','inventory'],['people','ui.search.section_people','user'],['map','ui.search.section_map','map-pin'],['graph','ui.search.section_graph','network'],['maintenance','ui.search.section_maintenance','refresh'],['monitoring','ui.search.section_monitoring','gauge'],['reports','ui.search.section_reports','file-text'],['warranties','ui.search.section_warranties','shield'],['labels','ui.search.section_labels','printer']];
  const TYPE_KEYS={asset:'ui.search.type_asset',person:'ui.search.type_person',site:'ui.search.type_site',location:'ui.search.type_location',incident:'ui.search.type_incident',intervention:'ui.search.type_intervention',maintenance:'ui.search.type_maintenance',plan:'ui.search.type_plan',report:'ui.search.type_report',category:'ui.search.type_category',section:'ui.search.type_section',view:'ui.search.type_view',action:'ui.search.type_action'};
  const TYPES={ get asset(){return tr(TYPE_KEYS.asset);}, get person(){return tr(TYPE_KEYS.person);}, get site(){return tr(TYPE_KEYS.site);}, get location(){return tr(TYPE_KEYS.location);}, get incident(){return tr(TYPE_KEYS.incident);}, get intervention(){return tr(TYPE_KEYS.intervention);}, get maintenance(){return tr(TYPE_KEYS.maintenance);}, get plan(){return tr(TYPE_KEYS.plan);}, get report(){return tr(TYPE_KEYS.report);}, get category(){return tr(TYPE_KEYS.category);}, get section(){return tr(TYPE_KEYS.section);}, get view(){return tr(TYPE_KEYS.view);}, get action(){return tr(TYPE_KEYS.action);} };
  const FAMILY_KEYS={inventory:'ui.search.family_inventory',history:'ui.search.family_history',warranty:'ui.search.family_warranty'};
  function record(kind,id,label,subtitle,icon,tokens,target) { return {key:kind+':'+id,type:TYPE_KEYS[kind]?tr(TYPE_KEYS[kind]):tr('ui.search.type_results'),kind,id,label:label||id,subtitle:subtitle||'',icon:icon||'box',tokens:(tokens||[]).filter(Boolean),target:target||{kind,id}}; }
  function targetFor(item) {
    const t=item.target||{kind:item.type,id:item.id};
    if(t.kind==='maintenance')return {...t,kind:'plan'};
    if(t.kind==='category')return {kind:'category',id:t.id};
    return t;
  }
  function fromServer(item) {
    const type=item.type||(item.target&&item.target.kind)||'section';
    const target=targetFor(item);
    const record=window.AssetSearch.record(type,item.id,item.label,item.subtitle,item.icon,item.tokens||[],target);
    if(item.key)record.key=item.key;
    return record;
  }
  function actions(app) {
    const asset=app.currentAsset || (app.assets||[]).find(a=>a.id===(app.route?.assetId||app.route?.focusId||app.explorerSelection));
    const rows=[],add=(id,label,icon,assetId)=>rows.push(record('action',id,label,assetId?tr('ui.search.subtitle_for_asset',{name:asset.name}):tr('ui.search.subtitle_section'),''+icon,[],{kind:'action',action:id,id:assetId||''}));
    const can=permission=>!app.can||app.can(permission);
    if(can('assets.edit')) add('create-asset',tr('ui.search.action_create_asset'),'plus');
    if(can('assets.view')) { add('inventory',tr('ui.search.action_inventory'),'inventory');add('reports',tr('ui.search.action_reports'),'file-text');add('map',tr('ui.search.action_map'),'map-pin',asset?.id);add('graph',tr('ui.search.action_graph'),'network',asset?.id); }
    if(can('assets.edit')) {add('intervention',tr('ui.search.action_intervention'),'refresh',asset?.id);add('incident',tr('ui.search.action_incident'),'bell',asset?.id);}
    if(asset&&can('assets.view')) {add('consult',tr('ui.search.action_consult',{name:asset.name}),'box',asset.id);if(can('assets.remote')&&app.settings?.anydeskEnabled&&asset.anydeskId)add('remote-anydesk',tr('ui.search.action_anydesk'),'remote',asset.id);if(can('assets.remote')&&app.settings?.rmmEnabled&&asset.rmmAgentId)add('remote-rmm',tr('ui.search.action_rmm'),'remote',asset.id);}
    return rows;
  }
  function buildIndex(app) {
    const out=[],categories=app.categories||app.config?.categories||[],sites=app.sites||app.config?.sites||[],people=app.people||[];
    const label=(list,id)=>list.find(x=>x.id===id)?.label||id||'';
    if(!app.can||app.can('assets.view')) {
      (app.assets||[]).forEach(a=>{const person=people.find(p=>p.id===a.assigneeId);out.push(record('asset',a.id,a.name,[a.code,a.id,a.ip].filter(Boolean).join(' · '),'box',[a.id,a.permanentId,a.code,a.name,a.model,a.brand,a.ip,a.type,label(categories,a.category),label(sites,a.site),person?.name,...Object.values(a.tech||{})]));});
      sites.forEach(s=>{out.push(record('site',s.id,s.label,tr('ui.search.subtitle_site'),'building',[s.short]));(s.locations||[]).forEach(l=>out.push(record('location',s.id+':'+l.id,l.label,s.label,'map-pin',[s.label],{kind:'location',id:l.id,siteId:s.id})));});
      const m=app.maintenance||{};
      // Plans carry no title of their own: name them after their template and asset.
      const planName=r=>{const t=(m.templates||[]).find(x=>x.id===r.templateId),a=(app.assets||[]).find(x=>x.id===r.assetId);return t&&a?t.label+' · '+a.name:'';};
      [['incidents','incident'],['interventions','intervention'],['plans','plan']].forEach(([list,kind])=>(m[list]||[]).forEach(r=>out.push(record(kind,r.id,r.title||r.name||r.label||(kind==='plan'&&planName(r))||r.id,[r.id,r.assetId,r.state].filter(Boolean).join(' · '),kind==='incident'?'bell':'refresh',[r.description,r.assetId,kind==='plan'&&planName(r)],{kind,id:r.id,assetId:r.assetId}))));
      (app.phase9?.templates?.items||[]).forEach(t=>out.push(record('report',t.id,t.name,tr('ui.search.subtitle_template',{family:FAMILY_KEYS[t.family]?tr(FAMILY_KEYS[t.family]):t.family}),'file-text',[t.description,t.family])));
    }
    if(!app.can||app.can('people.view'))people.forEach(p=>out.push(record('person',p.id,p.name,[p.role,p.email].filter(Boolean).join(' · '),'user',[p.id,p.departmentId,label(sites,p.siteId),p.phone])));
    SECTIONS.forEach(([id,key,icon])=>{if(!app.can||app.can(id==='people'?'people.view':'assets.view'))out.push(record('section',id,tr(key),tr('ui.workspace.record_section'),icon,[],{kind:'section',id,route:{name:id}}));});
    (app.permittedConfigSections||app.configSections||[]).forEach(s=>{out.push(record('section','config-'+s.id,s.label,tr('ui.page.settings'),'sliders',[s.hint],{kind:'section',id:'config-'+s.id,route:{name:'config',section:s.id}}));});
    return out.concat(actions(app));
  }
  function search(index,query,options={}) {
    const q=normalize(query),parts=q.split(/\s+/).filter(Boolean),favorites=options.favorites||[],usage=options.usage||{};
    return index.map((r,i)=>{const label=normalize(r.label),fields=[r.label,r.subtitle,...(r.tokens||[])].map(normalize),hay=fields.join(' ');if(parts.some(p=>!hay.includes(p)))return null;const exact=q&&fields.some(f=>f===q),prefix=q&&fields.some(f=>f.startsWith(q));const score=(exact?10000:prefix?5000:q?1000:0)+(favorites.includes(r.key)?100:0)+Math.min(80,Number(usage[r.key]||0)*5)+(r.kind==='action'?10:0);return {r,i,score,label};}).filter(Boolean).sort((a,b)=>b.score-a.score||a.i-b.i).map(x=>x.r);
  }
  window.AssetSearch={normalize,record,fromServer,types:TYPES,buildIndex,actions,search};
})();
