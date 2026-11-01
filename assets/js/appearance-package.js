(function () {
  'use strict';
  function tr(key, params) {
    const i18n = window.ItsmI18n;
    if (!i18n || typeof i18n.t !== 'function') return key;
    return i18n.t(key, params);
  }
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const keys = ['logo', 'logoDark', 'logoCompact', 'favicon'];
  const types = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', ico: 'image/x-icon' };
  function crc(bytes) { let c = -1; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ -1) >>> 0; }
  function join(parts) { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let offset = 0; for (const p of parts) { out.set(p, offset); offset += p.length; } return out; }
  function header(size) { const bytes = new Uint8Array(size); return { bytes, view: new DataView(bytes.buffer) }; }
  function zip(files) {
    const chunks = [], directory = []; let offset = 0;
    for (const [name, data] of files) {
      const filename = encoder.encode(name), sum = crc(data), local = header(30), central = header(46);
      const l = local.view, c = central.view;
      l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true);
      l.setUint32(14, sum, true); l.setUint32(18, data.length, true); l.setUint32(22, data.length, true); l.setUint16(26, filename.length, true);
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
      c.setUint32(16, sum, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, filename.length, true); c.setUint32(42, offset, true);
      chunks.push(local.bytes, filename, data); directory.push(central.bytes, filename); offset += 30 + filename.length + data.length;
    }
    const dir = join(directory), end = header(22);
    end.view.setUint32(0, 0x06054b50, true); end.view.setUint16(8, files.length, true); end.view.setUint16(10, files.length, true);
    end.view.setUint32(12, dir.length, true); end.view.setUint32(16, offset, true);
    return join([...chunks, dir, end.bytes]);
  }
  async function unzip(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 22 || bytes.length > 24 * 1024 * 1024) throw new Error(tr('ui.appearance.package.zip_invalid'));
    let end = bytes.length - 22;
    while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
    if (end < 0 || view.getUint32(end, true) !== 0x06054b50) throw new Error(tr('ui.appearance.package.zip_incomplete'));
    let offset = view.getUint32(end + 16, true); const count = view.getUint16(end + 10, true), files = new Map();
    if (count > 40) throw new Error('El ZIP contiene demasiados recursos.');
    for (let i = 0; i < count; i++) {
      if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new Error(tr('ui.appearance.package.index_damaged'));
      const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true), size = view.getUint32(offset + 20, true), expanded = view.getUint32(offset + 24, true);
      const n = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true), start = view.getUint32(offset + 42, true);
      const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + n));
      if (flags & 1 || expanded > 8 * 1024 * 1024 || start + 30 > bytes.length || view.getUint32(start, true) !== 0x04034b50) throw new Error(tr('ui.appearance.package.zip_incompatible'));
      const localNameLength = view.getUint16(start + 26, true);
      if (decoder.decode(bytes.slice(start + 30, start + 30 + localNameLength)) !== name) throw new Error(tr('ui.appearance.package.names_incoherent'));
      const payload = start + 30 + localNameLength + view.getUint16(start + 28, true);
      if (payload + size > bytes.length) throw new Error('Falta un recurso del ZIP.');
      let data = bytes.slice(payload, payload + size);
      if (method === 8 && typeof DecompressionStream !== 'undefined') {
        try { data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()); }
        catch (_) { throw new Error('No se pudo descomprimir el ZIP. Exporta el preset desde Asset Manager.'); }
      } else if (method !== 0) throw new Error(tr('ui.appearance.package.compression_unsupported'));
      if (data.length !== expanded || crc(data) !== view.getUint32(offset + 16, true)) throw new Error(tr('ui.appearance.package.integrity_failed'));
      if (files.has(name)) throw new Error('El ZIP contiene recursos duplicados.');
      files.set(name, data); offset += 46 + n + extra + comment;
    }
    return files;
  }
  function check(p) {
    if (!p || p.version !== 1) throw new Error(tr('ui.appearance.package.preset_version'));
    if (!p.name || !p.branding?.appName || !p.branding?.organizationName || !p.colors?.light || !p.colors?.dark) throw new Error(tr('ui.appearance.package.preset_incomplete'));
    for (const m of ['light', 'dark']) for (const k of ['primary', 'secondary', 'accent']) if (!/^#[\da-f]{6}$/i.test(p.colors[m][k] || '')) throw new Error('El preset contiene colores incompatibles.');
    if (!p.preferences || !['light', 'dark', 'system'].includes(p.preferences.defaultMode) || typeof p.preferences.compact !== 'boolean') throw new Error(tr('ui.appearance.package.preset_preferences'));
    for (const key of keys) if (p.branding[key] != null && typeof p.branding[key] !== 'string') throw new Error(tr('ui.appearance.package.resource_invalid', { key }));
  }
  function unbase64(text) { const binary = atob(text); return Uint8Array.from(binary, c => c.charCodeAt(0)); }
  function base64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s); }
  async function asset(source, resolver) {
    if (source.startsWith('data:')) {
      const match = source.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/);
      if (!match || !Object.values(types).includes(match[1])) throw new Error('Formato de recurso no compatible. Usa SVG, PNG, JPEG, WebP o ICO.');
      return { type: match[1], bytes: match[2] ? unbase64(match[3]) : encoder.encode(decodeURIComponent(match[3])) };
    }
    if (/^[a-z]+:|^\/\//i.test(source)) throw new Error('El paquete no puede depender de recursos externos. Carga una imagen local.');
    if (resolver) return resolver(source);
    const response = await fetch(source);
    if (!response.ok) throw new Error('No se pudo incluir el recurso ' + source + '.');
    return { bytes: new Uint8Array(await response.arrayBuffer()), type: types[source.split('.').pop().toLowerCase()] || response.headers.get('content-type')?.split(';')[0] };
  }
  async function encode(preset, resolver) {
    check(preset); const p = JSON.parse(JSON.stringify(preset)), files = [], resources = [];
    for (const key of keys) {
      if (!p.branding[key]) continue;
      const result = await asset(p.branding[key], resolver), ext = Object.keys(types).find(k => types[k] === result.type);
      if (!ext) throw new Error('El recurso ' + key + ' tiene un formato incompatible.');
      const path = 'resources/' + key + '.' + ext;
      files.push([path, result.bytes]); resources.push({ key, name: path, type: result.type }); p.branding[key] = path;
    }
    files.unshift(['preset.json', encoder.encode(JSON.stringify({ format: 'asset-manager-appearance', version: 1, preset: p, resources }, null, 2))]);
    return zip(files);
  }
  async function decode(input) {
    try {
      const files = await unzip(input);
      if (!files.has('preset.json')) throw new Error('El ZIP no contiene preset.json. Selecciona un paquete de apariencia.');
      const manifest = JSON.parse(decoder.decode(files.get('preset.json')));
      if (manifest.format !== 'asset-manager-appearance' || manifest.version !== 1) throw new Error(tr('ui.appearance.package.format_incompatible'));
      check(manifest.preset); const p = manifest.preset, resources = [];
      if (!Array.isArray(manifest.resources)) throw new Error(tr('ui.appearance.package.resource_index_missing'));
      for (const key of keys) {
        if (!p.branding[key]) continue;
        const resource = manifest.resources.find(r => r.key === key && r.name === p.branding[key]);
        if (!resource || !Object.values(types).includes(resource.type) || !files.has(resource.name)) throw new Error(tr('ui.appearance.package.resource_missing', { key }));
        const bytes = files.get(resource.name); p.branding[key] = 'data:' + resource.type + ';base64,' + base64(bytes);
        resources.push({ name: resource.name, size: bytes.length, type: resource.type });
      }
      return { preset: p, resources };
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof RangeError) throw new Error(tr('ui.appearance.package.zip_corrupt'));
      throw error;
    }
  }
  window.AssetAppearancePackage = { encode, decode };
})();
