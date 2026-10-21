(function () {
  'use strict';
  const E = window.AssetAppearanceEngine;
  const AppearancePreview = {
    props: ['preset', 'mode'],
    data: () => ({ tab: 'panel', query: '', selected: false }),
    computed: {
      palette() { try { return E.tokens(this.preset, this.mode); } catch (_) { return {}; } },
      logo() { return (this.mode === 'dark' && this.preset.branding.logoDark) || this.preset.branding.logo; },
      rows() { return [{ name: 'Portátil de administración', code: 'EQ-001', status: 'Asignado' }, { name: 'Monitor de recepción', code: 'EQ-002', status: 'Disponible' }].filter(x => x.name.toLowerCase().includes(this.query.toLowerCase())); }
    },
    template: `<div class="appearance-specimen" :class="{'is-dark':mode==='dark'}" :style="palette" :data-theme="mode" data-od-id="appearance-preview">
      <div class="appearance-specimen__nav"><div class="appearance-specimen__brand"><img v-if="logo" :src="logo" width="30" height="30" alt="Logotipo de la vista previa"><strong>{{ preset.branding.appName }}</strong></div><span>{{ preset.branding.organizationName }}</span></div>
      <div class="appearance-specimen__tabs" role="tablist" aria-label="Contenido de la vista previa"><button v-for="item in [{id:'panel',label:'Dashboard'},{id:'inventory',label:'Inventario'}]" :key="item.id" role="tab" :aria-selected="tab===item.id" :class="{'is-active':tab===item.id}" @click="tab=item.id">{{item.label}}</button><small>VISTA PREVIA</small></div>
      <div class="appearance-specimen__body">
        <div class="appearance-specimen__heading"><div><span class="appearance-kicker">{{tab==='panel'?'Resumen operativo':'Activos de ejemplo'}}</span><h3>{{tab==='panel'?'Todo, en su sitio':'Inventario de equipos'}}</h3></div><span class="appearance-status">Sistema operativo</span></div>
        <template v-if="tab==='panel'"><div class="appearance-specimen__stats"><div><small>Activos de muestra</small><strong>02</strong><span>Inventario de demostración</span></div><div><small>Disponibilidad</small><strong>01 <em>/ 02</em></strong><span>Un equipo disponible</span></div></div><div class="appearance-specimen__chart"><div><strong>Distribución de muestra</strong><span>Asignados / disponibles</span></div><div class="appearance-specimen__bar"><span></span></div><small>1 asignado <span>1 disponible</span></small></div></template>
        <label class="appearance-specimen__search"><span>Buscar un activo</span><input v-model="query" placeholder="Nombre del equipo" data-od-id="preview-search"></label>
        <div class="appearance-specimen__table"><table><thead><tr><th>Equipo</th><th>Código</th><th>Estado</th></tr></thead><tbody><tr v-for="row in rows" :key="row.code"><td>{{row.name}}</td><td>{{row.code}}</td><td><span class="appearance-status">{{row.status}}</span></td></tr><tr v-if="!rows.length"><td colspan="3">No hay resultados para esta búsqueda.</td></tr></tbody></table></div>
        <div class="appearance-specimen__footer"><label><input type="checkbox" v-model="selected"> Incluir información técnica</label><button @click="selected=!selected" data-od-id="preview-action">{{selected?'Selección preparada':'Preparar selección'}}</button></div>
      </div>
    </div>`
  };
  const AppearancePackageDialog = {
    components: { ModalShell: window.ModalShell, AppearancePreview },
    props: ['open', 'kind', 'presets', 'active', 'current'], emits: ['close', 'imported'],
    data() { return { presetId: this.active.id, filename: 'apariencia-asset-manager.zip', detected: null, error: '', busy: false, policy: 'both', dragging: false, prepared: false }; },
    computed: {
      selected() { return this.presetId === this.active.id ? this.active : (this.presets.find(p => p.id === this.presetId) || this.active); },
      collision() { return this.detected && this.presets.find(p => p.name === this.detected.preset.name); },
      canReplace() { return this.collision && this.collision.id !== 'generic'; }
    },
    methods: {
      async read(file) {
        this.error = ''; this.detected = null; this.busy = true;
        try {
          if (!file || !/\.zip$/i.test(file.name)) throw new Error('Selecciona un archivo ZIP de apariencia.');
          if (file.size > 24 * 1024 * 1024) throw new Error('El paquete supera el máximo de 24 MB.');
          this.detected = await window.AssetAppearancePackage.decode(await file.arrayBuffer());
          E.validate(this.detected.preset); this.policy = 'both';
        } catch (error) { this.detected = null; this.error = error.message; }
        finally { this.busy = false; }
      },
      drop(event) { this.dragging = false; this.read(event.dataTransfer.files[0]); },
      confirm() { if (this.detected) this.$emit('imported', { preset: this.detected.preset, policy: this.policy }); },
      async download() {
        this.busy = true; this.error = ''; this.prepared = false;
        try {
          const bytes = await window.AssetAppearancePackage.encode(this.selected);
          const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
          const link = document.createElement('a'); link.href = url; link.download = (this.filename.trim() || 'apariencia.zip').replace(/\.zip$/i, '') + '.zip'; link.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000); this.prepared = true;
        } catch (error) { this.error = error.message; }
        finally { this.busy = false; }
      }
    },
    template: `<modal-shell :open="open" :title="kind==='import'?'Importar apariencia':'Exportar apariencia'" eyebrow="Paquete ZIP portable" size="lg" @close="$emit('close')">
      <div class="appearance-package" data-od-id="appearance-package">
        <template v-if="kind==='import'">
          <p>Importa la configuración y sus recursos. La identidad actual no cambiará hasta que apliques el preset.</p>
          <label class="appearance-drop" :class="{'is-dragging':dragging}" @dragover.prevent="dragging=true" @dragleave.prevent="dragging=false" @drop.prevent="drop" data-od-id="appearance-zip-drop"><strong>{{busy?'Leyendo el paquete…':'Arrastra aquí un archivo ZIP'}}</strong><span>o selecciona un paquete · Máximo 24 MB</span><input type="file" accept=".zip,application/zip" :disabled="busy" @change="read($event.target.files[0])"></label>
          <template v-if="detected"><div class="appearance-package__detected"><strong>{{detected.preset.name}}</strong><span>Versión {{detected.preset.version}} · {{detected.resources.length}} recursos incluidos</span><ul><li v-for="r in detected.resources" :key="r.name">{{r.name}} <small>{{Math.ceil(r.size/1024)}} KB</small></li></ul></div>
          <div class="appearance-compare"><div><h3>Apariencia actual</h3><appearance-preview :preset="current" mode="light"></appearance-preview></div><div><h3>Preset importado</h3><appearance-preview :preset="detected.preset" mode="light"></appearance-preview></div></div>
          <fieldset v-if="collision" class="appearance-conflict"><legend>Ya existe un preset con este nombre</legend><label><input type="radio" v-model="policy" value="both"> Conservar ambos con un nombre distinto</label><label v-if="canReplace"><input type="radio" v-model="policy" value="replace"> Sustituir el preset guardado</label><p v-else>La identidad genérica original se conserva siempre.</p></fieldset></template>
        </template>
        <template v-else><p>El paquete incluye la identidad, los temas claro y oscuro, los logotipos y el favicon. Podrás importarlo en otra instalación.</p><div class="field"><label for="appearance-export-preset">Preset que se exportará</label><select id="appearance-export-preset" v-model="presetId"><option v-for="p in presets" :value="p.id" :key="p.id">{{p.name}}{{p.id===active.id?' · Activo':''}}</option></select></div><div class="field"><label for="appearance-export-name">Nombre del archivo</label><input id="appearance-export-name" v-model="filename" maxlength="120"></div><appearance-preview :preset="selected" mode="light"></appearance-preview><p v-if="prepared" class="appearance-feedback" role="status">Paquete preparado. La descarga se ha iniciado.</p></template>
        <p v-if="error" class="appearance-error" role="alert">{{error}}</p>
      </div>
      <template #footer><button class="btn btn--secondary" @click="$emit('close')">Cerrar</button><button v-if="kind==='import'" class="btn btn--primary" :disabled="!detected||busy" @click="confirm" data-od-id="appearance-confirm-import">Importar y revisar</button><button v-else class="btn btn--primary" :disabled="busy" @click="download" data-od-id="appearance-download">{{busy?'Preparando…':'Descargar ZIP'}}</button></template>
    </modal-shell>`
  };
  const AppearanceSettings = {
    components: { AppearancePreview, AppearancePackageDialog }, props: ['app'],
    data() { return { draft: E.clone(this.app.appearance.active), previewMode: 'light', editMode: 'light', packageKind: '', error: '', notice: '', restorePrompt: false, resourceKeys: [{ id: 'logo', label: 'Logotipo principal' }, { id: 'logoDark', label: 'Variante para modo oscuro' }, { id: 'logoCompact', label: 'Logotipo compacto' }, { id: 'favicon', label: 'Favicon' }] }; },
    computed: {
      dirty() { return JSON.stringify(this.draft) !== JSON.stringify(this.app.appearance.active); },
      valid() { try { E.validate(this.draft); return true; } catch (_) { return false; } },
      currentMode() { return this.app.themeMode; },
      colors() { return this.draft.colors[this.editMode]; }
    },
    methods: {
      select(preset) { this.draft = E.clone(preset); this.error = ''; this.notice = 'Vista previa seleccionada. Pulsa Aplicar para cambiar la identidad global.'; },
      discard() { this.draft = E.clone(this.app.appearance.active); this.error = ''; this.notice = 'Cambios sin aplicar descartados.'; },
      apply() {
        try {
          E.validate(this.draft);
          const generic = this.app.appearance.presets[0];
          if (this.draft.id === 'generic' && JSON.stringify(this.draft) !== JSON.stringify(generic)) {
            const p = E.clone(this.draft); p.name = p.name === generic.name ? 'Mi organización' : p.name; this.draft = E.savePreset(this.app.appearance, p, 'both');
          } else {
            const index = this.app.appearance.presets.findIndex(p => p.id === this.draft.id);
            if (index >= 0 && this.draft.id !== 'generic') this.app.appearance.presets.splice(index, 1, E.clone(this.draft));
          }
          this.app.applyAppearance(this.draft); this.notice = 'Identidad aplicada. Tu modo de apariencia se mantiene.'; this.error = '';
        } catch (error) { this.error = error.message; }
      },
      duplicate() { this.draft = E.duplicate(this.app.appearance, this.draft); this.notice = 'Copia guardada. Puedes editarla sin cambiar el preset original.'; },
      save() {
        try { E.validate(this.draft); const p = E.clone(this.draft); if (p.id === 'generic') p.name = 'Mi organización'; this.draft = E.savePreset(this.app.appearance, p, 'replace'); this.notice = 'Preset guardado en la galería de esta sesión. No se ha aplicado.'; }
        catch (error) { this.error = error.message; }
      },
      restore() { this.restorePrompt = false; const generic = this.app.appearance.presets[0]; this.draft = E.clone(generic); this.app.applyAppearance(generic); this.notice = 'Se ha restaurado la identidad original de Asset Manager.'; },
      previous() { if (!this.app.appearance.previous) return; const p = E.clone(this.app.appearance.previous); this.draft = p; this.app.applyAppearance(p); this.notice = 'Se ha recuperado la apariencia anterior.'; },
      setMode(mode) { this.app.setAppearanceMode(mode); },
      imported(result) { try { this.draft = E.savePreset(this.app.appearance, result.preset, result.policy); this.packageKind = ''; this.notice = 'Preset importado. Revisa el resultado antes de pulsar Aplicar.'; } catch (error) { this.error = error.message; } },
      async resource(event, key) {
        const file = event.target.files[0]; if (!file) return;
        if (!['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon'].includes(file.type)) { this.error = 'Selecciona una imagen SVG, PNG, JPEG, WebP o ICO.'; return; }
        if (file.size > 2 * 1024 * 1024) { this.error = 'La imagen supera los 2 MB. Selecciona un archivo más pequeño.'; return; }
        try { const reader = new FileReader(); this.draft.branding[key] = await new Promise((resolve, reject) => { reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('No se pudo leer la imagen.')); reader.readAsDataURL(file); }); this.error = ''; }
        catch (error) { this.error = error.message; }
      }
    },
    template: `<section class="config-section appearance" data-od-id="appearance-settings">
      <header class="config-section__head"><div><span class="eyebrow">Configuración</span><h2 data-od-id="appearance-heading">Apariencia</h2><p>Logotipos, colores y tipografía de la organización.</p></div><div class="appearance-tools"><button class="btn btn--secondary" @click="packageKind='import'" data-od-id="appearance-import">Importar ZIP</button><button class="btn btn--secondary" @click="packageKind='export'" data-od-id="appearance-export">Exportar</button></div></header>
      <div class="appearance-mode" data-od-id="appearance-user-mode"><div><h3>Tu modo de apariencia</h3><p>Solo cambia para tu usuario. La identidad de la organización es compartida.</p></div><div class="appearance-segments" aria-label="Modo de apariencia"><button v-for="m in [{id:'light',label:'Claro'},{id:'dark',label:'Oscuro'},{id:'system',label:'Automático'}]" :key="m.id" :aria-pressed="currentMode===m.id" :class="{'is-active':currentMode===m.id}" @click="setMode(m.id)">{{m.label}}</button></div></div>
      <div class="appearance-section-title"><div><h3>Presets de identidad</h3><p>Selecciona un preset para previsualizarlo.</p></div><span class="appearance-session">Galería de esta sesión</span></div>
      <div class="appearance-gallery" data-od-id="appearance-gallery"><button v-for="p in app.appearance.presets" :key="p.id" class="appearance-preset" :class="{'is-selected':draft.id===p.id}" :aria-pressed="draft.id===p.id" :data-od-id="'appearance-preset-'+p.id" @click="select(p)"><div class="appearance-preset__sample" :style="{'--sample-primary':p.colors.light.primary,'--sample-secondary':p.colors.light.secondary}"><span class="appearance-preset__rail"></span><div><i></i><div><b></b><b></b><b></b></div><em></em></div></div><div class="appearance-preset__label"><strong>{{p.name}}</strong><span v-if="app.appearance.active.id===p.id" class="appearance-active">Activo</span></div><small>{{p.description||'Identidad personalizada'}}</small></button></div>
      <div class="appearance-workspace">
        <div class="appearance-editor" data-od-id="appearance-identity-editor"><div class="appearance-section-title"><h3>Identidad de la organización</h3><button class="btn btn--ghost" @click="duplicate" data-od-id="appearance-duplicate">Duplicar</button></div>
          <div class="field"><label for="appearance-preset-name">Nombre del preset</label><input id="appearance-preset-name" v-model="draft.name" maxlength="64"></div>
          <div class="field"><label for="appearance-app-name">Nombre visible de la aplicación</label><input id="appearance-app-name" v-model="draft.branding.appName" maxlength="64"></div>
          <div class="field"><label for="appearance-org-name">Organización</label><input id="appearance-org-name" v-model="draft.branding.organizationName" maxlength="80"></div>
          <div class="appearance-resource-grid"><div v-for="r in resourceKeys" :key="r.id" class="appearance-resource" :data-od-id="'appearance-resource-'+r.id"><div class="appearance-resource__preview" :class="{'is-dark':r.id==='logoDark'}"><img v-if="draft.branding[r.id]" :src="draft.branding[r.id]" width="44" height="44" :alt="r.label"><span v-else>Sin variante</span></div><label>{{r.label}}<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon" @change="resource($event,r.id)"><span>Cargar imagen</span></label><button v-if="draft.branding[r.id]" class="appearance-text-button" @click="draft.branding[r.id]=''" :aria-label="'Quitar '+r.label">Quitar</button></div></div>
          <p class="appearance-hint">SVG, PNG, JPEG, WebP o ICO · Máximo 2 MB por recurso. Sin variante se utiliza el logotipo principal.</p>
          <div class="appearance-section-title"><h3>Colores del tema</h3><div class="appearance-segments appearance-segments--small"><button :class="{'is-active':editMode==='light'}" :aria-pressed="editMode==='light'" @click="editMode='light'">Claro</button><button :class="{'is-active':editMode==='dark'}" :aria-pressed="editMode==='dark'" @click="editMode='dark'">Oscuro</button></div></div>
          <div class="appearance-colors"><label v-for="c in [{id:'primary',label:'Principal'},{id:'secondary',label:'Secundario'},{id:'accent',label:'Acento'}]" :key="c.id">{{c.label}}<div><input type="color" v-model="colors[c.id]" :aria-label="c.label+' '+editMode"><input type="text" v-model="colors[c.id]" maxlength="7" :aria-label="'Valor hexadecimal '+c.label"></div></label></div>
          <p class="appearance-hint">Los controles ajustan automáticamente el color del texto para mantener el contraste.</p>
          <label class="appearance-check"><input type="checkbox" v-model="draft.preferences.compact"> Controles y filas compactos</label>
          <div class="field"><label for="appearance-default-mode">Modo inicial de nuevos usuarios</label><select id="appearance-default-mode" v-model="draft.preferences.defaultMode"><option value="system">Automático · Seguir el sistema</option><option value="light">Claro</option><option value="dark">Oscuro</option></select></div>
          <button class="btn btn--secondary" :disabled="!valid" @click="save" data-od-id="appearance-save">Guardar preset sin aplicar</button>
        </div>
        <aside class="appearance-preview-panel" data-od-id="appearance-live-preview"><div class="appearance-section-title"><div><h3>Vista previa interactiva</h3><p>Prueba los controles sin cambiar tu aplicación.</p></div></div><div class="appearance-preview-toolbar"><span>{{previewMode==='light'?'Tema claro':'Tema oscuro'}}</span><div class="appearance-segments"><button :class="{'is-active':previewMode==='light'}" :aria-pressed="previewMode==='light'" @click="previewMode='light'">Claro</button><button :class="{'is-active':previewMode==='dark'}" :aria-pressed="previewMode==='dark'" @click="previewMode='dark'">Oscuro</button></div></div><appearance-preview :preset="draft" :mode="previewMode"></appearance-preview><div class="appearance-preview-note"><strong>Un tema compartido</strong><p>Se aplicará a la navegación, el acceso, los formularios y los encabezados de los informes. Cada usuario conserva su modo preferido.</p></div></aside>
      </div>
      <p v-if="error" class="appearance-error" role="alert">{{error}}</p><p v-if="notice" class="appearance-feedback" role="status">{{notice}}</p>
      <footer class="appearance-apply" data-od-id="appearance-apply-bar"><div><strong>{{dirty?'Hay cambios sin aplicar':'Apariencia actualizada'}}</strong><span>{{dirty?'Solo los ves en esta vista previa.':'La identidad genérica siempre estará disponible.'}}</span></div><div><button class="btn btn--ghost" :disabled="!dirty" @click="discard" data-od-id="appearance-discard">Descartar</button><button class="btn btn--primary" :disabled="!dirty||!valid" @click="apply" data-od-id="appearance-apply">Aplicar apariencia</button></div></footer>
      <div class="appearance-restore"><div><h3>Volver a lo conocido</h3><p>Restaura el diseño genérico sin eliminar tus presets guardados.</p></div><button class="btn btn--secondary" @click="restorePrompt=true" data-od-id="appearance-restore">Restaurar original</button><button v-if="app.appearance.previous" class="appearance-text-button" @click="previous">Apariencia anterior</button></div>
      <div v-if="restorePrompt" class="appearance-confirm" role="group" aria-label="Confirmar restauración"><p>¿Restaurar la identidad original de Asset Manager? Tus presets se conservarán.</p><button class="btn btn--secondary" @click="restorePrompt=false">Cancelar</button><button class="btn btn--secondary" @click="restore">Sí, restaurar</button></div>
      <appearance-package-dialog v-if="packageKind" :open="true" :kind="packageKind" :presets="app.appearance.presets" :active="app.appearance.active" :current="app.appearance.active" @close="packageKind=''" @imported="imported"></appearance-package-dialog>
    </section>`
  };
  window.AssetAppearanceViews = { AppearanceSettings, AppearancePreview, AppearancePackageDialog };
})();
