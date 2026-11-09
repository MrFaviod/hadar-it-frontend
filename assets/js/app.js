(function () {
  'use strict';

  // Root computeds resolve catalog keys without relying on the plugin injection,
  // so a computed stays callable before/without the app instance (tests, SDK
  // consumers, extension host). Templates use `$t` from the installed plugin.
  function tr(key, params) {
    return window.ItsmI18n ? window.ItsmI18n.t(key, params) : '';
  }

  function collator(options) {
    return window.ItsmI18n ? window.ItsmI18n.collator(options) : new Intl.Collator('es', options || { sensitivity: 'base' });
  }

  // React calls this factory after the ordered runtime has loaded.
  window.mountAssetApp = function (target) {
  // Extracted so the phase-5 server adapter can delegate to the prototype
  // people views instead of duplicating their filter semantics.
  window.AssetAppPeopleComputed = {
      filteredPeople() {
        const filters = this.prefs.people;
        const term = filters.search.trim().toLocaleLowerCase('es');
        const peopleCollator = window.ItsmI18n ? window.ItsmI18n.collator() : new Intl.Collator('es', { sensitivity: 'base' });
        return this.people.filter((person) => {
          if (filters.site !== 'all' && person.siteId !== filters.site) return false;
          if (filters.department !== 'all' && person.departmentId !== filters.department) return false;
          if (filters.status === 'active' && !person.active) return false;
          if (filters.status === 'inactive' && person.active) return false;
          if (!term) return true;
          const haystack = [
            person.name, person.role, person.email, person.phone,
            this.departmentLabel(person.departmentId), this.siteLabel(person.siteId)
          ].join(' ').toLocaleLowerCase('es');
          return haystack.indexOf(term) !== -1;
        }).sort((a, b) => peopleCollator.compare(a.name, b.name));
      },
      peopleFilterCount() {
        const filters = this.prefs.people;
        let count = 0;
        if (filters.search.trim()) count += 1;
        if (filters.site !== 'all') count += 1;
        if (filters.department !== 'all') count += 1;
        if (filters.status !== 'all') count += 1;
        return count;
      },
      peopleFilterDescription() {
        const filters = this.prefs.people;
        const pieces = [];
        if (filters.search.trim()) pieces.push('“' + filters.search.trim() + '”');
        if (filters.department !== 'all') pieces.push(this.departmentLabel(filters.department));
        if (filters.site !== 'all') pieces.push(this.siteLabel(filters.site));
        if (filters.status === 'active') pieces.push('Solo activas');
        if (filters.status === 'inactive') pieces.push('Solo inactivas');
        return pieces.join(' · ');
      },
      currentPerson() {
        if (this.route.name !== 'person' || !this.route.personId) return null;
        return this.people.find((person) => person.id === this.route.personId) || null;
      },
      personAssets() {
        if (!this.currentPerson) return [];
        return this.assets
          .filter((asset) => asset.assigneeId === this.currentPerson.id)
          .sort((a, b) => collator({ numeric: true, sensitivity: 'base' }).compare(a.id, b.id));
      },
      assignContextAsset() {
        if (!this.assignDialog.assetId) return null;
        return this.assets.find((asset) => asset.id === this.assignDialog.assetId) || null;
      },
      assignTargetPerson() {
        if (!this.assignDialog.personId) return null;
        return this.personById(this.assignDialog.personId);
      },
      assignPeople() {
        const term = this.assignDialog.search.trim().toLocaleLowerCase('es');
        const currentId = this.assignDialog.mode === 'person' ? this.assignDialog.personId : '';
        return this.people
          .filter((person) => person.active || person.id === currentId)
          .filter((person) => !term || [person.name, person.role].join(' ').toLocaleLowerCase('es').indexOf(term) !== -1)
          .sort((a, b) => collator({ sensitivity: 'base' }).compare(a.name, b.name));
      },
      assignAssets() {
        const term = this.assignDialog.search.trim().toLocaleLowerCase('es');
        return this.assets
          .filter((asset) => !asset.assigneeId)
          .filter((asset) => !term || [asset.name, asset.id, asset.type].join(' ').toLocaleLowerCase('es').indexOf(term) !== -1)
          .sort((a, b) => collator({ numeric: true, sensitivity: 'base' }).compare(a.id, b.id));
      },
  };

  const Store = window.AssetStore;
  const initial = Store.initialState();

  // The shared parser predates the IA and system sections. Each feature keeps
  // its own narrow override and this seam composes them without forking routes.
  const RouteMethods = {
    uiNavHidden(target) {
      return !!(this.uiProjection && this.uiProjection.hidden[target]);
    },
    parseRoute() {
      const parsed = window.AssetMethods.parseRoute.call(this);
      const agentRoute = (window.AssetAgentViews && window.AssetAgentViews.routeOverride(parsed, window.location.hash)) || parsed;
      return (window.AssetSystemViews && window.AssetSystemViews.routeOverride(agentRoute, window.location.hash)) || agentRoute;
    },
    hashFor(route) {
      if (route && route.name === 'config' && route.section === 'ia') return '#/configuracion/ia';
      if (route && route.name === 'config' && route.section === 'sistema') return '#/configuracion/sistema';
      return window.AssetMethods.hashFor.call(this, route);
    }
  };

  const appOptions = {
    mixins: [{ data: window.AssetAccess.data, computed: window.AssetAccess.computed }, window.AssetPhase10],
    components: {
      HelpPage: window.AssetHelp.HelpPage,
      AppIcon: window.AppIcon,
      DemoCountdown: window.AssetAccess.DemoCountdown,
      LocaleSelect: window.ItsmI18n ? window.ItsmI18n.LocaleSelect : null,
      ItsmTable: window.ItsmTable,
      ItsmField: window.ItsmField,
      ItsmStatus: window.ItsmStatus,
      ItsmError: window.ItsmError,
      ExtensionPage: window.AssetExtensions.components.ExtensionPage,
      ExtensionAssetPanels: window.AssetExtensions.components.ExtensionAssetPanels,
      ExtensionReview: window.AssetExtensions.components.ExtensionReview,
      ...(window.ExtensionViews ? window.ExtensionViews.components : {}),
      ...(window.UIComposition ? window.UIComposition.components : {}),
      SearchPalette: window.AssetSearchViews.SearchPalette,
      SearchSettings: window.AssetSearchViews.SearchSettings,
      WorkspaceShortcuts: window.AssetWorkspaceViews.WorkspaceShortcuts,
      QuickIntervention: window.AssetMaintDialogs.InterventionDialog,
      QuickIncident: window.AssetMaintDialogs.IncidentDialog,
      ModalShell: window.ModalShell,
      AccessUsers: window.AssetAccessViews.AccessUsers,
      AccessUserDetail: window.AssetAccessViews.AccessUserDetail,
      AccessSecurity: window.AssetAccessViews.AccessSecurity,
      AssetEditor: window.AssetEditor,
      AssetConversation: window.AssetConversation,
      AgentEnginePicker: window.AssetAgentViews.AgentEnginePicker,
      AgentInstanceEditor: window.AssetAgentViews.AgentInstanceEditor,
      AgentCatalogPanel: window.AssetAgentViews.AgentCatalogPanel,
      AgentInstallationsPanel: window.AssetAgentViews.AgentInstallationsPanel,
      AgentIntegrationWizard: window.AssetAgentViews.AgentIntegrationWizard,
      AgentIntegrationsSettings: window.AssetAgentViews.AgentIntegrationsSettings,
      AgentProvidersPanel: window.AssetAgentViews.AgentProvidersPanel,
      SystemOperations: window.AssetSystemViews.SystemOperations,
      TranslationSettings: window.AssetTranslationViews.TranslationSettings,
      AssetFieldsPanel: window.AssetConfigViews.AssetFieldsPanel,
      AssetFormsPanel: window.AssetConfigViews.AssetFormsPanel,
      AssetStatusesPanel: window.AssetConfigViews.AssetStatusesPanel,
      AssetIdentityPanel: window.AssetConfigViews.AssetIdentityPanel,
      PanelOverview: window.AssetPanel.PanelOverview,
      DashboardPreferences: window.AssetDashboardPrefs.DashboardPreferences,
      DataTransfer: window.AssetTransferViews.DataTransfer,
      DataTransferSettings: window.AssetTransferViews.DataTransferSettings,
      AssetHistory: window.AssetOpsViews.AssetHistory,
      AssetMovements: window.AssetOpsViews.AssetMovements,
      BulkEditor: window.AssetOpsViews.BulkEditor,
      AssetRelations: window.AssetRelationViews.AssetRelations,
      OrganizationRelations: window.AssetRelationViews.OrganizationRelations,
      OrganizationRelationTypes: window.AssetRelationViews.OrganizationRelationTypes,
      RelationsSettings: window.AssetRelationViews.RelationsSettings,
      GraphExplorer: window.AssetGraphView,
      MapExplorer: window.AssetMapViews.MapExplorer,
      MapSettings: window.AssetMapViews.MapSettings,
      MaintenanceCenter: window.AssetMaintViews.MaintenanceCenter,
      IncidentDetail: window.AssetMaintViews.IncidentDetail,
      AssetMaintenancePanel: window.AssetMaintPanels.AssetMaintenancePanel,
      MaintenanceSettings: window.AssetMaintPanels.MaintenanceSettings,
      MonChart: window.Views.MonChart,
      MonSpark: window.Views.MonSpark,
      MonStatusPill: window.Views.MonStatusPill,
      MonMetric: window.Views.MonMetric,
      MonSilenceDialog: window.Views.MonSilenceDialog,
      MonConvertDialog: window.Views.MonConvertDialog,
      MonitoringCenter: window.Views.MonitoringCenter,
      MonitorDevice: window.Views.MonitorDevice,
      MonitorAlert: window.Views.MonitorAlert,
      NotificationBell: window.Views.NotificationBell,
      NotificationCenter: window.Views.NotificationCenter,
      AssetMonitoringPanel: window.Views.AssetMonitoringPanel,
      MonitoringSettings: window.Views.MonitoringSettings,
      AlertSettings: window.Views.AlertSettings,
      NotificationSettings: window.Views.NotificationSettings,
      AppearanceSettings: window.AssetAppearanceViews.AppearanceSettings,
      ReportsCenter: window.AssetReportViews.ReportsCenter,
      ReportSettings: window.AssetReportViews.ReportSettings,
      WarrantyCenter: window.AssetWarrantyViews.WarrantyCenter,
      AssetWarrantyPanel: window.AssetWarrantyViews.AssetWarrantyPanel,
      WarrantySettings: window.AssetWarrantyViews.WarrantySettings,
      Phase6DataTransfer: window.AssetPhase6Views.Phase6DataTransfer,
      Phase6BulkEditor: window.AssetPhase6Views.Phase6BulkEditor,
      Phase6WarrantyCenter: window.AssetPhase6Views.Phase6WarrantyCenter,
      Phase6WarrantySettings: window.AssetPhase6Views.Phase6WarrantySettings,
      Phase6AssetWarranty: window.AssetPhase6Views.Phase6AssetWarranty,
      Phase6Attachments: window.AssetPhase6Views.Phase6Attachments,
      LabelsCenter: window.AssetLabelViews.LabelsCenter,
      AssetQrPanel: window.AssetLabelViews.AssetQrPanel,
      AssetQrCode: window.AssetLabelViews.AssetQrCode,
      QrSettings: window.AssetLabelViews.QrSettings,
      LabelSettings: window.AssetLabelViews.LabelSettings,
      PublicAssetReport: window.AssetLabelViews.PublicAssetReport
    },
    data() {
      return {
        workspaceState: window.AssetWorkspace.createState(),
        workspaceInventory: {status:'all',location:'all',columns:['model','location','assignee','ip','remote']},
        workspacePending: null, workspaceMaintenanceId: '', workspaceRevision: 0,
        universalOpen: false, quickDialog: {type:'',assetId:'',interventionId:''},
        config: initial.config,
        assets: initial.assets,
        relations: initial.relations,
        graphPrefs: initial.graphPrefs,
        maps: initial.maps,
        monitoring: initial.monitoring,
        dashboard: window.AssetDashboardPrefs.createState(),
        // Warranty view filters live only in this session; the server stores
        // the single expiring-day preference (phase 6, warranty settings).
        warrantyPrefs: { days: 90, includeRetired: false, site: 'all', category: 'all' },
        documentContext: { ids: [], category: 'all', site: 'all', search: '' },
        explorerFilters: { categories: [], sites: [], states: [], locations: [], search: '' },
        explorerSelection: '',
        assetAdmin: initial.assetAdmin,
        ...window.AssetInventory.data(),
        ...window.AssetOrganization.data(),
        ...window.AssetRedundancy.data(),
        ...window.AssetPhase6.data(),
        ...window.AssetPhase9.data(),
        ...window.AssetMaintenanceApi.data(),
        ...window.AssetMonitoringApi.data(),
        ...window.AssetExtensions.data(),
        bulk: { ids: [], open: false },
        assetConfigTab: 'campos',
        assetEditor: {
          open: false,
          mode: 'create',
          id: '',
          advancedOpen: false,
          category: '',
          error: '',
          saving: false,
          draft: window.AssetSchema.newAsset(initial.assetAdmin, initial.config.categories)
        },
        assetEditorErrors: {},
        statusDialog: { open: false, assetId: '', statusId: '', note: '' },
        statusDialogError: '',
        retireDialog: { open: false, assetId: '', reason: '', note: '', acknowledged: false },
        retireDialogError: '',
        deleteDialog: { open: false, assetId: '', typed: '', reason: '' },
        deleteDialogError: '',
        fieldDialog: { open: false, mode: 'create', key: '', label: '', type: 'text', unit: '', options: '', hint: '' },
        fieldDialogErrors: {},
        assetStatusDialog: { open: false, mode: 'create', id: '', label: '', tone: 'ok', final: false },
        assetStatusErrors: {},
        assetIdRulesDraft: Store.clone(initial.assetAdmin.idRules),
        assetIdRulesErrors: {},
        formDraft: null,
        formDraftError: '',
        fieldTypes: window.AssetSchema.FIELD_TYPES,
        people: initial.people,
        authenticated: initial.authenticated,
        route: { name: 'login', assetId: null, personId: null, section: null },
        prefs: initial.prefs,
        mobileNavOpen: false,
        sidebarPinnedPref: window.AssetSidebar ? window.AssetSidebar.isPinned() : false,
        sidebarDockable: window.AssetSidebar ? window.AssetSidebar.canDock() : false,
        userMenuOpen: false,
        themeMode: window.AssetTheme ? window.AssetTheme.getPreference() : 'system',
        themeResolvedMode: window.AssetTheme ? window.AssetTheme.getResolved() : 'light',
        appearance: window.AssetAppearanceEngine.createState(initial.config.general),
        inventoryScrollY: 0,
        loginForm: { username: '', password: '' },
        loginErrors: { username: '', password: '', general: '' },
        loginBusy: false,
        showPassword: false,
        integrationDraft: Store.clone(initial.config.integrations),
        integrationErrors: { anydesk: '', rmm: '', general: '' },
        personDialog: {
          open: false,
          mode: 'create',
          id: '',
          name: '',
          role: '',
          departmentId: '',
          siteId: '',
          email: '',
          phone: '',
          active: true
        },
        personErrors: { name: '', role: '', departmentId: '', siteId: '', email: '', phone: '', general: '' },
        departmentDialog: { open: false, mode: 'create', id: '', label: '' },
        departmentErrors: { label: '', general: '' },
        assignDialog: {
          open: false,
          mode: 'person',
          assetId: '',
          personId: '',
          selectedId: '',
          search: ''
        },
        categoryDialog: {
          open: false,
          mode: 'create',
          id: '',
          label: '',
          description: '',
          image: 'assets/svg/devices/other.svg',
          icon: 'package'
        },
        categoryErrors: { label: '', description: '', image: '', general: '' },
        siteDialog: { open: false, mode: 'create', id: '', label: '', short: '' },
        siteErrors: { label: '', short: '', general: '' },
        locationDialog: { open: false, siteId: '', id: '', label: '' },
        locationErrors: { label: '', general: '' },
        confirmDialog: {
          open: false,
          kind: '',
          title: '',
          message: '',
          detail: '',
          confirmLabel: '',
          categoryId: '',
          siteId: '',
          locationId: ''
        },
        assetConfig: {
          open: false,
          asset: null,
          anydeskId: '',
          rmmAgentId: ''
        },
        assetConfigErrors: { anydeskId: '', rmmAgentId: '', general: '' },
        remoteDialog: {
          open: false,
          asset: null,
          kind: 'anydesk',
          state: 'idle'
        },
        remoteTimer: null,
        toast: { text: '', tone: 'success' },
        toastTimer: null
      };
    },
    computed: Object.assign({}, window.AssetWorkspaceRuntime.computed, {
      // The retired reasons are catalog keys; resolving them here keeps the
      // option list in step with a live locale switch.
      // The select binds the stable id and shows the localized label, so the
      // dialog does not depend on the language that was active when it opened.
      retireReasons() {
        const keys = window.AssetAdminReasons || [];
        const ids = window.AssetAdminRetireReasons;
        return keys.map((key) => ({
          id: ids ? ids.id(key) : key,
          label: tr(key)
        }));
      },
      isPublicReport() {
        return !!(this.route && this.route.name === 'reportAsset' && this.route.section === 'publico' && this.route.shareToken);
      },
      categories() {
        return this.config.categories;
      },
      sites() {
        return this.config.sites;
      },
      departments() {
        return this.config.departments;
      },
      appName() {
        return this.config.general.appName || 'Hadar IT';
      },
      organizationName() {
        return this.config.general.organizationName || 'Operaciones TI';
      },
      brandLogo() {
        const branding = this.appearance.active.branding;
        return (this.themeResolved === 'dark' && branding.logoDark) || this.config.general.logo || 'assets/svg/logo.svg';
      },
      brandCompactLogo() {
        return this.appearance.active.branding.logoCompact || this.brandLogo;
      },
      settings() {
        return Store.settingsFromConfig(this.config);
      },
      // Copy-bearing navigation and form data lives in computed properties so a
      // language switch re-renders labels while ids, tones, icons and image
      // sources stay stable for stored state, routes and server payloads.
      assetConfigTabs() {
        return [
          { id: 'campos', label: tr('ui.shell.tab_fields'), icon: 'sliders' },
          { id: 'formularios', label: tr('ui.shell.tab_forms'), icon: 'file-text' },
          { id: 'estados', label: tr('ui.shell.tab_statuses'), icon: 'activity' },
          { id: 'identificacion', label: tr('ui.shell.tab_identification'), icon: 'inventory' }
        ];
      },
      statusTones() {
        return [
          { value: 'ok', label: tr('ui.shell.tone_ok') },
          { value: 'warn', label: tr('ui.shell.tone_warn') },
          { value: 'hold', label: tr('ui.shell.tone_hold') },
          { value: 'down', label: tr('ui.shell.tone_down') }
        ];
      },
      sortOptions() {
        return [
          { value: 'id-asc', label: tr('ui.shell.sort_code') },
          { value: 'name-asc', label: tr('ui.shell.sort_name_asc') },
          { value: 'name-desc', label: tr('ui.shell.sort_name_desc') },
          { value: 'site-asc', label: tr('ui.shell.sort_site') },
          { value: 'assignee-asc', label: tr('ui.shell.sort_assignee') },
          { value: 'type-asc', label: tr('ui.shell.sort_type') }
        ];
      },
      permittedConfigSections() {
        return this.configSections.filter((section) => this.canConfig(section.id));
      },
      configSections() {
        // Installation ownership stays a filtered section of the existing
        // Configuración nav; it never becomes a second navigation level.
        return [
          { id: 'sistema', label: tr('ui.shell.config_section_sistema'), hint: tr('ui.shell.config_section_sistema_hint'), icon: 'server' },
          { id: 'idiomas', label: tr('ui.shell.config_section_idiomas'), hint: tr('ui.shell.config_section_idiomas_hint'), icon: 'file-text' },
          { id: 'extensiones', label: tr('ui.shell.config_section_extensiones'), hint: tr('ui.shell.config_section_extensiones_hint'), icon: 'package' },
          { id: 'seguridad', label: tr('ui.shell.config_section_seguridad'), hint: tr('ui.shell.config_section_seguridad_hint'), icon: 'user' },
          { id: 'general', label: tr('ui.shell.config_section_general'), hint: tr('ui.shell.config_section_general_hint'), icon: 'sliders' },
          { id: 'ia', label: tr('ui.shell.config_section_ia'), hint: tr('ui.shell.config_section_ia_hint'), icon: 'layers' },
          { id: 'apariencia', label: tr('ui.shell.config_section_apariencia'), hint: tr('ui.shell.config_section_apariencia_hint'), icon: 'sliders' },
          { id: 'categorias', label: tr('ui.shell.config_section_categorias'), hint: tr('ui.shell.config_section_categorias_hint'), icon: 'grid' },
          { id: 'activos', label: tr('ui.shell.config_section_activos'), hint: tr('ui.shell.config_section_activos_hint'), icon: 'box' },
          { id: 'sedes', label: tr('ui.shell.config_section_sedes'), hint: tr('ui.shell.config_section_sedes_hint'), icon: 'building' },
          { id: 'personas', label: tr('ui.shell.config_section_personas'), hint: tr('ui.shell.config_section_personas_hint'), icon: 'user' },
          { id: 'integraciones', label: tr('ui.shell.config_section_integraciones'), hint: tr('ui.shell.config_section_integraciones_hint'), icon: 'remote' },
          { id: 'relaciones', label: tr('ui.shell.config_section_relaciones'), hint: tr('ui.shell.config_section_relaciones_hint'), icon: 'network' },
          { id: 'mantenimiento', label: tr('ui.shell.config_section_mantenimiento'), hint: tr('ui.shell.config_section_mantenimiento_hint'), icon: 'refresh' },
          { id: 'supervision', label: tr('ui.shell.config_section_supervision'), hint: tr('ui.shell.config_section_supervision_hint'), icon: 'gauge' },
          { id: 'alertas', label: tr('ui.shell.config_section_alertas'), hint: tr('ui.shell.config_section_alertas_hint'), icon: 'bell' },
          { id: 'notificaciones', label: tr('ui.shell.config_section_notificaciones'), hint: tr('ui.shell.config_section_notificaciones_hint'), icon: 'send' },
          { id: 'mapas', label: tr('ui.shell.config_section_mapas'), hint: tr('ui.shell.config_section_mapas_hint'), icon: 'map-pin' },
          { id: 'datos', label: tr('ui.shell.config_section_datos'), hint: tr('ui.shell.config_section_datos_hint'), icon: 'upload' },
          { id: 'reportes', label: tr('ui.shell.config_section_reportes'), hint: tr('ui.shell.config_section_reportes_hint'), icon: 'file-text' },
          { id: 'garantias', label: tr('ui.shell.config_section_garantias'), hint: tr('ui.shell.config_section_garantias_hint'), icon: 'shield' },
          { id: 'qr', label: tr('ui.shell.config_section_qr'), hint: tr('ui.shell.config_section_qr_hint'), icon: 'grid' },
          { id: 'etiquetas', label: tr('ui.shell.config_section_etiquetas'), hint: tr('ui.shell.config_section_etiquetas_hint'), icon: 'printer' }
        ];
      },
      deviceImagePresets() {
        return [
          { label: tr('ui.shell.device_desktop'), icon: 'desktop', src: 'assets/svg/devices/desktop.svg' },
          { label: tr('ui.shell.device_notebook'), icon: 'laptop', src: 'assets/svg/devices/notebook.svg' },
          { label: tr('ui.shell.device_server'), icon: 'server', src: 'assets/svg/devices/server.svg' },
          { label: tr('ui.shell.device_printer'), icon: 'printer', src: 'assets/svg/devices/printer.svg' },
          { label: tr('ui.shell.device_switch'), icon: 'network', src: 'assets/svg/devices/switch.svg' },
          { label: tr('ui.shell.device_monitor'), icon: 'display', src: 'assets/svg/devices/monitor.svg' },
          { label: tr('ui.shell.device_camera'), icon: 'camera', src: 'assets/svg/devices/camera.svg' },
          { label: tr('ui.shell.device_ups'), icon: 'battery', src: 'assets/svg/devices/ups.svg' },
          { label: tr('ui.shell.device_vm'), icon: 'layers', src: 'assets/svg/devices/vm.svg' },
          { label: tr('ui.shell.device_container'), icon: 'box', src: 'assets/svg/devices/container.svg' },
          { label: tr('ui.shell.device_other'), icon: 'package', src: 'assets/svg/devices/other.svg' }
        ];
      },
      integrationDefinitions() {
        return [
          {
            id: 'anydesk',
            name: 'AnyDesk',
            icon: 'remote',
            description: tr('ui.shell.integration_anydesk_description'),
            urlLabel: tr('ui.shell.integration_anydesk_url_label'),
            placeholder: 'https://anydesk.com/es/remote-support',
            hint: tr('ui.shell.integration_anydesk_hint')
          },
          {
            id: 'rmm',
            name: 'Tactical RMM',
            icon: 'activity',
            description: tr('ui.shell.integration_rmm_description'),
            urlLabel: tr('ui.shell.integration_rmm_url_label'),
            placeholder: 'https://rmm.assetmanager.local/agents/',
            hint: tr('ui.shell.integration_rmm_hint')
          }
        ];
      },
      configSectionLabel() {
        const section = this.configSections.find((item) => item.id === (this.route.section || 'general'));
        return section ? section.label : tr('ui.shell.config_fallback');
      },
      anyIntegrationEnabled() {
        return this.settings.anydeskEnabled || this.settings.rmmEnabled;
      },
      filteredAssets() {
        const term = this.prefs.search.trim().toLocaleLowerCase('es');
        const filtered = this.assets.filter((asset) => {
          if (this.prefs.category !== 'all' && asset.category !== this.prefs.category) return false;
          if (this.prefs.site !== 'all' && asset.site !== this.prefs.site) return false;
          if (this.workspaceInventory.status !== 'all' && asset.statusId !== this.workspaceInventory.status) return false;
          if (this.workspaceInventory.location !== 'all' && asset.locationId !== this.workspaceInventory.location) return false;
          if (!term) return true;
          const haystack = [
            asset.name, asset.code, asset.id, asset.brand, asset.model, asset.ip,
            this.assigneeLabel(asset), asset.type, this.categoryLabel(asset.category), this.siteLabel(asset.site),
            this.locationLabel(asset)
          ].join(' ').toLocaleLowerCase('es');
          return haystack.indexOf(term) !== -1;
        });
        const direction = this.prefs.sort.endsWith('-desc') ? -1 : 1;
        const field = this.prefs.sort.replace(/-(asc|desc)$/, '');
        const compare = collator({ numeric: true, sensitivity: 'base' });
        const valueFor = (asset) => {
          if (field === 'id') return asset.id;
          if (field === 'site') return this.siteLabel(asset.site);
          if (field === 'assignee') return this.assigneeLabel(asset) || '\uffff';
          if (field === 'type') return asset.type;
          return asset.name;
        };
        return filtered.sort((a, b) => compare.compare(valueFor(a), valueFor(b)) * direction);
      },
      assignedCount() {
        return this.assets.filter((asset) => !!this.assigneeLabel(asset)).length;
      },
      ...window.AssetAppPeopleComputed,
      ...window.AssetPhase6.computed,
      remoteCount() {
        const anydesk = this.settings.anydeskEnabled;
        const rmm = this.settings.rmmEnabled;
        return this.assets.filter((asset) => (anydesk && !!asset.anydeskId) || (rmm && !!asset.rmmAgentId)).length;
      },
      activeFilterCount() {
        let count = 0;
        if (this.prefs.search.trim()) count += 1;
        if (this.prefs.category !== 'all') count += 1;
        if (this.prefs.site !== 'all') count += 1;
        return count;
      },
      filterDescription() {
        const pieces = [];
        if (this.prefs.search.trim()) pieces.push('“' + this.prefs.search.trim() + '”');
        if (this.prefs.category !== 'all') pieces.push(this.categoryLabel(this.prefs.category));
        if (this.prefs.site !== 'all') pieces.push(this.siteLabel(this.prefs.site));
        return pieces.join(' · ');
      },
      currentAsset() {
        if (this.route.name !== 'detail' || !this.route.assetId) return null;
        return this.assets.find((asset) => asset.id === this.route.assetId) || null;
      },
      statusAsset() {
        if (!this.statusDialog.assetId) return null;
        return this.assets.find((asset) => asset.id === this.statusDialog.assetId) || null;
      },
      retireAsset() {
        if (!this.retireDialog.assetId) return null;
        return this.assets.find((asset) => asset.id === this.retireDialog.assetId) || null;
      },
      deleteAsset() {
        if (!this.deleteDialog.assetId) return null;
        return this.assets.find((asset) => asset.id === this.deleteDialog.assetId) || null;
      },
      maintenance() {
        return this.maintenancePlanning;
      },
      maintenanceOverdueCount() {
        const overview = this.maintenanceApi && this.maintenanceApi.overview;
        if (!overview) return 0;
        if (overview.overdue !== null) return overview.overdue;
        const today = window.AssetMaintEngine.today();
        return this.maintenancePlans.reduce((total, plan) => {
          if (plan.status !== 'active') return total;
          const days = window.AssetMaintEngine.daysUntil(plan.dueOn, today);
          return days !== null && days < 0 ? total + 1 : total;
        }, 0);
      },
      monitorAlertCount() {
        return this.monitoringActiveAlertCount || 0;
      },
      uiProjection() {
        return window.AssetExtensions && typeof window.AssetExtensions.compositionFor === 'function'
          ? window.AssetExtensions.compositionFor(this)
          : { additions: {}, hidden: {}, replacement: {}, ignored: [], candidates: [] };
      },
      // Route-bound composition target. Protected administration routes such
      // as users, security, extension management and system return an empty
      // target, so their core surfaces are never suppressible.
      uiRouteTarget() {
        const route = this.route || {};
        const pages = {
          panel: 'page.panel', inventory: 'page.inventory', conversation: 'page.conversation',
          maintenance: 'page.maintenance', incident: 'page.incident', monitoring: 'page.monitoring',
          map: 'page.map', graph: 'page.graph', datos: 'page.datos', reports: 'page.reports',
          warranties: 'page.warranties', labels: 'page.labels', people: 'page.people',
          person: 'page.person', detail: 'page.detail', reportAsset: 'page.reportAsset',
          monitorDevice: 'page.monitorDevice', monitorAlert: 'page.monitorAlert',
          notifications: 'page.notifications', help: 'page.help'
        };
        if (route.name === 'config') {
          const target = 'config.' + (route.section || '');
          return window.UIComposition && window.UIComposition.isKnownTarget(target) ? target : '';
        }
        const target = pages[route.name] || '';
        return window.UIComposition && window.UIComposition.isKnownTarget(target) ? target : '';
      },
      pageLabel() {
        if (this.route.name === 'help') return tr('ui.page.help');
        if (this.route.name === 'reports') return tr('ui.page.reports');
        if (this.route.name === 'warranties') return tr('ui.page.warranties');
        if (this.route.name === 'labels') return tr('ui.page.labels');
        if (this.route.name === 'reportAsset') return tr('ui.page.report_asset');
        if (this.route.name === 'detail' && this.currentAsset) return this.currentAsset.id;
        if (this.route.name === 'maintenance' || this.route.name === 'incident') return tr('ui.page.maintenance');
        if (this.route.name === 'monitoring') return tr('ui.page.monitoring');
        if (this.route.name === 'monitorDevice') return this.route.assetId || tr('ui.page.device');
        if (this.route.name === 'monitorAlert') return this.route.alertId || tr('ui.page.alert');
        if (this.route.name === 'notifications') return tr('ui.page.notifications');
        if (this.route.name === 'person') return this.currentPerson ? this.currentPerson.name : tr('ui.page.people');
        if (this.route.name === 'users') return tr('ui.page.users');
        if (this.route.name === 'user') return this.currentAccount ? this.currentAccount.name : tr('ui.page.user');
        if (this.route.name === 'denied') return tr('ui.page.denied');
        if (this.route.name === 'people') return tr('ui.page.people');
        if (this.route.name === 'panel') return tr('ui.page.panel');
        if (this.route.name === 'inventory') return tr('ui.page.inventory');
        if (this.route.name === 'conversation') return tr('ui.page.conversation');
        if (this.route.name === 'extension') {
          const link = this.extensionPageLinks.find((entry) => entry.extensionId === this.route.extensionId && entry.pageId === this.route.pageId);
          return link ? link.label : tr('ui.page.extension');
        }
        if (this.route.name === 'map' || this.route.name === 'graph') return tr('ui.page.infrastructure');
        if (this.route.name === 'datos') return tr('ui.page.data');
        if (this.route.name === 'config') return tr('ui.page.settings');
        return tr('ui.page.login');
      },
      remoteDialogId() {
        if (!this.remoteDialog.asset) return '';
        return this.remoteDialog.kind === 'anydesk'
          ? this.remoteDialog.asset.anydeskId
          : this.remoteDialog.asset.rmmAgentId;
      },
      remoteDialogEndpoint() {
        if (!this.remoteDialog.asset) return '';
        if (this.remoteDialog.kind === 'rmm') {
          return this.settings.rmmUrl.replace(/\/+$/, '') + '/' + encodeURIComponent(this.remoteDialogId);
        }
        return this.settings.anydeskUrl;
      },
      themeResolved() {
        return this.themeMode === 'system' ? this.themeResolvedMode : this.themeMode;
      },
      themeToggleLabel() {
        return this.themeResolved === 'dark' ? tr('ui.shell.theme_light') : tr('ui.shell.theme_dark');
      },
      themeToggleText() {
        return this.themeResolved === 'dark' ? tr('ui.shell.theme_light_label') : tr('ui.shell.theme_dark_label');
      },
      sidebarPinned() {
        return this.sidebarPinnedPref && this.sidebarDockable;
      },
      sidebarPinLabel() {
        return tr('ui.shell.sidebar_pin');
      },
      sidebarPinTitle() {
        return this.sidebarPinned
          ? tr('ui.shell.sidebar_pinned')
          : tr('ui.shell.sidebar_pin');
      }
    }, window.AssetInventory.computed, window.AssetOrganization.computed, window.AssetRedundancy.computed, window.AssetMaintenanceApi.computed, window.AssetMonitoringApi.computed, window.AssetPhase9.computed, window.AssetExtensions.computed),
    watch: {
      activeUserId() { this.changeAppearanceUser(); this.phase10IdentityChanged(); this.identityChangedPhase6(); this.identityChangedPhase9(); this.maintainMaintenanceIdentity(); this.maintainMonitoringIdentity(); this.extensionsIdentityChanged(); this.maintainInventoryCount(); },
      serverInventory: { immediate: true, handler() { this.maintainInventoryCount(); } },
      serverPermissions: { deep: true, handler() { this.extensionsIdentityChanged(); } },
      'config.general': { deep: true, handler(value) {
        Object.assign(this.appearance.active.branding, value);
        this.syncAppearance();
      } },
      prefs: {
        deep: true,
        handler(value) {
          Store.writeJSON(window.localStorage, Store.KEYS.prefs, value);
        }
      },
      // The directory is a bounded server query: a real filter change asks the
      // server again from offset 0 instead of re-reading the page in memory.
      'prefs.people': {
        deep: true,
        handler() {
          if (!this.serverOrganizationMode || !this.organizationDirectoryMode) return;
          if (!this.route || this.route.name !== 'people') return;
          this.scheduleOrganizationPeopleSearch();
        }
      },
      // The assignment sheet searches the same bounded endpoints it reads.
      'assignDialog.search'(value) {
        if (!this.serverOrganizationMode || !this.assignDialog || !this.assignDialog.open) return;
        if (this.assignDialog.mode === 'person') this.scheduleOrganizationPeopleSearch({ query: value });
        else this.scheduleOrganizationAssetSearch(value);
      },
      people: {
        deep: true,
        handler(value) {
          // The server directory is authoritative in phase 5; it never reaches
          // localStorage, so a load, a 500 or a 401 cannot persist server people.
          if (this.serverOrganizationMode) return;
          Store.writeJSON(window.localStorage, Store.KEYS.people, value);
        }
      },
      assetConfigTab(value) {
        if (value !== 'formularios' || this.formDraft) return;
        const categories = this.inventoryCatalogReady ? this.inventoryConfigCategories() : this.categories;
        if (categories.length) this.openFormDraft(categories[0].id);
      },
      assets: {
        deep: true,
        handler(value) {
          Store.writeJSON(window.localStorage, Store.KEYS.assets, value);
        }
      },
      assetAdmin: {
        deep: true,
        handler(value) {
          Store.writeJSON(window.localStorage, Store.KEYS.assetAdmin, value);
        }
      },
      maps: {
        deep: true,
        handler(value) {
          Store.writeJSON(window.localStorage, Store.KEYS.maps, value);
        }
      },
      route: {
        immediate: true,
        handler(next,previous) {
          this.updateDocumentTitle();
          this.handleWorkspaceRoute(next,previous);
          this.handlePhase10Route(next);
          this.handleInventoryRoute(next,previous);
          this.handleOrganizationRoute(next,previous);
          this.handleRedundancyRoute(next,previous);
          this.handleMaintenanceRoute(next,previous);
          this.handleMonitoringRoute(next,previous);
          this.handleExtensionRoute(next);
        }
      },
      inventoryFilters: {
        deep: true,
        handler() {
          if (this.authenticated && this.route.name === 'inventory') this.scheduleInventorySearch();
        }
      },
      authenticated(value) {
        if (!value) {
          this.phase10Clear();
          this.clearInventoryState();
          this.clearOrganizationState();
          this.clearRedundancyState();
          this.clearPhase6State();
          this.clearPhase9State();
          this.clearMaintenanceState();
          this.clearMonitoringState();
          this.extensionsStop();
        } else {
          this.maintainMaintenanceIdentity();
          this.maintainMonitoringIdentity();
          this.extensionsLoad({ force: true });
        }
      },
      mobileNavOpen(value) {
        if (value) this.userMenuOpen = false;
      }
    },
    created() {
      window.AssetAccess.start(this);
      this.changeAppearanceUser();
      this.startAppearance();
      this.phase10Start();
      const parsed = this.parseRoute();
      let next = parsed;
      if (!this.authenticated && parsed.name === 'reportAsset' && parsed.section === 'publico' && parsed.shareToken) {
        // The tokenized public report is the only screen available before a
        // session exists; every other route still requires the real login.
        next = parsed;
      } else if (!this.authenticated) {
        next = { name: 'login', assetId: null, personId: null, section: null };
      } else if (parsed.name === 'login') {
        next = { name: 'panel', assetId: null, personId: null, section: null };
      } else if (parsed.name === 'detail' && !this.assetExists(parsed.assetId)) {
        next = { name: 'inventory', assetId: null, personId: null, section: null };
      } else if (parsed.name === 'person' && !this.serverOrganizationMode && !this.people.some((person) => person.id === parsed.personId)) {
        next = { name: 'people', assetId: null, personId: null, section: null };
      }
      next = this.accessRoute(next);
      this.route = next;
      this.ensureHash(this.hashFor(next));
      window.addEventListener('hashchange', this.handleHashChange);
      window.addEventListener('asset-theme-change', this.handleThemeChange);
      document.addEventListener('pointerdown', this.handleDocumentPointerDown);
      document.addEventListener('keydown', this.handleGlobalKeydown);
      if (window.AssetSidebar) {
        this.applySidebarState(window.AssetSidebar.capture());
        this.stopSidebarWatch = window.AssetSidebar.watch(this.applySidebarState);
      }
    },
    beforeUnmount() {
      this.extensionsStop();
      this.phase10Stop();
      this.stopAppearance();
      this.clearInventoryState();
      this.clearOrganizationState();
      this.clearRedundancyState();
      this.clearPhase6State();
      this.clearPhase9State();
      this.clearMaintenanceState();
      this.clearMonitoringState();
      window.AssetAccess.stop(this);
      window.removeEventListener('hashchange', this.handleHashChange);
      window.removeEventListener('asset-theme-change', this.handleThemeChange);
      document.removeEventListener('pointerdown', this.handleDocumentPointerDown);
      document.removeEventListener('keydown', this.handleGlobalKeydown);
      if (this.stopSidebarWatch) this.stopSidebarWatch();
      if (this.remoteTimer) window.clearTimeout(this.remoteTimer);
      if (this.toastTimer) window.clearTimeout(this.toastTimer);
    },
      methods: window.AssetAccess.guardMethods(Object.assign({}, window.AssetMethods, window.AssetConfigMethods, window.AssetPeopleMethods, window.AssetThemeMethods, window.AssetAppearanceMethods, window.AssetSidebarMethods, window.AssetAdminMethods, window.AssetOpsMethods, window.AssetAccess.methods, window.AssetWorkspaceRuntime.methods, window.AssetInventory.methods, window.AssetOrganization.methods, window.AssetRedundancy.methods, window.AssetPhase6.methods, window.AssetMaintenanceApi.methods, window.AssetMonitoringApi.methods, window.AssetPhase9.methods, window.AssetExtensions.methods, RouteMethods))
  };
  const app = window.Vue.createApp(appOptions);
  // D1: the single vue-i18n instance provides `$t`/`$n`/`$d` to every component;
  // the guard keeps the factory usable when a host stubs `createApp`.
  if (typeof app.use === 'function' && window.ItsmI18n) app.use(window.ItsmI18n.i18n);
  // Vue local registrations do not propagate to a module's child components.
  // Only these six stable host primitives are part of the public SDK.
  if (typeof app.component === 'function') {
    ['AppIcon', 'ModalShell', 'ItsmTable', 'ItsmField', 'ItsmStatus', 'ItsmError'].forEach((name) => {
      app.component(name, appOptions.components[name]);
    });
  }
  // Trusted native modules render through this Vue instance. Core component
  // names are reserved so a module can never replace the host design system.
  window.ITSMExtensions.configure({
    app,
    coreComponents: Object.keys(appOptions.components)
  });
  app.mount(target || '#app');
  return app;
  };
  // Preserve direct static usage and the original Node harness contract.
  if (!window.AssetReactHost) window.mountAssetApp('#app');
})();
