    /* ── small helpers ─────────────────────────────────────────────── */
    function fill(text, params) {
      if (!params) return String(text);
      return String(text).replace(/\{(\w+)\}/g, function (m, k) {
        return params[k] === undefined || params[k] === null ? m : String(params[k]);
      });
    }
    function isObj(value) { return value !== null && typeof value === 'object'; }
    function asArray(value) { return Array.isArray(value) ? value : []; }
    function textOf(value, max) {
      if (value === null || value === undefined) return '';
      var raw = typeof value === 'string' ? value : String(value);
      return raw.length > (max || 240) ? raw.slice(0, max || 240) + '…' : raw;
    }
    function shortId(value) { return String(value || '').slice(0, 8); }

    var C = {
      bg: 'var(--dsh-color-surface, #ffffff)',
      raised: 'var(--dsh-color-surface-raised, #f7f7f8)',
      border: 'var(--dsh-color-border, #e3e3e6)',
      text: 'var(--dsh-color-text, #1f2328)',
      muted: 'var(--dsh-color-text-muted, #6b7280)',
      accent: 'var(--dsh-color-accent, #2563eb)',
      pass: '#0f7b58',
      warn: '#8a5c00',
      fail: '#b42318',
      flat: '#6b7280',
    };
    var TINT = {
      accent: 'rgba(37, 99, 235, 0.09)',
      pass: 'rgba(15, 123, 88, 0.10)',
      warn: 'rgba(138, 92, 0, 0.10)',
      fail: 'rgba(180, 35, 24, 0.10)',
    };
    var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

    var S = {
      root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: C.bg, color: C.text, fontSize: 13, lineHeight: 1.5, fontFamily: 'inherit' },
      header: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', minHeight: 48, flex: '0 0 auto', flexWrap: 'wrap', borderBottom: '1px solid ' + C.border },
      title: { fontSize: 14, fontWeight: 650, margin: 0 },
      sub: { fontSize: 11.5, color: C.muted },
      spacer: { flex: '1 1 auto' },
      body: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: 16 },
      row: { display: 'flex', alignItems: 'center', gap: 8 },
      col: { display: 'flex', flexDirection: 'column', gap: 8 },
      btn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 28, padding: '0 10px', borderRadius: 8, border: '1px solid ' + C.border, background: C.bg, color: C.text, cursor: 'pointer', font: 'inherit', fontSize: 12 },
      primary: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 28, padding: '0 12px', borderRadius: 8, border: '1px solid transparent', background: C.accent, color: '#fff', cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 600 },
      ghost: { display: 'inline-flex', alignItems: 'center', gap: 4, height: 24, padding: '0 9px', borderRadius: 999, border: '1px solid ' + C.border, background: 'transparent', color: C.muted, cursor: 'pointer', font: 'inherit', fontSize: 11.5 },
      pill: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: 999, fontSize: 11, border: '1px solid currentColor', whiteSpace: 'nowrap' },
      dot: { width: 6, height: 6, borderRadius: 999, background: 'currentColor', flex: '0 0 auto' },
      input: { height: 30, padding: '0 9px', borderRadius: 8, border: '1px solid ' + C.border, background: C.bg, color: 'inherit', font: 'inherit', fontSize: 12.5, outline: 'none' },
      card: { border: '1px solid ' + C.border, borderRadius: 10, background: C.raised, padding: '10px 12px' },
      cardHead: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
      cardTitle: { fontSize: 12.5, fontWeight: 650 },
      muted: { color: C.muted },
      err: { color: C.fail },
      mono: { fontFamily: MONO, fontSize: 11 },
      code: { display: 'block', padding: '5px 7px', borderRadius: 7, background: 'rgba(127,127,127,0.12)', fontFamily: MONO, fontSize: 11, wordBreak: 'break-all' },
      bar: { height: 6, borderRadius: 999, background: 'rgba(127,127,127,0.18)', overflow: 'hidden' },
      barFill: { height: '100%', background: C.accent, transition: 'width .2s ease' },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 },
      thumb: { border: '1px solid ' + C.border, borderRadius: 8, overflow: 'hidden', background: '#000', cursor: 'pointer' },
      thumbImg: { display: 'block', width: '100%', height: 90, objectFit: 'cover' },
      video: { width: '100%', maxHeight: 260, background: '#000', borderRadius: 8, display: 'block' },
      list: { display: 'flex', flexDirection: 'column', gap: 6 },
      item: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 9, border: '1px solid ' + C.border, background: C.bg, cursor: 'pointer', color: 'inherit', font: 'inherit', textAlign: 'left', width: '100%' },
      itemOn: { background: TINT.accent, borderColor: 'rgba(37, 99, 235, 0.28)' },
      badge: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 7px', height: 18, borderRadius: 999, fontSize: 10.5, fontWeight: 600 },
      empty: { padding: 24, textAlign: 'center', color: C.muted, fontSize: 12.5 },
      sep: { height: 1, background: C.border, margin: '8px 0' },
      link: { color: C.accent, cursor: 'pointer', textDecoration: 'none', fontSize: 12 },
      nowrap: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      scrollX: { display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 },
    };

    function gateColor(status) {
      if (status === 'pass') return C.pass;
      if (status === 'warn') return C.warn;
      if (status === 'fail') return C.fail;
      return C.flat;
    }
    function gateLabel(t, status) {
      if (status === 'pass' || status === 'warn' || status === 'fail' || status === 'unchecked') return t('gate.' + status);
      return t('gate.unknown');
    }
    function fmtTime(iso) {
      if (!iso) return '—';
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      try { return d.toLocaleString(); } catch (e) { return String(iso); }
    }
    function pct(produced, expected) {
      var p = Number(produced), e = Number(expected);
      if (!isFinite(p) || !isFinite(e) || e <= 0) return null;
      return Math.max(0, Math.min(100, Math.round((p / e) * 100)));
    }

    /* ── same-origin calls (token stays on the Host) ───────────────── */
    function call(path, init) {
      var options = init || {};
      var url = path.indexOf('/zipx-') === 0 ? path : API + path;
      return fetch(url, {
        method: options.method || 'GET',
        headers: Object.assign({ Accept: 'application/json' }, options.headers || {}),
        body: options.body,
        signal: options.signal,
      }).then(function (res) {
        return res.text().then(function (text) {
          var json = null;
          try { json = JSON.parse(text); } catch (e) { json = null; }
          return { ok: res.ok, status: res.status, json: json, text: text };
        });
      }).catch(function (error) {
        return { ok: false, status: 0, json: null, text: String(error && error.message ? error.message : error), network: true };
      });
    }
    function apiErrorText(t, res) {
      if (!res) return t('error.http', { status: '?' });
      if (res.status === 0) return t('error.network') + (res.text ? ' · ' + textOf(res.text, 160) : '');
      var body = res.json;
      var code = body && (body.code || (body.detail && body.detail.code));
      var message = body && (body.message || (body.detail && body.detail.message) || body.detail);
      var head = t('error.http', { status: res.status });
      if (code) head += ' · ' + code;
      if (message && typeof message === 'string') head += ' · ' + message.slice(0, 200);
      return head;
    }

    /* ── host navigation helpers ───────────────────────────────────── */
    function openLibrary() {
      try {
        var layout = RUNTIME.ctx && RUNTIME.ctx.get('layout');
        if (layout && typeof layout.selectPanel === 'function') { layout.selectPanel('zipx'); return true; }
      } catch (e) { /* no layout service */ }
      return false;
    }
    function closeLibrary() {
      try {
        var layout = RUNTIME.ctx && RUNTIME.ctx.get('layout');
        if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(null);
      } catch (e) { /* no layout service */ }
    }
    function openRightTab(kind, params) {
      try {
        var sidebar = RUNTIME.ctx && RUNTIME.ctx.get('sidebarRight');
        if (sidebar && typeof sidebar.openTab === 'function') { sidebar.openTab(kind, { params: params }); return true; }
      } catch (e) { /* no right sidebar */ }
      return false;
    }
    /** Buttons never write the backend: they turn intent into the user's own message. */
    function sendToDirector(props, text) {
      try {
        if (props && props.inputActions && typeof props.inputActions.setDraft === 'function') {
          props.inputActions.setDraft(String(text || ''));
          if (typeof props.inputActions.submit === 'function') props.inputActions.submit();
          return true;
        }
      } catch (e) { /* input locked */ }
      return false;
    }

    /* ── icons ─────────────────────────────────────────────────────── */
    function ZipxIcon(props) {
      var size = (props && props.size) || 16;
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('rect', { x: 1.7, y: 3.2, width: 12.6, height: 9.6, rx: 1.6 }),
        h('path', { d: 'M1.7 6.2h12.6' }),
        h('path', { d: 'M5.2 3.2 3.9 6.2M9.4 3.2 8.1 6.2M13.4 3.2 12.1 6.2' }));
    }
    function ChevronIcon() {
      return h('svg', { width: 10, height: 10, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': 'true' }, h('path', { d: 'M4 6l4 4 4-4' }));
    }
    function PlayIcon() {
      return h('svg', { width: 11, height: 11, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true' }, h('path', { d: 'M4 2.5v11l9-5.5-9-5.5Z' }));
    }
    function RefreshIcon() {
      return h('svg', { width: 11, height: 11, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': 'true' }, h('path', { d: 'M13 8a5 5 0 1 1-1.5-3.6' }), h('path', { d: 'M13 2v3.4h-3.4' }));
    }
