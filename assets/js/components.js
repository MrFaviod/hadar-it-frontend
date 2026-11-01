(function () {
  'use strict';

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
        previousOverflow: ''
      };
    },
    watch: {
      open(value) {
        if (value) {
          this.activate();
        } else {
          this.deactivate();
        }
      }
    },
    mounted() {
      document.addEventListener('keydown', this.onKeydown);
    },
    beforeUnmount() {
      document.removeEventListener('keydown', this.onKeydown);
      if (this.open) this.deactivate();
    },
    methods: {
      activate() {
        this.lastFocused = document.activeElement;
        this.previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        this.$nextTick(() => {
          if (this.$refs.dialog) this.$refs.dialog.focus();
        });
      },
      deactivate() {
        document.body.style.overflow = this.previousOverflow;
        if (this.lastFocused && typeof this.lastFocused.focus === 'function') {
          this.lastFocused.focus();
        }
        this.lastFocused = null;
      },
      onKeydown(event) {
        if (!this.open) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          this.$emit('close');
          return;
        }
        if (event.key !== 'Tab' || !this.$refs.dialog) return;
        const focusables = Array.from(this.$refs.dialog.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter((element) => element.offsetParent !== null);
        if (!focusables.length) {
          event.preventDefault();
          this.$refs.dialog.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === this.$refs.dialog)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    },
    template: `
      <teleport to="body">
        <transition name="modal">
          <div v-if="open" class="modal-layer" @mousedown.self="$emit('close')">
            <div ref="dialog" class="modal" :class="{ 'modal--wide': size === 'wide', 'modal--xl': size === 'xl' }" role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1">
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
            </div>
          </div>
        </transition>
      </teleport>
    `
  };

  let fieldSequence = 0;

  function displayValue(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
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
      empty: { type: String, default: 'Sin datos.' },
      loading: { type: Boolean, default: false },
      rowKey: { type: [String, Function], default: 'id' }
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
      <div class="table-panel itsm-table" role="region" :aria-label="caption || 'Tabla de la extensión'" :aria-busy="loading ? 'true' : 'false'" tabindex="0">
        <table class="asset-table">
          <caption class="sr-only">{{ caption || 'Datos de la extensión' }}</caption>
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
              <tr><td :colspan="Math.max(columns.length, 1)" class="itsm-table__empty">{{ empty }}</td></tr>
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
      title: { type: String, default: 'No se pudo completar la acción' },
      retry: { type: Boolean, default: false },
      retryLabel: { type: String, default: 'Reintentar' }
    },
    emits: ['retry'],
    template: `
      <div v-if="error" class="form-alert itsm-error" role="alert" tabindex="-1">
        <app-icon name="alert"></app-icon>
        <div>
          <strong>{{ title }}</strong>
          <p>{{ error }}</p>
          <slot></slot>
          <button v-if="retry" type="button" class="btn btn--secondary btn--small" @click="$emit('retry')">{{ retryLabel }}</button>
        </div>
      </div>
    `
  };
})();
