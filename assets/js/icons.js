(function () {
  'use strict';

  const ICONS = {
    inventory: '<path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z"/><path d="m4 7.5 8 4.5 8-4.5"/><path d="M12 12v9"/>',
    remote: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/><path d="m10 8 4 2-4 2z"/>',
    shield: '<path d="M12 3 19 6v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="m9 12 2 2 4-4"/>',
    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.5 3.3-5.5 7-5.5s6.2 2 7 5.5"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v2"/>',
    eye: '<path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.5"/>',
    'eye-off': '<path d="M3 3l18 18"/><path d="M10.6 6.7A10.9 10.9 0 0 1 12 6.5c6 0 9.5 5.5 9.5 5.5a16 16 0 0 1-2.2 2.8"/><path d="M6.2 7.4A15.7 15.7 0 0 0 2.5 12S6 17.5 12 17.5c1.3 0 2.5-.2 3.5-.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    alert: '<path d="M10.3 4.3 2.8 17.2A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.7-2.8L13.7 4.3a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 16.5h.01"/>',
    'arrow-right': '<path d="M4 12h16"/><path d="m14 6 6 6-6 6"/>',
    'arrow-left': '<path d="M20 12H4"/><path d="m10 6-6 6 6 6"/>',
    'arrow-up-right': '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
    close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
    sliders: '<path d="M4 6h10"/><path d="M18 6h2"/><path d="M4 12h4"/><path d="M12 12h8"/><path d="M4 18h10"/><path d="M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
    'chevron-right': '<path d="m9 6 6 6-6 6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    sort: '<path d="M7 4v16"/><path d="m3 8 4-4 4 4"/><path d="M17 20V4"/><path d="m13 16 4 4 4-4"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    logout: '<path d="M14 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3"/><path d="M9 12h11"/><path d="m17 8 4 4-4 4"/>',
    menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
    pin: '<path d="M12 17v5"/><path d="M9 10.76V6a3 3 0 1 1 6 0v4.76a2 2 0 0 0 .59 1.42l1.41 1.41A2 2 0 0 1 15.58 17H8.42A2 2 0 0 1 7 13.59l1.41-1.41A2 2 0 0 0 9 10.76Z"/>',
    building: '<rect x="4" y="3" width="12" height="18" rx="1"/><path d="M16 9h4v12h-4"/><path d="M8 7h1"/><path d="M11 7h1"/><path d="M8 11h1"/><path d="M11 11h1"/><path d="M8 15h1"/><path d="M11 15h1"/><path d="M2 21h20"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M3 14.5h18"/><path d="M9 9v11"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    desktop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/>',
    laptop: '<rect x="4" y="4" width="16" height="11" rx="2"/><path d="M2 19h20l-2.5-4h-15z"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01"/><path d="M7 16.5h.01"/><path d="M11 7.5h5"/><path d="M11 16.5h5"/>',
    printer: '<path d="M7 8V3h10v5"/><rect x="3" y="8" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/><path d="M17 11h.01"/>',
    network: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4"/><path d="M6 16v-4h12v4"/>',
    display: '<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
    package: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5"/><path d="M12 12v9"/><path d="m8 5.2 8 4.5"/>',
    'map-pin': '<path d="M20 10c0 5.2-8 11-8 11S4 15.2 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    activity: '<path d="M3 12h4l2.2-6 4.2 12 2.2-6H21"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    pencil: '<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m14.5 6.5 3 3"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m6 7 1 13h10l1-13"/><path d="M10 11v5"/><path d="M14 11v5"/>',
    upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
    download: '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 4v7h-7"/>',
    'chevron-up': '<path d="m6 15 6-6 6 6"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
    phone: '<path d="M8 3H5a2 2 0 0 0-2 2c0 8.3 6.7 15 15 15a2 2 0 0 0 2-2v-3l-4-1-2 2a14 14 0 0 1-6-6l2-2z"/>',
    moon: '<path d="M20.5 15.5A8 8 0 1 1 8.5 3.5a6.5 6.5 0 0 0 12 12Z"/>',    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    camera: '<path d="M4 8h3l1.6-2h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.2"/>',
    battery: '<rect x="2.5" y="7.5" width="16" height="9" rx="2"/><path d="M21 10.5v3"/><path d="M5.5 10.5v3"/><path d="M9 10.5v3"/><path d="M12.5 10.5v3"/>',
    layers: '<path d="m12 3 8 4.2-8 4.2-8-4.2z"/><path d="m4 12 8 4.2 8-4.2"/><path d="m4 16.6 8 4.2 8-4.2"/>',
    box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="m3 7.5 9 4.5 9-4.5"/><path d="M12 12v9"/><path d="M7.5 5.2v6"/>',
    history: '<path d="M3.2 12a8.8 8.8 0 1 0 2.6-6.3"/><path d="M3 4.5V9h4.5"/><path d="M12 8v4.5l3 1.8"/>',
    restore: '<path d="M3.2 12a8.8 8.8 0 1 0 2.6-6.3"/><path d="M3 4.5V9h4.5"/><path d="m9.5 12 2 2 4-4"/>',
    'x-circle': '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6"/><path d="m15 9-6 6"/>',
    minus: '<path d="M5 12h14"/>',
    'file-text': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>',
    bell: '<path d="M18 15.5V11a6 6 0 1 0-12 0v4.5L4.5 18h15z"/><path d="M10 21h4"/>',
    gauge: '<path d="M4.2 17a9 9 0 1 1 15.6 0"/><path d="m12 13 4-3.5"/><circle cx="12" cy="14" r="1.6"/>',
    wifi: '<path d="M3.5 9a13 13 0 0 1 17 0"/><path d="M6.5 12.5a9 9 0 0 1 11 0"/><path d="M9.5 16a4.6 4.6 0 0 1 5 0"/><circle cx="12" cy="19.5" r="1"/>',
    thermometer: '<path d="M14 14.5V5a2 2 0 1 0-4 0v9.5a4 4 0 1 0 4 0Z"/><path d="M12 9v7"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    slash: '<circle cx="12" cy="12" r="8.5"/><path d="m6.5 17.5 11-11"/>',
    send: '<path d="M21 3 10.5 13.5"/><path d="M21 3l-6.5 18-4-8-8-4z"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>'
  };

  // The graph view draws icons inside SVG, where a nested component is not
  // reliable; the raw path markup is exported for that case only.
  window.AppIconPaths = ICONS;

  window.AppIcon = {    name: 'AppIcon',
    props: {
      name: { type: String, required: true }
    },
    computed: {
      markup() {
        return ICONS[this.name] || ICONS.info;
      }
    },
    template: '<svg class="od-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" v-html="markup"></svg>'
  };
})();
