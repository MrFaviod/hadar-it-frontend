(function () {
  'use strict';
  const SearchPalette={
    components:{AppIcon:window.AppIcon},
    props:{open:Boolean,records:{type:Array,default:()=>[]},favorites:{type:Array,default:()=>[]},usage:{type:Object,default:()=>({})}},
    emits:['close','select','favorite'],
    data(){return {query:'',scope:'all',active:0,lastFocus:null,previousOverflow:'',remote:[],loading:false,error:'',engine:'',fallback:false,total:0,requestId:0,timer:null};},
    computed:{
      scopes(){return [{id:'all',label:'Todo'},{id:'favorites',label:'Favoritos'},{id:'actions',label:'Acciones'},{id:'views',label:'Vistas'}];},
      actions(){return window.AssetSearch.actions(this.$root);},
      results(){
        const q=window.AssetSearch.normalize(this.query);
        const rank=(list,options={})=>window.AssetSearch.search(list,this.query,{favorites:this.favorites,usage:this.usage,...options});
        if(this.scope==='actions')return rank(this.actions);
        if(this.scope==='favorites')return rank((this.records||[]).filter(r=>this.favorites.includes(r.key)));
        if(this.scope==='views')return this.remote.slice();
        const rows=[];
        if(!q)rows.push(...(this.records||[]).filter(r=>this.favorites.includes(r.key)));
        rows.push(...this.remote);
        const seen=new Set(rows.map(r=>r.key));
        rank(this.actions).forEach(r=>{if(!seen.has(r.key))rows.push(r);});
        return rows;
      },
      groups(){const groups=this.results?new this.results.constructor():[];this.results.forEach((r,index)=>{let group=groups.find(g=>g.label===r.type);if(!group){group={label:r.type,items:[]};groups.push(group);}group.items.push({record:r,index});});return groups;},
      activeId(){return this.results.length?'universal-option-'+this.active:null;},
      favoriteTarget(){const record=this.results[this.active];return record&&record.type!=='Acciones'?record:null;},
      favoriteOn(){return !!this.favoriteTarget&&this.favorites.includes(this.favoriteTarget.key);},
      status(){if(this.loading)return 'Buscando…';if(this.error)return this.error;if(this.fallback)return 'Búsqueda SQL de respaldo';return '';},
      emptyText(){if(this.error)return this.error;if(this.loading)return 'Buscando…';if(this.scope==='favorites'&&!this.query)return 'Sin favoritos';return 'No hay coincidencias';}
    },
    watch:{
      open(value){if(value)this.activate();else this.deactivate();},
      query(){this.active=0;this.schedule();},
      scope(){this.active=0;this.runSearch(this.query);},
      results(){if(this.active>=this.results.length)this.active=0;}
    },
    mounted(){if(this.open)this.activate();},beforeUnmount(){this.deactivate();clearTimeout(this.timer);},
    methods:{
      schedule(){clearTimeout(this.timer);if(!this.query.trim()&&this.scope!=='views'){this.requestId+=1;this.remote=[];this.total=0;this.loading=false;this.error='';return;}this.loading=true;this.timer=setTimeout(()=>this.runSearch(this.query),180);},
      async runSearch(query){const id=++this.requestId;this.loading=true;this.error='';if(Array.isArray(this.remote))this.remote.length=0;else this.remote=[];this.total=0;const vm=this.$root||{};try{const result=await window.AssetPhase10Api.search(vm,query,{scope:this.scope,limit:20});if(id!==this.requestId)return;if(!result)return;const rows=result.records||[];if(Array.isArray(this.remote))this.remote.splice(0,this.remote.length,...rows);else this.remote=rows.slice();this.total=Number(result.total)||0;this.engine=result.engine||'';this.fallback=!!result.fallback;this.loading=false;}catch(error){if(id!==this.requestId)return;if(Array.isArray(this.remote))this.remote.length=0;else this.remote=[];this.total=0;this.engine='';this.fallback=false;this.error=(error&&error.message)||'No se pudo completar la búsqueda.';this.loading=false;}},
      retry(){if(this.query.trim()||this.scope==='views')this.runSearch(this.query);},
      activate(){this.lastFocus=document.activeElement;this.previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';this.query='';this.scope='all';this.active=0;this.remote=[];this.error='';this.requestId+=1;this.$nextTick(()=>this.$refs.input?.focus());},
      deactivate(){document.body.style.overflow=this.previousOverflow;this.lastFocus?.focus?.();this.lastFocus=null;},
      choose(record){if(record)this.$emit('select',record);},
      toggleFavorite(){if(this.favoriteTarget)this.$emit('favorite',this.favoriteTarget);},
      clearQuery(){this.query='';this.$nextTick(()=>this.$refs.input?.focus());},
      onKey(e){if(e.isComposing)return;if(e.key==='Escape'){e.preventDefault();this.$emit('close');return;}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const n=this.results.length;this.active=n?(this.active+(e.key==='ArrowDown'?1:-1)+n)%n:0;this.$nextTick(()=>{const row=this.$refs.panel?.querySelector('#'+this.activeId),list=this.$refs.results;if(row&&list){const bottom=row.offsetTop+row.offsetHeight;if(row.offsetTop<list.scrollTop)list.scrollTop=row.offsetTop;else if(bottom>list.scrollTop+list.clientHeight)list.scrollTop=bottom-list.clientHeight;}});}if(e.key==='Enter'&&e.target?.tagName!=='BUTTON'){e.preventDefault();const record=this.results[this.active];if(record)this.$emit('select',record);}if(e.key==='Tab'){const items=Array.from(this.$refs.panel?.querySelectorAll('button:not([disabled]),input,[tabindex="0"]')||[]);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}
    },
    template:`<transition name="modal"><div v-if="open" class="search-layer" @mousedown.self="$emit('close')" data-od-id="universal-search">
      <section ref="panel" class="search-palette" role="dialog" aria-modal="true" aria-labelledby="universal-title" @keydown="onKey">
        <h2 id="universal-title" class="sr-only">Búsqueda universal y acciones rápidas</h2>
        <div class="search-palette__input"><app-icon name="search"></app-icon><label class="sr-only" for="universal-query">Buscar en Asset Manager</label><input ref="input" id="universal-query" v-model="query" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="universal-results" :aria-activedescendant="activeId" placeholder="Buscar activos, personas, lugares o acciones…" autocomplete="off" data-od-id="universal-query"><button type="button" class="icon-button" aria-label="Cerrar búsqueda" @click="$emit('close')"><app-icon name="close"></app-icon></button></div>
        <div class="search-palette__scopes" role="group" aria-label="Tipo de búsqueda"><button v-for="s in scopes" :key="s.id" type="button" :aria-pressed="scope===s.id" :class="{active:scope===s.id}" @click="scope=s.id" :data-od-id="'search-scope-'+s.id">{{s.label}}</button><span class="mono">Ctrl K</span></div>
        <p class="search-palette__count" role="status" aria-live="polite"><span v-if="loading">Buscando…</span><span v-else-if="error">No se pudo buscar</span><span v-else>{{results.length}} {{results.length===1?'resultado':'resultados'}}<span v-if="fallback"> · SQL de respaldo</span><span v-else-if="!query"> · Favoritos y acciones habituales primero</span></span></p>
        <div v-if="loading" class="search-empty" role="status"><h3>Buscando…</h3><p>Consultando activos, personas, lugares y acciones.</p></div>
        <div v-else-if="error" class="search-empty" role="alert"><h3>No se pudo buscar</h3><p>{{error}}</p><button type="button" class="text-button" @click="retry">Reintentar</button></div>
        <div ref="results" v-else id="universal-results" class="search-palette__results" :class="{'is-empty':!results.length}" role="listbox" aria-label="Resultados de búsqueda">
          <div v-for="g in groups" :key="g.label" role="group" :aria-label="g.label" class="search-group"><h3>{{g.label}}</h3><div v-for="item in g.items" :key="item.record.key" role="none" :class="['search-result',{'is-active':active===item.index}]" @mousemove="active=item.index" :data-od-id="'search-result-'+item.record.key.replaceAll(':','-')">
            <div :id="'universal-option-'+item.index" role="option" :aria-selected="active===item.index" class="search-result__open" @click="choose(item.record)"><app-icon :name="item.record.icon"></app-icon><span><strong>{{item.record.label}}</strong><small>{{item.record.subtitle}}</small></span><span v-if="active===item.index" class="search-result__enter" aria-hidden="true">↵</span></div>
          </div></div>
        </div>
        <div v-if="!loading && !error && !results.length" class="search-empty"><app-icon name="search"></app-icon><h3>{{emptyText}}</h3><p>{{scope==='favorites'&&!query?'Añade una ficha, una persona o una sección con Añadir a favoritos; aparecerá en este listado.':'Prueba con otro nombre, un ID permanente o una dirección IP.'}}</p><button v-if="query" type="button" class="text-button" @click="clearQuery">Borrar búsqueda</button></div>
        <footer class="search-palette__footer"><span><kbd>↑</kbd><kbd>↓</kbd> recorrer <kbd>↵</kbd> abrir</span><button v-if="favoriteTarget" id="search-favorite" type="button" class="search-palette__favorite" data-od-id="search-favorite" :aria-pressed="favoriteOn" :aria-label="(favoriteOn?'Quitar de favoritos: ':'Añadir a favoritos: ')+favoriteTarget.label" @click="toggleFavorite">{{favoriteOn?'Quitar de favoritos':'Añadir a favoritos'}}</button><span><kbd>Esc</kbd> cerrar</span></footer>
      </section></div></transition>`
  };
  window.AssetSearchViews={SearchPalette};
})();
