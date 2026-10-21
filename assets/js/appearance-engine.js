(function () {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const GENERIC = {
    id: 'generic', name: 'Asset Manager', version: 1, description: 'Identidad original · Siempre disponible',
    branding: { appName: 'Asset Manager', organizationName: 'Operaciones TI', logo: 'assets/svg/logo.svg', logoDark: '', logoCompact: '', favicon: 'assets/svg/logo.svg' },
    colors: { light: { primary: '#0b2331', secondary: '#0d766e', accent: '#a65c13' }, dark: { primary: '#071923', secondary: '#62d4c7', accent: '#f6bf67' } },
    preferences: { defaultMode: 'system', compact: false }
  };
  function createState(general) {
    const generic = clone(GENERIC), active = clone(generic);
    if (general) Object.assign(active.branding, general);
    const blue = clone(generic), forest = clone(generic);
    Object.assign(blue, { id: 'blue', name: 'Azul mineral', description: 'Azul profundo y superficies neutras' });
    blue.colors = { light: { primary: '#10283f', secondary: '#2357a1', accent: '#925113' }, dark: { primary: '#0a1d30', secondary: '#95bbf6', accent: '#f4c778' } };
    Object.assign(forest, { id: 'forest', name: 'Verde bosque', description: 'Verde sobrio y contraste natural' });
    forest.colors = { light: { primary: '#17372c', secondary: '#30684b', accent: '#935026' }, dark: { primary: '#10251d', secondary: '#9dd6b5', accent: '#efbb91' } };
    return { presets: [generic, blue, forest], active, previous: null, userModes: {} };
  }
  function validate(preset) {
    if (!preset || preset.version !== 1) throw new Error('Versión de preset incompatible.');
    if (!String(preset.name || '').trim() || !String(preset.branding?.appName || '').trim() || !String(preset.branding?.organizationName || '').trim()) throw new Error('Completa el nombre del preset, la aplicación y la organización.');
    for (const mode of ['light', 'dark']) for (const key of ['primary', 'secondary', 'accent']) {
      if (!/^#[\da-f]{6}$/i.test(preset.colors?.[mode]?.[key] || '')) throw new Error('El color ' + key + ' del modo ' + (mode === 'light' ? 'claro' : 'oscuro') + ' no es válido. Usa seis dígitos hexadecimales.');
    }
    if (!preset.preferences || !['light', 'dark', 'system'].includes(preset.preferences.defaultMode) || typeof preset.preferences.compact !== 'boolean') throw new Error('El preset está incompleto: faltan preferencias válidas de apariencia.');
    for (const key of ['logo', 'logoDark', 'logoCompact', 'favicon']) if (preset.branding[key] != null && typeof preset.branding[key] !== 'string') throw new Error('El recurso gráfico ' + key + ' no es válido.');
    return preset;
  }
  function luminance(hex) {
    const v = hex.slice(1).match(/../g).map(s => parseInt(s, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    return v[0] * .2126 + v[1] * .7152 + v[2] * .0722;
  }
  function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
  function readable(color, background, fallback) { return contrast(color, background) >= 4.5 ? color : fallback; }
  function tokens(preset, mode) {
    validate(preset);
    const dark = mode === 'dark', c = preset.colors[dark ? 'dark' : 'light'];
    const text = dark ? '#e4f0f1' : '#152b34', paper = dark ? '#0f242d' : '#ffffff', bg = dark ? '#0a1820' : '#f2f7f5';
    const secondary = readable(c.secondary, paper, text);
    let button = c.secondary;
    let onButton = contrast(button, '#ffffff') >= contrast(button, '#071923') ? '#ffffff' : '#071923';
    if (contrast(button, onButton) < 4.5) { button = '#0b2331'; onButton = '#ffffff'; }
    const chrome = contrast(c.primary, '#a9c0c6') >= 4.5 ? c.primary : (dark ? '#071923' : '#0b2331');
    return {
      '--bg': bg, '--paper': paper, '--text': text, '--muted': dark ? '#a9c1c4' : '#58717a',
      '--border': dark ? '#29434b' : '#d7e2e1', '--border-strong': dark ? '#3a5962' : '#c2d2d0',
      '--brand-primary': chrome, '--brand-secondary': secondary, '--brand-accent': readable(c.accent, paper, text),
      '--brand-button': button, '--brand-on-button': onButton,
      '--amber-700': readable(c.accent, paper, text), '--amber-800': readable(c.accent, paper, text),
      '--amber-100': 'color-mix(in oklch, ' + c.accent + ' 12%, ' + paper + ')',
      '--amber-050': 'color-mix(in oklch, ' + c.accent + ' 6%, ' + paper + ')',
      '--teal-700': secondary, '--teal-800': secondary, '--teal-600': secondary,
      '--teal-200': 'color-mix(in oklch, ' + secondary + ' 25%, ' + paper + ')',
      '--teal-100': 'color-mix(in oklch, ' + secondary + ' 12%, ' + paper + ')',
      '--teal-050': 'color-mix(in oklch, ' + secondary + ' 6%, ' + paper + ')',
      '--chrome-bg': chrome, '--chrome-panel': chrome,
      '--ink-950': dark ? '#f1fbfa' : '#071923', '--ink-900': dark ? '#e7f2f2' : '#0b2331',
      '--ink-800': dark ? '#d0e3e4' : '#123346', '--ink-700': dark ? '#b4ced0' : '#1a4559',
      '--slate-900': text, '--slate-800': dark ? '#d7e6e7' : '#243f49', '--slate-700': dark ? '#bfd2d4' : '#3b5660',
      '--slate-600': dark ? '#a6bec1' : '#557079', '--slate-500': dark ? '#8ca7aa' : '#5c747c',
      '--slate-400': dark ? '#708d91' : '#8ba0a6', '--slate-300': dark ? '#536e73' : '#b9c8cb',
      '--slate-200': dark ? '#3c565b' : '#d8e3e3', '--slate-150': dark ? '#2e464c' : '#e4eceb',
      '--slate-100': dark ? '#243c42' : '#eef4f3', '--slate-050': dark ? '#1c3238' : '#f4f8f7'
    };
  }
  function unique(state, name) { let n = name, i = 2; while (state.presets.some(p => p.name === n)) n = name + ' (' + i++ + ')'; return n; }
  function freshId(state) { let i = 1; while (state.presets.some(p => p.id === 'custom-' + i)) i++; return 'custom-' + i; }
  function savePreset(state, preset, policy) {
    validate(preset); const p = clone(preset);
    const index = state.presets.findIndex(x => x.name === p.name);
    if (policy === 'replace' && index >= 0 && state.presets[index].id !== 'generic') {
      p.id = state.presets[index].id; state.presets.splice(index, 1, p);
    } else {
      p.name = unique(state, p.name); p.id = freshId(state); state.presets.push(p);
    }
    return clone(p);
  }
  function applyPreset(state, preset) { validate(preset); state.previous = clone(state.active); state.active = clone(preset); return state.active; }
  function duplicate(state, preset) { const p = clone(preset); p.name += ' · Copia'; return savePreset(state, p, 'both'); }
  function restore(state) { return applyPreset(state, GENERIC); }
  function setUserMode(state, id, mode) { state.userModes[id || 'guest'] = ['light', 'dark', 'system'].includes(mode) ? mode : 'system'; }
  function getUserMode(state, id) { return state.userModes[id || 'guest'] || state.active.preferences?.defaultMode || 'system'; }
  window.AssetAppearanceEngine = { clone, createState, validate, tokens, contrast, savePreset, applyPreset, duplicate, restore, setUserMode, getUserMode };
})();
