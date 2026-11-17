    /* ── primitives ────────────────────────────────────────────────── */
    function proxyMedia(url) {
      var raw = String(url || '');
      if (!raw) return '';
      if (raw.indexOf('/zipx-media') === 0) return raw;
      if (!/^https?:\/\//i.test(raw) && raw.charAt(0) !== '/') return raw;
      return '/zipx-media?u=' + encodeURIComponent(raw);
    }

    function Badge(props) {
      var color = props.color || C.muted;
      return h('span', { style: Object.assign({}, S.badge, { color: color, background: props.tint || 'transparent', border: '1px solid ' + color }) },
        props.dot ? h('span', { style: Object.assign({}, S.dot, { background: color }) }) : null,
        props.children);
    }

    function GateBadge(props) {
      var status = props.status || 'unknown';
      return h(Badge, { color: gateColor(status), tint: status === 'unknown' || status === 'unchecked' ? 'transparent' : 'rgba(127,127,127,0.08)', dot: true },
        props.label || status);
    }

    function Btn(props) {
      var style = props.primary ? S.primary : (props.ghost ? S.ghost : S.btn);
      return h('button', {
        type: 'button',
        style: Object.assign({}, style, props.disabled ? { opacity: 0.45, cursor: 'not-allowed' } : null, props.style || null),
        disabled: Boolean(props.disabled),
        title: props.title || undefined,
        onClick: props.disabled ? undefined : props.onClick,
      }, props.icon || null, props.children);
    }

    function Card(props) {
      return h('div', { style: Object.assign({}, S.card, props.style || null), 'data-zipx-card': props.kind || 'card' },
        h('div', { style: S.cardHead },
          props.icon ? h('span', { style: { color: C.accent, display: 'inline-flex' } }, props.icon) : null,
          h('span', { style: S.cardTitle }, props.title),
          props.badge ? h('span', { style: { marginLeft: 'auto' } }, props.badge) : null),
        props.children,
        props.footer ? h('div', { style: { display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' } }, props.footer) : null);
    }

    function Progress(props) {
      var value = pct(props.produced, props.expected);
      if (value === null) return null;
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 90 } },
        h('div', { style: Object.assign({}, S.bar, { flex: '1 1 auto' }) }, h('div', { style: Object.assign({}, S.barFill, { width: value + '%' }) })),
        h('span', { style: Object.assign({}, S.mono, { color: C.muted }) }, String(props.produced) + '/' + String(props.expected)));
    }

    function Empty(props) {
      return h('div', { style: S.empty }, props.children || '—');
    }

    function ErrLine(props) {
      return h('div', { style: { color: C.fail, fontSize: 12 } }, props.children);
    }

    function MediaOne(props) {
      var item = props.item || {};
      var url = proxyMedia(item.url);
      if (!url) return null;
      var open = function () {
        if (props.onOpen) props.onOpen(item);
      };
      if (item.kind === 'video') {
        return h('video', { src: url, controls: true, preload: 'metadata', style: S.video });
      }
      if (item.kind === 'audio') {
        return h('audio', { src: url, controls: true, style: { width: '100%' } });
      }
      if (item.kind === 'image') {
        return h('div', { style: S.thumb, onClick: open, title: item.path || '' },
          h('img', { src: url, loading: 'lazy', style: S.thumbImg, alt: item.path || '' }));
      }
      return h('a', { href: url, target: '_blank', rel: 'noreferrer', style: S.link }, item.path || url);
    }

    function MediaGrid(props) {
      var items = asArray(props.items);
      if (!items.length) return null;
      return h('div', { style: S.grid }, items.map(function (item, i) {
        return h(MediaOne, { key: (item.path || '') + i, item: item, onOpen: props.onOpen });
      }));
    }

    function Field(props) {
      return h('label', { style: { display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, color: C.muted } },
        props.label,
        h('input', {
          style: S.input, type: props.type || 'text', value: props.value || '',
          placeholder: props.placeholder || '', disabled: Boolean(props.disabled),
          onChange: function (e) { if (props.onChange) props.onChange(e.target.value); },
        }));
    }

    function StepLine(props) {
      var current = props.current || {};
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
        h('span', { style: { fontWeight: 600 } }, current.label || current.step || '—'),
        h('span', { style: Object.assign({}, S.mono, { color: C.muted }) }, current.step || ''),
        h(GateBadge, { status: props.gate, label: gateLabel(props.t, props.gate) }),
        h(Progress, { produced: current.produced, expected: current.expected }),
        current.locked ? h(Badge, { color: C.warn, tint: TINT.warn, dot: true }, props.t('composer.generating', { produced: current.produced, expected: current.expected })) : null);
    }
