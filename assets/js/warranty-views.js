(function () {
  'use strict';

  /* Individual warranties (Phase 6, S7).
   *
   * These are the original warranty views: same routes, same tables, same
   * dialog and settings flow. Their authority changed: the server stores the
   * individual warranty, the calculated coverage, the single receipt reference
   * and the expiring-day preference. Nothing is written to browser storage and
   * the prototype asset collection is never mutated.
   */
  const E = window.AssetWarrantyEngine;

  const STATUS_LABELS = {
    active: 'Vigente',
    cancelled: 'Cancelada',
    claimed: 'Reclamada',
    unknown: 'Sin estado'
  };
  const COVERAGE = {
    current: { label: 'Vigente', tone: 'ok' },
    expiring: { label: 'Próxima a vencer', tone: 'warn' },
    expired: { label: 'Vencida', tone: 'down' },
    unknown: { label: 'Sin información', tone: 'hold' }
  };

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function formatDate(value) {
    const raw = text(value);
    return raw ? new Date(raw + 'T12:00:00').toLocaleDateString('es-ES') : 'Sin fecha';
  }

  function formatSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
    return (value / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function coverageOf(value) {
    return COVERAGE[text(value)] || COVERAGE.unknown;
  }

  function statusLabel(value) {
    return STATUS_LABELS[text(value)] || STATUS_LABELS.unknown;
  }

  const TODAY = () => new Date().toLocaleDateString('en-CA');

  /* The remaining days are arithmetic on the stored expiry; the coverage label
   * itself is the server's decision. */
  function daysLeft(expiresOn, today) {
    if (!E.validDate(expiresOn)) return null;
    return Math.round((Date.parse(expiresOn + 'T00:00:00Z') - Date.parse((today || TODAY()) + 'T00:00:00Z')) / 86400000);
  }

  function saveBlob(blob, filename) {
    if (typeof URL === 'undefined' || !URL.createObjectURL || typeof document === 'undefined') return false;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'comprobante';
    link.rel = 'noopener';
    if (document.body && document.body.appendChild) {
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    if (typeof window.setTimeout === 'function') window.setTimeout(() => URL.revokeObjectURL(url), 1200);
    return true;
  }

  /* Shared form behaviour for the asset panel, the center and the standalone
   * editor. Each host defines `warrantyAssetId`, `warrantyAssetLabel` and
   * `canonicalItem`; the server remains the only authority for the write. */
  const warrantyFormMixin = {
    data() {
      return {
        editing: false,
        draft: { provider: '', purchase: '', until: '', months: '', mode: 'date', note: '', receiptId: '', status: 'active' },
        error: '',
        fieldErrors: {},
        message: '',
        busy: false,
        receiptBusy: false,
        warrantyAlive: true
      };
    },
    computed: {
      receiptAttachments() {
        const page = this.app.phase6 && this.app.phase6.attachments;
        if (!page || page.assetId !== this.warrantyAssetId) return [];
        return page.items.filter((entry) => entry && entry.category === 'receipt');
      }
    },
    beforeUnmount() {
      this.warrantyAlive = false;
    },
    methods: {
      statusLabel,
      formatSize,
      editorDraft(next) {
        if (next && typeof next === 'object') this.draft = Object.assign({}, this.draft, next);
        return this.draft;
      },
      previewExpiry(draft) {
        const source = draft && typeof draft === 'object' ? draft : this.draft;
        return E.expiry(source.purchase, Number(source.months));
      },
      receipt() {
        const id = text(this.draft && this.draft.receiptId) || text(this.canonicalItem && this.canonicalItem.receiptId);
        if (!id) return null;
        return this.receiptAttachments.find((entry) => entry.id === id) || null;
      },
      startEdit() {
        if (!this.canEdit) return false;
        const item = this.canonicalItem || {};
        this.draft = {
          provider: text(item.supplier),
          purchase: text(item.purchaseDate),
          until: text(item.expiresOn),
          months: item.durationMonths === null || item.durationMonths === undefined ? '' : item.durationMonths,
          /* A stored duration stays a duration only while it still explains the
           * stored expiry; otherwise the expiry is the registered authority. */
          mode: item.durationMonths && E.expiry(item.purchaseDate, item.durationMonths) === text(item.expiresOn) ? 'duration' : 'date',
          note: text(item.notes),
          receiptId: text(item.receiptId),
          status: text(item.status) || 'active'
        };
        this.editing = true;
        this.error = '';
        this.fieldErrors = {};
        this.message = '';
        if (this.warrantyAssetId && this.app.loadAssetAttachments) this.app.loadAssetAttachments(this.warrantyAssetId);
        return true;
      },
      closeEditor() {
        this.editing = false;
        this.error = '';
        this.fieldErrors = {};
      },
      async saveEditor(next) {
        const draft = this.editorDraft(next);
        const id = this.warrantyAssetId;
        if (!id) {
          this.error = 'El activo no está disponible.';
          return false;
        }
        const provider = text(draft.provider);
        if (!provider) {
          this.error = 'Indica el proveedor de la garantía.';
          return false;
        }
        if (!E.validDate(draft.purchase)) {
          this.error = 'Indica una fecha de compra válida.';
          return false;
        }
        const values = {
          supplier: provider,
          purchaseDate: draft.purchase,
          status: text(draft.status) || 'active',
          notes: text(draft.note),
          receiptId: text(draft.receiptId)
        };
        if (draft.mode === 'duration') {
          const months = Number(draft.months);
          if (!Number.isInteger(months) || months < 1 || months > 1200) {
            this.error = 'Indica una duración entre 1 y 1200 meses.';
            return false;
          }
          /* The server calculates and stores the expiry; sending a date too
           * would conflict with the registered duration. */
          values.durationMonths = months;
        } else {
          if (!E.validDate(draft.until)) {
            this.error = 'Indica una fecha de vencimiento válida.';
            return false;
          }
          if (draft.until < draft.purchase) {
            this.error = 'El vencimiento no puede ser anterior a la compra.';
            return false;
          }
          values.expiresOn = draft.until;
        }
        this.busy = true;
        const result = await this.app.saveAssetWarranty(id, values);
        this.busy = false;
        if (!this.warrantyAlive) return false;
        if (!result || !result.ok || result.cancelled) {
          if (!(result && result.cancelled)) {
            this.error = (result && result.error) || 'No se pudo guardar la garantía.';
            this.fieldErrors = (result && result.fieldErrors) || {};
          }
          return false;
        }
        this.editing = false;
        this.error = '';
        this.fieldErrors = {};
        this.message = 'Garantía individual actualizada.';
        if (this.app.showToast) this.app.showToast('Garantía individual actualizada.');
        if (this.$emit) {
          this.$emit('saved', result.payload);
          this.$emit('close');
        }
        return true;
      },
      async uploadReceipt(event) {
        const input = event && event.target;
        const file = input && input.files && input.files.length ? input.files[0] : null;
        const id = this.warrantyAssetId;
        if (input) input.value = '';
        if (!file || !id) return false;
        this.receiptBusy = true;
        const result = await this.app.uploadAssetAttachment(id, file, 'receipt');
        this.receiptBusy = false;
        if (!this.warrantyAlive) return false;
        if (!result || !result.ok) {
          if (result && !result.cancelled) this.error = result.error || 'No se pudo subir el comprobante.';
          return false;
        }
        const uploaded = text(result.payload && result.payload.id);
        this.draft.receiptId = uploaded;
        this.error = '';
        await this.app.loadAssetAttachments(id);
        return uploaded;
      },
      unlinkReceipt() {
        /* Only the reference is cleared: the stored attachment keeps existing
         * and stays reachable from the asset attachments panel. */
        this.draft.receiptId = '';
      },
      async downloadReceipt() {
        const entry = this.receipt();
        if (!entry) return false;
        const result = await this.app.downloadAssetAttachment(entry);
        if (result && result.ok) {
          saveBlob(result.blob, result.filename);
          this.message = 'Descarga preparada.';
          return true;
        }
        if (result && !result.cancelled) this.message = result.error || 'No se pudo descargar el comprobante.';
        return false;
      }
    }
  };

  /* The editor dialog keeps the original single-column form and its month-end
   * preview. The preview is local arithmetic; only the server value is stored. */
  const editorTemplate = `
    <modal-shell :open="editing" title="Editar garantía individual" :eyebrow="warrantyAssetId" size="wide" @close="closeEditor">
      <form id="warranty-edit-form" data-od-id="warranty-edit-form" class="warranty-form" @submit.prevent="saveEditor()">
        <p>La cobertura pertenece únicamente a <strong>{{ warrantyAssetLabel }}</strong>.</p>
        <label class="doc-field">Proveedor<input v-model="draft.provider" required maxlength="160" placeholder="Nombre del proveedor"></label>
        <div class="doc-form-grid">
          <label class="doc-field">Fecha de compra<input type="date" v-model="draft.purchase" required></label>
          <label class="doc-field">Definir vencimiento por<select v-model="draft.mode"><option value="date">Fecha de vencimiento</option><option value="duration">Duración desde la compra</option></select></label>
        </div>
        <label v-if="draft.mode === 'date'" class="doc-field">Fecha de vencimiento<input type="date" v-model="draft.until" :min="draft.purchase" required></label>
        <div v-else class="doc-form-grid">
          <label class="doc-field">Duración en meses<input type="number" v-model.number="draft.months" min="1" max="1200" required></label>
          <div class="warranty-calculated"><span>Vencimiento calculado</span><strong>{{ previewExpiry(draft) || 'Selecciona la compra' }}</strong></div>
        </div>
        <label class="doc-field">Estado<select v-model="draft.status"><option value="active">Vigente</option><option value="claimed">Reclamada</option><option value="cancelled">Cancelada</option><option value="unknown">Sin estado</option></select></label>
        <label class="doc-field">Notas de cobertura<textarea v-model="draft.note" maxlength="2000" placeholder="Condiciones o referencias de la garantía"></textarea></label>
        <div class="warranty-receipts">
          <div class="doc-section-label"><strong>Comprobante</strong><label class="btn btn--secondary btn--small warranty-upload">Añadir archivo<input type="file" accept=".pdf,image/*" :disabled="receiptBusy" @change="uploadReceipt"></label></div>
          <p class="doc-help">La garantía referencia un único comprobante guardado en el servidor. Los demás archivos del activo permanecen en «Adjuntos del activo».</p>
          <div v-if="receipt()" class="warranty-receipt"><app-icon name="file-text"></app-icon><span>{{ receipt().filename }}<small>{{ formatSize(receipt().size) }}</small></span><button class="icon-button" type="button" :aria-label="'Quitar la referencia a ' + receipt().filename" @click="unlinkReceipt">×</button></div>
          <p v-else class="doc-help">No hay comprobante vinculado.</p>
          <p class="doc-help">Quitar la referencia no elimina el archivo guardado.</p>
        </div>
        <p v-if="error" class="doc-error" role="alert">{{ error }}</p>
      </form>
      <template #footer><button class="btn btn--secondary" type="button" @click="closeEditor">Cancelar</button><button class="btn btn--primary" type="submit" form="warranty-edit-form" :disabled="busy">Guardar garantía</button></template>
    </modal-shell>
  `;

  const WarrantyEditor = {
    props: { app: Object, asset: Object, item: Object, open: Boolean },
    emits: ['close', 'saved'],
    mixins: [warrantyFormMixin],
    computed: {
      warrantyAssetId() {
        return this.asset && this.asset.id ? String(this.asset.id) : '';
      },
      warrantyAssetLabel() {
        return (this.asset && (this.asset.name || this.asset.id)) || this.warrantyAssetId;
      },
      canonicalItem() {
        return this.item || {};
      },
      canEdit() {
        return !!(this.app && this.app.phase6CanEdit);
      }
    },
    watch: {
      open: {
        immediate: true,
        handler(value) {
          if (value) this.startEdit();
          else this.editing = false;
        }
      }
    },
    template: editorTemplate
  };

  const AssetWarrantyPanel = {
    props: { app: Object, asset: Object },
    mixins: [warrantyFormMixin],
    data() {
      return { serverWarranty: null };
    },
    computed: {
      server() {
        return !!(this.asset && this.asset.serverAsset);
      },
      warrantyAssetId() {
        return this.asset && this.asset.id ? String(this.asset.id) : '';
      },
      warrantyAssetLabel() {
        return (this.asset && (this.asset.name || this.asset.id)) || this.warrantyAssetId;
      },
      detail() {
        return this.app.phase6 ? this.app.phase6.warranty : null;
      },
      /* The server detail is only current for the asset it was read for. */
      item() {
        if (!this.server || !this.detail || this.detail.assetId !== this.warrantyAssetId) return null;
        return this.detail.item;
      },
      canonicalItem() {
        return this.item || {};
      },
      w() {
        if (!this.server) {
          const demo = (this.asset && this.asset.warranty) || {};
          return {
            provider: text(demo.provider),
            purchase: text(demo.purchase),
            until: text(demo.until),
            months: demo.months || 0,
            note: text(demo.note),
            receiptId: '',
            status: ''
          };
        }
        const row = this.item || {};
        return {
          provider: text(row.supplier),
          purchase: text(row.purchaseDate),
          until: text(row.expiresOn),
          months: row.durationMonths || 0,
          note: text(row.notes),
          receiptId: text(row.receiptId),
          status: text(row.status)
        };
      },
      state() {
        if (!this.server) {
          const demo = E.status(this.asset && this.asset.warranty, 90);
          return { key: demo.key, label: demo.label, tone: demo.tone, days: demo.days };
        }
        const cover = coverageOf(this.item && this.item.coverage);
        return {
          key: text(this.item && this.item.coverage) || 'unknown',
          label: cover.label,
          tone: cover.tone,
          days: daysLeft(this.w && this.w.until)
        };
      },
      canEdit() {
        return this.server && !!(this.app.phase6CanEdit);
      },
      loading() {
        return !!(this.detail && this.detail.assetId === this.warrantyAssetId && this.detail.loading);
      },
      detailError() {
        return this.detail && this.detail.assetId === this.warrantyAssetId ? text(this.detail.error) : '';
      },
      loaded() {
        return !!(this.detail && this.detail.assetId === this.warrantyAssetId && this.detail.loaded);
      },
      expiringDays() {
        const prefs = this.app.phase6 && this.app.phase6.warrantyPrefs;
        return prefs && prefs.loaded ? prefs.expiringDays : null;
      }
    },
    watch: {
      'asset.id': {
        immediate: true,
        handler() {
          this.editing = false;
          this.error = '';
          this.reload();
        }
      }
    },
    methods: {
      date: formatDate,
      statusLabel,
      async reload() {
        if (!this.server || !this.warrantyAssetId || !this.app.phase6CanView) return false;
        const ok = await this.app.loadAssetWarranty(this.warrantyAssetId);
        if (this.app.phase6CanEdit) this.app.loadAssetAttachments(this.warrantyAssetId);
        return ok;
      }
    },
    template: `
      <section class="operations-panel warranty-asset-panel" data-od-id="asset-warranty-panel">
        <header class="panel-head">
          <div><p class="eyebrow">Cobertura individual</p><h2>Garantía</h2></div>
          <button v-if="canEdit" class="btn btn--secondary btn--small" type="button" @click="startEdit">Editar garantía</button>
        </header>
        <p v-if="loading" class="config-note" role="status">Consultando la garantía…</p>
        <p v-else-if="detailError" class="field__error" role="alert">{{ detailError }}</p>
        <p v-if="!server" class="config-note">Datos de demostración de solo lectura. La garantía real se registra desde el inventario del servidor.</p>
        <div class="warranty-asset-body">
          <div class="warranty-status-card">
            <span :class="['status-pill','status--'+state.tone]">{{ state.label }}</span>
            <strong v-if="state.days !== null">{{ state.days < 0 ? Math.abs(state.days) + ' días desde el vencimiento' : state.days === 0 ? 'Vence hoy' : state.days + ' días de cobertura' }}</strong>
            <p v-if="server && expiringDays">Aviso de proximidad: {{ expiringDays }} días (preferencia del servidor).</p>
            <p v-else-if="server">Cobertura calculada por el servidor con los datos registrados.</p>
          </div>
          <dl class="doc-facts">
            <div><dt>Proveedor</dt><dd>{{ w.provider || 'Sin especificar' }}</dd></div>
            <div><dt>Fecha de compra</dt><dd>{{ date(w.purchase) }}</dd></div>
            <div><dt>Vencimiento</dt><dd>{{ date(w.until) }}</dd></div>
            <div><dt>Duración</dt><dd>{{ w.months ? w.months + ' meses' : 'Según fecha de vencimiento' }}</dd></div>
            <div v-if="w.status"><dt>Estado registrado</dt><dd>{{ statusLabel(w.status) }}</dd></div>
          </dl>
        </div>
        <p v-if="server && loaded && !item" class="config-note">Este activo no tiene garantía registrada.</p>
        <p v-if="w.note" class="warranty-note">{{ w.note }}</p>
        <div class="warranty-asset-receipts">
          <span class="doc-help">Comprobante · {{ w.receiptId ? 1 : 0 }}</span>
          <button v-if="receipt()" class="btn btn--ghost btn--small" type="button" @click="downloadReceipt"><app-icon name="file-text"></app-icon>{{ receipt().filename }}</button>
          <p v-if="server && !w.receiptId" class="doc-help">Sin comprobante vinculado. Los archivos del activo se gestionan en «Adjuntos del activo».</p>
        </div>
        ${editorTemplate}
      </section>
    `
  };

  const WarrantyCenter = {
    props: { app: Object },
    mixins: [warrantyFormMixin],
    data() {
      return {
        filter: '',
        search: '',
        site: this.app.warrantyPrefs ? this.app.warrantyPrefs.site : 'all',
        category: this.app.warrantyPrefs ? this.app.warrantyPrefs.category : 'all',
        includeRetired: !!(this.app.warrantyPrefs && this.app.warrantyPrefs.includeRetired),
        provider: 'all',
        editRow: null
      };
    },
    computed: {
      warrantyAssetId() {
        return this.editRow ? text(this.editRow.assetId) : '';
      },
      warrantyAssetLabel() {
        const found = this.editRow ? this.assetOf(this.editRow) : null;
        return (found && (found.name || found.id)) || this.warrantyAssetId;
      },
      canonicalItem() {
        return this.editRow || {};
      },
      canEdit() {
        return !!(this.app.phase6CanEdit);
      },
      state() {
        return this.app.phase6.warranties;
      },
      items() {
        return this.app.phase6WarrantyItems;
      },
      /* Counts describe the pages already loaded: the server pages the list and
       * the UI never claims a global total it did not read. */
      counts() {
        const out = { all: 0, current: 0, expiring: 0, expired: 0, unknown: 0 };
        this.items.forEach((row) => {
          out.all += 1;
          const key = text(row && row.coverage);
          out[out[key] === undefined ? 'unknown' : key] += 1;
        });
        return out;
      },
      providers() {
        return [...new Set(this.items.map((row) => text(row.supplier)).filter(Boolean))].sort();
      },
      rows() {
        const needle = this.search.trim().toLocaleLowerCase('es');
        return this.items
          .filter((row) => {
            const asset = this.assetOf(row);
            if (this.site !== 'all' && (!asset || asset.site !== this.site)) return false;
            if (this.category !== 'all' && (!asset || asset.category !== this.category)) return false;
            if (this.includeRetired === false && asset && asset.retired) return false;
            if (this.provider !== 'all' && text(row.supplier) !== this.provider) return false;
            if (!needle) return true;
            const haystack = [row.assetId, row.supplier, asset && asset.name, asset && asset.code].map((part) => text(part)).join(' ').toLocaleLowerCase('es');
            return haystack.includes(needle);
          })
          .slice()
          .sort((a, b) => text(a.expiresOn || '9999').localeCompare(text(b.expiresOn || '9999')));
      },
      metrics() {
        const days = this.app.phase6.warrantyPrefs.expiringDays;
        return [
          { id: '', cov: '', label: 'Garantías cargadas', description: 'Garantías individuales registradas' },
          { id: 'current', cov: 'current', label: 'Vigentes', description: 'Cobertura sin vencimiento próximo' },
          { id: 'expiring', cov: 'expiring', label: 'Próximas a vencer', description: 'Dentro de ' + days + ' días (preferencia del servidor)' },
          { id: 'expired', cov: 'expired', label: 'Vencidas', description: 'Cobertura finalizada' }
        ];
      },
      loadedNote() {
        return this.counts.all + ' garantías cargadas. Los recuentos describen únicamente las garantías cargadas en esta vista.';
      }
    },
    created() {
      if (this.app.phase6CanView) this.reload();
    },
    methods: {
      date: formatDate,
      coverageLabel(value) {
        return coverageOf(value).label;
      },
      status(row) {
        const cover = coverageOf(row && row.coverage);
        return { key: text(row && row.coverage) || 'unknown', label: cover.label, tone: cover.tone, days: daysLeft(row && row.expiresOn) };
      },
      assetOf(row) {
        const id = row && typeof row === 'object' ? text(row.assetId) : text(row);
        if (!id) return null;
        const listed = Array.isArray(this.app.inventoryItems) ? this.app.inventoryItems : [];
        const found = listed.find((entry) => entry && entry.id === id);
        if (found) return found;
        const current = this.app.currentAsset;
        if (current && current.id === id) return current;
        return null;
      },
      assetLabel(row) {
        const found = this.assetOf(row);
        if (!found) return text(row && row.assetId) || text(row);
        return found.name ? found.name : found.id;
      },
      receiptsLabel(row) {
        return row && text(row.receiptId) ? 'Comprobante vinculado' : 'Sin comprobante';
      },
      setCoverage(value) {
        this.filter = value;
        return this.reload();
      },
      async reload() {
        if (!this.app.phase6CanView) return false;
        this.editing = false;
        this.editRow = null;
        return this.app.loadWarranties({ coverage: this.filter, offset: 0, limit: 50 });
      },
      async loadMore() {
        if (!this.app.phase6CanView) return false;
        return this.app.loadWarranties({ coverage: this.filter, offset: this.items.length, limit: 50 });
      },
      async saveEditor(next) {
        const saved = await warrantyFormMixin.methods.saveEditor.call(this, next);
        if (saved) await this.reload();
        return saved;
      },
      openEditor(row) {
        this.editRow = row;
        return this.startEdit();
      }
    },
    template: `
      <section class="page warranties-page" data-od-id="warranties-center">
        <header class="page-head">
          <div><p class="eyebrow">Ciclo de vida</p><h1>Garantías</h1><p class="page-head__description">Cobertura de cada activo, proveedores y próximos vencimientos.</p></div>
          <div class="doc-inline"><a class="btn btn--secondary" href="#/configuracion/garantias"><app-icon name="sliders"></app-icon>Preferencias</a><button class="btn btn--primary" type="button" disabled aria-describedby="warranty-report-note">Preparar reporte</button></div>
        </header>
        <p id="warranty-report-note" class="doc-help">La preparación de informes de garantías no forma parte de esta fase; el botón queda desactivado.</p>
        <div class="warranty-metrics">
          <button v-for="m in metrics" :key="m.id" type="button" :class="['warranty-metric',{'is-active':filter===m.cov}]" :aria-pressed="filter===m.cov" @click="setCoverage(m.cov)"><span>{{ m.label }}</span><strong class="mono">{{ counts[m.cov || 'all'] }}</strong><small>{{ m.description }}</small></button>
        </div>
        <div class="warranty-toolbar">
          <label class="doc-field"><span class="sr-only">Buscar garantía</span><input type="search" v-model="search" placeholder="Buscar activo, ID o proveedor"></label>
          <label class="doc-field"><span class="sr-only">Sede</span><select v-model="site"><option value="all">Todas las sedes</option><option v-for="s in app.sites" :key="s.id" :value="s.id">{{ s.label }}</option></select></label>
          <label class="doc-field"><span class="sr-only">Categoría</span><select v-model="category"><option value="all">Todas las categorías</option><option v-for="c in app.categories" :key="c.id" :value="c.id">{{ c.label }}</option></select></label>
          <label class="doc-field"><span class="sr-only">Proveedor</span><select v-model="provider"><option value="all">Todos los proveedores</option><option v-for="p in providers" :key="p" :value="p">{{ p }}</option></select></label>
        </div>
        <p class="doc-help">Los filtros de sede, categoría y proveedor se aplican a las garantías cargadas; solo se pueden filtrar los activos que ya están en la página del inventario.</p>
        <div class="results-bar"><p><strong>{{ rows.length }}</strong> de {{ counts.all }} cargadas · Ordenadas por fecha de vencimiento</p><button class="text-button" type="button" :aria-pressed="filter==='unknown'" @click="setCoverage(filter==='unknown'?'':'unknown')">Sin información <span class="mono">{{ counts.unknown }}</span></button></div>
        <p v-if="state.loading" class="config-note" role="status">Consultando garantías…</p>
        <p v-else-if="state.error" class="field__error" role="alert">{{ state.error }}</p>
        <div class="table-panel">
          <table class="asset-table warranty-table">
            <thead><tr><th>Activo</th><th>Proveedor / compra</th><th>Vencimiento</th><th>Cobertura</th><th>Comprobante</th><th></th></tr></thead>
            <tbody>
              <tr v-for="row in rows" :key="row.assetId">
                <td data-label="Activo"><a :href="'#/activo/'+row.assetId" class="asset-name">{{ assetLabel(row) }}</a><span class="cell-note mono">{{ row.assetId }}</span></td>
                <td data-label="Proveedor"><strong>{{ row.supplier || 'Sin especificar' }}</strong><span class="cell-note">{{ date(row.purchaseDate) }}</span></td>
                <td data-label="Vencimiento"><span class="mono">{{ date(row.expiresOn) }}</span><span class="cell-note" v-if="status(row).days !== null">{{ status(row).days < 0 ? 'Hace ' + Math.abs(status(row).days) + ' días' : status(row).days === 0 ? 'Vence hoy' : 'En ' + status(row).days + ' días' }}</span></td>
                <td data-label="Cobertura"><span :class="['status-pill','status--'+status(row).tone]">{{ status(row).label }}</span></td>
                <td data-label="Comprobante"><span class="cell-note">{{ receiptsLabel(row) }}</span></td>
                <td><button v-if="canEdit" class="text-button" type="button" @click="openEditor(row)" :aria-label="'Editar garantía de ' + assetLabel(row)">Editar</button><a v-else :href="'#/activo/'+row.assetId" class="text-button">Ver ficha</a></td>
              </tr>
              <tr v-if="!rows.length"><td colspan="6" class="doc-empty">{{ state.loaded ? 'No hay garantías con estos filtros.' : 'Sin garantías cargadas.' }}</td></tr>
            </tbody>
          </table>
        </div>
        <button v-if="state.hasMore" class="btn btn--secondary btn--small" type="button" :disabled="state.loading" @click="loadMore">Cargar más garantías</button>
        <p class="doc-help warranty-bottom-note">{{ loadedNote }} Cada garantía pertenece a un único activo; no hay garantías compartidas. El plazo de aviso lo fija la preferencia guardada en el servidor.</p>
        ${editorTemplate}
      </section>
    `
  };

  const WarrantySettings = {
    props: { app: Object },
    data() {
      return { days: '', busy: false, saved: false, error: '', message: '' };
    },
    computed: {
      state() {
        return this.app.phase6.warrantyPrefs;
      },
      canEdit() {
        return !!(this.app.authenticated && this.app.can && this.app.can('config.general'));
      },
      canView() {
        return !!(this.app.phase6CanView);
      },
      dayOptions() {
        const presets = [15, 30, 60, 90, 180];
        const current = Number(this.days);
        return current && presets.indexOf(current) === -1 ? presets.concat(current).sort((a, b) => a - b) : presets;
      },
      filterNote() {
        return 'Los filtros de sede, categoría y activos dados de baja solo se aplican en esta sesión; no se guardan en el servidor ni en el navegador.';
      }
    },
    created() {
      this.load();
    },
    methods: {
      async load() {
        this.saved = false;
        if (!this.canView) {
          this.error = 'No tienes permisos para consultar las preferencias de garantías.';
          return false;
        }
        const ok = await this.app.loadWarrantyPreferences();
        this.days = this.app.phase6.warrantyPrefs.expiringDays;
        this.error = ok ? '' : this.app.phase6.warrantyPrefs.error || '';
        return ok;
      },
      async save() {
        this.saved = false;
        const value = Number(this.days);
        if (!Number.isInteger(value) || value < 1 || value > 365) {
          this.error = 'Indica un número entero de días entre 1 y 365.';
          return false;
        }
        if (!this.canEdit) {
          this.error = 'No tienes permisos para guardar esta preferencia.';
          return false;
        }
        this.busy = true;
        const result = await this.app.saveWarrantyPreferences(value);
        this.busy = false;
        if (!result || !result.ok) {
          if (!(result && result.cancelled)) this.error = (result && result.error) || 'No se pudo guardar la preferencia.';
          return false;
        }
        this.days = this.app.phase6.warrantyPrefs.expiringDays;
        this.saved = true;
        this.error = '';
        this.message = 'Preferencia guardada en el servidor.';
        if (this.app.showToast) this.app.showToast('Preferencia de vencimiento guardada.');
        return true;
      }
    },
    template: `
      <section class="config-section doc-settings" data-od-id="warranty-settings">
        <header class="config-section-head"><p class="eyebrow">Cobertura individual</p><h2>Preferencias de garantías</h2><p>El servidor guarda únicamente el plazo de aviso; el resto de filtros son de vista.</p></header>
        <form class="warranty-settings-form" @submit.prevent="save">
          <label class="doc-field">Considerar próximas a vencer<select v-model.number="days" :disabled="!canEdit"><option v-for="option in dayOptions" :key="option" :value="option">En los próximos {{ option }} días</option></select><small class="doc-help">Entre 1 y 365 días. Es el único valor que se guarda en el servidor.</small></label>
          <div class="doc-form-grid">
            <label class="doc-field">Sede inicial<select v-model="app.warrantyPrefs.site"><option value="all">Todas</option><option v-for="s in app.sites" :key="s.id" :value="s.id">{{ s.label }}</option></select></label>
            <label class="doc-field">Categoría inicial<select v-model="app.warrantyPrefs.category"><option value="all">Todas</option><option v-for="c in app.categories" :key="c.id" :value="c.id">{{ c.label }}</option></select></label>
          </div>
          <label class="doc-inline"><input type="checkbox" v-model="app.warrantyPrefs.includeRetired">Incluir activos dados de baja</label>
          <p class="doc-help">{{ filterNote }}</p>
          <p class="doc-help">El estado se calcula en el servidor a partir del vencimiento individual. No se crean contratos ni garantías compartidas.</p>
          <p v-if="message" class="config-note" role="status">{{ message }}</p>
          <p v-if="error" class="doc-error" role="alert">{{ error }}</p>
          <button class="btn btn--primary" type="submit" :disabled="!canEdit || busy">{{ saved ? 'Preferencias guardadas' : 'Guardar preferencias' }}</button>
        </form>
      </section>
    `
  };

  window.AssetWarrantyViews = { WarrantyCenter, AssetWarrantyPanel, WarrantySettings, WarrantyEditor };
  for (const component of Object.values(window.AssetWarrantyViews)) component.components = Object.assign({ AppIcon: window.AppIcon, ModalShell: window.ModalShell }, component.components || {});
})();
