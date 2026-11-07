(function(){
  'use strict';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const ROUTES=['inventory','map','graph','panel','reports','maintenance'];
  function createState(){return {users:{},views:[],nextId:1,widgets:null,themeMode:'auto',shortcuts:[],loaded:false,loading:false,error:'',epoch:0,ownerId:''};}
  function user(state,id){const key=String(id||'');if(!Object.hasOwn(state.users,key))Object.defineProperty(state.users,key,{value:{favorites:[],usage:{},lastViews:{}},enumerable:true,writable:true,configurable:true});return state.users[key];}
  function toggleFavorite(state,id,record){const u=user(state,id),i=u.favorites.findIndex(r=>r.key===record.key);if(i<0)u.favorites.push(clone(record));else u.favorites.splice(i,1);return i<0;}
  function isFavorite(state,id,key){return user(state,id).favorites.some(r=>r.key===key);}
  function visibleViews(state,id){return state.views.filter(v=>v.scope==='shared'||v.ownerId===String(id||''));}
  function validateView(draft,owner,views){
    const name=String(draft.name||'').trim(),existing=draft.id?(views||[]).find(v=>v.id===draft.id):null,fail=error=>({ok:false,error});
    if(!name||name.length>70)return fail('Escribe un nombre de entre 1 y 70 caracteres.');
    if(draft.id&&!existing)return fail('La vista ya no está disponible.');
    if(existing&&existing.ownerId!==String(owner))return fail('Solo puedes actualizar tus propias vistas.');
    if(!ROUTES.includes(draft.route))return fail('No hay una vista disponible para guardar.');
    if(!draft.snapshot||typeof draft.snapshot!=='object'||Array.isArray(draft.snapshot))return fail('No hay una vista disponible para guardar.');
    let snapshot;
    try{snapshot=clone(draft.snapshot);}catch(_){return fail('La vista no se puede serializar.');}
    if(JSON.stringify(snapshot).length>20000)return fail('La vista contiene demasiados datos.');
    return {ok:true,view:{id:existing?existing.id:'',name,scope:draft.scope==='shared'?'shared':'personal',ownerId:String(owner),route:draft.route,snapshot}};
  }
  function saveView(state,id,draft){const owner=String(id||''),checked=validateView(draft,owner,state.views);if(!checked.ok)return checked;const view={...checked.view,id:checked.view.id||'view-'+state.nextId},existing=view.id?state.views.find(v=>v.id===view.id):null;if(existing)state.views.splice(state.views.indexOf(existing),1,view);else{state.views.push(view);state.nextId++;}return {ok:true,view};}
  function removeView(state,id,viewId){const v=state.views.find(v=>v.id===viewId);if(!v||v.ownerId!==String(id||''))return {ok:false,error:'Solo puedes eliminar tus propias vistas.'};state.views.splice(state.views.indexOf(v),1);Object.values(state.users).forEach(u=>{u.favorites=u.favorites.filter(f=>f.key!=='view:'+viewId);});return {ok:true};}
  function rememberView(state,id,route,snapshot){user(state,id).lastViews[route]=clone(snapshot);}
  window.AssetWorkspace={clone,createState,user,toggleFavorite,isFavorite,visibleViews,validateView,saveView,removeView,rememberView,ROUTES};
})();
