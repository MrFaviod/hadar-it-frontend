(function () {
  'use strict';

  // Copy for the shared components comes from the catalog. Reading the tracked
  // `version` ref inside a render or computed keeps a hot locale switch reactive.
  function tr(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime && typeof runtime.t === 'function' ? runtime.t(key, params) : '';
  }

  function trackLocale() {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    if (runtime && runtime.version) runtime.version.value;
  }

  let modalSequence = 0;

  window.ModalShell = {
    name: 'ModalShell',
    components: {
      AppIcon: window.AppIcon
    },
    props: {
      open: { type: Boolean, default: false },
      title: { type: String, required: true },
      eyebrow: { type: String, default: '' },
      size: { type: String, default: 'normal' }
    },
    emits: ['close'],
    data() {
      modalSequence += 1;
      return {
        titleId: 'modal-title-' + modalSequence,
        lastFocused: null,
        previousOverflow: '',
        scrollLocked: false,
        active: false
      };
    },
    watch: {
      open(value) {
        if (value === this.active) return;
        if (value) {
          this.activate();
        } else {
          this.deactivate();
        }
      }
    },
    mounted() {
      if (this.open) this.activate();
    },
    beforeUnmount() {
      if (this.active) this.deactivate();
    },
    methods: {
      activate() {
        if (this.active) return;
        const dialog = this.$refs.dialog;
        if (!dialog) return;
        this.active = true;
        this.lastFocused = document.activeElement;
        if (window.AssetDialogFocus) window.AssetDialogFocus.activate(this);
        // Shared with SearchPalette: the first open dialog saves the body
        // overflow and the last close restores it, in any teardown order.
        this.scrollLocked = true;
        if (window.AssetScrollLock) window.AssetScrollLock.acquire();
        else {
          this.previousOverflow = document.body.style.overflow;
          document.body.style.overflow = 'hidden';
        }
        if (!dialog.open) {
          if (typeof dialog.showModal === 'function') {
            try {
              dialog.showModal();
            } catch (error) {
              dialog.setAttribute('open', '');
            }
          } else {
            dialog.setAttribute('open', '');
          }
        }
        this.$nextTick(() => this.focusInitial());
      },
      deactivate() {
        if (!this.active) return;
        this.active = false;
        const dialog = this.$refs.dialog;
        if (dialog && dialog.open) {
          if (typeof dialog.close === 'function') {
            try {
              dialog.close();
            } catch (error) {
              dialog.removeAttribute('open');
            }
          } else {
            dialog.removeAttribute('open');
          }
        }
        if (this.scrollLocked) {
          if (window.AssetScrollLock) window.AssetScrollLock.release();
          else document.body.style.overflow = this.previousOverflow;
        }
        this.scrollLocked = false;
        this.previousOverflow = '';
        const shared = window.AssetDialogFocus;
        if (shared) {
          // The shared lineage focuses the invoker for the top dialog and does
          // nothing when a lower dialog closes under an open one.
          const restore = shared.deactivate(this);
          this.lastFocused = null;
          if (!restore) this.blurClosedFocus(dialog);
          return;
        }
        const target = this.lastFocused;
        this.lastFocused = null;
        if (target && target !== document.body && document.contains(target) && typeof target.focus === 'function') {
          target.focus();
        }
      },
      blurClosedFocus(dialog) {
        // Documented fallback when no remembered invoker survives: drop focus
        // from the control inside the dialog that just closed instead of
        // leaving it on a hidden surface or calling focus() on <body>.
        const active = document.activeElement;
        if (active && dialog && typeof dialog.contains === 'function' && dialog.contains(active) && typeof active.blur === 'function') active.blur();
      },
      focusInitial() {
        const dialog = this.$refs.dialog;
        if (!dialog) return;
        const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const body = dialog.querySelector('.modal__body');
        const first = (body && body.querySelector(selector)) || dialog.querySelector(selector);
        if (first && typeof first.focus === 'function') first.focus();
        else dialog.focus();
      },
      onCancel(event) {
        event.preventDefault();
        this.$emit('close');
      },
      onEscape(event) {
        // Handle Escape on keydown and cancel the browser close request, so a
        // nested dialog underneath is not closed by the same key press.
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) this.$emit('close');
      },
      onBackdrop(event) {
        const dialog = this.$refs.dialog;
        if (!dialog || event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
          if (typeof event.preventDefault === 'function') event.preventDefault();
          this.$emit('close');
        }
      }
    },
    template: `
      <teleport to="body">
        <dialog ref="dialog" class="modal" :class="{ 'modal--wide': size === 'wide', 'modal--xl': size === 'xl' }" role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1" @cancel="onCancel" @keydown.esc="onEscape" @mousedown="onBackdrop">
          <header class="modal__head">
            <div>
              <p v-if="eyebrow" class="eyebrow"><span class="eyebrow__line"></span> {{ eyebrow }}</p>
              <h2 :id="titleId">{{ title }}</h2>
            </div>
            <button type="button" class="icon-button modal__close" :aria-label="$t('ui.shell.close_dialog')" @click="$emit('close')">
              <app-icon name="close"></app-icon>
            </button>
          </header>
          <div class="modal__body"><slot></slot></div>
          <footer v-if="$slots.footer" class="modal__foot"><slot name="footer"></slot></footer>
        </dialog>
      </teleport>
    `
  };

  let fieldSequence = 0;

  function displayValue(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? tr('ui.asset.editor.yes') : tr('ui.asset.editor.no');
    if (Array.isArray(value)) return value.map(displayValue).join(', ');
    if (typeof value === 'object') {
      try {
        const json = JSON.stringify(value);
        return json.length > 180 ? json.slice(0, 177) + '…' : json;
      } catch (_) {
        return '—';
      }
    }
    return String(value);
  }

  window.ItsmTable = {
    name: 'ItsmTable',
    props: {
      columns: { type: Array, default: () => [] },
      rows: { type: Array, default: () => [] },
      caption: { type: String, default: '' },
      empty: { type: String, default: '' },
      loading: { type: Boolean, default: false },
      rowKey: { type: [String, Function], default: 'id' }
    },
    computed: {
      emptyLabel() {
        trackLocale();
        return this.empty || tr('ui.common.no_data');
      },
      captionLabel() {
        trackLocale();
        return this.caption || tr('ui.extensions.frame.caption_fallback');
      },
      tableLabel() {
        trackLocale();
        return this.caption || tr('ui.extensions.frame.table_aria');
      }
    },
    methods: {
      rowKeyFor(row, index) {
        if (typeof this.rowKey === 'function') {
          try {
            const key = this.rowKey(row, index);
            return key === null || key === undefined || key === '' ? index : key;
          } catch (_) {
            return index;
          }
        }
        const value = row && this.rowKey ? row[this.rowKey] : null;
        return value === null || value === undefined || value === '' ? index : value;
      },
      cell(row, column) {
        trackLocale();
        if (!column) return '—';
        let value;
        try {
          value = column.field ? row && row[column.field] : (column.valueKey ? row && row[column.valueKey] : '');
          if (typeof column.formatter === 'function') value = column.formatter(value, row);
        } catch (_) {
          return '—';
        }
        return displayValue(value);
      }
    },
    template: `
      <div class="table-panel itsm-table" role="region" :aria-label="tableLabel" :aria-busy="loading ? 'true' : 'false'" tabindex="0">
        <table class="asset-table">
          <caption class="sr-only">{{ captionLabel }}</caption>
          <thead>
            <tr>
              <th v-for="(column, index) in columns" :key="column.key || column.field || index" scope="col">{{ column.label || column.field || '' }}</th>
            </tr>
          </thead>
          <tbody>
            <template v-if="loading">
              <tr><td :colspan="Math.max(columns.length, 1)" class="itsm-table__empty" role="status">{{ $t('ui.shell.loading_data') }}</td></tr>
            </template>
            <template v-else-if="!rows.length">
              <tr><td :colspan="Math.max(columns.length, 1)" class="itsm-table__empty">{{ emptyLabel }}</td></tr>
            </template>
            <template v-else>
              <tr v-for="(row, index) in rows" :key="rowKeyFor(row, index)" class="asset-row">
                <td v-for="(column, columnIndex) in columns" :key="column.key || column.field || columnIndex" :class="{ mono: column.mono }">{{ cell(row, column) }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    `
  };

  window.ItsmField = {
    name: 'ItsmField',
    props: {
      id: { type: String, default: '' },
      label: { type: String, required: true },
      modelValue: { type: [String, Number], default: '' },
      type: { type: String, default: 'text' },
      hint: { type: String, default: '' },
      error: { type: String, default: '' },
      placeholder: { type: String, default: '' },
      autocomplete: { type: String, default: 'off' },
      required: { type: Boolean, default: false },
      disabled: { type: Boolean, default: false },
      multiline: { type: Boolean, default: false },
      rows: { type: Number, default: 3 }
    },
    emits: ['update:modelValue', 'blur'],
    data() {
      fieldSequence += 1;
      return { generatedId: 'itsm-field-' + fieldSequence };
    },
    computed: {
      controlId() { return this.id || this.generatedId; },
      safeType() {
        return ['text', 'email', 'password', 'number', 'search', 'tel', 'url', 'date'].indexOf(this.type) !== -1 ? this.type : 'text';
      },
      describedBy() {
        if (this.error) return this.controlId + '-error';
        return this.hint ? this.controlId + '-hint' : null;
      }
    },
    methods: {
      onInput(event) { this.$emit('update:modelValue', event.target.value); }
    },
    template: `
      <div class="field itsm-field" :class="{ 'field--invalid': !!error }">
        <label :for="controlId">{{ label }}<span v-if="required" class="itsm-field__required" aria-hidden="true"> *</span></label>
        <div class="input-shell">
          <textarea v-if="multiline" :id="controlId" :value="modelValue" :rows="rows" :placeholder="placeholder" :required="required" :disabled="disabled"
                    :aria-invalid="error ? 'true' : null" :aria-describedby="describedBy" @input="onInput" @blur="$emit('blur', $event)"></textarea>
          <input v-else :id="controlId" :type="safeType" :value="modelValue" :placeholder="placeholder" :autocomplete="autocomplete"
                 :required="required" :disabled="disabled" :aria-invalid="error ? 'true' : null" :aria-describedby="describedBy"
                 @input="onInput" @blur="$emit('blur', $event)">
        </div>
        <p v-if="error" :id="controlId + '-error'" class="field__error" role="alert">{{ error }}</p>
        <p v-else-if="hint" :id="controlId + '-hint'" class="field__hint">{{ hint }}</p>
      </div>
    `
  };

  window.ItsmStatus = {
    name: 'ItsmStatus',
    props: {
      tone: { type: String, default: 'hold' },
      label: { type: String, default: '—' }
    },
    computed: {
      safeTone() {
        return ['ok', 'hold', 'warn', 'down'].indexOf(this.tone) !== -1 ? this.tone : 'hold';
      }
    },
    template: `
      <span class="status-pill itsm-status" :class="'status--' + safeTone"><span class="itsm-status__dot" aria-hidden="true"></span>{{ label }}</span>
    `
  };

  window.ItsmError = {
    name: 'ItsmError',
    props: {
      error: { type: String, default: '' },
      title: { type: String, default: '' },
      retry: { type: Boolean, default: false },
      retryLabel: { type: String, default: '' }
    },
    emits: ['retry'],
    computed: {
      titleLabel() {
        trackLocale();
        return this.title || tr('ui.common.action_failed');
      },
      retryText() {
        trackLocale();
        return this.retryLabel || tr('ui.common.retry');
      }
    },
    template: `
      <div v-if="error" class="form-alert itsm-error" role="alert" tabindex="-1">
        <app-icon name="alert"></app-icon>
        <div>
          <strong>{{ titleLabel }}</strong>
          <p>{{ error }}</p>
          <slot></slot>
          <button v-if="retry" type="button" class="btn btn--secondary btn--small" @click="$emit('retry')">{{ retryText }}</button>
        </div>
      </div>
    `
  };
})();
