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

  function t(key, params) {
    const runtime = window.ItsmI18n;
    return runtime ? runtime.t(key, params) : key;
  }

  function localeRevision() {
    return window.ItsmI18n && window.ItsmI18n.version ? window.ItsmI18n.version.value : 0;
  }

  const STATUS_KEYS = {
    active: 'ui.warranty.status.active',
    cancelled: 'ui.warranty.status.cancelled',
    claimed: 'ui.warranty.status.claimed',
    unknown: 'ui.warranty.status.unknown'
  };
  const COVERAGE = {
    current: { key: 'ui.warranty.coverage.current', tone: 'ok' },
    expiring: { key: 'ui.warranty.coverage.expiring', tone: 'warn' },
    expired: { key: 'ui.warranty.coverage.expired', tone: 'down' },
    unknown: { key: 'ui.warranty.coverage.unknown', tone: 'hold' }
  };

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function formatDate(value) {
    const raw = text(value);
    return raw ? (window.ItsmI18n ? window.ItsmI18n.formatDate(raw) : raw) : t('ui.warranty.no_date');
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
    localeRevision();
    return t(STATUS_KEYS[text(value)] || STATUS_KEYS.unknown);
  }

  function coverageLabelOf(value) {
    localeRevision();
    return t(coverageOf(value).key);
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
    link.download = filename || t('ui.warranty.receipt_filename');
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
      t,
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
          this.error = t('ui.warranty.error_asset');
          return false;
        }
        const provider = text(draft.provider);
        if (!provider) {
          this.error = t('ui.warranty.error_provider');
          return false;
        }
        if (!E.validDate(draft.purchase)) {
          this.error = t('ui.warranty.error_purchase');
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
            this.error = t('ui.warranty.error_months');
            return false;
          }
          /* The server calculates and stores the expiry; sending a date too
           * would conflict with the registered duration. */
          values.durationMonths = months;
        } else {
          if (!E.validDate(draft.until)) {
            this.error = t('ui.warranty.error_until');
            return false;
          }
          if (draft.until < draft.purchase) {
            this.error = t('ui.warranty.error_before');
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
            this.error = (result && result.error) || t('ui.warranty.error_save');
            this.fieldErrors = (result && result.fieldErrors) || {};
          }
          return false;
        }
        this.editing = false;
        this.error = '';
        this.fieldErrors = {};
        this.message = t('ui.warranty.saved');
        if (this.app.showToast) this.app.showToast(t('ui.warranty.saved'));
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
          if (result && !result.cancelled) this.error = result.error || t('ui.warranty.error_upload');
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
          this.message = t('ui.warranty.download_ready');
          return true;
        }
        if (result && !result.cancelled) this.message = result.error || t('ui.warranty.error_download');
        return false;
      }
    }
  };

  /* The editor dialog keeps the original single-column form and its month-end
   * preview. The preview is local arithmetic; only the server value is stored. */
  const editorTemplate = `
    <modal-shell :open="editing" :title="t('ui.warranty.editor_title')" :eyebrow="warrantyAssetId" size="wide" @close="closeEditor">
      <form id="warranty-edit-form" data-od-id="warranty-edit-form" class="warranty-form" @submit.prevent="saveEditor()">
        <p>{{ t('ui.warranty.editor_scope', { name: warrantyAssetLabel }) }}</p>
        <label class="doc-field">{{ t('ui.warranty.editor_provider') }}<input v-model="draft.provider" required maxlength="160" :placeholder="t('ui.warranty.editor_provider_placeholder')"></label>
        <div class="doc-form-grid">
          <label class="doc-field">{{ t('ui.warranty.purchase') }}<input type="date" v-model="draft.purchase" required></label>
          <label class="doc-field">{{ t('ui.warranty.editor_mode') }}<select v-model="draft.mode"><option value="date">{{ t('ui.warranty.editor_mode_date') }}</option><option value="duration">{{ t('ui.warranty.editor_mode_duration') }}</option></select></label>
        </div>
        <label v-if="draft.mode === 'date'" class="doc-field">{{ t('ui.warranty.editor_until') }}<input type="date" v-model="draft.until" :min="draft.purchase" required></label>
        <div v-else class="doc-form-grid">
          <label class="doc-field">{{ t('ui.warranty.editor_months') }}<input type="number" v-model.number="draft.months" min="1" max="1200" required></label>
          <div class="warranty-calculated"><span>{{ t('ui.warranty.editor_calculated') }}</span><strong>{{ previewExpiry(draft) || t('ui.warranty.editor_pick_purchase') }}</strong></div>
        </div>
        <label class="doc-field">{{ t('ui.warranty.editor_status') }}<select v-model="draft.status"><option value="active">{{ t('ui.warranty.status.active') }}</option><option value="claimed">{{ t('ui.warranty.status.claimed') }}</option><option value="cancelled">{{ t('ui.warranty.status.cancelled') }}</option><option value="unknown">{{ t('ui.warranty.status.unknown') }}</option></select></label>
        <label class="doc-field">{{ t('ui.warranty.editor_note') }}<textarea v-model="draft.note" maxlength="2000" :placeholder="t('ui.warranty.note_placeholder')"></textarea></label>
        <div class="warranty-receipts">
          <div class="doc-section-label"><strong>{{ t('ui.warranty.editor_receipt') }}</strong><label class="btn btn--secondary btn--small warranty-upload">{{ t('ui.warranty.editor_add_file') }}<input type="file" accept=".pdf,image/*" :disabled="receiptBusy" @change="uploadReceipt"></label></div>
          <p class="doc-help">{{ t('ui.warranty.editor_receipt_note') }}</p>
          <div v-if="receipt()" class="warranty-receipt"><app-icon name="file-text"></app-icon><span>{{ receipt().filename }}<small>{{ formatSize(receipt().size) }}</small></span><button class="icon-button" type="button" :aria-label="t('ui.warranty.editor_unlink_aria', { name: receipt().filename })" @click="unlinkReceipt">×</button></div>
          <p v-else class="doc-help">{{ t('ui.warranty.editor_no_receipt') }}</p>
          <p class="doc-help">{{ t('ui.warranty.editor_unlink_note') }}</p>
        </div>
        <p v-if="error" class="doc-error" role="alert">{{ error }}</p>
      </form>
      <template #footer><button class="btn btn--secondary" type="button" @click="closeEditor">{{ t('ui.common.cancel') }}</button><button class="btn btn--primary" type="submit" form="warranty-edit-form" :disabled="busy">{{ t('ui.warranty.editor_save') }}</button></template>
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
          label: coverageLabelOf(this.item && this.item.coverage),
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
      },
      stateDaysLabel() {
        localeRevision();
        const days = this.state.days;
        if (days === null || days === undefined) return '';
        if (days < 0) return t('ui.warranty.days_since', { count: Math.abs(days) });
        if (days === 0) return t('ui.warranty.expires_today');
        return t('ui.warranty.days_covered', { count: days });
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
      t,
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
          <div><p class="eyebrow">{{ t('ui.warranty.eyebrow') }}</p><h2>{{ t('ui.warranty.panel_title') }}</h2></div>
          <button v-if="canEdit" class="btn btn--secondary btn--small" type="button" @click="startEdit">{{ t('ui.warranty.edit') }}</button>
        </header>
        <p v-if="loading" class="config-note" role="status">{{ t('ui.warranty.loading') }}</p>
        <p v-else-if="detailError" class="field__error" role="alert">{{ detailError }}</p>
        <p v-if="!server" class="config-note">{{ t('ui.warranty.demo_note') }}</p>
        <div class="warranty-asset-body">
          <div class="warranty-status-card">
            <span :class="['status-pill','status--'+state.tone]">{{ state.label }}</span>
            <strong v-if="state.days !== null">{{ stateDaysLabel }}</strong>
            <p v-if="server && expiringDays">{{ t('ui.warranty.expiring_notice', { count: expiringDays }) }}.</p>
            <p v-else-if="server">{{ t('ui.warranty.calculated') }}</p>
          </div>
          <dl class="doc-facts">
            <div><dt>{{ t('ui.warranty.provider') }}</dt><dd>{{ w.provider || t('ui.warranty.unspecified') }}</dd></div>
            <div><dt>{{ t('ui.warranty.purchase') }}</dt><dd>{{ date(w.purchase) }}</dd></div>
            <div><dt>{{ t('ui.warranty.until') }}</dt><dd>{{ date(w.until) }}</dd></div>
            <div><dt>{{ t('ui.warranty.duration') }}</dt><dd>{{ w.months ? t('ui.warranty.months', { count: w.months }) : t('ui.warranty.by_expiry') }}</dd></div>
            <div v-if="w.status"><dt>{{ t('ui.warranty.registered_status') }}</dt><dd>{{ statusLabel(w.status) }}</dd></div>
          </dl>
        </div>
        <p v-if="server && loaded && !item" class="config-note">{{ t('ui.warranty.none_registered') }}</p>
        <p v-if="w.note" class="warranty-note">{{ w.note }}</p>
        <div class="warranty-asset-receipts">
          <span class="doc-help">{{ t('ui.warranty.receipt_count', { count: w.receiptId ? 1 : 0 }) }}</span>
          <button v-if="receipt()" class="btn btn--ghost btn--small" type="button" @click="downloadReceipt"><app-icon name="file-text"></app-icon>{{ receipt().filename }}</button>
          <p v-if="server && !w.receiptId" class="doc-help">{{ t('ui.warranty.receipt_none_linked') }}</p>
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
        localeRevision();
        const days = this.app.phase6.warrantyPrefs.expiringDays;
        return [
          { id: '', cov: '', label: t('ui.warranty.metric_all'), description: t('ui.warranty.metric_all_note') },
          { id: 'current', cov: 'current', label: t('ui.warranty.metric_current'), description: t('ui.warranty.metric_current_note') },
          { id: 'expiring', cov: 'expiring', label: t('ui.warranty.metric_expiring'), description: t('ui.warranty.metric_expiring_note', { count: days }) },
          { id: 'expired', cov: 'expired', label: t('ui.warranty.metric_expired'), description: t('ui.warranty.metric_expired_note') }
        ];
      },
      loadedNote() {
        return t('ui.warranty.loaded_note', { count: this.counts.all });
      }
    },
    created() {
      if (this.app.phase6CanView) this.reload();
    },
    methods: {
      t,
      date: formatDate,
      coverageLabel(value) {
        return coverageLabelOf(value);
      },
      status(row) {
        const cover = coverageOf(row && row.coverage);
        return { key: text(row && row.coverage) || 'unknown', label: coverageLabelOf(row && row.coverage), tone: cover.tone, days: daysLeft(row && row.expiresOn) };
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
      daysLabel(row) {
        localeRevision();
        const days = this.status(row).days;
        if (days === null || days === undefined) return '';
        if (days < 0) return t('ui.warranty.days_ago', { count: Math.abs(days) });
        if (days === 0) return t('ui.warranty.expires_today');
        return t('ui.warranty.in_days', { count: days });
      },
      receiptsLabel(row) {
        // Reuse the existing short label: the catalog already declares this state once.
        return row && text(row.receiptId) ? t('ui.warranty.receipt_linked') : t('ui.warranty.receipt_missing');
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
          <div><p class="eyebrow">{{ t('ui.warranty.lifecycle') }}</p><h1>{{ t('ui.warranty.center_title') }}</h1></div>
          <div class="doc-inline"><a class="btn btn--secondary" href="#/configuracion/garantias"><app-icon name="sliders"></app-icon>{{ t('ui.warranty.preferences') }}</a><button class="btn btn--primary" type="button" disabled aria-describedby="warranty-report-note">{{ t('ui.warranty.report') }}</button></div>
        </header>
        <p id="warranty-report-note" class="doc-help">{{ t('ui.warranty.report_note') }}</p>
        <div class="warranty-metrics">
          <button v-for="m in metrics" :key="m.id" type="button" :class="['warranty-metric',{'is-active':filter===m.cov}]" :aria-pressed="filter===m.cov" @click="setCoverage(m.cov)"><span>{{ m.label }}</span><strong class="mono">{{ counts[m.cov || 'all'] }}</strong><small>{{ m.description }}</small></button>
        </div>
        <div class="warranty-results">
        <div class="warranty-filters">
        <div class="warranty-toolbar">
          <label class="doc-field"><span class="sr-only">{{ t('ui.warranty.search_aria') }}</span><input type="search" v-model="search" :placeholder="t('ui.warranty.search_placeholder')"></label>
          <label class="doc-field"><span class="sr-only">{{ t('ui.transfer.dialog.site') }}</span><select v-model="site"><option value="all">{{ t('ui.warranty.all_sites') }}</option><option v-for="s in app.sites" :key="s.id" :value="s.id">{{ s.label }}</option></select></label>
          <label class="doc-field"><span class="sr-only">{{ t('ui.asset.common.category') }}</span><select v-model="category"><option value="all">{{ t('ui.warranty.all_categories') }}</option><option v-for="c in app.categories" :key="c.id" :value="c.id">{{ c.label }}</option></select></label>
          <label class="doc-field"><span class="sr-only">{{ t('ui.warranty.provider') }}</span><select v-model="provider"><option value="all">{{ t('ui.warranty.all_providers') }}</option><option v-for="p in providers" :key="p" :value="p">{{ p }}</option></select></label>
        </div>
        <p class="doc-help">{{ t('ui.warranty.filters_note') }}</p>
        </div>
        <div class="results-bar"><p>{{ t('ui.warranty.results', { shown: rows.length, total: counts.all }) }}</p><button class="text-button" type="button" :aria-pressed="filter==='unknown'" @click="setCoverage(filter==='unknown'?'':'unknown')">{{ t('ui.warranty.coverage.unknown') }} <span class="mono">{{ counts.unknown }}</span></button></div>
        <p v-if="state.loading" class="config-note" role="status">{{ t('ui.warranty.loading_list') }}</p>
        <p v-else-if="state.error" class="field__error" role="alert">{{ state.error }}</p>
        <div class="table-panel">
          <table class="asset-table warranty-table">
            <thead><tr><th>{{ t('ui.warranty.col_asset') }}</th><th>{{ t('ui.warranty.col_provider') }}</th><th>{{ t('ui.warranty.col_expiry') }}</th><th>{{ t('ui.warranty.col_coverage') }}</th><th>{{ t('ui.warranty.col_receipt') }}</th><th></th></tr></thead>
            <tbody>
              <tr v-for="row in rows" :key="row.assetId">
                <td :data-label="t('ui.warranty.col_asset')"><a :href="'#/activo/'+row.assetId" class="asset-name">{{ assetLabel(row) }}</a><span class="cell-note mono">{{ row.assetId }}</span></td>
                <td :data-label="t('ui.warranty.col_provider')"><strong>{{ row.supplier || t('ui.warranty.unspecified') }}</strong><span class="cell-note">{{ date(row.purchaseDate) }}</span></td>
                <td :data-label="t('ui.warranty.col_expiry')"><span class="mono">{{ date(row.expiresOn) }}</span><span class="cell-note" v-if="status(row).days !== null">{{ daysLabel(row) }}</span></td>
                <td :data-label="t('ui.warranty.col_coverage')"><span :class="['status-pill','status--'+status(row).tone]">{{ status(row).label }}</span></td>
                <td :data-label="t('ui.warranty.col_receipt')"><span class="cell-note">{{ receiptsLabel(row) }}</span></td>
                <td><button v-if="canEdit" class="text-button" type="button" @click="openEditor(row)" :aria-label="t('ui.warranty.edit_aria', { name: assetLabel(row) })">{{ t('ui.warranty.edit_short') }}</button><a v-else :href="'#/activo/'+row.assetId" class="text-button">{{ t('ui.warranty.view_record') }}</a></td>
              </tr>
              <tr v-if="!rows.length"><td colspan="6" class="doc-empty">{{ state.loaded ? t('ui.warranty.empty_filtered') : t('ui.warranty.empty_loaded') }}</td></tr>
            </tbody>
          </table>
        </div>
        <button v-if="state.hasMore" class="btn btn--secondary btn--small" type="button" :disabled="state.loading" @click="loadMore">{{ t('ui.warranty.load_more') }}</button>
        <p class="doc-help warranty-bottom-note">{{ loadedNote }} {{ t('ui.warranty.bottom_note') }}</p>
        </div>
        ${editorTemplate}
      </section>
    `
  };

  const WarrantySettings = {
    props: { app: Object },
    data() {
      return { days: '', busy: false, saved: false, error: '', message: '', loading: true, dirty: false, owned: true };
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
        localeRevision();
        return t('ui.warranty.settings_filter_note');
      }
    },
    created() {
      this.load();
    },
    beforeUnmount() { this.owned = false; },
    methods: {
      t,
      ownerToken() { return String(this.app.currentUser && this.app.currentUser.id || '') + ':' + String(this.app.sessionEpoch || 0); },
      async load() {
        const owner = this.ownerToken();
        this.loading = true;
        this.saved = false;
        if (this.state.loaded && !this.dirty) this.days = this.state.expiringDays;
        if (!this.canView) {
          this.error = t('ui.warranty.error_settings_view');
          this.loading = false;
          return false;
        }
        const ok = await this.app.loadWarrantyPreferences();
        if (!this.owned || owner !== this.ownerToken()) return false;
        this.loading = false;
        this.error = ok || this.state.loaded ? '' : this.state.error || t('ui.warranty.error_settings');
        if (ok && !this.dirty) this.days = this.state.expiringDays;
        return ok;
      },
      async save() {
        if (!this.owned || this.loading || !this.state.loaded || this.busy) return false;
        this.saved = false;
        const value = Number(this.days);
        if (!Number.isInteger(value) || value < 1 || value > 365) {
          this.error = t('ui.warranty.error_settings_days');
          return false;
        }
        if (!this.canEdit) {
          this.error = t('ui.warranty.error_settings_save');
          return false;
        }
        this.busy = true;
        const result = await this.app.saveWarrantyPreferences(value);
        this.busy = false;
        if (!result || !result.ok) {
          if (!(result && result.cancelled)) this.error = (result && result.error) || t('ui.warranty.error_settings');
          return false;
        }
        this.days = this.app.phase6.warrantyPrefs.expiringDays;
        this.saved = true;
        this.error = '';
        this.dirty = false;
        this.message = t('ui.warranty.settings_stored');
        if (this.app.showToast) this.app.showToast(t('ui.warranty.settings_toast'));
        return true;
      }
    },
    template: `
      <section class="config-section doc-settings" data-od-id="warranty-settings">
        <header class="config-section-head"><p class="eyebrow">{{ t('ui.warranty.eyebrow') }}</p><h2>{{ t('ui.warranty.settings_title') }}</h2><p>{{ t('ui.warranty.settings_lead') }}</p></header>
        <form class="warranty-settings-form" @submit.prevent="save" @input="dirty=true;saved=false" @change="dirty=true;saved=false">
          <label class="doc-field">{{ t('ui.warranty.settings_window') }}<select v-model.number="days" :disabled="!canEdit"><option v-for="option in dayOptions" :key="option" :value="option">{{ t('ui.warranty.settings_window_option', { count: option }) }}</option></select><small class="doc-help">{{ t('ui.warranty.settings_window_hint') }}</small></label>
          <div class="doc-form-grid">
            <label class="doc-field">{{ t('ui.warranty.settings_site') }}<select v-model="app.warrantyPrefs.site"><option value="all">{{ t('ui.warranty.settings_all') }}</option><option v-for="s in app.sites" :key="s.id" :value="s.id">{{ s.label }}</option></select></label>
            <label class="doc-field">{{ t('ui.warranty.settings_category') }}<select v-model="app.warrantyPrefs.category"><option value="all">{{ t('ui.warranty.settings_all') }}</option><option v-for="c in app.categories" :key="c.id" :value="c.id">{{ c.label }}</option></select></label>
          </div>
          <label class="doc-inline"><input type="checkbox" v-model="app.warrantyPrefs.includeRetired">{{ t('ui.warranty.settings_retired') }}</label>
          <p class="doc-help">{{ filterNote }}</p>
          <p class="doc-help">{{ t('ui.warranty.settings_server_note') }}</p>
          <p v-if="message" class="config-note" role="status">{{ message }}</p>
          <p v-if="error" class="doc-error" role="alert">{{ error }}</p>
          <button class="btn btn--primary" type="submit" :disabled="!canEdit || busy || loading || !state.loaded">{{ saved ? t('ui.warranty.settings_saved') : t('ui.warranty.settings_save') }}</button>
        </form>
      </section>
    `
  };

  window.AssetWarrantyViews = { WarrantyCenter, AssetWarrantyPanel, WarrantySettings, WarrantyEditor };
  for (const component of Object.values(window.AssetWarrantyViews)) component.components = Object.assign({ AppIcon: window.AppIcon, ModalShell: window.ModalShell }, component.components || {});
})();
