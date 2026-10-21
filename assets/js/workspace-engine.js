(function(){
  'use strict';
  const clone=value=>JSON.parse(JSON.stringify(value));
  function createState(){return {users:{},views:[],nextId:1};}
  function user(state,id){const key=String(id||'demo');if(!Object.hasOwn(state.users,key))Object.defineProperty(state.users,key,{value:{favorites:[],usage:{},lastViews:{}},enumerable:true,writable:true,configurable:true});return state.users[key];}
  function toggleFavorite(state,id,record){const u=user(state,id),i=u.favorites.findIndex(r=>r.key===record.key);if(i<0)u.favorites.push(clone(record));else u.favorites.splice(i,1);return i<0;}
  function isFavorite(state,id,key){return user(state,id).favorites.some(r=>r.key===key);}
  function visibleViews(state,id){return state.views.filter(v=>v.scope==='shared'||v.ownerId===String(id||'demo'));}
  function saveView(state,id,draft){const owner=String(id||'demo'),name=String(draft.name||'').trim(),old=draft.id?state.views.find(v=>v.id===draft.id):null,fail=error=>({ok:false,error});if(!name||name.length>70)return fail('Escribe un nombre de entre 1 y 70 caracteres.');if(draft.id&&(!old||old.ownerId!==owner))return fail('Solo puedes actualizar tus propias vistas.');if(!draft.route||!draft.snapshot)return fail('No hay una vista disponible para guardar.');const view={id:old?old.id:'view-'+state.nextId,name,scope:draft.scope==='shared'?'shared':'personal',ownerId:owner,route:draft.route,snapshot:clone(draft.snapshot)};if(old)state.views.splice(state.views.indexOf(old),1,view);else{state.views.push(view);state.nextId++;}return {ok:true,view};}
  function removeView(state,id,viewId){const v=state.views.find(v=>v.id===viewId);if(!v||v.ownerId!==String(id||'demo'))return {ok:false,error:'Solo puedes eliminar tus propias vistas.'};state.views.splice(state.views.indexOf(v),1);Object.values(state.users).forEach(u=>{u.favorites=u.favorites.filter(f=>f.key!=='view:'+viewId);});return {ok:true};}
  function rememberView(state,id,route,snapshot){user(state,id).lastViews[route]=clone(snapshot);}
  window.AssetWorkspace={clone,createState,user,toggleFavorite,isFavorite,visibleViews,saveView,removeView,rememberView};
})();
