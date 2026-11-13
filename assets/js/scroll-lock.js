(function () {
  'use strict';

  // One body-scroll lock shared by every native dialog surface (ModalShell and
  // SearchPalette). The first acquirer saves the original inline overflow and
  // the last releaser restores it exactly once, so any teardown order leaves
  // the body as it was found while at least one dialog stays open.
  let locks = 0;
  let saved = '';

  function acquire() {
    if (typeof document === 'undefined' || !document.body) return;
    if (locks === 0) {
      saved = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    locks += 1;
  }

  function release() {
    if (locks === 0) return;
    locks -= 1;
    if (locks === 0) {
      document.body.style.overflow = saved;
      saved = '';
    }
  }

  window.AssetScrollLock = {
    acquire,
    release,
    get locks() { return locks; }
  };
})();
