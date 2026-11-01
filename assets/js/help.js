(function () {
  'use strict';
  // Task guides are static documentation, never a second domain data source.
  // Titles and steps are catalog keys so the guide set ships in both locales.
  const topics = [
    { id: 'inventory', titleKey: 'ui.help.topics.inventory.title', href: '#/inventario', permission: 'assets.view', stepKeys: [
      'ui.help.topics.inventory.step_1',
      'ui.help.topics.inventory.step_2',
      'ui.help.topics.inventory.step_3'
    ] },
    { id: 'operations', titleKey: 'ui.help.topics.operations.title', href: '#/inventario', permission: 'assets.view', stepKeys: [
      'ui.help.topics.operations.step_1',
      'ui.help.topics.operations.step_2',
      'ui.help.topics.operations.step_3'
    ] },
    { id: 'incidents', titleKey: 'ui.help.topics.incidents.title', href: '#/mantenimiento', permission: 'assets.view', stepKeys: [
      'ui.help.topics.incidents.step_1',
      'ui.help.topics.incidents.step_2',
      'ui.help.topics.incidents.step_3'
    ] },
    { id: 'monitoring', titleKey: 'ui.help.topics.monitoring.title', href: '#/panel', permission: 'assets.view', stepKeys: [
      'ui.help.topics.monitoring.step_1',
      'ui.help.topics.monitoring.step_2',
      'ui.help.topics.monitoring.step_3'
    ] },
    { id: 'warranties', titleKey: 'ui.help.topics.warranties.title', href: '#/garantias', permission: 'assets.view', stepKeys: [
      'ui.help.topics.warranties.step_1',
      'ui.help.topics.warranties.step_2',
      'ui.help.topics.warranties.step_3'
    ] },
    { id: 'reports', titleKey: 'ui.help.topics.reports.title', href: '#/reportes', permission: 'assets.view', stepKeys: [
      'ui.help.topics.reports.step_1',
      'ui.help.topics.reports.step_2',
      'ui.help.topics.reports.step_3'
    ] },
    { id: 'settings', titleKey: 'ui.help.topics.settings.title', href: '#/configuracion/general', permission: 'config.general', stepKeys: [
      'ui.help.topics.settings.step_1',
      'ui.help.topics.settings.step_2',
      'ui.help.topics.settings.step_3'
    ] },
    { id: 'agents', titleKey: 'ui.help.topics.agents.title', href: '#/conversacion', permission: 'assets.view', stepKeys: [
      'ui.help.topics.agents.step_1',
      'ui.help.topics.agents.step_2',
      'ui.help.topics.agents.step_3'
    ] },
    { id: 'extensions', titleKey: 'ui.help.topics.extensions.title', href: '#/configuracion/extensiones', permission: 'system.modules', stepKeys: [
      'ui.help.topics.extensions.step_1',
      'ui.help.topics.extensions.step_2',
      'ui.help.topics.extensions.step_3'
    ] }
  ];
  function tr(key, params) {
    return window.ItsmI18n ? window.ItsmI18n.t(key, params) : key;
  }
  // Search normalization is an identifier path, not display copy: it keeps the
  // source-locale case folding and accent stripping regardless of the UI locale.
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
  function view(topic) {
    return { id: topic.id, href: topic.href, permission: topic.permission, title: tr(topic.titleKey), steps: topic.stepKeys.map(key => tr(key)) };
  }
  function search(query) {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    return topics.map(view).filter(topic => {
      if (!words.length) return true;
      const text = normalize([topic.title].concat(topic.steps).join(' '));
      return words.every(word => text.includes(word));
    });
  }
  const HelpPage = {
    props: ['app'],
    data() { return { query: '' }; },
    computed: { topics() { return search(this.query); } },
    template: `<section class="page help-page" aria-labelledby="help-title">
      <header class="page-head"><div><h1 id="help-title">{{ $t('ui.help.title') }}</h1><p>{{ $t('ui.help.lead') }}</p></div></header>
      <div class="help-search"><label for="help-search">{{ $t('ui.help.search_label') }}</label><input id="help-search" type="search" v-model="query" :placeholder="$t('ui.help.search_placeholder')" autocomplete="off"></div>
      <p role="status" aria-live="polite">{{ $t('ui.help.topic_count', { count: topics.length }) }}</p>
      <p v-if="!topics.length">{{ $t('ui.help.empty') }}</p>
      <div class="help-topics"><article v-for="topic in topics" :key="topic.id" class="help-topic" :aria-labelledby="'help-'+topic.id">
        <h2 :id="'help-'+topic.id">{{ topic.title }}</h2><ol><li v-for="step in topic.steps" :key="step">{{ step }}</li></ol>
        <a v-if="app.can(topic.permission)" :href="topic.href">{{ $t('ui.help.open_section', { title: topic.title }) }}</a>
        <p v-else class="muted">{{ $t('ui.help.permission_note') }}</p>
      </article></div>
    </section>`
  };
  window.AssetHelp = { search, HelpPage, topics };
}());
