(function () {
  'use strict';
  const KEY='asset-manager.warranty-preferences';
  // Visible labels and messages come from the catalog; the stable `key` values
  // and the stored dates never depend on the locale.
  function tr(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime && typeof runtime.t === 'function' ? runtime.t(key, params) : '';
  }
  const day=()=>new Date().toLocaleDateString('en-CA');
  function validDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value||'')&&!Number.isNaN(Date.parse(value))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;}
  function createPreferences(){const s=window.AssetStore.readJSON(window.localStorage,KEY,{});return {days:[15,30,60,90,180].includes(Number(s.days))?Number(s.days):90,includeRetired:!!s.includeRetired,site:typeof s.site==='string'?s.site:'all',category:typeof s.category==='string'?s.category:'all'};}
  function persist(prefs){return window.AssetStore.writeJSON(window.localStorage,KEY,prefs);}
  function status(warranty,days,today){
    const until=warranty&&warranty.until;
    if(!validDate(until))return {key:'missing',label:tr('ui.warranty.coverage.unknown'),tone:'hold',days:null};
    const remaining=Math.round((Date.parse(until+'T00:00:00Z')-Date.parse((today||day())+'T00:00:00Z'))/86400000);
    if(remaining<0)return {key:'expired',label:tr('ui.warranty.coverage.expired'),tone:'down',days:remaining};
    if(remaining<=Number(days||90))return {key:'expiring',label:tr('ui.warranty.coverage.expiring'),tone:'warn',days:remaining};
    return {key:'active',label:tr('ui.warranty.coverage.current'),tone:'ok',days:remaining};
  }
  function expiry(purchase,months){
    if(!validDate(purchase)||!Number.isInteger(Number(months))||Number(months)<1||Number(months)>240)return '';
    const [y,m,d]=purchase.split('-').map(Number);const target=new Date(Date.UTC(y,m-1+Number(months),1));
    const last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
    target.setUTCDate(Math.min(d,last));return target.toISOString().slice(0,10);
  }
  function save(asset,draft){
    if(!draft||!String(draft.provider||'').trim())return {ok:false,error:tr('ui.warranty.error_provider')};
    const until=draft.mode==='duration'?expiry(draft.purchase,draft.months):draft.until;
    if(!validDate(draft.purchase))return {ok:false,error:tr('ui.warranty.error_purchase')};
    if(!validDate(until))return {ok:false,error:tr('ui.warranty.error_expiry')};
    if(until<draft.purchase)return {ok:false,error:tr('ui.warranty.error_before')};
    asset.warranty=Object.assign({},asset.warranty||{},{provider:draft.provider.trim(),purchase:draft.purchase,until,months:Number(draft.months)||0,note:String(draft.note||'').trim(),receipts:Array.isArray(draft.receipts)?draft.receipts.map(r=>({name:String(r.name||tr('ui.warranty.receipt_default_name')),size:Number(r.size)||0,type:String(r.type||'')})):[]});
    return {ok:true};
  }
  window.AssetWarrantyEngine={createPreferences,persist,status,expiry,save,validDate,today:day};
})();
