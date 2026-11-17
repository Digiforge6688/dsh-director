    /* ── composer status strip ─────────────────────────────────────── */
    function ComposerStatus(props) {
      var t = props.t;
      var store = useZipxStore();
      var sid = String(props.sessionId || '');
      useEffect(function () {
        if (!sid) return;
        RUNTIME.lastSessionId = sid;
        void loadSession(sid);
      }, [sid]);
      if (!store.projectId || !store.state) return null;
      var current = store.state.current || {};
      var gate = store.state.gates ? store.state.gates.overall : 'unchecked';
      var cost = store.cost || {};
      var credits = cost.estimate_calls;
      var paid = cost.paid === true || credits !== null && credits !== undefined;
      var generating = current.is_locked === true;
      var advance = function () {
        sendToDirector(props, '推进' + (current.label ? '「' + current.label + '」' : '当前步骤') + '，先预检再按批准执行。');
      };
      return h('div', {
        style: { display: 'flex', alignItems: 'center', gap: 8, padding: '2px 2px 4px', fontSize: 11.5, color: C.muted, flexWrap: 'wrap' },
        'data-zipx-composer': 'status',
      },
        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, color: C.text, fontWeight: 600 } },
          h(ZipxIcon, { size: 12 }), current.label || current.step || t('composer.noProject')),
        h(GateBadge, { status: gate, label: gateLabel(t, gate) }),
        generating
          ? h(Badge, { color: C.warn, tint: TINT.warn, dot: true }, t('composer.generating', { produced: current.produced ?? '?', expected: current.expected ?? '?' }))
          : h('span', null, t('composer.idle')),
        h('span', null, paid ? (credits === null || credits === undefined ? t('composer.costUnknown') : t('composer.cost', { credits: credits })) : t('preview.free')),
        h('span', { style: S.spacer }),
        h(Btn, { primary: true, disabled: generating, onClick: advance }, t('composer.advance')));
    }
