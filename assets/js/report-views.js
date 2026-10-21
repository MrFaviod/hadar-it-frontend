(function () {
  'use strict';
  const E=window.AssetReportEngine;
  const ReportPreview={
    props:{app:Object,assets:Array,template:Object,group:String,family:String,history:Array,warrantyStatus:String},
    computed:{
      groups(){return E.groupAssets(this.assets,this.group||'none');},
      rows(){return this.family==='history'?this.history:this.assets;},
      pages(){
        if(this.template.mode==='individual')return this.assets.map(a=>({id:a.id,name:a.name,items:[a],events:(this.history||[]).filter(h=>h.assetId===a.id)}));
        const source=this.family==='history'?(this.history||[]):this.assets;
        if(!source.length)return this.assets.length?[{id:'empty-history',name:this.template.name,items:this.assets,events:[]}]:[];
        const pages=[];for(let i=0;i<source.length;i+=18){const slice=source.slice(i,i+18);pages.push({id:'page-'+i,name:this.template.name,items:this.family==='history'?this.assets:slice,events:this.family==='history'?slice:[]});}return pages;
      },
      fields(){return E.FIELDS.filter(f=>this.template.fields.includes(f.id));}
    },
    methods:{
      imageSize(event){const image=event.target;image.setAttribute('width',image.naturalWidth);image.setAttribute('height',image.naturalHeight);},
      value(a,key){if(key==='category')return this.app.categoryLabel(a.category);if(key==='site')return this.app.siteLabel(a.site);if(key==='location')return this.app.locationLabel(a);if(key==='assignee')return this.app.assigneeLabel(a)||'Sin asignar';return a[key]||'—';},
      date(value){return value?new Date(value+'T12:00:00').toLocaleDateString('es-ES'):'—';},
      warranty(a){return window.AssetWarrantyEngine.status(a.warranty,this.app.warrantyPrefs.days);},
      qr(a){return window.AssetLabelEngine.assetUrl(this.app.labelState,a);},
      pageAssets(page){return page.items;},
      pageGroups(page){return E.groupAssets(page.items,this.group||'none');},
      title(page){return this.template.mode==='individual'?page.name:this.template.name;}
    },
    template:`<div class="doc-pages" data-od-id="report-preview">
      <article class="doc-paper" v-for="(page,pi) in pages" :key="page.id" :class="{'doc-paper--landscape':template.format.includes('horizontal')}">
        <template v-for="b in template.blocks" :key="b.id"><section v-if="b.enabled" class="doc-block" :data-od-id="'preview-block-'+b.id">
          <header v-if="b.type==='heading'" class="doc-paper__head"><img v-if="template.logo" :src="app.brandLogo" alt="Logotipo de la organización" width="36" height="36"><div><p>{{app.organizationName}} · Gestión de activos</p><h2>{{b.text || title(page)}}</h2></div><span class="mono">{{new Date().toLocaleDateString('es-ES')}}</span></header>
          <p v-else-if="b.type==='text'" class="doc-text">{{b.text}}</p>
          <div v-else-if="b.type==='summary'" class="doc-summary"><div><strong>{{pageAssets(page).length}}</strong><span>activos incluidos</span></div><div><strong>{{new Set(pageAssets(page).map(a=>a.site)).size}}</strong><span>sedes representadas</span></div><div class="doc-bars"><div v-for="g in pageGroups(page)" :key="g.key"><span>{{group==='site'?app.siteLabel(g.key):group==='category'?app.categoryLabel(g.key):g.key}}</span><i :style="{width:Math.max(3,g.count/pageAssets(page).length*100)+'%'}"></i><b>{{g.count}}</b></div></div></div>
          <div v-else-if="b.type==='asset'" v-for="a in pageAssets(page)" :key="a.id" class="doc-facts"><div v-for="f in fields" :key="f.id"><span>{{f.label}}</span><strong>{{value(a,f.id)}}</strong></div><div v-for="(v,k) in a.tech" :key="k"><span>{{k}}</span><strong>{{v}}</strong></div></div>
          <div v-else-if="b.type==='photo'" class="doc-photos"><figure v-for="a in pageAssets(page)" :key="a.id"><img :src="app.assetImage(a)" :alt="a.name" @load="imageSize"><figcaption>{{a.name}} · {{a.id}}</figcaption></figure></div>
          <div v-else-if="b.type==='qr'" class="doc-qr-list"><div v-for="a in pageAssets(page)" :key="a.id"><asset-qr-code :text="qr(a)"></asset-qr-code><span class="mono">{{a.id}}</span></div></div>
          <template v-else-if="b.type==='table'">
            <table v-if="family==='history'" class="doc-table"><thead><tr><th>Fecha</th><th>Activo</th><th>Acontecimiento</th><th>Responsable</th></tr></thead><tbody><tr v-for="h in page.events" :key="h.assetId+h.id"><td>{{String(h.at).slice(0,10)}}</td><td>{{h.assetId}}</td><td>{{h.title}}<small>{{h.detail}}</small></td><td>{{h.actor||'—'}}</td></tr><tr v-if="!page.events.length"><td colspan="4">No hay acontecimientos en el período seleccionado.</td></tr></tbody></table>
            <table v-else-if="family==='warranty'" class="doc-table"><thead><tr><th>Activo</th><th>Proveedor</th><th>Compra</th><th>Vencimiento</th><th>Estado / comprobantes</th></tr></thead><tbody><tr v-for="a in pageAssets(page)" :key="a.id"><td>{{a.name}}<small>{{a.id}}</small></td><td>{{a.warranty?.provider||'Sin proveedor'}}</td><td>{{date(a.warranty?.purchase)}}</td><td>{{date(a.warranty?.until)}}</td><td>{{warranty(a).label}}<small>{{(a.warranty?.receipts||[]).map(r=>r.name).join(', ')||'Sin comprobantes'}}</small></td></tr></tbody></table>
            <template v-else v-for="g in pageGroups(page)" :key="g.key"><h3 v-if="group!=='none'" class="doc-group-title">{{group==='site'?app.siteLabel(g.key):group==='category'?app.categoryLabel(g.key):g.key}} <span>{{g.count}} activos</span></h3><table class="doc-table"><thead><tr><th v-if="template.images">Imagen</th><th v-for="f in fields" :key="f.id">{{f.label}}</th></tr></thead><tbody><tr v-for="a in g.assets" :key="a.id"><td v-if="template.images"><img :src="app.assetImage(a)" :alt="a.name" width="64" height="40"></td><td v-for="f in fields" :key="f.id">{{value(a,f.id)}}</td></tr></tbody></table></template>
          </template>
          <footer v-else-if="b.type==='footer'" class="doc-paper__foot"><span>{{b.text || 'Documento de uso interno · '+app.organizationName}}</span><span>{{pi+1}} / {{pages.length}}</span></footer>
        </section></template>
      </article>
      <div v-if="!assets.length" class="doc-empty"><app-icon name="file-text"></app-icon><h3>No hay activos en este alcance</h3><p>Ajusta los filtros o selecciona equipos para previsualizar el documento.</p></div>
    </div>`
  };
  const ReportsCenter={
    props:{app:Object},components:{ReportPreview},
    created(){const ctx=this.app.documentContext||{};if(ctx.templateId){const t=this.app.documents.templates.find(t=>t.id===ctx.templateId);if(t){this.family=t.family;this.chooseTemplate(t.id);}}else if(ctx.family)this.chooseFamily(ctx.family);},
    data(){
      const ctx=this.app.documentContext||{};
      return {tab:'prepare',family:'inventory',templateId:'inventory-list',template:E.clone(this.app.documents.templates[0]),
        filters:{category:ctx.category||'all',site:ctx.site||'all',search:ctx.search||'',responsible:'all',status:'all'},
        ids:ctx.ids?.length?ctx.ids.slice():[],explicit:!!ctx.ids?.length,group:'site',from:'',to:'',event:'all',warrantyFilter:'all',
        editor:false,addType:'text',saved:false,error:'',generation:null,output:'PDF',inspectId:''};
    },
    computed:{
      families(){return [{id:'inventory',label:'Inventario',description:'Fichas y listados de equipos'},{id:'history',label:'Cambios e historial',description:'Movimientos y trazabilidad'},{id:'warranty',label:'Garantías',description:'Coberturas y vencimientos'}];},
      templates(){return this.app.documents.templates.filter(t=>t.family===this.family);},
      matches(){return E.selectAssets(this.app.assets,this.filters).filter(a=>this.family!=='warranty'||this.warrantyFilter==='all'||window.AssetWarrantyEngine.status(a.warranty,this.app.warrantyPrefs.days).key===this.warrantyFilter);},
      selected(){return this.explicit?this.matches.filter(a=>this.ids.includes(a.id)):this.matches;},
      events(){return E.historyRows(this.selected,{from:this.from,to:this.to,event:this.event});},
      fields(){return E.FIELDS;},blocks(){return E.BLOCKS;},
      pageCount(){return this.template.mode==='individual'?this.selected.length:Math.max(1,Math.ceil((this.family==='history'?this.events.length:this.selected.length)/18));},
      allSelected(){return this.matches.length>0&&(!this.explicit||this.matches.every(a=>this.ids.includes(a.id)));}
    },
    methods:{
      chooseFamily(id){this.family=id;const t=this.app.documents.templates.find(t=>t.family===id);this.chooseTemplate(t.id);this.generation=null;},
      chooseTemplate(id){this.templateId=id;this.template=E.clone(this.app.documents.templates.find(t=>t.id===id));this.saved=false;},
      toggle(id){if(!this.explicit){this.ids=this.matches.map(a=>a.id);this.explicit=true;}const i=this.ids.indexOf(id);if(i>=0)this.ids.splice(i,1);else this.ids.push(id);},
      toggleAll(){this.ids=this.allSelected?[]:this.matches.map(a=>a.id);this.explicit=true;},
      move(i,delta){const j=i+delta;if(j<0||j>=this.template.blocks.length)return;const b=this.template.blocks.splice(i,1)[0];this.template.blocks.splice(j,0,b);},
      addBlock(){this.template.blocks.push(E.block(this.addType,Date.now()));},
      save(){const result=E.saveTemplate(this.app.documents,this.template);this.error=result.error||'';if(result.ok){this.template=E.clone(result.template);this.templateId=result.template.id;this.saved=true;this.app.showToast('Plantilla guardada y disponible para reutilizar.');}},
      generate(){if(this.from&&this.to&&this.from>this.to){this.error='La fecha final debe ser igual o posterior a la inicial.';return;}const r=E.generate(this.app.documents,this.selected,{name:this.template.name,family:this.family,mode:this.template.mode,format:this.output,rows:this.events.length,context:{filters:this.filters,group:this.group,from:this.from,to:this.to,event:this.event,warrantyFilter:this.warrantyFilter,template:this.template}});this.error=r.error||'';this.generation=r.document||null;},
      reopen(d){this.family=d.family;this.ids=d.assets.slice();this.explicit=true;this.filters={category:'all',site:'all',search:'',responsible:'all',status:'all'};const t=this.app.documents.templates.find(t=>t.family===d.family&&t.mode===d.mode)||this.app.documents.templates.find(t=>t.family===d.family);this.chooseTemplate(t.id);if(d.context){Object.assign(this,{group:d.context.group,from:d.context.from,to:d.context.to,event:d.context.event,warrantyFilter:d.context.warrantyFilter});this.filters=E.clone(d.context.filters);this.template=E.clone(d.context.template);this.templateId=this.template.id;}this.tab='prepare';this.generation=null;},
      reset(){this.filters={category:'all',site:'all',search:'',responsible:'all',status:'all'};this.explicit=false;this.ids=[];},
      date(at){return new Date(at).toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'});}
    },
    template:`<section class="page reports-page" data-od-id="reports-center" aria-labelledby="reports-title">
      <header class="page-head"><div><p class="eyebrow">Documentación</p><h1 id="reports-title">Reportes</h1><p class="page-head__description">Fichas, listados e historial en PDF o impresión.</p></div><a class="btn btn--secondary" href="#/configuracion/reportes" data-od-id="report-settings-link"><app-icon name="sliders"></app-icon> Plantillas</a></header>
      <div class="doc-tabs" role="tablist" aria-label="Secciones de reportes"><button role="tab" :aria-selected="tab==='prepare'" :class="{active:tab==='prepare'}" @click="tab='prepare'">Preparar reporte</button><button role="tab" :aria-selected="tab==='history'" :class="{active:tab==='history'}" @click="tab='history'">Documentos recientes <span class="mono">{{app.documents.history.length}}</span></button></div>
      <template v-if="tab==='prepare'">
        <div class="doc-family-grid"><button v-for="(f,i) in families" :key="f.id" :data-od-id="'report-family-'+f.id" :class="['doc-family',{active:family===f.id}]" :aria-pressed="family===f.id" @click="chooseFamily(f.id)"><span class="mono doc-family__number">0{{i+1}}</span><div><strong>{{f.label}}</strong><small>{{f.description}}</small></div><app-icon name="chevron-right"></app-icon></button></div>
        <div class="doc-workspace" :class="{'doc-workspace--editing':editor}">
          <aside class="doc-controls" data-od-id="report-controls"><div class="doc-control-head"><span class="eyebrow">01 · Preparación</span><h2>Define tu documento</h2></div>
            <label class="doc-field">Plantilla<select v-model="templateId" @change="chooseTemplate(templateId)"><option v-for="t in templates" :value="t.id" :key="t.id">{{t.name}}</option></select></label>
            <p class="doc-help">{{template.description}}</p>
            <div class="doc-form-grid"><label class="doc-field">Categoría<select v-model="filters.category"><option value="all">Todas</option><option v-for="c in app.categories" :key="c.id" :value="c.id">{{c.label}}</option></select></label><label class="doc-field">Sede<select v-model="filters.site"><option value="all">Todas</option><option v-for="s in app.sites" :key="s.id" :value="s.id">{{s.label}}</option></select></label></div>
            <div class="doc-form-grid"><label class="doc-field">Responsable<select v-model="filters.responsible"><option value="all">Todos</option><option v-for="p in app.people" :key="p.id" :value="p.id">{{p.name}}</option></select></label><label class="doc-field">Estado<select v-model="filters.status"><option value="all">Todos</option><option v-for="s in app.assetAdmin.statuses" :key="s.id" :value="s.id">{{s.label}}</option></select></label></div>
            <label class="doc-field">Buscar activos<input type="search" v-model="filters.search" placeholder="Nombre, ID o código rápido"></label>
            <label v-if="family==='warranty'" class="doc-field">Cobertura<select v-model="warrantyFilter"><option value="all">Todas las garantías</option><option value="active">Vigentes</option><option value="expiring">Próximas a vencer</option><option value="expired">Vencidas</option><option value="missing">Sin información</option></select></label>
            <template v-if="family==='history'"><div class="doc-form-grid"><label class="doc-field">Desde<input type="date" v-model="from"></label><label class="doc-field">Hasta<input type="date" v-model="to" :min="from"></label></div><label class="doc-field">Acontecimiento<select v-model="event"><option value="all">Todos</option><option value="updated">Modificaciones</option><option value="transfer">Movimientos</option><option value="assigned">Asignaciones</option><option value="incident">Incidentes</option><option value="status">Cambios de estado</option></select></label></template>
            <div class="doc-section-label"><strong>Activos incluidos</strong><button class="text-button" @click="toggleAll">{{allSelected?'Quitar todos':'Seleccionar todos'}}</button></div>
            <div class="doc-asset-picker"><label v-for="a in matches" :key="a.id"><input type="checkbox" :checked="!explicit||ids.includes(a.id)" @change="toggle(a.id)"><span><strong>{{a.name}}</strong><small class="mono">{{a.id}} · {{a.code}}</small></span></label><p v-if="!matches.length" class="doc-help">No hay coincidencias.</p></div>
            <button class="text-button" @click="reset">Restablecer alcance</button>
            <hr class="doc-rule"><label class="doc-field">Composición<select v-model="template.mode"><option value="consolidated">Listado consolidado</option><option value="individual">Fichas individuales en un documento</option></select></label><label class="doc-field">Agrupar por<select v-model="group"><option value="none">Sin agrupación</option><option value="category">Categoría</option><option value="site">Sede</option><option value="location">Ubicación</option><option value="assignee">Responsable</option><option value="status">Estado</option></select></label>
            <button class="btn btn--secondary doc-full" :aria-expanded="editor" @click="editor=!editor"><app-icon name="pencil"></app-icon>{{editor?'Cerrar editor':'Personalizar plantilla'}}</button>
          </aside>
          <div class="doc-preview-area"><header class="doc-preview-toolbar"><div><span class="eyebrow">02 · Vista previa</span><h2>{{template.name}}</h2><p>{{selected.length}} activos · {{pageCount}} {{pageCount===1?'página':'páginas'}}<span v-if="family==='history'"> · {{events.length}} acontecimientos</span></p></div><label class="doc-field doc-format">Papel<select v-model="template.format"><option>A4 horizontal</option><option>A4 vertical</option></select></label></header>
            <transition name="fade"><div v-if="editor" class="doc-editor" data-od-id="report-block-editor"><div class="doc-editor__head"><div><h3>Editor de bloques</h3></div><span class="mono">{{template.blocks.length}} bloques</span></div><label class="doc-field">Nombre de la plantilla<input v-model="template.name" maxlength="90"></label><div class="doc-inline"><label><input type="checkbox" v-model="template.logo"> Logotipo</label><label><input type="checkbox" v-model="template.images"> Imágenes en tablas</label></div><fieldset class="doc-field-options"><legend>Campos visibles</legend><label v-for="f in fields" :key="f.id"><input type="checkbox" v-model="template.fields" :value="f.id">{{f.label}}</label></fieldset>
              <div class="doc-block-list"><div v-for="(b,i) in template.blocks" :key="b.id" class="doc-block-row"><span class="mono">{{String(i+1).padStart(2,'0')}}</span><label><input type="checkbox" v-model="b.enabled">{{b.label}}</label><div class="doc-block-moves"><button class="icon-button" :disabled="i===0" @click="move(i,-1)" :aria-label="'Subir '+b.label">↑</button><button class="icon-button" :disabled="i===template.blocks.length-1" @click="move(i,1)" :aria-label="'Bajar '+b.label">↓</button><button class="icon-button" @click="template.blocks.splice(i,1)" :aria-label="'Eliminar '+b.label">×</button></div><input v-if="['heading','text','footer'].includes(b.type)" v-model="b.text" :aria-label="'Texto de '+b.label" :placeholder="b.type==='text'?'Escribe el texto del bloque':'Texto predeterminado'"></div></div>
              <div class="doc-inline"><select v-model="addType" aria-label="Tipo de bloque"><option v-for="b in blocks" :key="b.type" :value="b.type">{{b.label}}</option></select><button class="btn btn--secondary" @click="addBlock">Añadir bloque</button><button class="btn btn--secondary" @click="save" data-od-id="save-report-template">{{saved?'Plantilla guardada':'Guardar plantilla'}}</button></div></div></transition>
            <report-preview :app="app" :assets="selected" :template="template" :group="group" :family="family" :history="events"></report-preview>
            <footer class="doc-output-bar"><div><strong>Documento listo para preparar</strong><p>Se conservarán la selección y los filtros de origen.</p></div><label class="doc-field doc-output-format"><span class="sr-only">Salida</span><select v-model="output"><option>PDF</option><option>Impresión</option></select></label><button class="btn btn--primary" :disabled="!selected.length" @click="generate" data-od-id="generate-report"><app-icon name="file-text"></app-icon>{{output==='PDF'?'Preparar PDF':'Preparar impresión'}}</button></footer>
            <p v-if="error" class="doc-error" role="alert">{{error}}</p>
          </div>
        </div>
      </template>
      <div v-else class="table-panel"><table class="asset-table"><thead><tr><th>Documento</th><th>Preparado</th><th>Alcance</th><th>Salida</th><th></th></tr></thead><tbody><tr v-for="d in app.documents.history" :key="d.id"><td><strong>{{d.name}}</strong><span class="cell-note mono">{{d.id}}</span></td><td>{{date(d.at)}}</td><td>{{d.assets.length}} activos · {{d.pages}} páginas</td><td>{{d.format}}</td><td><button class="text-button" @click="reopen(d)">Volver a preparar</button></td></tr><tr v-if="!app.documents.history.length"><td colspan="5" class="doc-empty">Todavía no hay documentos preparados. Empieza en Preparar reporte.</td></tr></tbody></table></div>
      <modal-shell :open="!!generation" title="Documento preparado" eyebrow="Generación de reportes" @close="generation=null"><div v-if="generation" class="doc-generated"><span class="doc-generated__mark"><app-icon name="check"></app-icon></span><h3>{{generation.name}}</h3><p>{{generation.assets.length}} activos · {{generation.pages}} páginas · {{generation.format}}</p><dl class="doc-facts"><div><dt>Referencia</dt><dd class="mono">{{generation.id}}</dd></div><div><dt>Estado</dt><dd>Preparado para {{generation.format==='PDF'?'exportación PDF':'impresión'}}</dd></div></dl><p class="doc-help">La generación se ha simulado. El documento y su alcance quedan disponibles en Documentos recientes.</p></div><template #footer><button class="btn btn--secondary" @click="generation=null">Volver a la vista previa</button><button class="btn btn--primary" @click="generation=null;tab='history'">Ver documentos recientes</button></template></modal-shell>
    </section>`
  };
  const ReportSettings={props:{app:Object},template:`<section class="config-section doc-settings" data-od-id="report-settings"><header class="config-section-head"><p class="eyebrow">Documentación</p><h2>Plantillas de reportes</h2><p>Formatos predeterminados y composiciones propias para tus documentos habituales.</p></header><div class="doc-template-list"><article v-for="t in app.documents.templates" :key="t.id"><span class="doc-template-icon"><app-icon name="file-text"></app-icon></span><div><h3>{{t.name}}</h3><p>{{t.description}}</p><small>{{t.format}} · {{t.blocks.length}} bloques · {{t.builtin?'Predeterminada':'Personalizada'}}</small></div><button class="btn btn--secondary" @click="app.openDocuments('reports',[]);app.documentContext.templateId=t.id">Usar plantilla</button></article></div><a href="#/reportes" class="text-button">Abrir editor de reportes →</a></section>`};
  window.AssetReportViews={ReportsCenter,ReportSettings,ReportPreview};
  for(const component of Object.values(window.AssetReportViews))component.components=Object.assign({AppIcon:window.AppIcon,ModalShell:window.ModalShell,AssetQrCode:window.AssetLabelViews.AssetQrCode},component.components||{});
})();
