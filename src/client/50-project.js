    /* ── project chip + library (the only full-screen surface) ─────── */
    function ProjectChip(props) {
      var t = props.t;
      var store = useZipxStore();
      var sid = String(props.sessionId || '');
      useEffect(function () {
        if (!sid) return;
        RUNTIME.lastSessionId = sid;
        void loadSession(sid).then(function () {
          if (RUNTIME.pendingProject && !STORE.projectId) {
            var pending = RUNTIME.pendingProject;
            RUNTIME.pendingProject = '';
            void bindProject(sid, pending);
          }
        });
      }, [sid]);
      var project = store.project;
      var state = store.state;
      var current = state && state.current ? state.current : {};
      var gate = state && state.gates ? state.gates.overall : 'unchecked';
      if (!store.projectId) {
        return h('button', {
          type: 'button', style: S.btn, title: t('chip.switch'), onClick: openLibrary,
        }, h(ZipxIcon, { size: 13 }), h('span', null, t('chip.unbound')));
      }
      var title = (project && project.title) || shortId(store.projectId);
      return h('button', {
        type: 'button',
        style: Object.assign({}, S.btn, { maxWidth: '46vw' }),
        title: t('chip.tooltip', { title: title, step: current.label || current.step || '—', gate: gateLabel(t, gate) }),
        onClick: openLibrary,
      },
        h(ZipxIcon, { size: 13 }),
        h('span', { style: Object.assign({}, S.nowrap, { fontWeight: 600 }) }, title),
        h('span', { style: Object.assign({}, S.mono, { color: C.muted }) }, current.step || ''),
        h('span', { style: { color: gateColor(gate), display: 'inline-flex' } }, h('span', { style: Object.assign({}, S.dot, { background: gateColor(gate) }) })),
        h(ChevronIcon, null));
    }

    function ProjectRow(props) {
      var t = props.t; var item = props.item || {};
      var active = props.active;
      return h('button', {
        type: 'button',
        style: Object.assign({}, S.item, active ? S.itemOn : null),
        onClick: function () { if (props.onOpen) props.onOpen(item); },
      },
        h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
          h('div', { style: Object.assign({}, S.nowrap, { fontWeight: 600 }) }, item.title || shortId(item.id)),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 } },
            h('span', { style: Object.assign({}, S.mono, { color: C.muted }) }, item.current_step || '—'),
            h('span', { style: { color: gateColor(item.gates) } }, gateLabel(t, item.gates)),
            item.updated_at ? h('span', { style: { color: C.muted, fontSize: 11 } }, fmtTime(item.updated_at)) : null)),
        active ? h(Badge, { color: C.accent, tint: TINT.accent }, t('projects.bound')) : h(ChevronIcon, null));
    }

    function CreateSheet(props) {
      var t = props.t;
      var title = useState('');
      var genre = useState('悬疑');
      var form = useState('film');
      var episodes = useState('1');
      var duration = useState('180');
      var busy = useState(false);
      var error = useState('');
      var onSubmit = function () {
        busy[1](true); error[1]('');
        var body = {
          title: title[0].trim(), genre: genre[0].trim(), form: form[0],
          episodes: Number(episodes[0]) || undefined,
          duration_s: Number(duration[0]) || undefined,
          auto_start: false,
        };
        call('/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (res) {
          busy[1](false);
          if (res.ok && res.json) {
            var id = String(res.json.project_id || (res.json.project && res.json.project.id) || '');
            var sid = RUNTIME.lastSessionId || STORE.sessionId;
            if (id && sid) {
              void bindProject(sid, id).then(function () { if (props.onCreated) props.onCreated(id); });
            } else if (props.onCreated) props.onCreated(id);
            return;
          }
          error[1](apiErrorText(t, res));
        });
      };
      return h('div', { style: Object.assign({}, S.card, { marginBottom: 10 }) },
        h('div', { style: S.cardTitle }, t('projects.new')),
        h('div', { style: { fontSize: 11.5, color: C.muted, marginBottom: 6 } }, t('projects.newHint')),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 } },
          h(Field, { label: t('projects.createTitle'), value: title[0], onChange: title[1] }),
          h(Field, { label: t('projects.createGenre'), value: genre[0], onChange: genre[1] }),
          h(Field, { label: t('projects.createForm'), value: form[0], onChange: form[1], placeholder: 'film / series' }),
          h(Field, { label: t('projects.createEpisodes'), value: episodes[0], onChange: episodes[1], type: 'number' }),
          h(Field, { label: t('projects.createDuration'), value: duration[0], onChange: duration[1], type: 'number' })),
        error[0] ? h(ErrLine, null, error[0]) : null,
        h('div', { style: { display: 'flex', gap: 6, marginTop: 8 } },
          h(Btn, { primary: true, disabled: busy[0] || !title[0].trim() || !genre[0].trim(), onClick: onSubmit }, busy[0] ? t('loading') : t('projects.createSubmit')),
          h(Btn, { onClick: props.onCancel }, t('cancel'))));
    }

    function ProjectLibrary(props) {
      var t = props.t;
      var list = useProjectList();
      var store = useZipxStore();
      var creating = useState(false);
      var status = useState(null);
      useEffect(function () {
        void refreshProjects();
        call(AUTH + '/status').then(function (res) { if (res.ok && res.json) status[1](res.json); });
      }, []);
      var sid = RUNTIME.lastSessionId || STORE.sessionId;
      var open = function (item) {
        if (!item || !item.id) return;
        if (!sid) {
          // Opened from the sidebar before any conversation rendered: hand the choice
          // to the next ProjectChip mount instead of inventing a global binding.
          RUNTIME.pendingProject = item.id;
          closeLibrary();
          return;
        }
        void bindProject(sid, item.id).then(function (res) {
          if (res && res.ok) closeLibrary();
        });
      };
      var connected = status[0] ? status[0].connected === true : null;
      return h('div', { style: S.root },
        h('div', { style: S.header },
          h(ZipxIcon, { size: 16 }),
          h('h2', { style: S.title }, t('projects.title')),
          h('span', { style: S.sub }, connected === false ? t('notConnected') : connected === true ? t('connected') : ''),
          h('span', { style: S.spacer }),
          h(Btn, { icon: h(RefreshIcon, null), onClick: function () { void refreshProjects(); void loadSession(sid, true); } }, t('refresh')),
          h(Btn, { primary: true, onClick: function () { creating[1](!creating[0]); } }, t('projects.new'))),
        h('div', { style: S.body },
          creating[0] ? h(CreateSheet, { t: t, onCancel: function () { creating[1](false); }, onCreated: function (id) { creating[1](false); void refreshProjects(); if (id) open({ id: id }); } }) : null,
          h('div', { style: { display: 'flex', gap: 8, marginBottom: 10 } },
            h('span', { style: { fontSize: 12, color: C.muted } }, t('projects.total', { total: list.total })),
            h('span', { style: S.spacer })),
          list.error ? h(ErrLine, null, list.error) : null,
          list.loading && !list.items.length ? h(Empty, null, t('loading')) : null,
          !list.loading && !list.items.length ? h(Empty, null, t('projects.empty')) : null,
          h('div', { style: S.list }, list.items.map(function (item) {
            return h(ProjectRow, { key: item.id, t: t, item: item, active: item.id === store.projectId, onOpen: open });
          })),
          h('div', { style: S.sep }),
          h('div', { style: { fontSize: 11.5, color: C.muted } }, t('panel.hint'))));
    }

    function HeroOptions(props) {
      var t = props.t;
      return h('button', { type: 'button', style: S.ghost, onClick: openLibrary, title: t('hero.desc') },
        h(ZipxIcon, { size: 12 }), h('span', null, t('hero.title')));
    }

    function LegacyStudio(props) {
      var t = props.t;
      var store = useZipxStore();
      var src = useState('');
      var error = useState('');
      useEffect(function () {
        if (!store.projectId) return;
        call('/zipx-embed/url?project_id=' + encodeURIComponent(store.projectId) + '&step=story').then(function (res) {
          if (res.ok && res.json && res.json.url) src[1](res.json.url);
          else error[1](apiErrorText(t, res));
        });
      }, [store.projectId]);
      return h('div', { style: S.root },
        h('div', { style: S.header }, h(ZipxIcon, { size: 16 }), h('h2', { style: S.title }, t('legacy.title')), h('span', { style: S.spacer }), h(Btn, { onClick: openLibrary }, t('projects.title'))),
        h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' } },
          !store.projectId ? h(Empty, null, t('workbench.empty')) : null,
          error[0] ? h('div', { style: S.body }, h(ErrLine, null, error[0])) : null,
          store.projectId && src[0] ? h('iframe', { src: src[0], style: { border: 'none', flex: '1 1 auto', width: '100%', minHeight: 480 }, title: t('legacy.title') }) : null,
          store.projectId && !src[0] ? h(Empty, null, t('loading')) : null));
    }
