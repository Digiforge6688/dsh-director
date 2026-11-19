    /* ── project chip + library + three-mode create wizard ─────────── */

    /** 三模式 → 后端 workflow_type（唯一映射；创建面板与工具共用同一张表）。 */
    var CREATE_MODES = [
      { id: 'idea', wf: 'idea2video' },
      { id: 'novel', wf: 'novel2video' },
      { id: 'script', wf: 'script2video' },
    ];
    function workflowTypeFor(mode) {
      for (var i = 0; i < CREATE_MODES.length; i += 1) {
        if (CREATE_MODES[i].id === mode) return CREATE_MODES[i].wf;
      }
      return 'idea2video';
    }

    /** 示例母本：只在用户点「填示例」时写入输入框，不偷偷替用户创作。 */
    var CREATE_SAMPLE = '一个跑长途的货车司机，在无人区的暴雪夜里捡到一个不肯说话的少年。'
      + '他要把货按时送到，又不能让少年冻死在路上。到达收费站时他发现少年的背包里装着一把枪。'
      + '全片 90 秒，强风雪、暖色车灯、克制对白，结局停在司机把外套盖在少年身上。';

    function ProjectChip(props) {
      var t = props.t;
      var store = useZipxStore();
      var sid = String(props.sessionId || '');
      useEffect(function () {
        // 会话作用域才拿得到 inputActions：记下来给面板按钮用（见 05-util.sendToDirector）。
        rememberInputActions(props);
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
      var archived = item.status === 'archived';
      return h('button', {
        type: 'button',
        style: Object.assign({}, S.item, active ? S.itemOn : null, archived ? { opacity: 0.72 } : null),
        onClick: function () { if (props.onOpen) props.onOpen(item); },
      },
        h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
          h('div', { style: Object.assign({}, S.nowrap, { fontWeight: 600 }) }, item.title || shortId(item.id)),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 } },
            h('span', { style: Object.assign({}, S.mono, { color: C.muted }) }, item.current_step || '—'),
            h('span', { style: { color: gateColor(item.gates) } }, gateLabel(t, item.gates)),
            archived ? h('span', { style: { color: C.muted, fontSize: 11 } }, t('projects.archived')) : null,
            item.updated_at ? h('span', { style: { color: C.muted, fontSize: 11 } }, fmtTime(item.updated_at)) : null)),
        active ? h(Badge, { color: C.accent, tint: TINT.accent }, t('projects.bound')) : h(ChevronIcon, null));
    }

    /**
     * 三模式创建向导（P0-1）。
     *
     * 一次只问三件事：做什么（创意/小说/剧本）、母本原文、以及可选的规格。
     * 所有规格都有默认值，所以最快路径 = 选模式 + 粘一段话 + 创建。
     * 创建本身不计费（/setup 只建项目）；第一步生成会在对话里单独请批准。
     */
    function CreateWizard(props) {
      var t = props.t;
      var mode = useState(props.initialMode || 'idea');
      var content = useState('');
      var title = useState('');
      var genre = useState(t('create.defaultGenre'));
      var shape = useState('film');
      var episodes = useState('1');
      var duration = useState('180');
      var template = useState('');
      var archetype = useState('');
      var aspect = useState('9:16');
      var briefBrand = useState('');
      var briefProduct = useState('');
      var briefMessage = useState('');
      var briefPoints = useState('');
      var briefCta = useState('');
      var briefAvoid = useState('');
      var briefConversion = useState('balanced');
      var briefStructure = useState('auto');
      var kbDocs = useState([]);
      var kbPick = useState([]);
      var creatorMode = useState('director');
      var metas = useState({ templates: [], archetypes: [] });
      var busy = useState(false);
      var error = useState('');
      useEffect(function () {
        void call('/zipx-meta/templates').then(function (res) {
          if (res.ok && res.json) metas[1](function (m) { return Object.assign({}, m, { templates: asArray(res.json.templates) }); });
        });
        void call('/archetypes').then(function (res) {
          if (res.ok && res.json) metas[1](function (m) { return Object.assign({}, m, { archetypes: asArray(res.json.archetypes || res.json) }); });
        });
        // 知识库文档（账号级）：创建时可勾选"只引用这几篇"；读不到就不显示选择器。
        void call('/zipx-kb/knowledge/documents').then(function (res) {
          if (res.ok && res.json) kbDocs[1](asArray(res.json.documents));
        });
      }, []);
      var wf = workflowTypeFor(mode[0]);
      var series = shape[0] === 'series' && wf !== 'script2video';
      var selected = null;
      for (var ti = 0; ti < metas[0].templates.length; ti += 1) {
        if ((metas[0].templates[ti].template_id || '') === template[0]) { selected = metas[0].templates[ti]; break; }
      }
      // 商业模板：多问三件机器搬不动的事实（品牌/产品/核心信息），其余仍由模板给默认值。
      var commercial = Boolean(selected && asArray(selected.verticals).indexOf('commercial') >= 0);
      var submit = function () {
        var text = content[0].trim();
        if (!text) { error[1](t('create.needContent')); return; }
        busy[1](true); error[1]('');
        var body = {
          title: title[0].trim() || t('create.untitled'),
          genre: genre[0].trim(),
          initial_content: text,
          workflow_type: wf,
          target_runtime_s: Number(duration[0]) || undefined,
          creation_template: template[0] || undefined,
          director_archetype: archetype[0] || undefined,
          aspect_ratio: aspect[0],
          creator_mode: creatorMode[0],
          auto_start: false,
        };
        if (series) body.story_requirements = { chapter_count: Math.max(1, Number(episodes[0]) || 1), words_per_chapter: 1200 };
        if (commercial) {
          var splitList = function (text) {
            return String(text || '').split(/[;；\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
          };
          var brief = {
            brand_name: briefBrand[0].trim(),
            product_name: briefProduct[0].trim(),
            core_message: briefMessage[0].trim(),
            selling_points: splitList(briefPoints[0]),
            must_avoid: splitList(briefAvoid[0]),
            cta: briefCta[0].trim(),
            conversion_intensity: briefConversion[0],
            structure_framework: briefStructure[0],
          };
          if (brief.brand_name || brief.product_name || brief.core_message || brief.selling_points.length || brief.cta) {
            body.campaign_brief = brief;
            body.brand_product = { brand_name: brief.brand_name, product_name: brief.product_name };
          }
        }
        void call('/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (res) {
          busy[1](false);
          if (!res.ok || !res.json) { error[1](apiErrorText(t, res)); return; }
          var id = String(res.json.project_id || (res.json.project && res.json.project.id) || '');
          var finish = function () {
            var sid = RUNTIME.lastSessionId || STORE.sessionId;
            if (id && sid) {
              void bindProject(sid, id).then(function () { if (props.onCreated) props.onCreated(id); });
              return;
            }
            if (props.onCreated) props.onCreated(id);
          };
          if (id && kbPick[0].length) {
            // 知识引用是项目级设置（/setup 不收）：create 之后补一次 PATCH，失败也照常进入项目。
            void patchProject(id, { creator_kb_doc_ids: kbPick[0] }).then(finish, finish);
            return;
          }
          finish();
        });
      };
      var modeHint = mode[0] === 'idea' ? t('create.hintIdea') : mode[0] === 'novel' ? t('create.hintNovel') : t('create.hintScript');
      return h('div', { style: Object.assign({}, S.card, { marginBottom: 10 }) },
        h('div', { style: S.cardHead }, h('span', { style: S.cardTitle }, t('create.title'))),
        h('div', { style: { fontSize: 11.5, color: C.muted, marginBottom: 8 } }, t('create.subtitle')),
        h('div', { style: S.row, flexWrap: 'wrap', marginBottom: 6 },
          CREATE_MODES.map(function (m) {
            var on = mode[0] === m.id;
            return h(Btn, { key: m.id, primary: on, onClick: function () { mode[1](m.id); } }, t('create.mode.' + m.id));
          }),
          h('span', { style: S.spacer }),
          h(Btn, { ghost: true, onClick: function () { content[1](CREATE_SAMPLE); if (!title[0]) title[1](t('create.sampleTitle')); } }, t('create.sample'))),
        h('div', { style: { fontSize: 11.5, color: C.muted, marginBottom: 6 } }, modeHint),
        h('textarea', {
          style: Object.assign({}, S.input, { height: 132, padding: '8px 9px', resize: 'vertical', lineHeight: 1.6, width: '100%' }),
          value: content[0],
          placeholder: mode[0] === 'idea' ? t('create.placeholderIdea') : mode[0] === 'novel' ? t('create.placeholderNovel') : t('create.placeholderScript'),
          onChange: function (e) { content[1](e.target.value); },
          'data-zipx-create': 'content',
        }),
        h('div', { style: Object.assign({}, S.mono, { color: C.muted, margin: '3px 0 8px' }) }, t('create.chars', { n: content[0].length })),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 } },
          h(Field, { label: t('projects.createTitle'), value: title[0], onChange: title[1] }),
          h(Field, { label: t('projects.createGenre'), value: genre[0], onChange: genre[1] }),
          h(Field, { label: t('projects.createDuration'), value: duration[0], onChange: duration[1], type: 'number' }),
          h(Select, { label: t('create.aspect'), value: aspect[0], onChange: aspect[1], options: ['9:16', '16:9', '1:1'] }),
          h(Select, {
            label: t('create.archetype'), value: archetype[0], onChange: archetype[1],
            placeholder: t('create.backendDefault'),
            options: metas[0].archetypes.map(function (a) { return { id: a.id, label: (a.emoji ? a.emoji + ' ' : '') + (a.name || a.id) }; }),
          }),
          h(Select, {
            label: t('create.template'), value: template[0],
            onChange: function (value) {
              template[1](value);
              // 模板是 ZipX 的设计系统：选它就把原型/画幅/时长带过来，人只做判断。
              for (var i = 0; i < metas[0].templates.length; i += 1) {
                var tp = metas[0].templates[i];
                if ((tp.template_id || '') !== value) continue;
                if (tp.default_archetype && !archetype[0]) archetype[1](tp.default_archetype);
                if (tp.default_aspect_ratio) aspect[1](tp.default_aspect_ratio);
              }
            },
            placeholder: t('create.backendDefault'),
            options: metas[0].templates.filter(function (x) { return x && x.template_id; }).map(function (x) { return { id: x.template_id, label: x.display_zh || x.display_en || x.template_id }; }),
          }),
          h(Select, {
            label: t('create.shape'), value: shape[0], onChange: shape[1],
            options: [{ id: 'film', label: t('create.film') }, { id: 'series', label: t('create.series') }],
          }),
          h(Select, {
            label: t('create.creatorMode'), value: creatorMode[0], onChange: creatorMode[1],
            options: [{ id: 'director', label: t('create.modeDirector') }, { id: 'easy', label: t('create.modeEasy') }],
          })),
        series ? h('div', { style: { marginTop: 8, maxWidth: 220 } }, h(Field, { label: t('projects.createEpisodes'), value: episodes[0], onChange: episodes[1], type: 'number' })) : null,
        commercial ? h('div', { style: { marginTop: 8, padding: '8px 10px', border: '1px solid ' + C.border, borderRadius: 8 } },
          h('div', { style: { fontSize: 11.5, fontWeight: 600, marginBottom: 6 } }, t('create.commercial')),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 } },
            h(Field, { label: t('create.brand'), value: briefBrand[0], onChange: briefBrand[1] }),
            h(Field, { label: t('create.product'), value: briefProduct[0], onChange: briefProduct[1] }),
            h(Field, { label: t('create.coreMessage'), value: briefMessage[0], onChange: briefMessage[1] }),
            h(Field, { label: t('create.sellingPoints'), value: briefPoints[0], onChange: briefPoints[1] }),
            h(Field, { label: t('create.cta'), value: briefCta[0], onChange: briefCta[1] }),
            h(Field, { label: t('create.mustAvoid'), value: briefAvoid[0], onChange: briefAvoid[1] }),
            h(Select, {
              label: t('create.conversion'), value: briefConversion[0], onChange: briefConversion[1],
              options: [{ id: 'soft', label: t('create.conversion.soft') }, { id: 'balanced', label: t('create.conversion.balanced') }, { id: 'hard', label: t('create.conversion.hard') }],
            }),
            h(Select, {
              label: t('create.structure'), value: briefStructure[0], onChange: briefStructure[1],
              options: ['auto', 'aida', 'pas', 'bab', 'hook_retain_payoff', '4u'].map(function (x) { return { id: x, label: x }; }),
            })),
          h('div', { style: { fontSize: 11, color: C.muted, marginTop: 4 } }, t('create.commercialHint'))) : null,
        h('div', { style: { marginTop: 8, padding: '8px 10px', border: '1px solid ' + C.border, borderRadius: 8 } },
          h('div', { style: { fontSize: 11.5, fontWeight: 600, marginBottom: 4 } }, t('kb.pickTitle')),
          h('div', { style: { fontSize: 11, color: C.muted, marginBottom: 4 } }, t('kb.pickHint')),
          h(KbPicker, { t: t, docs: kbDocs[0], value: kbPick[0], onChange: kbPick[1] })),
        h('div', { style: { fontSize: 11.5, color: C.muted, marginTop: 8 } }, t('create.costHint')),
        error[0] ? h(ErrLine, null, error[0]) : null,
        h('div', { style: { display: 'flex', gap: 6, marginTop: 8 } },
          h(Btn, { primary: true, disabled: busy[0] || !content[0].trim(), onClick: submit }, busy[0] ? t('loading') : t('create.submit')),
          h(Btn, { onClick: props.onCancel }, t('cancel'))));
    }

    /** 分集区：只读列表 + 进入某一集（绑定到子项目）/ 开始（走对话与批准）。 */
    function EpisodeBlock(props) {
      var t = props.t;
      var items = asArray(props.items);
      if (!items.length) return null;
      return h('div', null,
        h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4 } }, t('detail.episodes', { n: items.length })),
        h('div', { style: S.list }, items.map(function (ep, idx) {
          var id = String(ep.id || '');
          var label = t('detail.episodeLabel', { no: ep.episode_number || idx + 1 });
          return h('div', { key: id || idx, style: Object.assign({}, S.item, { cursor: 'default' }) },
            h('span', { style: Object.assign({}, S.mono, { color: C.muted, width: 28 }) }, String(ep.episode_number || idx + 1)),
            h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
              h('div', { style: Object.assign({}, S.nowrap, { fontWeight: 600 }) }, label),
              h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11, color: C.muted } },
                h('span', null, String(ep.current_step || '—')),
                ep.scene_count ? h('span', null, t('detail.scenes', { n: ep.scene_count })) : null,
                ep.shot_count ? h('span', null, t('detail.shots', { n: ep.shot_count })) : null,
                ep.duration ? h('span', null, String(ep.duration)) : null,
                ep.status ? h('span', { style: { color: gateColor(ep.status === 'completed' ? 'pass' : ep.status === 'failed' ? 'fail' : 'unchecked') } }, String(ep.status)) : null)),
            h(Btn, { disabled: !id, title: t('detail.enterEpisodeHint'), onClick: function () { if (props.onEnter) props.onEnter(ep); } }, t('detail.enterEpisode')),
            ep.status === 'draft' || ep.status === 'failed' || !ep.status
              ? h(Btn, { ghost: true, disabled: !id, onClick: function () { if (props.onStart) props.onStart(ep); } }, t('detail.startEpisode'))
              : null);
        })));
    }

    /** 项目设置：改名 / 归档（唯一写入口是 PATCH /project/{id}）。 */
    /** 知识引用选择器：勾了哪几篇，后续步骤就只允许这几篇进入提示词（空=不限制）。 */
    function KbPicker(props) {
      var t = props.t;
      var docs = asArray(props.docs);
      var value = asArray(props.value);
      if (!docs.length) {
        return h('div', { style: { fontSize: 11.5, color: C.muted } }, t('kb.noDocs'));
      }
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        docs.slice(0, 10).map(function (d) {
          var id = String(d.id || '');
          var on = value.indexOf(id) >= 0;
          return h('label', { key: 'kb' + id, style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, cursor: 'pointer' } },
            h('input', {
              type: 'checkbox', checked: on,
              onChange: function () {
                var next = value.slice();
                var at = next.indexOf(id);
                if (at >= 0) next.splice(at, 1); else next.push(id);
                if (props.onChange) props.onChange(next);
              },
            }),
            h('span', null, textOf(d.analysis_title || d.source_name || id, 60)),
            d.enabled === false ? h('span', { style: { color: C.muted } }, t('kb.disabledTag')) : null);
        }));
    }

    function ProjectSettings(props) {
      var t = props.t;
      var item = props.item || {};
      var draft = useState(String(item.title || ''));
      var busy = useState(false);
      var error = useState('');
      var notice = useState('');
      var docs = useState([]);
      var picked = useState(asArray(item.creator_kb_doc_ids));
      var archived = item.status === 'archived';
      useEffect(function () {
        // 只有打开设置时才取一次文档清单（账号级；读不到就不显示选择器）。
        void call('/zipx-kb/knowledge/documents').then(function (res) {
          if (res.ok && res.json) docs[1](asArray(res.json.documents));
        });
      }, []);
      var save = function () {
        busy[1](true); error[1](''); notice[1]('');
        void patchProject(item.id, { title: draft[0] }).then(function (res) {
          busy[1](false);
          if (res.ok) { notice[1](t('save')); if (props.onChanged) props.onChanged(res.json); return; }
          error[1](apiErrorText(t, res));
        });
      };
      var toggle = function () {
        busy[1](true); error[1](''); notice[1]('');
        void patchProject(item.id, { archived: !archived }).then(function (res) {
          busy[1](false);
          if (res.ok) { if (props.onChanged) props.onChanged(res.json); return; }
          error[1](apiErrorText(t, res));
        });
      };
      var saveKb = function () {
        busy[1](true); error[1](''); notice[1]('');
        void patchProject(item.id, { creator_kb_doc_ids: picked[0] }).then(function (res) {
          busy[1](false);
          if (res.ok) { notice[1](t('kb.saved')); if (props.onChanged) props.onChanged(res.json); return; }
          error[1](apiErrorText(t, res));
        });
      };
      return h('div', { style: S.card },
        h('div', { style: S.cardHead }, h('span', { style: S.cardTitle }, t('detail.settings'))),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(160px, 1fr) auto auto', gap: 8, alignItems: 'end' } },
          h(Field, { label: t('detail.rename'), value: draft[0], onChange: draft[1] }),
          h(Btn, { disabled: busy[0] || !draft[0].trim() || draft[0].trim() === String(item.title || '') , onClick: save }, t('save')),
          h(Btn, { disabled: busy[0], onClick: toggle }, archived ? t('detail.restore') : t('detail.archive'))),
        h('div', { style: { fontSize: 11.5, color: C.muted, marginTop: 4 } }, archived ? t('detail.archivedHint') : t('detail.archiveHint')),
        h('div', { style: S.sep }),
        h('div', { style: { fontSize: 11.5, fontWeight: 600, marginBottom: 4 } }, t('kb.pickTitle')),
        h(KbPicker, { t: t, docs: docs[0], value: picked[0], onChange: picked[1] }),
        h('div', { style: { fontSize: 11, color: C.muted, marginTop: 4 } }, t('kb.pickHint')),
        h('div', { style: { marginTop: 4 } }, h(Btn, { disabled: busy[0], onClick: saveKb }, t('kb.pickSave'))),
        notice[0] ? h('div', { style: { fontSize: 11.5, color: C.pass } }, notice[0]) : null,
        error[0] ? h(ErrLine, null, error[0]) : null);
    }

    /** 团队协作（0.5.1）：成员 / 邀请 / 角色 / 移除 —— 写操作只走 /zipx-team。 */
    function TeamPanel(props) {
      var t = props.t;
      var projectId = String(props.projectId || '');
      var members = useState([]);
      var pending = useState([]);
      var email = useState('');
      var role = useState('editor');
      var busy = useState(false);
      var error = useState('');
      var notice = useState('');
      var locked = useState(false);
      var roles = ['editor', 'viewer', 'admin'];
      var roleOptions = roles.map(function (r) { return { id: r, label: t('team.role.' + r) }; });
      var load = function () {
        if (!projectId) return;
        void call('/zipx-team/members?project_id=' + encodeURIComponent(projectId)).then(function (res) {
          if (res.ok && res.json) {
            members[1](asArray(res.json.members));
            pending[1](asArray(res.json.pending_invitations));
            locked[1](false);
            return;
          }
          // 403 = 当前套餐不含团队协作：如实说，不当成「没有成员」。
          if (res.status === 403) { locked[1](true); return; }
          error[1](apiErrorText(t, res));
        });
      };
      useEffect(load, [projectId]);
      var invite = function () {
        busy[1](true); error[1](''); notice[1]('');
        void call('/zipx-team/invite', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email[0].trim(), role: role[0], project_id: projectId }),
        }).then(function (res) {
          busy[1](false);
          if (res.ok) { email[1](''); notice[1](t('team.invited')); load(); return; }
          error[1](apiErrorText(t, res));
        });
      };
      var changeRole = function (member, next) {
        busy[1](true); error[1](''); notice[1]('');
        void call('/zipx-team/members/' + encodeURIComponent(String(member.member_id)) + '/role', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: next, project_id: projectId }),
        }).then(function (res) {
          busy[1](false);
          if (res.ok) { notice[1](t('team.roleSaved')); load(); return; }
          error[1](apiErrorText(t, res));
        });
      };
      var remove = function (member) {
        var name = String(member.name || member.email || member.member_id || '');
        if (typeof window !== 'undefined' && window.confirm && !window.confirm(t('team.removeAsk', { name: name }))) return;
        busy[1](true); error[1](''); notice[1]('');
        void call('/zipx-team/members/' + encodeURIComponent(String(member.member_id)) + '?project_id=' + encodeURIComponent(projectId), { method: 'DELETE' }).then(function (res) {
          busy[1](false);
          if (res.ok) { notice[1](t('team.removed')); load(); return; }
          error[1](apiErrorText(t, res));
        });
      };
      var cancelInvite = function (invitation) {
        busy[1](true); error[1](''); notice[1]('');
        void call('/zipx-team/invitations/' + encodeURIComponent(String(invitation.id)), { method: 'DELETE' }).then(function (res) {
          busy[1](false);
          if (res.ok) { notice[1](t('team.inviteCanceled')); load(); return; }
          error[1](apiErrorText(t, res));
        });
      };
      return h('div', { style: S.card },
        h('div', { style: S.cardHead }, h('span', { style: S.cardTitle }, t('team.title', { n: members[0].length }))),
        locked[0]
          ? h('div', { style: { fontSize: 11.5, color: C.muted } }, t('team.planLocked'))
          : h('div', null,
            members[0].length
              ? h('div', { style: S.list }, members[0].map(function (m, i) {
                return h('div', { key: 'tm' + i, style: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: '1px solid ' + C.border, fontSize: 12 } },
                  h('span', { style: Object.assign({}, S.nowrap, { flex: '1 1 auto' }) }, String(m.name || m.email || m.member_id || '')),
                  h('span', { style: Object.assign({}, S.mono, { color: C.muted, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }) }, String(m.email || '')),
                  h('select', {
                    value: String(m.role || 'editor'), disabled: busy[0],
                    style: Object.assign({}, S.input, { width: 96, padding: '2px 4px' }),
                    onChange: function (e) { changeRole(m, e.target.value); },
                  }, roleOptions.map(function (o) { return h('option', { key: o.id, value: o.id }, o.label); })),
                  h(Btn, { ghost: true, disabled: busy[0], onClick: function () { remove(m); } }, t('team.remove')));
              }))
              : h('div', { style: { fontSize: 11.5, color: C.muted } }, t('team.empty')),
            h('div', { style: Object.assign({}, S.row, { flexWrap: 'wrap', marginTop: 6 }) },
              h('input', {
                style: Object.assign({}, S.input, { flex: '1 1 180px' }), value: email[0], placeholder: t('team.emailPlaceholder'),
                onChange: function (e) { email[1](e.target.value); },
              }),
              h('select', {
                value: role[0], disabled: busy[0],
                style: Object.assign({}, S.input, { width: 108, padding: '3px 4px' }),
                onChange: function (e) { role[1](e.target.value); },
              }, roleOptions.map(function (o) { return h('option', { key: o.id, value: o.id }, o.label); })),
              h(Btn, { primary: true, disabled: busy[0] || email[0].indexOf('@') < 0, onClick: invite }, t('team.invite'))),
            pending[0].length
              ? h('div', { style: { marginTop: 6 } },
                h('div', { style: { fontSize: 11.5, fontWeight: 600 } }, t('team.pending', { n: pending[0].length })),
                pending[0].map(function (iv, i) {
                  return h('div', { key: 'pi' + i, style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, padding: '3px 0' } },
                    h('span', { style: { flex: '1 1 auto' } }, String(iv.email || '') + ' · ' + String(iv.role || '')),
                    h(Btn, { ghost: true, disabled: busy[0], onClick: function () { cancelInvite(iv); } }, t('team.cancelInvite')));
                }))
              : null,
            h('div', { style: { fontSize: 11, color: C.muted, marginTop: 4 } }, t('team.hint'))),
        notice[0] ? h('div', { style: { fontSize: 11.5, color: C.pass } }, notice[0]) : null,
        error[0] ? h(ErrLine, null, error[0]) : null);
    }

    /**
     * 商业 / 植入模式面板（0.5.1）：营销简报 + 产品图。
     * 写入只走 /zipx-verticals（/api/v3/verticals）；产品图是 multipart（≤15MB）。
     * 没有商业简报、也没有产品图的项目不显示这一块。
     */
    function CommercialPanel(props) {
      var t = props.t;
      var projectId = String(props.projectId || '');
      var brief = useState(null);
      var brand = useState('');
      var product = useState('');
      var message = useState('');
      var points = useState('');
      var cta = useState('');
      var avoid = useState('');
      var images = useState([]);
      var angle = useState('reference');
      var busy = useState(false);
      var error = useState('');
      var notice = useState('');
      var splitList = function (text) {
        return String(text || '').split(/[;；\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
      };
      var load = function () {
        if (!projectId) return;
        void call('/zipx-verticals/project/' + encodeURIComponent(projectId) + '/campaign-brief').then(function (res) {
          if (!res.ok || !res.json) return;
          var b = res.json.brief || {};
          brief[1](b);
          brand[1](String(b.brand_name || ''));
          product[1](String(b.product_name || ''));
          message[1](String(b.core_message || ''));
          points[1](asArray(b.selling_points).join('；'));
          cta[1](String(b.cta || ''));
          avoid[1](asArray(b.must_avoid).join('；'));
          images[1](asArray((res.json.brand_product || {}).product_images));
        });
      };
      useEffect(load, [projectId]);
      var save = function () {
        busy[1](true); error[1](''); notice[1]('');
        var body = { brief: {
          brand_name: brand[0].trim(), product_name: product[0].trim(),
          core_message: message[0].trim(), selling_points: splitList(points[0]),
          must_avoid: splitList(avoid[0]), cta: cta[0].trim(),
        } };
        void call('/zipx-verticals/project/' + encodeURIComponent(projectId) + '/campaign-brief', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        }).then(function (res) {
          busy[1](false);
          if (res.ok) { notice[1](t('detail.saved')); load(); return; }
          error[1](apiErrorText(t, res));
        });
      };
      var upload = function (file) {
        if (!file) return;
        busy[1](true); error[1](''); notice[1]('');
        var form = new FormData();
        form.append('file', file);
        form.append('angle', angle[0]);
        fetch('/zipx-verticals/project/' + encodeURIComponent(projectId) + '/product-images', { method: 'POST', body: form, headers: { Accept: 'application/json' } })
          .then(function (res) {
            return res.text().then(function (text) {
              var json = null;
              try { json = JSON.parse(text); } catch (e) { json = null; }
              return { ok: res.ok, status: res.status, json: json, text: text };
            });
          })
          .then(function (res) {
            busy[1](false);
            if (res.ok) { notice[1](t('detail.imageSaved')); load(); return; }
            error[1](apiErrorText(t, res));
          })
          .catch(function (e) { busy[1](false); error[1](String(e && e.message ? e.message : e)); });
      };
      var b = brief[0] || {};
      var has = Boolean(b.brand_name || b.product_name || b.core_message || asArray(b.selling_points).length || images[0].length);
      if (!has && !props.commercial) return null;
      return h('div', { style: S.card },
        h('div', { style: S.cardHead },
          h('span', { style: S.cardTitle }, t('detail.commercial')),
          h('span', { style: { fontSize: 11, color: C.muted } }, t('detail.commercialHint'))),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 } },
          h(Field, { label: t('create.brand'), value: brand[0], onChange: brand[1] }),
          h(Field, { label: t('create.product'), value: product[0], onChange: product[1] }),
          h(Field, { label: t('create.coreMessage'), value: message[0], onChange: message[1] }),
          h(Field, { label: t('create.sellingPoints'), value: points[0], onChange: points[1] }),
          h(Field, { label: t('create.cta'), value: cta[0], onChange: cta[1] }),
          h(Field, { label: t('create.mustAvoid'), value: avoid[0], onChange: avoid[1] })),
        h('div', { style: Object.assign({}, S.row, { marginTop: 6 }) },
          h(Btn, { primary: true, disabled: busy[0], onClick: save }, busy[0] ? t('loading') : t('detail.save')),
          notice[0] ? h('span', { style: { fontSize: 11, color: C.pass } }, notice[0]) : null),
        h('div', { style: S.sep }),
        h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4 } }, t('detail.productImages', { n: images[0].length })),
        images[0].length
          ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, images[0].slice(0, 8).map(function (img, i) {
            var path = String(img.public_url || img.path || '');
            return h('img', {
              key: 'pi' + i, alt: String(img.angle || ''), title: String(img.angle || ''),
              src: '/zipx-api/files/download?file_path=' + encodeURIComponent(path),
              style: { width: 72, height: 72, objectFit: 'cover', borderRadius: 6, border: '1px solid ' + C.border },
            });
          }))
          : h('div', { style: { fontSize: 11.5, color: C.muted } }, t('detail.noProductImage')),
        h('div', { style: Object.assign({}, S.row, { marginTop: 6, flexWrap: 'wrap' }) },
          h('select', {
            value: angle[0], disabled: busy[0],
            style: Object.assign({}, S.input, { width: 120, padding: '3px 4px' }),
            onChange: function (e) { angle[1](e.target.value); },
          }, ['reference', 'front', 'detail', 'lifestyle'].map(function (a) {
            return h('option', { key: a, value: a }, t('detail.angle.' + a));
          })),
          h('input', {
            type: 'file', accept: '.jpg,.jpeg,.png,.webp', disabled: busy[0],
            onChange: function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) upload(f); },
          })),
        error[0] ? h(ErrLine, null, error[0]) : null);
    }

    function ProjectDetail(props) {
      var t = props.t; var item = props.item || {};
      var projectId = String(item.id || '');
      var sid = String(props.sessionId || RUNTIME.lastSessionId || STORE.sessionId || '');
      var overview = useState(null);
      var info = useState(null);
      var steps = useState([]);
      var events = useState([]);
      var artifacts = useState(null);
      var episodes = useState([]);
      var commercial = useState(false);
      var selected = useState('');
      var error = useState('');
      var busy = useState(false);
      var load = function () {
        if (!projectId) return;
        void call('/project/' + encodeURIComponent(projectId)).then(function (res) {
          if (res.ok && res.json) info[1](res.json);
        });
        void call('/project/' + encodeURIComponent(projectId) + '/overview').then(function (res) {
          if (res.ok && res.json) overview[1](res.json); else error[1](apiErrorText(t, res));
        });
        void call('/workflow-steps?project_id=' + encodeURIComponent(projectId)).then(function (res) {
          if (res.ok && res.json) steps[1](asArray(res.json.steps || res.json));
        });
        void call('/project/' + encodeURIComponent(projectId) + '/events?limit=20').then(function (res) {
          if (res.ok && res.json) events[1](asArray(res.json.events || res.json.items || []));
        });
        void call('/project/' + encodeURIComponent(projectId) + '/artifacts?slim=1&media=1').then(function (res) {
          if (res.ok) artifacts[1](res.json);
        });
        void call('/project/' + encodeURIComponent(projectId) + '/episodes').then(function (res) {
          if (res.ok && res.json) episodes[1](asArray(res.json.episodes));
        });
        // 商业模板的项目即使简报还没填，也要能从这里补（否则只能回 Studio）。
        void call('/zipx-meta/project/' + encodeURIComponent(projectId) + '/resolved').then(function (res) {
          if (!res.ok || !res.json) return;
          var verts = asArray((res.json.template || {}).verticals).concat(asArray(res.json.active_verticals));
          commercial[1](verts.indexOf('commercial') >= 0);
        });
      };
      useEffect(load, [projectId]);
      var state = overview[0] && overview[0].state ? overview[0].state : null;
      var current = state && state.current ? state.current : {};
      var step = selected[0] || current.step || '';
      var gate = state && state.gates ? state.gates.overall : 'unchecked';
      var title = item.title || (state && state.project && state.project.title) || shortId(projectId);
      var media = artifacts[0] ? artifactItems(artifacts[0], step) : [];
      var lifecycle = String(current.lifecycle || '');
      var failed = lifecycle === 'failed' || current.step_status === 'processing_failed';
      var unbind = function () {
        if (!sid) return;
        busy[1](true); error[1]('');
        void call('/session/unbind', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dsh_session_id: sid }),
        }).then(function (res) {
          busy[1](false);
          if (res.ok) { forgetProject(); if (props.onUnbound) props.onUnbound(); return; }
          error[1](apiErrorText(t, res));
        });
      };
      return h('div', { style: S.root },
        h('div', { style: S.header },
          h(Btn, { onClick: props.onBack }, t('detail.back')),
          h('h2', { style: S.title }, title),
          h('span', { style: S.sub }, current.label || current.step || ''),
          h(GateBadge, { status: gate, label: gateLabel(t, gate) }),
          h('span', { style: S.spacer }),
          h(Btn, { icon: h(RefreshIcon, null), onClick: load }, t('refresh')),
          h(Btn, { onClick: function () { openRightTab('zipx-workbench', { projectId: projectId }); } }, t('detail.openWorkbench')),
          h(Btn, { onClick: function () { openRightTab('zipx-assets', { projectId: projectId }); } }, t('detail.openAssets')),
          h(Btn, { onClick: function () { openRightTab('zipx-delivery', { projectId: projectId }); } }, t('detail.openDelivery')),
          h(Btn, { disabled: busy[0] || !sid, title: t('projects.unbindHint'), onClick: unbind }, busy[0] ? t('loading') : t('projects.unbind'))),
        h('div', { style: S.body },
          error[0] ? h(ErrLine, null, error[0]) : null,
          state ? h(StepLine, { t: t, current: current, gate: gate }) : h(Empty, null, t('loading')),
          h('div', { style: S.sep }),
          h(ProjectSettings, { t: t, item: info[0] || item, onChanged: function (next) {
            info[1](function (prev) { return Object.assign({}, prev || {}, next || {}); });
            if (props.onChanged) props.onChanged(next);
            load();
          } }),
          failed ? h('div', { style: S.sep }) : null,
          failed ? h('div', { style: S.card },
            h('div', { style: S.cardHead }, h('span', { style: S.cardTitle }, t('detail.failed'))),
            h('div', { style: { fontSize: 12, color: C.muted } }, t('detail.failedHint')),
            h('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
              h(Btn, { primary: true, onClick: function () { sendToDirector(props, t('detail.retryAsk')); } }, t('detail.retry')),
              h(Btn, { onClick: function () { sendToDirector(props, t('detail.diagnoseAsk')); } }, t('detail.diagnose')))) : null,
          h(CommercialPanel, { t: t, projectId: projectId, commercial: commercial[0] }),
          h(TeamPanel, { t: t, projectId: projectId }),
          episodes[0].length ? h('div', { style: S.sep }) : null,
          episodes[0].length ? h(EpisodeBlock, { t: t, items: episodes[0], onStart: function (ep) {
            // 开始某一集 = 付费生成：只能经对话派发并走批准卡，面板不直连后端。
            sendToDirector(props, t('detail.startEpisodeAsk', {
              no: ep.episode_number || '?',
              id: String(ep.id || ''),
            }));
          }, onEnter: function (ep) {
            var id = String(ep.id || '');
            if (!id || !sid) return;
            void bindProject(sid, id).then(function (res) {
              if (!res || !res.ok) return;
              if (props.onChanged) props.onChanged({ id: id, title: t('detail.episodeLabel', { no: ep.episode_number }), status: ep.status, current_step: ep.current_step });
              openRightTab('zipx-workbench', { projectId: id });
            });
          } }) : null,
          h('div', { style: S.sep }),
          h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4 } }, t('detail.steps')),
          h('div', { style: S.list }, steps[0].map(function (s, idx) {
            var id = String(s.id || s.step || '');
            var label = s.label || s.label_zh || id;
            var on = id === step;
            return h('button', { key: id + idx, type: 'button', style: Object.assign({}, S.item, on ? S.itemOn : null), onClick: function () { selected[1](id); } },
              h('span', { style: Object.assign({}, S.mono, { color: C.muted, width: 22 }) }, String(idx + 1)),
              h('span', { style: { flex: '1 1 auto' } }, label),
              s.status ? h('span', { style: { color: gateColor(s.status), fontSize: 11 } }, String(s.status)) : null,
              on ? h(Badge, { color: C.accent, tint: TINT.accent }, t('state.step')) : null);
          })),
          h('div', { style: S.sep }),
          h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4 } }, t('detail.artifacts')),
          artifacts[0]
            ? (media.length
              ? h(MediaGrid, { items: media, onOpen: function (m) { openRightTab('zipx-artifact', { projectId: projectId, step: m.step, path: m.path, url: m.url, kind: m.kind }); } })
              : h(Empty, null, t('detail.empty')))
            : h(Empty, null, t('loading')),
          h('div', { style: S.sep }),
          h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4 } }, t('detail.history')),
          events[0].length
            ? h('div', { style: S.list }, events[0].map(function (ev, idx) {
              return h('div', { key: 'ev' + idx, style: { display: 'flex', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid ' + C.border } },
                h('span', { style: { color: C.muted, flex: '0 0 auto', width: 132 } }, fmtTime(ev.created_at || ev.at)),
                h('span', { style: { flex: '1 1 auto' } }, textOf(ev.title || ev.summary || ev.event_type || ev.type, 160)));
            }))
            : h(Empty, null, t('detail.noHistory')),
          h('div', { style: { display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' } },
            h(Btn, { primary: true, onClick: function () { closeLibrary(); } }, t('detail.continue')),
            h(Btn, { onClick: function () { openRightTab('zipx-assets', { projectId: projectId }); } }, t('detail.export')),
            h(Btn, { onClick: function () { openRightTab('zipx-knowledge', {}); } }, t('detail.knowledge')))));
    }

    function ProjectLibrary(props) {
      var t = props.t;
      var list = useProjectList();
      var store = useZipxStore();
      var creating = useState(Boolean(RUNTIME.pendingCreate));
      var createMode = useState(RUNTIME.pendingCreate && RUNTIME.pendingCreate.mode ? RUNTIME.pendingCreate.mode : 'idea');
      var status = useState(null);
      var detail = useState(null);
      var query = useState(PROJECTS.q || '');
      useEffect(function () {
        RUNTIME.pendingCreate = null;
        void refreshProjects();
        void call(AUTH + '/status').then(function (res) { if (res.ok && res.json) status[1](res.json); });
      }, []);
      var sid = RUNTIME.lastSessionId || STORE.sessionId;
      if (detail[0]) {
        return h(ProjectDetail, {
          t: t, item: detail[0], sessionId: sid,
          onBack: function () { detail[1](null); void refreshProjects(); },
          onChanged: function (next) {
            detail[1](function (prev) { return Object.assign({}, prev || {}, next || {}); });
            void refreshProjects();
          },
          onUnbound: function () { detail[1](null); forgetProject(); void refreshProjects(); },
        });
      }
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
          if (!res || !res.ok) return;
          // 点开历史项目 = 进入这个项目的创作视图（步骤/产物/历史），不是「绑一下就关窗」。
          detail[1](item);
          openRightTab('zipx-workbench', { projectId: item.id });
        });
      };
      var unbindCurrent = function () {
        if (!sid || !STORE.projectId) return;
        void call('/session/unbind', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dsh_session_id: sid }),
        }).then(function (res) {
          if (res.ok) { forgetProject(); void refreshProjects(); }
        });
      };
      var connected = status[0] ? status[0].connected === true : null;
      return h('div', { style: S.root },
        h('div', { style: S.header },
          h(ZipxIcon, { size: 16 }),
          h('h2', { style: S.title }, t('projects.title')),
          h('span', { style: S.sub }, connected === false ? t('notConnected') : connected === true ? t('connected') : ''),
          h('span', { style: S.spacer }),
          store.projectId ? h(Btn, { title: t('projects.unbindHint'), onClick: unbindCurrent }, t('projects.unbind')) : null,
          h(Btn, { icon: h(RefreshIcon, null), onClick: function () { void refreshProjects(); void loadSession(sid, true); } }, t('refresh')),
          h(Btn, { primary: true, onClick: function () { creating[1](!creating[0]); } }, t('projects.new'))),
        h('div', { style: S.body },
          creating[0] ? h(CreateWizard, {
            t: t, initialMode: createMode[0],
            onCancel: function () { creating[1](false); },
            onCreated: function (id) { RUNTIME.pendingCreate = null; creating[1](false); void refreshProjects(); if (id) open({ id: id }); },
          }) : null,
          h('div', { style: { display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' } },
            h('input', {
              style: Object.assign({}, S.input, { flex: '1 1 180px', minWidth: 120 }),
              value: query[0], placeholder: t('projects.search'),
              onChange: function (e) { query[1](e.target.value); },
              onKeyDown: function (e) { if (e.key === 'Enter') void refreshProjects(query[0], list.archived); },
            }),
            h(Btn, { onClick: function () { void refreshProjects(query[0], list.archived); } }, t('search')),
            h(Btn, { primary: list.archived, onClick: function () { void refreshProjects(query[0], !list.archived); } }, t('projects.archivedOnly')),
            h('span', { style: { fontSize: 12, color: C.muted } }, t('projects.total', { total: list.total }))),
          list.error ? h(ErrLine, null, list.error) : null,
          list.loading && !list.items.length ? h(Empty, null, t('loading')) : null,
          !list.loading && !list.items.length ? h(Empty, null, list.archived ? t('projects.emptyArchived') : t('projects.empty')) : null,
          h('div', { style: S.list }, list.items.map(function (item) {
            return h(ProjectRow, { key: item.id, t: t, item: item, active: item.id === store.projectId, onOpen: open });
          })),
          h('div', { style: S.sep }),
          h('div', { style: { fontSize: 11.5, color: C.muted } }, t('panel.hint'))));
    }

    function HeroOptions(props) {
      var t = props.t;
      // hero 也是会话作用域：这里同样记一次，保证"没进对话也能把话送到"。
      useEffect(function () { rememberInputActions(props); }, []);
      var start = function (mode) {
        RUNTIME.pendingCreate = { mode: mode };
        if (!openLibrary()) RUNTIME.pendingCreate = null;
      };
      return h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
        h('button', { type: 'button', style: S.ghost, onClick: openLibrary, title: t('hero.desc') },
          h(ZipxIcon, { size: 12 }), h('span', null, t('hero.title'))),
        h('button', { type: 'button', style: S.ghost, onClick: function () { start('idea'); }, title: t('hero.ideaDesc') }, t('hero.idea')),
        h('button', { type: 'button', style: S.ghost, onClick: function () { start('novel'); }, title: t('hero.novelDesc') }, t('hero.novel')),
        h('button', { type: 'button', style: S.ghost, onClick: function () { start('script'); }, title: t('hero.scriptDesc') }, t('hero.script')));
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
