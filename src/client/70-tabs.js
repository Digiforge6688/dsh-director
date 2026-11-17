    /* ── right-sidebar workbench / artifact / delivery / legacy ────── */
    function tabParams(props) {
      try { return (props.useTabInfo().tab.navigation.params) || {}; } catch (e) { return {}; }
    }

    function artifactItems(payload, step) {
      var out = payload && payload.output ? payload.output : {};
      var keys = step ? [step] : Object.keys(out);
      var items = [];
      for (var i = 0; i < keys.length; i += 1) {
        var key = keys[i];
        var entry = out[key];
        if (!entry) continue;
        var urls = entry.media_urls || {};
        var paths = Object.keys(urls);
        for (var j = 0; j < paths.length; j += 1) {
          var path = paths[j];
          var lower = path.toLowerCase();
          var kind = /\.(mp4|webm|mov|mkv)$/.test(lower) ? 'video' : /\.(png|jpe?g|webp|gif|svg)$/.test(lower) ? 'image' : /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac)$/.test(lower) ? 'audio' : 'other';
          items.push({ step: key, path: path, kind: kind, url: urls[path] });
        }
      }
      return items;
    }

    function WorkbenchTab(props) {
      var t = props.t;
      var store = useZipxStore();
      var params = tabParams(props);
      var projectId = String(params.projectId || store.projectId || '');
      var view = String(params.view || 'workbench');
      var selected = useState('');
      var artifacts = useState(null);
      var steps = useState([]);
      var doctor = useState(null);
      var error = useState('');
      var sid = String(props.sessionId || '');
      useEffect(function () {
        if (sid) { RUNTIME.lastSessionId = sid; void loadSession(sid); }
        if (projectId && !store.projectId) {
          void call('/session/' + encodeURIComponent(sid)).then(function () { void loadSession(sid, true); });
        }
      }, [sid, projectId]);
      useEffect(function () {
        if (!projectId) return;
        void call('/workflow-steps?project_id=' + encodeURIComponent(projectId)).then(function (res) {
          if (res.ok && res.json) steps[1](asArray(res.json.steps || res.json));
        });
        if (view === 'doctor') {
          void call(DOCTOR).then(function (res) { if (res.ok) doctor[1](res.json); });
        }
      }, [projectId, view]);
      var step = selected[0] || (store.state && store.state.current && store.state.current.step) || '';
      useEffect(function () {
        if (!projectId || !step) return;
        void call('/project/' + encodeURIComponent(projectId) + '/artifacts?slim=1&media=1&steps=' + encodeURIComponent(step)).then(function (res) {
          if (res.ok) artifacts[1](res.json); else error[1](apiErrorText(t, res));
        });
      }, [projectId, step]);
      if (view === 'doctor') {
        return h('div', { style: S.body },
          h('h3', { style: S.title }, t('workbench.doctor')),
          doctor[0] ? h('pre', { style: S.code }, JSON.stringify(doctor[0], null, 2)) : h(Empty, null, t('loading')),
          h('div', { style: { marginTop: 8 } }, h(Btn, { icon: h(RefreshIcon, null), onClick: function () { doctor[1](null); void call(DOCTOR).then(function (res) { if (res.ok) doctor[1](res.json); }); } }, t('refresh'))));
      }
      if (!projectId) {
        return h('div', { style: S.body }, h(Empty, null, t('workbench.empty')), h('div', { style: { textAlign: 'center' } }, h(Btn, { primary: true, onClick: openLibrary }, t('projects.title'))));
      }
      var current = store.state && store.state.current ? store.state.current : {};
      return h('div', { style: S.body },
        h('div', { style: S.row },
          h('h3', { style: S.title }, store.project ? store.project.title : shortId(projectId)),
          h('span', { style: S.spacer }),
          h(Btn, { icon: h(RefreshIcon, null), onClick: function () { void loadSession(sid, true); } }, t('refresh'))),
        h('div', { style: { marginTop: 6 } }, h(StepLine, { t: t, current: current, gate: store.state && store.state.gates ? store.state.gates.overall : 'unchecked' })),
        h('div', { style: S.sep }),
        h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4 } }, t('workbench.steps')),
        h('div', { style: S.list }, steps[0].map(function (item, i) {
          var id = String(item.id || item.step || '');
          var label = item.label || item.label_zh || item.name || id;
          var on = id === step;
          return h('button', { key: id + i, type: 'button', style: Object.assign({}, S.item, on ? S.itemOn : null), onClick: function () { selected[1](id); } },
            h('span', { style: Object.assign({}, S.mono, { color: C.muted, width: 22 }) }, String(i + 1)),
            h('span', { style: { flex: '1 1 auto' } }, label),
            on ? h(Badge, { color: C.accent, tint: TINT.accent }, t('state.step')) : null);
        })),
        h('div', { style: S.sep }),
        h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4 } }, t('workbench.artifacts')),
        error[0] ? h(ErrLine, null, error[0]) : null,
        artifacts[0] ? h(MediaGrid, { items: artifactItems(artifacts[0], step), onOpen: function (item) { openRightTab('zipx-artifact', { projectId: projectId, step: item.step, path: item.path, url: item.url, kind: item.kind }); } }) : h(Empty, null, t('loading')),
        h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 } },
          h(Btn, { primary: true, onClick: function () { sendToDirector(props, '推进当前步骤，先预检再按批准执行。'); } }, t('workbench.advance')),
          h(Btn, { onClick: function () { sendToDirector(props, '重做这一步，先预检再按批准执行。'); } }, t('workbench.regenerate')),
          h(Btn, { onClick: function () { openRightTab('zipx-delivery', { projectId: projectId }); } }, t('workbench.delivery')),
          h(Btn, { onClick: function () { openRightTab('zipx-studio', { projectId: projectId, step: step }); } }, t('workbench.legacy'))));
    }

    function ArtifactTab(props) {
      var t = props.t;
      var store = useZipxStore();
      var params = tabParams(props);
      var projectId = String(params.projectId || store.projectId || '');
      var path = String(params.path || '');
      var url = String(params.url || '');
      var kind = String(params.kind || '');
      var payload = useState(null);
      var error = useState('');
      useEffect(function () {
        if (url || !projectId) return;
        void call('/project/' + encodeURIComponent(projectId) + '/artifacts?slim=1&media=1').then(function (res) {
          if (!res.ok) { error[1](apiErrorText(t, res)); return; }
          payload[1](res.json);
        });
      }, [projectId, url]);
      var item = url ? { path: path, url: url, kind: kind || (/mp4|webm|mov/i.test(path) ? 'video' : 'image') } : null;
      if (!item && payload[0]) {
        var all = artifactItems(payload[0], '');
        for (var i = 0; i < all.length; i += 1) { if (!path || all[i].path === path) { item = all[i]; break; } }
      }
      return h('div', { style: S.body },
        h('h3', { style: S.title }, t('artifact.title')),
        error[0] ? h(ErrLine, null, error[0]) : null,
        item ? h('div', { style: S.col }, h(MediaOne, { item: item }), h('a', { href: proxyMedia(item.url), target: '_blank', rel: 'noreferrer', style: S.link }, t('artifact.download'))) : h(Empty, null, t('artifact.empty')));
    }

    function DeliveryTab(props) {
      var t = props.t;
      var store = useZipxStore();
      var params = tabParams(props);
      var projectId = String(params.projectId || store.projectId || '');
      var data = useState(null);
      var error = useState('');
      var load = function () {
        if (!projectId) return;
        void call('/project/' + encodeURIComponent(projectId) + '/delivery').then(function (res) {
          if (res.ok) data[1](res.json); else error[1](apiErrorText(t, res));
        });
      };
      useEffect(load, [projectId]);
      var d = data[0];
      return h('div', { style: S.body },
        h('div', { style: S.row }, h('h3', { style: S.title }, t('deliveryTab.title')), h('span', { style: S.spacer }), h(Btn, { icon: h(RefreshIcon, null), onClick: load }, t('refresh'))),
        error[0] ? h(ErrLine, null, error[0]) : null,
        !d ? h(Empty, null, t('loading')) : d.has_compose !== true ? h(Empty, null, t('deliveryTab.empty')) : h('div', { style: S.col },
          h('div', { style: S.row, flexWrap: 'wrap' },
            h(GateBadge, { status: d.release_ok === true ? 'pass' : d.release_ok === false ? 'fail' : 'unchecked', label: d.release_ok === true ? t('delivery.ok') : d.release_ok === false ? t('delivery.notOk') : t('gate.unchecked') }),
            h(Badge, { color: C.pass }, t('delivery.pass', { n: (d.counts || {}).pass || 0 })),
            h(Badge, { color: C.warn }, t('delivery.warn', { n: (d.counts || {}).warn || 0 })),
            h(Badge, { color: C.fail }, t('delivery.fail', { n: (d.counts || {}).fail || 0 })),
            h(Badge, { color: C.muted }, t('delivery.pending', { n: (d.counts || {}).pending || 0 }))),
          d.media_url ? h('video', { src: proxyMedia(d.media_url), controls: true, preload: 'metadata', style: S.video }) : null,
          h('div', { style: S.list }, asArray(d.checklist).map(function (it, i) {
            return h('div', { key: i, style: { display: 'flex', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid ' + C.border } },
              h('span', { style: { color: gateColor(it.status), width: 48, flex: '0 0 auto' } }, it.status),
              h('span', { style: { flex: '1 1 auto' } }, it.label || it.key),
              it.note ? h('span', { style: { color: C.muted, maxWidth: 220 } }, textOf(it.note, 120)) : null);
          }))));
    }

    function LegacyStudioTab(props) {
      var t = props.t;
      var store = useZipxStore();
      var params = tabParams(props);
      var projectId = String(params.projectId || store.projectId || '');
      var step = String(params.step || 'story');
      var src = useState('');
      var error = useState('');
      useEffect(function () {
        if (!projectId) return;
        void call('/zipx-embed/url?project_id=' + encodeURIComponent(projectId) + '&step=' + encodeURIComponent(step)).then(function (res) {
          if (res.ok && res.json && res.json.url) src[1](res.json.url); else error[1](apiErrorText(t, res));
        });
      }, [projectId, step]);
      return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 420 } },
        h('div', { style: { padding: '8px 12px', fontSize: 11.5, color: C.muted, borderBottom: '1px solid ' + C.border } }, t('legacy.note')),
        error[0] ? h('div', { style: { padding: 12 } }, h(ErrLine, null, error[0])) : null,
        src[0] ? h('iframe', { src: src[0], style: { border: 'none', flex: '1 1 auto', width: '100%', minHeight: 420 }, title: t('legacy.title') }) : h(Empty, null, t('loading')));
    }
