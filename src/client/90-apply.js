    /* ── registrations ─────────────────────────────────────────────── */
    var ZIPX_TOOLS = [
      'zipx_abort', 'zipx_advance_preflight', 'zipx_artifacts', 'zipx_bind_project', 'zipx_chat', 'zipx_confirm_step',
      'zipx_connect', 'zipx_cost', 'zipx_create_project', 'zipx_delivery', 'zipx_dispatch', 'zipx_events',
      'zipx_get_blueprint', 'zipx_get_locks', 'zipx_list_episodes', 'zipx_list_projects', 'zipx_preview_action',
      'zipx_progress', 'zipx_project_overview', 'zipx_project_state', 'zipx_read_asset', 'zipx_regenerate_item',
      'zipx_regenerate_step', 'zipx_repair_action', 'zipx_resume_step', 'zipx_review_project', 'zipx_rollback_step',
      'zipx_sign_lock', 'zipx_start', 'zipx_start_episode', 'zipx_timeline', 'zipx_turn_receipt',
      'zipx_update_blueprint', 'zipx_watch_step', 'zipx_watch_turn',
    ];

    function slot(ctx, name, options, component) {
      try {
        ctx.slots.inject(name, function () {
          return ctx.slots.register(options, component);
        });
      } catch (error) {
        try { console.warn('[zipx] slot ' + name + ' unavailable: ' + String(error && error.message ? error.message : error)); } catch (e) { /* no console */ }
      }
    }

    exports.inject = ['slots', 'locale', 'timer'];
    exports.apply = function apply(ctx) {
      RUNTIME.ctx = ctx;
      try {
        var here = new URL(window.location.href);
        RUNTIME.studioUrl = (here.searchParams.get('zipx_studio') || (here.protocol + '//' + here.hostname + ':3000')).replace(/\/+$/, '');
        RUNTIME.shell = here.searchParams.get('zipx_shell') || (window.__ZIPX_DSH_SHELL__ || 'conversation');
        RUNTIME.lastSessionId = '';
      } catch (e) {
        RUNTIME.studioUrl = 'http://localhost:3000';
        RUNTIME.shell = 'conversation';
      }
      var t = ctx.locale.bind(NS);
      ctx.effect(function () { return ctx.locale.register(NS, { zh: ZH, en: EN }); }, 'zipx: dictionaries');

      // The only full-screen panel: project library (or the explicit legacy shell).
      slot(ctx, 'sidebar.panellist', {
        name: 'sidebar.panellist', id: 'zipx', order: 20, locale: NS,
        label: function () { return t('panel'); },
      }, ZipxIcon);
      slot(ctx, 'main', {
        name: 'main', key: 'zipx', locale: NS,
        inject: function () { return { studioUrl: RUNTIME.studioUrl }; },
      }, RUNTIME.shell === 'legacy' ? LegacyStudio : ProjectLibrary);

      // Conversation-first surfaces.
      slot(ctx, 'conversation.session.header.actions', {
        name: 'conversation.session.header.actions', id: 'zipx-project', order: 100, locale: NS,
      }, ProjectChip);
      slot(ctx, 'conversation.composer.dock', {
        name: 'conversation.composer.dock', id: 'zipx-status', order: 50, locale: NS,
      }, ComposerStatus);
      slot(ctx, 'conversation.hero.options', {
        name: 'conversation.hero.options', id: 'zipx-hero', order: 30, locale: NS,
      }, HeroOptions);

      // Native cards: one keyed view per tool, specific where it matters.
      for (var i = 0; i < ZIPX_TOOLS.length; i += 1) {
        var toolName = ZIPX_TOOLS[i];
        slot(ctx, 'tool.call.toolview', {
          name: 'tool.call.toolview', key: toolName, order: 10, locale: NS,
        }, SPECIFIC_CARDS[toolName] || GenericCard);
      }

      // Settings page: connection, account, credits, budget, diagnosis.
      slot(ctx, 'settings.section', {
        name: 'settings.section', id: 'zipx', order: 60, locale: NS,
        label: function () { return t('settings.nav'); },
      }, SettingsSection);

      // Right-side workbench tabs (bodies + tab types).
      // The seat keys on the tab type's registration id, not on the openTab kind.
      slot(ctx, 'sidebar.right.pane.tab', { name: 'sidebar.right.pane.tab', key: '@zipx/dsh-plugin/workbench', locale: NS }, WorkbenchTab);
      slot(ctx, 'sidebar.right.pane.tab', { name: 'sidebar.right.pane.tab', key: '@zipx/dsh-plugin/artifact', locale: NS }, ArtifactTab);
      slot(ctx, 'sidebar.right.pane.tab', { name: 'sidebar.right.pane.tab', key: '@zipx/dsh-plugin/delivery', locale: NS }, DeliveryTab);
      slot(ctx, 'sidebar.right.pane.tab', { name: 'sidebar.right.pane.tab', key: '@zipx/dsh-plugin/studio', locale: NS }, LegacyStudioTab);
      if (typeof ctx.inject === 'function') ctx.inject(['sidebarRightTabs'], function (scope) {
        var tabs = scope.sidebarRightTabs;
        var defs = [
          { id: '@zipx/dsh-plugin/workbench', kind: 'zipx-workbench', title: 'workbench.title', guide: [{ id: 'open', order: 10, title: 'workbench.open', description: 'panel.hint' }] },
          { id: '@zipx/dsh-plugin/artifact', kind: 'zipx-artifact', title: 'artifact.title' },
          { id: '@zipx/dsh-plugin/delivery', kind: 'zipx-delivery', title: 'deliveryTab.title' },
          { id: '@zipx/dsh-plugin/studio', kind: 'zipx-studio', title: 'legacy.title' },
        ];
        for (var d = 0; d < defs.length; d += 1) {
          (function (def) {
            ctx.effect(function () {
              return tabs.register({
                id: def.id,
                kind: def.kind,
                multiple: false,
                priority: 'builtin',
                title: function () { return t(def.title); },
                guide: def.guide ? def.guide.map(function (g) {
                  return {
                    id: g.id, order: g.order,
                    title: function () { return t(g.title); },
                    description: function () { return t(g.description); },
                  };
                }) : undefined,
              });
            }, 'zipx:tab:' + def.kind);
          })(defs[d]);
        }
      });

      registerCommands(ctx, t);
      registerProjectTrigger(ctx, t);
    };
