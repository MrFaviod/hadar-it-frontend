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
                <button type="button" class="icon-button modal__close" aria-label="Cerrar diálogo" @click="$emit('close')">
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
})();
