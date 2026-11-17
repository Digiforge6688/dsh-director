    /* ── settings section: connect / account / credits / budget / doctor ─ */
    function SettingsSection(props) {
      var t = props.t;
      var auth = useState(null);
      var me = useState(null);
      var credits = useState(null);
      var budget = useState(null);
      var doctor = useState(null);
      var email = useState('');
      var password = useState('');
      var name = useState('');
      var mode = useState('login');
      var busy = useState(false);
      var error = useState('');
      var notice = useState('');

      var load = function () {
        void call(AUTH + '/status').then(function (res) { if (res.ok) auth[1](res.json); });
        void call(ACCOUNT + '/me').then(function (res) { if (res.ok && res.json && res.json.ok !== false) me[1](res.json); else me[1](null); });
        void call(ACCOUNT + '/credits').then(function (res) { if (res.ok && res.json && res.json.ok !== false) credits[1](res.json); });
        void call(BUDGET).then(function (res) { if (res.ok && res.json) budget[1](res.json.budget); });
        void call(DOCTOR).then(function (res) { if (res.ok) doctor[1](res.json); });
      };
      useEffect(load, []);

      var submitAuth = function () {
        busy[1](true); error[1](''); notice[1]('');
        var path = mode[0] === 'register' ? ACCOUNT + '/register' : ACCOUNT + '/login';
        var body = mode[0] === 'register'
          ? { email: email[0].trim(), password: password[0], name: name[0].trim() }
          : { email: email[0].trim(), password: password[0] };
        void call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (res) {
          busy[1](false);
          if (res.ok && res.json && res.json.ok !== false) {
            password[1]('');
            notice[1](t('connected'));
            load();
            return;
          }
          error[1](apiErrorText(t, res));
        });
      };
      var signOut = function () {
        busy[1](true);
        void call(ACCOUNT + '/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(function () {
          busy[1](false); me[1](null); credits[1](null); forgetProject(); load();
        });
      };
      var saveBudget = function () {
        busy[1](true); error[1](''); notice[1]('');
        void call(BUDGET, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ per_step: Number(budget[0] && budget[0].per_step) || 0, daily: Number(budget[0] && budget[0].daily) || 0 }) }).then(function (res) {
          busy[1](false);
          if (res.ok && res.json) { budget[1](res.json.budget); notice[1](t('save')); }
          else error[1](apiErrorText(t, res));
        });
      };

      var connected = auth[0] ? auth[0].connected === true : null;
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h('h3', { style: S.title }, t('settings.title')),
        error[0] ? h(ErrLine, null, error[0]) : null,
        notice[0] ? h('div', { style: { color: C.pass, fontSize: 12 } }, notice[0]) : null,
        h(Card, { title: t('settings.connection'), badge: h(GateBadge, { status: connected === true ? 'pass' : connected === false ? 'warn' : 'unchecked', label: connected === true ? t('connected') : connected === false ? t('notConnected') : t('gate.unchecked') }) },
          h('div', { style: S.col },
            h('div', { style: { fontSize: 12 } }, t('settings.tokenSource') + '：' + String((auth[0] && auth[0].source) || '—')),
            h('div', { style: { fontSize: 12 } }, t('settings.credentials') + '：' + ((auth[0] && auth[0].credentials) ? 'yes' : 'no')),
            h('div', { style: { fontSize: 12 } }, t('connect.expires', { expires: (auth[0] && auth[0].expires_at) || t('settings.never') })),
            h('div', { style: { fontSize: 11.5, color: C.muted } }, t('settings.pairHint')))),
        h(Card, { title: t('settings.account') },
          me[0]
            ? h('div', { style: S.col },
              h('div', { style: { fontSize: 12 } }, (me[0].name || me[0].email || me[0].id || '') + (me[0].email ? ' · ' + me[0].email : '')),
              h('div', { style: { display: 'flex', gap: 6 } }, h(Btn, { onClick: signOut, disabled: busy[0] }, t('settings.signOut'))))
            : h('div', { style: S.col },
              h('div', { style: { display: 'flex', gap: 6 } },
                h(Btn, { primary: mode[0] === 'login', onClick: function () { mode[1]('login'); } }, t('settings.signIn')),
                h(Btn, { primary: mode[0] === 'register', onClick: function () { mode[1]('register'); } }, t('settings.register'))),
              h(Field, { label: t('settings.email'), value: email[0], onChange: email[1] }),
              mode[0] === 'register' ? h(Field, { label: t('settings.name'), value: name[0], onChange: name[1] }) : null,
              h(Field, { label: t('settings.password'), value: password[0], onChange: password[1], type: 'password' }),
              h('div', null, h(Btn, { primary: true, disabled: busy[0] || !email[0] || !password[0], onClick: submitAuth }, busy[0] ? t('loading') : (mode[0] === 'register' ? t('settings.register') : t('settings.signIn')))))),
        h(Card, { title: t('settings.credits') },
          credits[0]
            ? h('div', { style: { fontSize: 13, fontWeight: 600 } }, String(credits[0].balance ?? credits[0].credits ?? '—') + ' credits')
            : h('div', { style: { fontSize: 12, color: C.muted } }, t('cost.unknown'))),
        h(Card, { title: t('settings.budget') },
          h('div', { style: S.col },
            h(Field, { label: t('settings.budgetPerStep'), type: 'number', value: String((budget[0] && budget[0].per_step) || 0), onChange: function (v) { budget[1](Object.assign({}, budget[0] || {}, { per_step: Number(v) || 0 })); } }),
            h(Field, { label: t('settings.budgetDaily'), type: 'number', value: String((budget[0] && budget[0].daily) || 0), onChange: function (v) { budget[1](Object.assign({}, budget[0] || {}, { daily: Number(v) || 0 })); } }),
            h('div', { style: { fontSize: 11.5, color: C.muted } }, t('settings.budgetHint')),
            h(Btn, { onClick: saveBudget, disabled: busy[0] }, t('settings.budgetSave')))),
        h(Card, { title: t('settings.diagnostics'), badge: doctor[0] ? h(GateBadge, { status: doctor[0].ok ? 'pass' : 'fail', label: doctor[0].ok ? t('settings.doctorOk') : t('settings.doctorFail') }) : null },
          h('div', { style: S.col },
            h('div', { style: { fontSize: 12 } }, t('settings.version') + '：' + ((doctor[0] && doctor[0].version) || '—')),
            h('div', { style: { fontSize: 12 } }, t('settings.tools') + '：' + ((doctor[0] && doctor[0].tools) ?? '—')),
            h('div', { style: { fontSize: 12 } }, (doctor[0] && doctor[0].backend ? doctor[0].backend.url + ' · HTTP ' + doctor[0].backend.status + ' · ' + doctor[0].backend.ms + 'ms' : '—')),
            h('div', { style: { display: 'flex', gap: 6 } },
              h(Btn, { icon: h(RefreshIcon, null), onClick: load }, t('settings.doctor')),
              props.close ? h(Btn, { ghost: true, onClick: props.close }, t('close')) : null))));
    }
