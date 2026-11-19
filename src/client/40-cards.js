    /* ── native tool cards (keyed by wire name) ────────────────────── */
    function metaOf(block) {
      if (!block || !block.meta || typeof block.meta !== 'object') return null;
      return block.meta;
    }
    function argOf(block, name) {
      try { return block && block.args ? block.args.value(name) : undefined; } catch (e) { return undefined; }
    }
    function resultText(block, max) {
      if (!block || !Array.isArray(block.content)) return '';
      var out = [];
      for (var i = 0; i < block.content.length; i += 1) {
        var item = block.content[i];
        if (item && item.type === 'text') out.push(String(item.text || ''));
      }
      return textOf(out.join('\n').trim(), max || 600);
    }
    function phaseCard(t, block, title, children, opts) {
      var phase = (block && block.phase) || (block && block.kind === 'tool-result' ? 'result' : 'result');
      if (phase === 'preparing') {
        return h(Card, { title: title, kind: 'zipx-pending' }, h('div', { style: S.muted }, t('card.preparing')));
      }
      if (phase === 'start') {
        return h(Card, { title: title, kind: 'zipx-running' }, h('div', { style: S.muted }, t('card.running')));
      }
      if (block && block.isError) {
        var why = resultText(block, 600) || (block.error && (block.error.reason || block.error.code)) || t('status.fail');
        return h(Card, { title: title, kind: 'zipx-error' }, h(ErrLine, null, why));
      }
      return h(Card, Object.assign({ title: title, kind: opts && opts.kind }, opts || {}), children);
    }

    function StateCard(props) {
      var t = props.t; var m = metaOf(props.block) || {};
      if (m.kind !== 'state') return h(GenericCard, props);
      var cur = m.current || {};
      var events = asArray(m.recent_events).slice(-3);
      var legal = asArray(m.legal_actions_human).slice(0, 6);
      return phaseCard(t, props.block, t('state.title'), h('div', { style: S.col },
        h('div', { style: S.row }, h('span', { style: { fontWeight: 650 } }, m.title || shortId(m.project_id)), h('span', { style: Object.assign({}, S.mono, { color: C.muted }) }, shortId(m.project_id))),
        h(StepLine, { t: t, current: cur, gate: m.gate }),
        m.current && m.current.gate_stale ? h('div', { style: { fontSize: 11.5, color: C.warn } }, t('state.gateStale')) : null,
        m.current && m.current.gate_unverified && !m.current.gate_stale ? h('div', { style: { fontSize: 11.5, color: C.warn } }, t('state.gateUnverified')) : null,
        m.next_suggestion ? h('div', { style: { fontSize: 12 } }, t('state.next') + '：' + textOf(m.next_suggestion.label || m.next_suggestion.action || '', 160)) : null,
        legal.length ? h('div', { style: S.scrollX }, legal.map(function (label, i) { return h(Badge, { key: i, color: C.muted }, label); })) : null,
        events.length ? h('div', { style: Object.assign({}, S.mono, { color: C.muted, lineHeight: 1.6 }) }, events.map(function (e, i) {
          return h('div', { key: i }, (e.type || '') + ' · ' + textOf(e.summary || '', 90));
        })) : null),
        { kind: 'zipx-state', badge: h(GateBadge, { status: m.gate, label: gateLabel(t, m.gate) }),
          footer: [
            h(Btn, { key: 'wb', onClick: function () { openRightTab('zipx-workbench', { projectId: m.project_id }); } }, t('state.openWorkbench')),
            h(Btn, { key: 'adv', primary: true, onClick: function () { sendToDirector(props, '推进' + (cur.label ? '「' + cur.label + '」' : '当前步骤') + '，先预检再按批准执行。'); } }, t('state.advance')),
            h(Btn, { key: 'rf', ghost: true, icon: h(RefreshIcon, null), onClick: function () { void refreshState(); } }, t('state.refresh')),
          ] });
    }

    function PreviewCard(props) {
      var t = props.t; var m = metaOf(props.block) || {};
      if (m.kind !== 'preview') return h(GenericCard, props);
      var status = m.allowed === true ? 'pass' : m.allowed === false ? 'fail' : 'unchecked';
      var label = m.allowed === true ? t('preview.allowed') : m.allowed === false ? t('preview.blocked') : t('preview.unknown');
      return phaseCard(t, props.block, t('preview.title'), h('div', { style: S.col },
        h('div', { style: S.row }, h(GateBadge, { status: status, label: label }), h('span', { style: S.mono }, String(m.action || ''))),
        m.reason ? h('div', { style: { fontSize: 12 } }, textOf(m.reason, 400)) : null,
        h('div', { style: { fontSize: 12, color: C.muted } },
          m.paid === true ? (m.credits === null ? t('composer.costUnknown') : t('preview.cost', { credits: m.credits, currency: m.currency || 'credits' })) : t('preview.free')),
        m.downstream && m.downstream.length ? h('div', { style: { fontSize: 12 } }, t('preview.downstream', { steps: m.downstream.join('、') })) : null,
        m.note ? h('div', { style: { fontSize: 11.5, color: C.muted } }, m.note) : null,
        m.alternatives && m.alternatives.length ? h('div', { style: S.scrollX }, m.alternatives.map(function (a, i) { return h(Badge, { key: i, color: C.muted }, a.label || a.action); })) : null),
        { kind: 'zipx-preview', badge: h(GateBadge, { status: status, label: label }),
          footer: [h(Btn, { key: 'run', primary: true, disabled: m.allowed === false, onClick: function () { sendToDirector(props, '执行 ' + (m.action || '这个动作') + '（项目 ' + (m.project_id || '') + '），先预检再按批准执行。'); } }, t('preview.execute'))] });
    }

    function DispatchCard(props) {
      var t = props.t; var m = metaOf(props.block) || {};
      if (m.kind !== 'dispatch') return h(GenericCard, props);
      var ok = m.state !== 'blocked' && m.state !== 'failed';
      return phaseCard(t, props.block, t('dispatch.title'), h('div', { style: S.col },
        h('div', { style: S.row }, h(GateBadge, { status: ok ? 'pass' : 'fail', label: ok ? t('dispatch.dispatched') : t('dispatch.blocked') }), h('span', { style: S.mono }, String(m.action || m.tool || ''))),
        m.current_step ? h('div', { style: { fontSize: 12 } }, t('state.step') + '：' + m.current_step + (m.lifecycle ? ' · ' + m.lifecycle : '')) : null,
        m.reply ? h('div', { style: { fontSize: 12, color: C.muted } }, textOf(m.reply, 300)) : null,
        m.job_id ? h('div', { style: { fontSize: 12 } }, t('dispatch.job', { id: m.job_id })) : null),
        { kind: 'zipx-dispatch', footer: [h(Btn, { key: 'wb', onClick: function () { openRightTab('zipx-workbench', { projectId: m.project_id }); } }, t('dispatch.progress'))] });
    }

    function stepsFromArtifacts(payload, filter) {
      var out = payload && payload.output ? payload.output : {};
      var keys = filter
        ? String(filter).split(',').map(function (s) { return s.trim(); }).filter(Boolean)
        : Object.keys(out);
      var steps = [];
      for (var i = 0; i < keys.length; i += 1) {
        var key = keys[i];
        var entry = out[key];
        if (!entry) continue;
        steps.push({
          step: key,
          status: entry.status || '',
          summary: entry.summary || entry.note || '',
          media: artifactItems(payload, key),
        });
      }
      return steps;
    }

    function ArtifactsCard(props) {
      var t = props.t; var m = metaOf(props.block) || {};
      if (m.kind !== 'artifacts') return h(GenericCard, props);
      var live = useState(null);
      var busy = useState(false);
      var error = useState('');
      var refresh = function () {
        if (!m.project_id) return;
        busy[1](true); error[1]('');
        var q = '/project/' + encodeURIComponent(m.project_id) + '/artifacts?slim=1&media=1';
        if (m.steps_filter) q += '&steps=' + encodeURIComponent(m.steps_filter);
        void call(q).then(function (res) {
          busy[1](false);
          if (res.ok && res.json) live[1](res.json);
          else error[1](apiErrorText(t, res));
        });
      };
      var steps = live[0] ? stepsFromArtifacts(live[0], m.steps_filter) : asArray(m.steps);
      if (!steps.length) return phaseCard(t, props.block, t('artifacts.title'), h('div', { style: S.col }, error[0] ? h(ErrLine, null, error[0]) : null, h(Empty, null, t('artifacts.empty'))), { kind: 'zipx-artifacts' });
      return phaseCard(t, props.block, t('artifacts.title'), h('div', { style: S.col }, steps.map(function (step, i) {
        var media = asArray(step.media);
        return h('div', { key: i, style: S.col },
          h('div', { style: S.row }, h('span', { style: { fontWeight: 600 } }, step.step), step.status ? h(Badge, { color: C.muted }, step.status) : null, h('span', { style: { marginLeft: 'auto' } }, h('span', { style: Object.assign({}, S.mono, { color: C.muted }) }, String(media.length)))),
          step.summary ? h('div', { style: { fontSize: 12, color: C.muted } }, textOf(step.summary, 220)) : null,
          h(MediaGrid, { items: media, onOpen: function (item) { openRightTab('zipx-artifact', { projectId: m.project_id, step: step.step, path: item.path, url: item.url, kind: item.kind }); } }));
      }), error[0] ? h(ErrLine, null, error[0]) : null), { kind: 'zipx-artifacts', footer: [h(Btn, { key: 'rf', ghost: true, disabled: busy[0], icon: h(RefreshIcon, null), onClick: refresh }, busy[0] ? t('loading') : t('artifacts.refresh'))] });
    }

    function CostCard(props) {
      var t = props.t; var m = metaOf(props.block) || {};
      if (m.kind !== 'cost') return h(GenericCard, props);
      return phaseCard(t, props.block, t('cost.title'), h('div', { style: S.col },
        h('div', { style: { fontSize: 13, fontWeight: 600 } }, t('cost.balance', { balance: m.balance === null ? t('cost.unknown') : m.balance + ' ' + (m.currency || 'credits') })),
        h('div', { style: { fontSize: 12 } }, t('cost.estimate', { credits: m.estimate === null ? t('cost.unknown') : m.estimate + ' ' + (m.currency || 'credits') })),
        m.estimate_kind ? h('div', { style: { fontSize: 11.5, color: m.estimate_kind === 'precheck_threshold' ? C.warn : C.muted } }, m.estimate_kind === 'precheck_threshold' ? t('cost.precheck') : t('cost.estimateKind', { kind: m.estimate_kind })) : null,
        m.affordable === true ? h('div', { style: { color: C.pass, fontSize: 12 } }, t('cost.affordable')) : m.affordable === false ? h('div', { style: { color: C.fail, fontSize: 12 } }, t('cost.notAffordable')) : null,
        m.note ? h('div', { style: { fontSize: 11.5, color: C.muted } }, m.note) : null),
        { kind: 'zipx-cost' });
    }

    function WatchCard(props) {
      var t = props.t; var m = metaOf(props.block) || {};
      if (m.kind !== 'watch') return h(GenericCard, props);
      var background = Boolean(m.job_id);
      return phaseCard(t, props.block, t('watch.title'), h('div', { style: S.col },
        h('div', { style: S.row }, h(GateBadge, { status: m.complete ? 'pass' : m.timed_out ? 'warn' : 'unchecked', label: m.complete ? t('watch.done') : m.timed_out ? t('watch.timeout') : t('watch.running') }),
          background ? h('span', { style: S.mono }, m.job_id) : null),
        h('div', { style: { fontSize: 12 } }, (m.current_step || m.step || '') + ' · ' + (m.lifecycle || '')),
        m.produced !== null || m.expected !== null ? h(Progress, { produced: m.produced, expected: m.expected }) : null,
        background ? h('div', { style: { fontSize: 11.5, color: C.muted } }, t('watch.background')) : null,
        m.note ? h('div', { style: { fontSize: 11.5, color: C.muted } }, m.note) : null),
        { kind: 'zipx-watch', footer: [h(Btn, { key: 'wb', onClick: function () { openRightTab('zipx-workbench', { projectId: m.project_id }); } }, t('workbench.title'))] });
    }

    function DeliveryCard(props) {
      var t = props.t; var m = metaOf(props.block) || {};
      if (m.kind !== 'delivery') return h(GenericCard, props);
      if (m.has_compose !== true) return phaseCard(t, props.block, t('delivery.title'), h(Empty, null, t('delivery.empty')), { kind: 'zipx-delivery' });
      var counts = m.counts || {};
      var bad = asArray(m.checklist).filter(function (it) { return it.status === 'fail' || it.status === 'warn'; }).slice(0, 6);
      return phaseCard(t, props.block, t('delivery.title'), h('div', { style: S.col },
        h('div', { style: S.row, flexWrap: 'wrap' }, h(GateBadge, { status: m.release_ok === true ? 'pass' : m.release_ok === false ? 'fail' : 'unchecked', label: m.release_ok === true ? t('delivery.ok') : m.release_ok === false ? t('delivery.notOk') : t('gate.unchecked') }),
          h(Badge, { color: C.pass }, t('delivery.pass', { n: counts.pass || 0 })),
          h(Badge, { color: C.warn }, t('delivery.warn', { n: counts.warn || 0 })),
          h(Badge, { color: C.fail }, t('delivery.fail', { n: counts.fail || 0 })),
          h(Badge, { color: C.muted }, t('delivery.pending', { n: counts.pending || 0 }))),
        bad.length ? h('div', { style: S.list }, bad.map(function (it, i) {
          return h('div', { key: i, style: { fontSize: 12 } }, h('span', { style: { color: gateColor(it.status) } }, (it.label || it.key) + '：' + it.status), it.note ? h('span', { style: { color: C.muted } }, '（' + textOf(it.note, 120) + '）') : null);
        })) : null,
        m.media_url ? h('video', { src: proxyMedia(m.media_url), controls: true, preload: 'metadata', style: S.video }) : null),
        { kind: 'zipx-delivery', footer: [
          m.media_url ? h(Btn, { key: 'play', primary: true, icon: h(PlayIcon, null), onClick: function () { openRightTab('zipx-artifact', { projectId: m.project_id, url: m.media_url, kind: 'video', path: m.video_path || '' }); } }, t('delivery.play')) : null,
          h(Btn, { key: 'tab', onClick: function () { openRightTab('zipx-delivery', { projectId: m.project_id }); } }, t('workbench.delivery')),
        ] });
    }

    function LocksCard(props) {
      var t = props.t; var m = metaOf(props.block) || {};
      if (m.kind !== 'locks') return h(GenericCard, props);
      return phaseCard(t, props.block, t('locks.title'), h('div', { style: S.col },
        h('div', { style: S.row, flexWrap: 'wrap' }, h(GateBadge, { status: m.all_signed ? 'pass' : 'warn', label: m.all_signed ? t('locks.allSigned') : t('locks.unsigned') })),
        h('div', { style: S.list }, asArray(m.locks).map(function (lock, i) {
          var label = lock.available ? (lock.signed ? t('locks.signed') : t('locks.unsigned')) : t('locks.unavailable');
          return h('div', { key: i, style: S.row }, h('span', { style: { fontWeight: 600, width: 80 } }, lock.key), h(GateBadge, { status: lock.signed ? 'pass' : lock.available ? 'warn' : 'unchecked', label: label }),
            !lock.signed && lock.available ? h('span', { style: { marginLeft: 'auto' } }, h(Btn, { key: 's', ghost: true, onClick: function () { sendToDirector(props, '签收 ' + lock.key + ' 锁。'); } }, t('locks.signed'))) : null);
        }))),
        { kind: 'zipx-locks' });
    }

    function ProjectsCard(props) {
      var t = props.t; var m = metaOf(props.block) || {};
      if (m.kind !== 'projects') return h(GenericCard, props);
      return phaseCard(t, props.block, t('projectsCard.title'), h('div', { style: S.list }, asArray(m.items).slice(0, 8).map(function (it, i) {
        return h('div', { key: i, style: S.item },
          h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
            h('div', { style: Object.assign({}, S.nowrap, { fontWeight: 600 }) }, it.title || shortId(it.id)),
            h('div', { style: Object.assign({}, S.mono, { color: C.muted }) }, (it.current_step || '') + ' · ' + (it.gates || 'unknown'))),
          h(Btn, { ghost: true, onClick: function () { void bindProject(props.sessionId, it.id); } }, t('projectsCard.bind')));
      })), { kind: 'zipx-projects' });
    }

    function BindCard(props) {
      var t = props.t; var m = metaOf(props.block) || {};
      if (m.kind !== 'bind') return h(GenericCard, props);
      return phaseCard(t, props.block, t('bind.title'), h('div', { style: S.col },
        h('div', { style: S.row }, h(GateBadge, { status: m.note ? 'warn' : 'pass', label: m.note ? t('bind.fail') : t('bind.ok') }), h('span', { style: S.mono }, shortId(m.project_id))),
        m.note ? h('div', { style: { fontSize: 12, color: C.muted } }, m.note) : null,
        h('div', { style: { fontSize: 11.5, color: C.muted } }, 'session ' + shortId(m.session_id) + (m.rebound ? ' · rebound' : ''))),
        { kind: 'zipx-bind', footer: [h(Btn, { key: 'wb', onClick: function () { openRightTab('zipx-workbench', { projectId: m.project_id }); } }, t('workbench.title'))] });
    }

    function ConnectCard(props) {
      var t = props.t; var m = metaOf(props.block) || {};
      if (m.kind !== 'connect') return h(GenericCard, props);
      return phaseCard(t, props.block, t('connect.title'), h('div', { style: S.col },
        h('div', { style: { fontSize: 12 } }, t('connect.channel', { state: m.channel_state || 'unknown' })),
        h('div', { style: { fontSize: 12 } }, t('connect.account', { account: m.account || t('unknown') })),
        h('div', { style: { fontSize: 12 } }, t('connect.expires', { expires: m.expires_at || t('unknown') })),
        h('div', { style: { fontSize: 12 } }, t('connect.tools', { n: m.tools === null ? '?' : m.tools }))),
        { kind: 'zipx-connect' });
    }

    function GenericCard(props) {
      var t = props.t; var m = metaOf(props.block) || {};
      var facts = m.facts && typeof m.facts === 'object' ? m.facts : {};
      var keys = Object.keys(facts);
      var body = keys.length
        ? h('div', { style: S.list }, keys.map(function (k) { return h('div', { key: k, style: { display: 'flex', gap: 8, fontSize: 12 } }, h('span', { style: Object.assign({}, S.mono, { color: C.muted, minWidth: 90 }) }, k), h('span', null, textOf(facts[k], 180))); }))
        : h('div', { style: { fontSize: 12, color: C.muted } }, resultText(props.block, 500) || t('card.noData'));
      return phaseCard(t, props.block, m.tool || t('card.generic'), body, { kind: 'zipx-generic' });
    }

    function ResultCard(props) {
      var t = props.t; var m = metaOf(props.block) || {};
      if (m.kind !== 'result') return h(GenericCard, props);
      var live = useState(null);
      var busy = useState(false);
      var error = useState('');
      // 签名媒体 15 分钟过期；卡片不重开也能重新取一次（同一读端点，无副作用）。
      var refresh = function () {
        if (!m.project_id || !m.step) return;
        busy[1](true); error[1]('');
        void call('/project/' + encodeURIComponent(m.project_id) + '/result?step=' + encodeURIComponent(m.step) + '&max_chars=2600&max_media=8').then(function (res) {
          busy[1](false);
          if (res.ok && res.json) live[1](res.json);
          else error[1](apiErrorText(t, res));
        });
      };
      var d = live[0] ? Object.assign({}, m, live[0]) : m;
      var gate = d.gate || {};
      var media = asArray(d.media);
      var counts = d.counts || {};
      var countText = Object.keys(counts).filter(function (k) { return counts[k]; }).map(function (k) { return k + ' ' + counts[k]; }).join(' · ');
      var footer = [
        h(Btn, { key: 'wb', onClick: function () { openRightTab('zipx-workbench', { projectId: d.project_id }); } }, t('workbench.title')),
      ];
      if (d.step && d.project_id) {
        footer.push(h(Btn, { key: 'st', onClick: function () { openRightTab('zipx-studio', { projectId: d.project_id, step: d.step }); } }, t('result.openStudio')));
        footer.push(h(Btn, { key: 'rf', ghost: true, disabled: busy[0], onClick: refresh }, busy[0] ? t('loading') : t('refresh')));
      }
      if (!d.has_content) {
        return phaseCard(t, props.block, d.label || t('result.title'), h(Empty, null, d.empty_reason || t('result.empty')), { kind: 'zipx-result', footer: footer });
      }
      var body = h('div', { style: S.col },
        error[0] ? h(ErrLine, null, error[0]) : null,
        h('div', { style: S.row }, h(GateBadge, { status: gate.overall || 'unchecked', label: gateLabel(t, gate.overall) }), h('span', { style: S.mono }, String(d.step || ''))),
        d.summary ? h('div', { style: { fontSize: 12, color: C.muted } }, textOf(d.summary, 220)) : null,
        countText ? h('div', { style: Object.assign({}, S.mono, { color: C.muted }) }, countText) : null,
        gate.score != null ? h('div', { style: { fontSize: 12 } }, t('result.score', { score: Number(gate.score).toFixed(2), threshold: gate.threshold == null ? '?' : gate.threshold })) : null,
        gate.summary ? h('div', { style: { fontSize: 11.5, color: C.muted } }, textOf(gate.summary, 300)) : null,
        asArray(gate.reasons).length ? h('div', { style: { fontSize: 11.5, color: C.fail } }, asArray(gate.reasons).map(function (r) { return '· ' + textOf(r, 160); }).join('；')) : null,
        d.text ? h('pre', { style: S.excerpt }, d.text) : null,
        d.truncated ? h('div', { style: { fontSize: 11.5, color: C.muted } }, t('result.truncated', { chars: d.text_chars == null ? '?' : d.text_chars })) : null,
        media.length ? h(MediaGrid, { items: media, onOpen: function (item) { openRightTab('zipx-artifact', { projectId: d.project_id, step: d.step, path: item.path, url: item.url, kind: item.kind }); } }) : null,
        media.length && d.media_total > media.length ? h('div', { style: { fontSize: 11.5, color: C.muted } }, t('result.mediaMore', { shown: media.length, total: d.media_total })) : null);
      return phaseCard(t, props.block, d.label || t('result.title'), body, { kind: 'zipx-result', footer: footer });
    }


    var SPECIFIC_CARDS = {
      zipx_project_state: StateCard,
      zipx_preview_action: PreviewCard,
      zipx_confirm_step: DispatchCard,
      zipx_abort: DispatchCard,
      zipx_watch_step: WatchCard,
      zipx_dispatch: DispatchCard,
      zipx_start: DispatchCard,
      zipx_start_episode: DispatchCard,
      zipx_regenerate_step: DispatchCard,
      zipx_regenerate_item: DispatchCard,
      zipx_resume_step: DispatchCard,
      zipx_artifacts: ArtifactsCard,
      zipx_step_result: ResultCard,
      zipx_read_asset: ResultCard,
      zipx_cost: CostCard,
      zipx_delivery: DeliveryCard,
      zipx_get_locks: LocksCard,
      zipx_list_projects: ProjectsCard,
      zipx_bind_project: BindCard,
      zipx_connect: ConnectCard,
    };
