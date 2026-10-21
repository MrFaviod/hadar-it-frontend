(function () {
  'use strict';
  const SearchPalette={
    components:{AppIcon:window.AppIcon},
    props:{open:Boolean,records:{type:Array,default:()=>[]},favorites:{type:Array,default:()=>[]},usage:{type:Object,default:()=>({})}},
    emits:['close','select','favorite'],
    data(){return {query:'',scope:'all',active:0,lastFocus:null,previousOverflow:''};},
    computed:{
      scopes(){return [{id:'all',label:'Todo'},{id:'favorites',label:'Favoritos'},{id:'actions',label:'Acciones'},{id:'views',label:'Vistas'}];},
      results(){let list=this.records;if(this.scope==='favorites')list=list.filter(r=>this.favorites.includes(r.key));if(this.scope==='actions')list=list.filter(r=>r.type==='Acciones');if(this.scope==='views')list=list.filter(r=>r.type==='Vistas guardadas');const ranked=window.AssetSearch.search(list,this.query,{favorites:this.favorites,usage:this.usage});const types=[...new Set(ranked.map(r=>r.type))];return types.flatMap(type=>ranked.filter(r=>r.type===type));},
      groups(){const groups=[];this.results.forEach((r,index)=>{let group=groups.find(g=>g.label===r.type);if(!group){group={label:r.type,items:[]};groups.push(group);}group.items.push({record:r,index});});return groups;},
      activeId(){return this.results.length?'universal-option-'+this.active:null;}
    },
    watch:{open(value){if(value)this.activate();else this.deactivate();},query(){this.active=0;},scope(){this.active=0;},results(){if(this.active>=this.results.length)this.active=0;}},
    mounted(){if(this.open)this.activate();},beforeUnmount(){if(this.open)this.deactivate();},
    methods:{
      activate(){this.lastFocus=document.activeElement;this.previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';this.query='';this.scope='all';this.active=0;this.$nextTick(()=>this.$refs.input?.focus());},
      deactivate(){document.body.style.overflow=this.previousOverflow;this.lastFocus?.focus?.();this.lastFocus=null;},
      choose(record){if(record)this.$emit('select',record);},
      onKey(e){if(e.isComposing)return;if(e.key==='Escape'){e.preventDefault();this.$emit('close');return;}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const n=this.results.length;this.active=n?(this.active+(e.key==='ArrowDown'?1:-1)+n)%n:0;this.$nextTick(()=>{const row=this.$refs.panel?.querySelector('#'+this.activeId),list=this.$refs.results;if(row&&list){const bottom=row.offsetTop+row.offsetHeight;if(row.offsetTop<list.scrollTop)list.scrollTop=row.offsetTop;else if(bottom>list.scrollTop+list.clientHeight)list.scrollTop=bottom-list.clientHeight;}});}if(e.key==='Enter'&&e.target?.tagName!=='BUTTON'){e.preventDefault();this.choose(this.results[this.active]);}if(e.key==='Tab'){const items=Array.from(this.$refs.panel?.querySelectorAll('button:not([disabled]),input,[tabindex="0"]')||[]);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}
    },
    template:`<transition name="modal"><div v-if="open" class="search-layer" @mousedown.self="$emit('close')" data-od-id="universal-search">
      <section ref="panel" class="search-palette" role="dialog" aria-modal="true" aria-labelledby="universal-title" @keydown="onKey">
        <h2 id="universal-title" class="sr-only">Búsqueda universal y acciones rápidas</h2>
        <div class="search-palette__input"><app-icon name="search"></app-icon><label class="sr-only" for="universal-query">Buscar en Asset Manager</label><input ref="input" id="universal-query" v-model="query" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="universal-results" :aria-activedescendant="activeId" placeholder="Buscar activos, personas, lugares o acciones…" autocomplete="off" data-od-id="universal-query"><button type="button" class="icon-button" aria-label="Cerrar búsqueda" @click="$emit('close')"><app-icon name="close"></app-icon></button></div>
        <div class="search-palette__scopes" role="group" aria-label="Tipo de búsqueda"><button v-for="s in scopes" :key="s.id" type="button" :aria-pressed="scope===s.id" :class="{active:scope===s.id}" @click="scope=s.id" :data-od-id="'search-scope-'+s.id">{{s.label}}</button><span class="mono">Ctrl K</span></div>
        <p class="search-palette__count" role="status" aria-live="polite">{{results.length}} {{results.length===1?'resultado':'resultados'}}<span v-if="!query"> · Favoritos y acciones habituales primero</span></p>
        <div ref="results" id="universal-results" class="search-palette__results" role="listbox" aria-label="Resultados de búsqueda">
          <div v-for="g in groups" :key="g.label" role="group" :aria-label="g.label" class="search-group"><h3>{{g.label}}</h3><div v-for="item in g.items" :key="item.record.key" :id="'universal-option-'+item.index" role="option" :aria-selected="active===item.index" :class="['search-result',{'is-active':active===item.index}]" @mousemove="active=item.index" :data-od-id="'search-result-'+item.record.key.replaceAll(':','-')">
            <button type="button" class="search-result__open" tabindex="-1" @click="choose(item.record)"><app-icon :name="item.record.icon"></app-icon><span><strong>{{item.record.label}}</strong><small>{{item.record.subtitle}}</small></span><span v-if="active===item.index" class="search-result__enter" aria-hidden="true">↵</span></button>
            <button v-if="item.record.type!=='Acciones'" type="button" class="search-result__star" :aria-pressed="favorites.includes(item.record.key)" :aria-label="(favorites.includes(item.record.key)?'Quitar de favoritos: ':'Añadir a favoritos: ')+item.record.label" @click="$emit('favorite',item.record)"><span aria-hidden="true">{{favorites.includes(item.record.key)?'★':'☆'}}</span></button>
          </div></div>
          <div v-if="!results.length" class="search-empty"><app-icon name="search"></app-icon><h3>{{scope==='favorites'&&!query?'Tus accesos, a un paso':'No hay coincidencias'}}</h3><p>{{scope==='favorites'&&!query?'Marca una estrella en una ficha, sección o resultado para encontrarlo aquí.':'Prueba con otro nombre, un ID permanente o una dirección IP.'}}</p><button v-if="query" type="button" class="text-button" @click="query=''">Borrar búsqueda</button></div>
        </div>
        <footer class="search-palette__footer"><span><kbd>↑</kbd><kbd>↓</kbd> recorrer <kbd>↵</kbd> abrir</span><span><kbd>Esc</kbd> cerrar</span></footer>
      </section></div></transition>`
  };
  window.AssetSearchViews={SearchPalette};
})();
