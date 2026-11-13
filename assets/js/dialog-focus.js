(function () {
  'use strict';

  // Shared focus lineage for every native dialog surface (ModalShell and
  // SearchPalette). Each open dialog pushes one frame holding the element that
  // was focused before it opened plus the lineage inherited from the dialogs
  // below it. When an intermediate owner disappears, its frame is dropped but
  // the inherited lineage keeps the original outside invoker, so the final
  // close can still return to it. Closing a lower dialog never moves focus:
  // the upper dialog owns the focus while it stays open.
  var frames = [];

  function usable(target) {
    if (!target || target === document.body || typeof target.focus !== 'function') return false;
    if (typeof target.isConnected === 'boolean' && !target.isConnected) return false;
    if (document.contains && !document.contains(target)) return false;
    if (typeof target.closest === 'function') {
      if (target.closest('[inert]')) return false;
      var dialog = target.closest('dialog');
      if (dialog && !dialog.open) return false;
    }
    if (target.hidden) return false;
    if (typeof target.getClientRects === 'function' && target.getClientRects().length === 0) return false;
    return true;
  }

  function activate(owner) {
    if (!owner) return;
    for (var i = 0; i < frames.length; i += 1) {
      if (frames[i].owner === owner) return;
    }
    var below = frames.length ? frames[frames.length - 1] : null;
    var lineage = [];
    var current = document.activeElement;
    if (current && current !== document.body) lineage.push(current);
    if (below) {
      for (var j = 0; j < below.lineage.length; j += 1) lineage.push(below.lineage[j]);
    }
    frames.push({ owner: owner, lineage: lineage });
  }

  function deactivate(owner) {
    var index = -1;
    for (var i = 0; i < frames.length; i += 1) {
      if (frames[i].owner === owner) { index = i; break; }
    }
    if (index === -1) return null;
    var frame = frames[index];
    var top = index === frames.length - 1;
    frames.splice(index, 1);
    // A lower dialog closes underneath an open upper one: never steal focus.
    if (!top) return null;
    var candidates = frame.lineage.slice();
    for (var k = frames.length - 1; k >= 0; k -= 1) {
      for (var m = 0; m < frames[k].lineage.length; m += 1) candidates.push(frames[k].lineage[m]);
    }
    for (var c = 0; c < candidates.length; c += 1) {
      if (usable(candidates[c])) {
        candidates[c].focus();
        return candidates[c];
      }
    }
    // Documented fallback when every remembered invoker is gone, detached,
    // hidden or inside a closed/inert dialog: leave focus where the browser's
    // native close put it. Forcing <body> or a dead node would be worse.
    return null;
  }

  window.AssetDialogFocus = {
    activate: activate,
    deactivate: deactivate,
    usable: usable,
    get size() { return frames.length; }
  };
})();
