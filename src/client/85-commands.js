    /* ── slash commands and @project references ────────────────────── */
    function registerCommands(ctx, t) {
      var ui = null;
      try { ui = ctx.get('commandUi'); } catch (e) { ui = null; }
      if (!ui || typeof ui.register !== 'function') return;
      function add(name, labelKey, descKey, run) {
        try {
          ctx.effect(function () {
            return ui.register({
              name: name,
              label: function () { return t(labelKey); },
              description: function () { return t(descKey); },
              available: function () { return true; },
              ui: { kind: 'action', run: run },
            });
          }, 'zipx:command:' + name);
        } catch (e) { /* a duplicate name must not break the plugin */ }
      }
      add('zipx', 'command.zipx', 'command.zipxDesc', function () { openLibrary(); });
      add('zipx-status', 'command.status', 'command.statusDesc', function () {
        if (!openRightTab('zipx-workbench', {})) openLibrary();
      });
      add('zipx-doctor', 'command.doctor', 'command.doctorDesc', function () {
        if (!openRightTab('zipx-workbench', { view: 'doctor' })) openLibrary();
      });
    }

    function registerProjectTrigger(ctx, t) {
      var triggers = null;
      try { triggers = ctx.get('inputTriggers'); } catch (e) { triggers = null; }
      if (!triggers || typeof triggers.registerSource !== 'function') return;
      try {
        ctx.effect(function () {
          return triggers.registerSource({
            trigger: '@',
            name: 'zipx-projects',
            order: 40,
            showGroupTitle: true,
            candidates: function () {
              return call('/projects?page=1&page_size=30&gates=1').then(function (res) {
                if (!res.ok || !res.json) return [];
                return asArray(res.json.items).map(function (item) {
                  return {
                    name: shortId(item.id),
                    label: item.title || shortId(item.id),
                    description: (item.current_step || '') + ' · ' + (item.gates || 'unknown'),
                    value: item.id,
                    hint: item.id,
                  };
                });
              });
            },
            onPick: function (pick) {
              var id = String((pick.candidate && pick.candidate.value) || '');
              var label = String((pick.candidate && pick.candidate.label) || id);
              try {
                if (pick.session && pick.session.sessionId && id) void bindProject(pick.session.sessionId, id);
              } catch (e) { /* binding is best-effort */ }
              return {
                insert: {
                  source: 'zipx-project',
                  ref: id,
                  label: label,
                  appearance: 'session',
                  clipboardText: '@' + label,
                },
              };
            },
            codec: {
              clipboardText: function (ref) { return '@' + String(ref || ''); },
              serialize: function (ref) { return Promise.resolve('<zipx_project id="' + String(ref || '') + '"/>'); },
            },
            lexicon: function () { return undefined; },
          });
        }, 'zipx:project trigger');
      } catch (e) { /* trigger is optional */ }
    }
