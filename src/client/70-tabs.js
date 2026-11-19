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

    /** 全项目资产库（P0-4）：所有步骤的图片/视频/音频 + 版本链 + 可下载清单。 */
    function AssetsTab(props) {
      var t = props.t;
      var store = useZipxStore();
      var params = tabParams(props);
      var projectId = String(params.projectId || store.projectId || '');
      var payload = useState(null);
      var repairs = useState(null);
      var filter = useState('');
      var error = useState('');
      var notice = useState('');
      var load = function () {
        if (!projectId) return;
        void call('/project/' + encodeURIComponent(projectId) + '/artifacts?slim=1&media=1').then(function (res) {
          if (res.ok) payload[1](res.json); else error[1](apiErrorText(t, res));
        });
        // 版本链只读：采纳/退回是写操作，交给对话里的 zipx_repair_action（面板不造第二套）。
        void call('/zipx-os/repair/' + encodeURIComponent(projectId)).then(function (res) {
          if (res.ok && res.json) repairs[1](asArray(res.json.attempts));
        });
      };
      useEffect(load, [projectId]);
      var items = payload[0] ? artifactItems(payload[0], '') : [];
      var counts = { image: 0, video: 0, audio: 0, other: 0 };
      for (var i = 0; i < items.length; i += 1) { counts[items[i].kind] = (counts[items[i].kind] || 0) + 1; }
      var shown = filter[0] ? items.filter(function (x) { return x.kind === filter[0]; }) : items;
      var manifest = function () {
        return JSON.stringify({
          project_id: projectId,
          generated_at: new Date().toISOString(),
          files: shown.map(function (x) { return { step: x.step, path: x.path, kind: x.kind, url: x.url }; }),
        }, null, 2);
      };
      var copy = function () {
        var text = manifest();
        try {
          if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
            void navigator.clipboard.writeText(text);
            notice[1](t('assets.copied'));
            return;
          }
        } catch (e) { /* fall through */ }
        notice[1](t('assets.copyManual'));
      };
      if (!projectId) {
        return h('div', { style: S.body },
          h('h3', { style: S.title }, t('assets.title')),
          h(Empty, null, t('workbench.empty')),
          h('div', { style: { textAlign: 'center' } }, h(Btn, { primary: true, onClick: openLibrary }, t('projects.title'))));
      }
      var kinds = [['', t('assets.all')], ['image', t('artifacts.image')], ['video', t('artifacts.video')], ['audio', t('artifacts.audio')]];
      return h('div', { style: S.body },
        h('div', { style: S.row, flexWrap: 'wrap' },
          h('h3', { style: S.title }, t('assets.title')),
          h('span', { style: S.spacer }),
          h(Btn, { icon: h(RefreshIcon, null), onClick: load }, t('refresh'))),
        h('div', { style: { fontSize: 11.5, color: C.muted } }, t('assets.subtitle')),
        error[0] ? h(ErrLine, null, error[0]) : null,
        h('div', { style: Object.assign({}, S.row, { flexWrap: 'wrap', margin: '8px 0' }) },
          kinds.map(function (k) {
            var on = filter[0] === k[0];
            var n = k[0] ? (counts[k[0]] || 0) : items.length;
            return h(Btn, { key: 'k' + k[0], primary: on, onClick: function () { filter[1](k[0]); } }, k[1] + ' ' + n);
          }),
          h('span', { style: S.spacer }),
          h(Btn, { onClick: copy, disabled: !shown.length }, t('assets.copyManifest')),
          h('a', { href: '/zipx-api/project/' + encodeURIComponent(projectId) + '/export?scope=final', download: '', style: S.link }, t('assets.exportFinal')),
          h('a', { href: '/zipx-api/project/' + encodeURIComponent(projectId) + '/export?scope=all', download: '', style: S.link }, t('assets.exportAll'))),
        notice[0] ? h('div', { style: { fontSize: 11.5, color: C.muted } }, notice[0]) : null,
        !payload[0] ? h(Empty, null, t('loading')) : null,
        payload[0] && !items.length ? h(Empty, null, t('assets.empty')) : null,
        h('div', { style: S.list }, shown.slice(0, 200).map(function (item, idx) {
          return h('div', { key: (item.path || '') + idx, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid ' + C.border, fontSize: 12 } },
            h('span', { style: Object.assign({}, S.mono, { color: C.muted, width: 92, flex: '0 0 auto' }) }, item.step || '—'),
            h('span', { style: Object.assign({}, S.nowrap, { flex: '1 1 auto' }) }, item.path || ''),
            h('span', { style: { color: C.muted, width: 44 } }, item.kind),
            item.url ? h('a', { href: proxyMedia(item.url), download: '', target: '_blank', rel: 'noreferrer', style: S.link }, t('assets.download')) : h('span', { style: { color: C.muted } }, t('assets.noUrl')),
            h(Btn, { ghost: true, onClick: function () { openRightTab('zipx-artifact', { projectId: projectId, step: item.step, path: item.path, url: item.url, kind: item.kind }); } }, t('open')));
        })),
        shown.length > 200 ? h('div', { style: { fontSize: 11.5, color: C.muted, marginTop: 6 } }, t('assets.capped', { n: shown.length })) : null,
        h('div', { style: S.sep }),
        h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4 } }, t('assets.versions')),
        repairs[0] === null ? h(Empty, null, t('loading')) : repairs[0].length
          ? h('div', { style: S.list }, repairs[0].map(function (a, idx) {
            return h('div', { key: 'r' + idx, style: { display: 'flex', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid ' + C.border } },
              h('span', { style: Object.assign({}, S.mono, { width: 92, flex: '0 0 auto', color: C.muted }) }, String(a.step || '')),
              h('span', { style: { flex: '1 1 auto' } }, textOf(a.unit_ref || a.reason || a.decision || '', 120)),
              h('span', { style: { color: a.decision === 'accepted' ? C.pass : a.decision === 'rejected' ? C.fail : C.muted } }, String(a.decision || '') + (a.rolled_back ? ' · rolled_back' : '')));
          }))
          : h(Empty, null, t('assets.noVersions')),
        h('div', { style: { fontSize: 11.5, color: C.muted, marginTop: 6 } }, t('assets.versionsHint')));
    }

    /** 创作者知识库（P1）：账号级，跨项目；文档/图片/音频/视频都走 /zipx-kb（流式，后端各自把关）。 */
    function KnowledgeTab(props) {
      var t = props.t;
      var docs = useState(null);
      var profile = useState(null);
      var assets = useState([]);
      var mediaType = useState('character');
      var url = useState('');
      var text = useState('');
      var busy = useState(false);
      var error = useState('');
      var notice = useState('');
      var load = function () {
        void call('/zipx-kb/knowledge/documents').then(function (res) {
          if (res.ok && res.json) docs[1](asArray(res.json.documents)); else error[1](apiErrorText(t, res));
        });
        void call('/zipx-kb/style-profile').then(function (res) {
          if (res.ok && res.json) profile[1](res.json);
        });
        // 媒体素材（图片/音频/视频）与文档是两个库：这里只列最近 8 条。
        void call('/zipx-kb/assets').then(function (res) {
          if (res.ok && res.json) assets[1](asArray(res.json.assets).slice(0, 8));
        });
      };
      useEffect(load, []);
      var post = function (path, body, okKey) {
        busy[1](true); error[1](''); notice[1]('');
        void call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (res) {
          busy[1](false);
          if (res.ok) { notice[1](t(okKey)); load(); return; }
          error[1](apiErrorText(t, res));
        });
      };
      // multipart 不能走 call()（它会写成 application/json 并 JSON.parse 回包）：
      // 这里裸 fetch，让浏览器自己带 boundary；/zipx-kb 是流式代理，视频不再受 25MB 限制。
      var MEDIA_EXT = {
        png: 'image', jpg: 'image', jpeg: 'image', webp: 'image',
        mp4: 'video', mov: 'video', webm: 'video', mkv: 'video',
        mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', flac: 'audio',
      };
      var upload = function (file) {
        if (!file) return;
        var ext = String(file.name || '').split('.').pop().toLowerCase();
        var kind = MEDIA_EXT[ext] || 'document';
        var form = new FormData();
        form.append('file', file);
        var path = '/zipx-kb/knowledge/documents';
        if (kind === 'video') {
          form.append('title', String(file.name || ''));
          path = '/zipx-kb/knowledge/media/upload';
        } else if (kind === 'image' || kind === 'audio') {
          form.append('asset_type', kind === 'audio' ? 'voice_sample' : mediaType[0]);
          form.append('title', String(file.name || ''));
          path = '/zipx-kb/assets/upload';
        }
        busy[1](true); error[1](''); notice[1]('');
        fetch(path, { method: 'POST', body: form, headers: { Accept: 'application/json' } })
          .then(function (res) {
            return res.text().then(function (text) {
              var json = null;
              try { json = JSON.parse(text); } catch (e) { json = null; }
              return { ok: res.ok, status: res.status, json: json, text: text };
            });
          })
          .then(function (res) {
            busy[1](false);
            if (res.ok) { notice[1](t('kb.uploaded')); load(); return; }
            error[1](apiErrorText(t, res));
          })
          .catch(function (e) { busy[1](false); error[1](String(e && e.message ? e.message : e)); });
      };
      var toggle = function (doc) {
        if (!doc || !doc.id) return;
        busy[1](true); error[1]('');
        void call('/zipx-kb/knowledge/documents/' + encodeURIComponent(doc.id), {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: !doc.enabled }),
        }).then(function (res) {
          busy[1](false);
          if (res.ok) { load(); return; }
          error[1](apiErrorText(t, res));
        });
      };
      var identities = profile[0] ? asArray(profile[0].identities) : [];
      return h('div', { style: S.body },
        h('div', { style: S.row },
          h('h3', { style: S.title }, t('kb.title')),
          h('span', { style: S.spacer }),
          h(Btn, { icon: h(RefreshIcon, null), onClick: load }, t('refresh'))),
        h('div', { style: { fontSize: 11.5, color: C.muted } }, t('kb.subtitle')),
        error[0] ? h(ErrLine, null, error[0]) : null,
        notice[0] ? h('div', { style: { fontSize: 11.5, color: C.pass } }, notice[0]) : null,
        identities.length ? h('div', { style: Object.assign({}, S.row, { flexWrap: 'wrap', marginTop: 8 }) },
          identities.slice(0, 8).map(function (x, i) {
            return h(Badge, { key: 'id' + i, color: C.accent, tint: TINT.accent }, (x.label || x.label_zh || x.dimension || '') + (x.confidence != null ? ' ' + Math.round(Number(x.confidence) * 100) + '%' : ''));
          })) : null,
        h('div', { style: S.sep }),
        !docs[0] ? h(Empty, null, t('loading')) : docs[0].length === 0 ? h(Empty, null, t('kb.empty')) : h('div', { style: S.list }, docs[0].map(function (d, i) {
          return h('div', { key: d.id || i, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid ' + C.border, fontSize: 12 } },
            h('span', { style: Object.assign({}, S.nowrap, { flex: '1 1 auto' }) }, d.analysis_title || d.source_name || d.id),
            h('span', { style: { color: C.muted, width: 56 } }, String(d.parsed_status || '')),
            h('span', { style: { color: C.muted, width: 52 } }, t('kb.recall', { n: d.recall_hits || 0 })),
            h(Btn, { ghost: true, disabled: busy[0], onClick: function () { toggle(d); } }, d.enabled ? t('kb.disable') : t('kb.enable')));
        })),
        h('div', { style: S.sep }),
        h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4 } }, t('kb.addLink')),
        h('div', { style: Object.assign({}, S.row, { flexWrap: 'wrap' }) },
          h('input', {
            style: Object.assign({}, S.input, { flex: '1 1 220px' }), value: url[0], placeholder: 'https://…',
            onChange: function (e) { url[1](e.target.value); },
          }),
          h(Btn, { primary: true, disabled: busy[0] || !/^https?:\/\//i.test(url[0]), onClick: function () { post('/zipx-kb/knowledge/links', { url: url[0] }, 'kb.added'); } }, t('kb.add'))),
        h('div', { style: { fontSize: 12, fontWeight: 600, margin: '8px 0 4px' } }, t('kb.addText')),
        h('div', { style: Object.assign({}, S.row, { flexWrap: 'wrap' }) },
          h('input', {
            style: Object.assign({}, S.input, { flex: '1 1 220px' }), value: text[0], placeholder: t('kb.textPlaceholder'),
            onChange: function (e) { text[1](e.target.value); },
          }),
          h(Btn, { primary: true, disabled: busy[0] || text[0].trim().length < 20, onClick: function () { post('/zipx-kb/knowledge/creative-text', { text: text[0].trim() }, 'kb.added'); } }, t('kb.add'))),
        h('div', { style: { fontSize: 12, fontWeight: 600, margin: '8px 0 4px' } }, t('kb.uploadMedia')),
        h('div', { style: Object.assign({}, S.row, { flexWrap: 'wrap' }) },
          h('select', {
            value: mediaType[0], disabled: busy[0], title: t('kb.assetType'),
            style: Object.assign({}, S.input, { width: 128, padding: '3px 4px' }),
            onChange: function (e) { mediaType[1](e.target.value); },
          }, [
            { id: 'character', key: 'kb.asset.character' },
            { id: 'prop', key: 'kb.asset.prop' },
            { id: 'scene', key: 'kb.asset.scene' },
          ].map(function (o) { return h('option', { key: o.id, value: o.id }, t(o.key)); })),
          h('input', {
            type: 'file',
            accept: '.pdf,.docx,.md,.txt,.png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a,.aac,.ogg,.flac,.mp4,.mov,.webm,.mkv',
            disabled: busy[0],
            onChange: function (e) {
              var file = e.target.files && e.target.files[0];
              e.target.value = '';
              if (file) upload(file);
            },
          })),
        h('div', { style: { fontSize: 11, color: C.muted, marginTop: 4 } }, t('kb.uploadMediaHint')),
        assets[0].length ? h('div', { style: { marginTop: 6 } },
          h('div', { style: { fontSize: 11.5, fontWeight: 600 } }, t('kb.assetsTitle', { n: assets[0].length })),
          assets[0].map(function (a, i) {
            return h('div', { key: 'as' + i, style: { display: 'flex', gap: 6, fontSize: 11.5, color: C.muted, padding: '2px 0' } },
              h('span', null, String(a.asset_type || a.origin || '')),
              h('span', { style: S.nowrap }, String(a.title || a.file_path || '')));
          })) : null,
        h('div', { style: { fontSize: 11.5, color: C.muted, marginTop: 8 } }, t('kb.uploadHint')));
    }

    /** 复盘 / 发布（P2）：成本与制作台账、发布物料、发布计划（.ics）、导出包、多版本选定。 */
    function ReviewTab(props) {
      var t = props.t;
      var store = useZipxStore();
      var params = tabParams(props);
      var projectId = String(params.projectId || store.projectId || '');
      var publish = useState(null);
      var cost = useState(null);
      var ledger = useState(null);
      var repairs = useState(null);
      var variations = useState([]);
      var plan = useState({ when: '', platform: '', note: '' });
      var busy = useState(false);
      var error = useState('');
      var notice = useState('');

      var load = function () {
        if (!projectId) return;
        void call('/project/' + encodeURIComponent(projectId) + '/publish').then(function (res) {
          if (!res.ok) { error[1](apiErrorText(t, res)); return; }
          publish[1](res.json);
          var p = (res.json.copy && res.json.copy.publish_plan) || {};
          plan[1]({ when: String(p.when || ''), platform: String(p.platform || ''), note: String(p.note || '') });
        });
        void call('/project/' + encodeURIComponent(projectId) + '/cost').then(function (res) {
          if (res.ok && res.json) cost[1](res.json);
        });
        void call('/project/' + encodeURIComponent(projectId) + '/ledger').then(function (res) {
          if (res.ok && res.json) ledger[1](res.json);
        });
        // 版本链只读：复盘里只数"改过几次"，采纳/退回仍走对话里的 zipx_repair_action。
        void call('/zipx-os/repair/' + encodeURIComponent(projectId)).then(function (res) {
          if (res.ok && res.json) repairs[1](res.json);
        });
        // A/B：ZipX 的多版本（multiverse）就是它自己的 A/B 原语；列表只读，选定是免费写。
        void call('/multiverse/' + encodeURIComponent(projectId) + '?step_type=' + encodeURIComponent(String((store.state && store.state.current && store.state.current.step) || 'story'))).then(function (res) {
          if (res.ok && res.json) variations[1](asArray(res.json.variations));
        });
      };
      useEffect(load, [projectId]);

      var copyText = function (text, okKey) {
        try {
          if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
            void navigator.clipboard.writeText(text);
            notice[1](t(okKey));
            return;
          }
        } catch (e) { /* fall through */ }
        notice[1](t('assets.copyManual'));
      };
      var copyPublish = function () {
        var d = publish[0] || {};
        var c = d.copy || {};
        var lines = [
          (c.title || ''),
          (c.one_liner || ''),
          ((c.tags || []).map(function (x) { return '#' + String(x).replace(/\s+/g, '_'); }).join(' ')),
        ].filter(Boolean);
        copyText(lines.join('\n'), 'review.copied');
      };
      var savePlan = function () {
        busy[1](true); error[1](''); notice[1]('');
        void patchProject(projectId, { publish_plan: plan[0] }).then(function (res) {
          busy[1](false);
          if (res.ok) { notice[1](t('review.planSaved')); load(); return; }
          error[1](apiErrorText(t, res));
        });
      };
      var downloadIcs = function () {
        var info = publish[0] || {};
        var title = (info.copy && info.copy.title) || projectId;
        var when = String(plan[0].when || '').slice(0, 16);
        var start = new Date(when);
        if (!when || isNaN(start.getTime())) { notice[1](t('review.needWhen')); return; }
        var fmt = function (d) {
          return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
        };
        var end = new Date(start.getTime() + 30 * 60 * 1000);
        var ics = [
          'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ZipX//DSH//CN',
          'BEGIN:VEVENT',
          'UID:' + projectId + '@zipx',
          'DTSTAMP:' + fmt(new Date()),
          'DTSTART:' + fmt(start),
          'DTEND:' + fmt(end),
          'SUMMARY:' + ('发布 ' + title).replace(/[\n,;]/g, ' '),
          'DESCRIPTION:' + ((plan[0].platform || '') + ' ' + (plan[0].note || '')).replace(/[\n,;]/g, ' '),
          'END:VEVENT', 'END:VCALENDAR', '',
        ].join('\r\n');
        try {
          var blob = new Blob([ics], { type: 'text/calendar' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'zipx-publish-' + projectId.slice(0, 8) + '.ics';
          a.click();
          if (URL.revokeObjectURL) setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
          notice[1](t('review.icsSaved'));
        } catch (e) { notice[1](t('review.icsFailed')); }
      };
      var pick = function (v) {
        if (!v || !v.variation_id) return;
        busy[1](true); error[1](''); notice[1]('');
        void call('/multiverse/' + encodeURIComponent(projectId) + '/pick', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ step_type: String(v.step_type || 'story'), variation_id: String(v.variation_id) }),
        }).then(function (res) {
          busy[1](false);
          if (res.ok && res.json && res.json.ok) { notice[1](t('review.picked')); load(); return; }
          error[1](apiErrorText(t, res));
        });
      };

      if (!projectId) {
        return h('div', { style: S.body },
          h('h3', { style: S.title }, t('review.title')),
          h(Empty, null, t('workbench.empty')));
      }
      var info = publish[0] || {};
      var copy = info.copy || {};
      var repairsCount = repairs[0] && Array.isArray(repairs[0].attempts) ? repairs[0].attempts.length : null;
      var progress = ledger[0] && ledger[0].progress ? ledger[0].progress : null;
      return h('div', { style: S.body },
        h('div', { style: S.row },
          h('h3', { style: S.title }, t('review.title')),
          h('span', { style: S.spacer }),
          h(Btn, { icon: h(RefreshIcon, null), onClick: load }, t('refresh'))),
        error[0] ? h(ErrLine, null, error[0]) : null,
        notice[0] ? h('div', { style: { fontSize: 11.5, color: C.pass } }, notice[0]) : null,

        h('div', { style: S.card },
          h('div', { style: S.cardHead }, h('span', { style: S.cardTitle }, t('review.materials'))),
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
            h('span', { style: { fontWeight: 600, fontSize: 13 } }, copy.title || '—'),
            h('span', { style: { fontSize: 11.5, color: C.muted } }, copy.one_liner || t('review.noOneLiner'))),
          h('div', { style: { fontSize: 11.5, color: C.muted, marginTop: 2 } },
            [copy.genre, copy.platform, copy.aspect_ratio, copy.target_runtime_s ? copy.target_runtime_s + 's' : ''].filter(Boolean).join(' · ')),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 } },
            asArray(copy.tags).slice(0, 10).map(function (tag, i) { return h(Badge, { key: 'tg' + i, color: C.accent, tint: TINT.accent }, '#' + String(tag).replace(/\s+/g, '_')); })),
          h('div', { style: { display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' } },
            h(Btn, { primary: true, onClick: copyPublish, disabled: !copy.title }, t('review.copyMaterials')),
            h('a', { href: '/zipx-api/project/' + encodeURIComponent(projectId) + '/export?scope=final', download: '', style: S.link }, t('assets.exportFinal')),
            h('a', { href: '/zipx-api/project/' + encodeURIComponent(projectId) + '/export?scope=all', download: '', style: S.link }, t('assets.exportAll')),
            h('a', { href: '/zipx-api/project/' + encodeURIComponent(projectId) + '/publish', target: '_blank', rel: 'noreferrer', style: S.link }, t('review.openJson'))),
          h('div', { style: { fontSize: 11, color: C.muted, marginTop: 4 } }, copy.note || '')),

        h('div', { style: Object.assign({}, S.card, { marginTop: 8 }) },
          h('div', { style: S.cardHead }, h('span', { style: S.cardTitle }, t('review.plan'))),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 } },
            h('label', { style: { display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, color: C.muted } }, t('review.when'),
              h('input', {
                type: 'datetime-local', style: S.input, value: plan[0].when,
                onChange: function (e) { plan[1](Object.assign({}, plan[0], { when: e.target.value })); },
              })),
            h(Field, { label: t('review.platform'), value: plan[0].platform, onChange: function (v) { plan[1](Object.assign({}, plan[0], { platform: v })); } }),
            h(Field, { label: t('review.note'), value: plan[0].note, onChange: function (v) { plan[1](Object.assign({}, plan[0], { note: v })); } })),
          h('div', { style: { display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' } },
            h(Btn, { primary: true, disabled: busy[0], onClick: savePlan }, t('save')),
            h(Btn, { onClick: downloadIcs }, t('review.ics'))),
          h('div', { style: { fontSize: 11, color: C.muted, marginTop: 4 } }, t('review.planHint'))),

        h('div', { style: Object.assign({}, S.card, { marginTop: 8 }) },
          h('div', { style: S.cardHead }, h('span', { style: S.cardTitle }, t('review.retro'))),
          h('div', { style: { display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12 } },
            h('span', null, t('review.balance', { v: cost[0] && cost[0].balance != null ? cost[0].balance : '—' })),
            h('span', null, t('review.stepCost', { v: cost[0] && cost[0].estimate_calls != null ? cost[0].estimate_calls : '—' })),
            h('span', null, t('review.progress', { done: progress ? progress.done : '—', total: progress ? progress.total : '—' })),
            h('span', null, t('review.repairs', { n: repairsCount === null ? '—' : repairsCount })),
            h('span', null, t('review.files', { n: info.files == null ? '—' : info.files, final: info.final_files == null ? '—' : info.final_files }))),
          asArray(info.skipped).length
            ? h('div', { style: { fontSize: 11, color: C.warn, marginTop: 4 } }, t('review.skipped', { n: asArray(info.skipped).length }))
            : null),

        h('div', { style: Object.assign({}, S.card, { marginTop: 8 }) },
          h('div', { style: S.cardHead }, h('span', { style: S.cardTitle }, t('review.ab'))),
          h('div', { style: { fontSize: 11, color: C.muted, marginBottom: 4 } }, t('review.abHint')),
          asArray(variations[0]).length
            ? h('div', { style: S.list }, asArray(variations[0]).map(function (v, i) {
              var vid = String(v.variation_id || i);
              return h('div', { key: 'mv' + vid, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid ' + C.border, fontSize: 12 } },
                h('span', { style: Object.assign({}, S.mono, { flex: '1 1 auto' }) }, vid),
                v.picked ? h(Badge, { color: C.pass, tint: TINT.pass }, t('review.pickedTag')) : null,
                h(Btn, { ghost: true, disabled: busy[0] || v.picked, onClick: function () { pick(v); } }, t('review.pick')));
            }))
            : h('div', { style: { fontSize: 11.5, color: C.muted } }, t('review.noVariations'))));
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
          d.media_url ? h('a', { href: proxyMedia(d.media_url), download: '', target: '_blank', rel: 'noreferrer', style: S.link }, t('delivery.download')) : null,
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
