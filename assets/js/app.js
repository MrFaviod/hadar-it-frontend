(function () {
  'use strict';

  // React calls this factory after the ordered runtime has loaded.
  window.mountAssetApp = function (target) {
  // Extracted so the phase-5 server adapter can delegate to the prototype
  // people views instead of duplicating their filter semantics.
  window.AssetAppPeopleComputed = {
      filteredPeople() {
        const filters = this.prefs.people;
        const term = filters.search.trim().toLocaleLowerCase('es');
        const collator = new Intl.Collator('es', { sensitivity: 'base' });
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
        }).sort((a, b) => collator.compare(a.name, b.name));
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
          .sort((a, b) => a.id.localeCompare(b.id, 'es', { numeric: true }));
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
          .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
      },
      assignAssets() {
        const term = this.assignDialog.search.trim().toLocaleLowerCase('es');
        return this.assets
          .filter((asset) => !asset.assigneeId)
          .filter((asset) => !term || [asset.name, asset.id, asset.type].join(' ').toLocaleLowerCase('es').indexOf(term) !== -1)
          .sort((a, b) => a.id.localeCompare(b.id, 'es', { numeric: true }));
      },
  };

  const Store = window.AssetStore;
  const initial = Store.initialState();

  const app = window.Vue.createApp({
    mixins: [{ data: window.AssetAccess.data, computed: window.AssetAccess.computed }],
    components: {
      AppIcon: window.AppIcon,
      SearchPalette: window.AssetSearchViews.SearchPalette,
      WorkspaceShortcuts: window.AssetWorkspaceViews.WorkspaceShortcuts,
      QuickIntervention: window.AssetMaintDialogs.InterventionDialog,
      QuickIncident: window.AssetMaintDialogs.IncidentDialog,
      ModalShell: window.ModalShell,
      AccessUsers: window.AssetAccessViews.AccessUsers,
      AccessUserDetail: window.AssetAccessViews.AccessUserDetail,
      AccessSecurity: window.AssetAccessViews.AccessSecurity,
      AssetEditor: window.AssetEditor,
      AssetConversation: window.AssetConversation,
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
        universalOpen: false, quickDialog: {type:'',assetId:'',intervention:null},
        config: initial.config,
        assets: initial.assets,
        relations: initial.relations,
        graphPrefs: initial.graphPrefs,
        maps: initial.maps,
        maintenance: initial.maintenance,
        monitoring: initial.monitoring,
        dashboard: window.AssetDashboardPrefs.createState(),
        documents: window.AssetReportEngine.createState(),
        warrantyPrefs: window.AssetWarrantyEngine.createPreferences(),
        labelState: window.AssetLabelEngine.createState(),
        documentContext: { ids: [], category: 'all', site: 'all', search: '' },
        explorerFilters: { categories: [], sites: [], states: [], locations: [], search: '' },
        explorerSelection: '',
        assetAdmin: initial.assetAdmin,
        ...window.AssetInventory.data(),
        ...window.AssetOrganization.data(),
        bulk: { ids: [], open: false },
        assetConfigTab: 'campos',
        assetConfigTabs: [
          { id: 'campos', label: 'Campos', icon: 'sliders' },
          { id: 'formularios', label: 'Formularios', icon: 'file-text' },
          { id: 'estados', label: 'Estados', icon: 'activity' },
          { id: 'identificacion', label: 'Identificación', icon: 'inventory' }
        ],
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
        retireDialog: { open: false, assetId: '', reason: 'Fin de vida útil', note: '', acknowledged: false },
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
        retireReasons: window.AssetAdminReasons || [],
        fieldTypes: window.AssetSchema.FIELD_TYPES,
        statusTones: [
          { value: 'ok', label: 'Operativo' },
          { value: 'warn', label: 'Atención' },
          { value: 'hold', label: 'Sin asignar' },
          { value: 'down', label: 'Baja' }
        ],
        people: initial.people,
        authenticated: initial.authenticated,
        route: { name: 'login', assetId: null, personId: null, section: null },
        prefs: initial.prefs,
        sortOptions: [
          { value: 'id-asc', label: 'Código' },
          { value: 'name-asc', label: 'Nombre A–Z' },
          { value: 'name-desc', label: 'Nombre Z–A' },
          { value: 'site-asc', label: 'Sede' },
          { value: 'assignee-asc', label: 'Responsable' },
          { value: 'type-asc', label: 'Tipo' }
        ],
        configSections: [
          { id: 'seguridad', label: 'Usuarios y permisos', hint: 'Roles y sesiones', icon: 'user' },
          { id: 'general', label: 'General', hint: 'Identidad y marca', icon: 'sliders' },
          { id: 'apariencia', label: 'Apariencia', hint: 'Branding, temas y presets', icon: 'sliders' },
          { id: 'categorias', label: 'Categorías', hint: 'Catálogo de equipos', icon: 'grid' },
          { id: 'activos', label: 'Activos', hint: 'Campos, formularios y códigos', icon: 'box' },
          { id: 'sedes', label: 'Sedes y ubicaciones', hint: 'Estructura física', icon: 'building' },
          { id: 'personas', label: 'Personas', hint: 'Departamentos y áreas', icon: 'user' },
          { id: 'integraciones', label: 'Integraciones', hint: 'AnyDesk y Tactical RMM', icon: 'remote' },
          { id: 'relaciones', label: 'Relaciones', hint: 'Vínculos y grafo', icon: 'network' },
          { id: 'mantenimiento', label: 'Mantenimiento', hint: 'Plantillas e intervalos', icon: 'refresh' },
          { id: 'supervision', label: 'Supervisión', hint: 'Comprobaciones y umbrales', icon: 'gauge' },
          { id: 'alertas', label: 'Alertas', hint: 'Silencios y ventanas', icon: 'bell' },
          { id: 'notificaciones', label: 'Notificaciones', hint: 'Canales y escalamiento', icon: 'send' },
          { id: 'mapas', label: 'Mapas y planos', hint: 'Sedes, planos y capas', icon: 'map-pin' },
          { id: 'datos', label: 'Datos e importación', hint: 'Perfiles, formatos e historial', icon: 'upload' },
          { id: 'reportes', label: 'Reportes', hint: 'Plantillas y composición', icon: 'file-text' },
          { id: 'garantias', label: 'Garantías', hint: 'Plazos y vencimientos', icon: 'shield' },
          { id: 'qr', label: 'Códigos QR', hint: 'URL base y acceso', icon: 'grid' },
          { id: 'etiquetas', label: 'Etiquetas', hint: 'Formatos de impresión', icon: 'printer' }
        ],
        deviceImagePresets: [
          { label: 'Computadora', icon: 'desktop', src: 'assets/svg/devices/desktop.svg' },
          { label: 'Notebook', icon: 'laptop', src: 'assets/svg/devices/notebook.svg' },
          { label: 'Servidor', icon: 'server', src: 'assets/svg/devices/server.svg' },
          { label: 'Impresora', icon: 'printer', src: 'assets/svg/devices/printer.svg' },
          { label: 'Switch', icon: 'network', src: 'assets/svg/devices/switch.svg' },
          { label: 'Monitor', icon: 'display', src: 'assets/svg/devices/monitor.svg' },
          { label: 'Cámara IP', icon: 'camera', src: 'assets/svg/devices/camera.svg' },
          { label: 'UPS', icon: 'battery', src: 'assets/svg/devices/ups.svg' },
          { label: 'Máquina virtual', icon: 'layers', src: 'assets/svg/devices/vm.svg' },
          { label: 'Contenedor', icon: 'box', src: 'assets/svg/devices/container.svg' },
          { label: 'Otros equipos', icon: 'package', src: 'assets/svg/devices/other.svg' }
        ],
        integrationDefinitions: [
          {
            id: 'anydesk',
            name: 'AnyDesk',
            icon: 'remote',
            description: 'Acceso remoto puntual para soporte y asistencia.',
            urlLabel: 'Dirección base de AnyDesk',
            placeholder: 'https://anydesk.com/es/remote-support',
            hint: 'Los identificadores numéricos se asignan en cada activo.'
          },
          {
            id: 'rmm',
            name: 'Tactical RMM',
            icon: 'activity',
            description: 'Gestión de agentes, monitoreo y mantenimiento.',
            urlLabel: 'URL de la instancia RMM',
            placeholder: 'https://rmm.assetmanager.local/agents/',
            hint: 'El identificador del agente se añade al final de esta dirección.'
          }
        ],
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
        generalDraft: Store.clone(initial.config.general),
        generalErrors: { organizationName: '', appName: '', logo: '', general: '' },
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
        return this.config.general.appName || 'Asset Manager';
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
      configSectionLabel() {
        const section = this.configSections.find((item) => item.id === (this.route.section || 'general'));
        return section ? section.label : 'Configuración';
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
        const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
        const valueFor = (asset) => {
          if (field === 'id') return asset.id;
          if (field === 'site') return this.siteLabel(asset.site);
          if (field === 'assignee') return this.assigneeLabel(asset) || '\uffff';
          if (field === 'type') return asset.type;
          return asset.name;
        };
        return filtered.sort((a, b) => collator.compare(valueFor(a), valueFor(b)) * direction);
      },
      assignedCount() {
        return this.assets.filter((asset) => !!this.assigneeLabel(asset)).length;
      },
      ...window.AssetAppPeopleComputed,
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
      maintenanceOverdueCount() {
        if (!this.maintenance) return 0;
        const today = window.AssetMaintEngine.today();
        return (this.maintenance.plans || []).reduce((total, plan) => {
          if (plan.paused) return total;
          return window.AssetMaintEngine.scheduleRow(this.maintenance, plan, this.assets, today).status === 'overdue' ? total + 1 : total;
        }, 0);
      },
      monitorAlertCount() {
        if (!this.monitoring || !this.maintenance) return 0;
        return (this.maintenance.alerts || []).filter((alert) => alert.state === 'open').length;
      },
      pageLabel() {
        if (this.route.name === 'reports') return 'Reportes';
        if (this.route.name === 'warranties') return 'Garantías';
        if (this.route.name === 'labels') return 'Etiquetas';
        if (this.route.name === 'reportAsset') return 'Reporte del activo';
        if (this.route.name === 'detail' && this.currentAsset) return this.currentAsset.id;
        if (this.route.name === 'maintenance' || this.route.name === 'incident') return 'Mantenimiento';
        if (this.route.name === 'monitoring') return 'Supervisión';
        if (this.route.name === 'monitorDevice') return this.route.assetId || 'Dispositivo';
        if (this.route.name === 'monitorAlert') return this.route.alertId || 'Alerta';
        if (this.route.name === 'notifications') return 'Notificaciones';
        if (this.route.name === 'person' && this.currentPerson) return this.currentPerson.name;
        if (this.route.name === 'users') return 'Usuarios';
        if (this.route.name === 'user') return this.currentAccount ? this.currentAccount.name : 'Usuario';
        if (this.route.name === 'denied') return 'Acceso denegado';
        if (this.route.name === 'people') return 'Personas';
        if (this.route.name === 'panel') return 'Panel';
        if (this.route.name === 'inventory') return 'Inventario';
        if (this.route.name === 'conversation') return 'Conversación';
        if (this.route.name === 'map' || this.route.name === 'graph') return 'Infraestructura';
        if (this.route.name === 'datos') return 'Importar y exportar';
        if (this.route.name === 'config') return 'Configuración';
        return 'Acceso';
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
        return this.themeResolved === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro';
      },
      themeToggleText() {
        return this.themeResolved === 'dark' ? 'Claro' : 'Oscuro';
      },
      sidebarPinned() {
        return this.sidebarPinnedPref && this.sidebarDockable;
      },
      sidebarPinLabel() {
        return 'Anclar el menú lateral';
      },
      sidebarPinTitle() {
        return this.sidebarPinned
          ? 'Menú anclado · clic para liberarlo'
          : 'Anclar el menú lateral';
      }
    }, window.AssetInventory.computed, window.AssetOrganization.computed),
    watch: {
      activeUserId() { this.changeAppearanceUser(); },
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
      maintenance: {
        deep: true,
        handler(value) {
          Store.writeJSON(window.localStorage, Store.KEYS.maintenance, value);
        }
      },
      monitoring: {
        deep: true,
        handler(value) {
          Store.writeJSON(window.localStorage, Store.KEYS.monitoring, value);
        }
      },
      route: {
        immediate: true,
        handler(next,previous) {
          this.updateDocumentTitle();
          this.handleWorkspaceRoute(next,previous);
          this.handleInventoryRoute(next,previous);
          this.handleOrganizationRoute(next,previous);
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
          this.clearInventoryState();
          this.clearOrganizationState();
        }
      },
      mobileNavOpen(value) {
        if (value) this.userMenuOpen = false;
      }
    },
    created() {
      window.AssetAccess.start(this);
      this.changeAppearanceUser();
      const parsed = this.parseRoute();
      let next = parsed;
      if (!this.authenticated) {
        next = { name: 'login', assetId: null, personId: null, section: null };
      } else if (parsed.name === 'login') {
        next = { name: 'inventory', assetId: null, personId: null, section: null };
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
      this.clearInventoryState();
      this.clearOrganizationState();
      window.AssetAccess.stop(this);
      window.removeEventListener('hashchange', this.handleHashChange);
      window.removeEventListener('asset-theme-change', this.handleThemeChange);
      document.removeEventListener('pointerdown', this.handleDocumentPointerDown);
      document.removeEventListener('keydown', this.handleGlobalKeydown);
      if (this.stopSidebarWatch) this.stopSidebarWatch();
      if (this.remoteTimer) window.clearTimeout(this.remoteTimer);
      if (this.toastTimer) window.clearTimeout(this.toastTimer);
    },
      methods: window.AssetAccess.guardMethods(Object.assign({}, window.AssetMethods, window.AssetConfigMethods, window.AssetPeopleMethods, window.AssetThemeMethods, window.AssetAppearanceMethods, window.AssetSidebarMethods, window.AssetAdminMethods, window.AssetOpsMethods, window.AssetAccess.methods, window.AssetWorkspaceRuntime.methods, window.AssetInventory.methods, window.AssetOrganization.methods))
  });
  app.mount(target || '#app');
  return app;
  };
  // Preserve direct static usage and the original Node harness contract.
  if (!window.AssetReactHost) window.mountAssetApp('#app');
})();
