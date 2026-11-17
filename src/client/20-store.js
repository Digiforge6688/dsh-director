    /* ── one session-scoped store (no global project fallback) ─────── */
    var STORE = {
      sessionId: '', loadedFor: '', projectId: '', project: null,
      state: null, cost: null, loading: false, error: '', bound: null,
    };
    var PROJECTS = { items: [], total: 0, loading: false, error: '' };
    var STORE_LISTENERS = [];
    var LOAD_SEQ = 0;

    function notifyStore() {
      var list = STORE_LISTENERS.slice();
      for (var i = 0; i < list.length; i += 1) {
        try { list[i](); } catch (e) { /* a listener must not break the store */ }
      }
    }
    function subscribeStore(fn) {
      STORE_LISTENERS.push(fn);
      return function () {
        var at = STORE_LISTENERS.indexOf(fn);
        if (at >= 0) STORE_LISTENERS.splice(at, 1);
      };
    }
    function useZipxStore() {
      var pair = useState(0);
      var bump = pair[1];
      useEffect(function () {
        return subscribeStore(function () { bump(function (n) { return n + 1; }); });
      }, []);
      return STORE;
    }
    function useProjectList() {
      var pair = useState(0);
      var bump = pair[1];
      useEffect(function () {
        return subscribeStore(function () { bump(function (n) { return n + 1; }); });
      }, []);
      return PROJECTS;
    }

    function applyState(state) {
      STORE.state = state || null;
      if (state && state.project) {
        STORE.project = state.project;
        STORE.projectId = String(state.project.id || STORE.projectId || '');
      }
      notifyStore();
    }

    function refreshCost() {
      if (!STORE.projectId || !STORE.state) return Promise.resolve(null);
      var step = STORE.state.current && STORE.state.current.step ? STORE.state.current.step : '';
      var q = step ? '?step=' + encodeURIComponent(step) : '';
      return call('/project/' + encodeURIComponent(STORE.projectId) + '/cost' + q).then(function (res) {
        if (res.ok && res.json) {
          STORE.cost = res.json;
          notifyStore();
          return res.json;
        }
        return null;
      });
    }

    function refreshState() {
      if (!STORE.projectId) return Promise.resolve(null);
      return call('/state/' + encodeURIComponent(STORE.projectId) + '?language=zh').then(function (res) {
        if (res.ok && res.json) {
          applyState(res.json);
          void refreshCost();
          return res.json;
        }
        STORE.error = apiErrorText(function (k) { return k; }, res);
        notifyStore();
        return null;
      });
    }

    function loadSession(sessionId, force) {
      var sid = String(sessionId || '');
      if (!sid) return Promise.resolve(STORE);
      if (!force && STORE.loadedFor === sid) return Promise.resolve(STORE);
      STORE.sessionId = sid;
      STORE.loadedFor = sid;
      STORE.loading = true;
      STORE.error = '';
      STORE.bound = null;
      notifyStore();
      var seq = ++LOAD_SEQ;
      return call('/session/' + encodeURIComponent(sid)).then(function (res) {
        if (seq !== LOAD_SEQ) return STORE;
        STORE.loading = false;
        if (res.ok && res.json) {
          STORE.bound = res.json;
          var pid = res.json.revoked === true ? '' : String(res.json.project_id || '');
          STORE.projectId = pid;
          if (!pid) {
            STORE.project = null;
            STORE.state = null;
            STORE.cost = null;
            notifyStore();
            return STORE;
          }
          return refreshState().then(function () { return STORE; });
        }
        STORE.error = apiErrorText(function (k) { return k; }, res);
        notifyStore();
        return STORE;
      });
    }

    function bindProject(sessionId, projectId) {
      var sid = String(sessionId || '');
      var pid = String(projectId || '');
      if (!sid || !pid) return Promise.resolve({ ok: false, message: 'missing session or project' });
      return call('/session/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dsh_session_id: sid, project_id: pid }),
      }).then(function (res) {
        if (res.ok) {
          STORE.sessionId = sid;
          STORE.loadedFor = sid;
          STORE.projectId = pid;
          STORE.bound = res.json;
          notifyStore();
          return refreshState().then(function () { return res; });
        }
        return res;
      });
    }

    function refreshProjects() {
      PROJECTS.loading = true;
      PROJECTS.error = '';
      notifyStore();
      return call('/projects?page=1&page_size=50&gates=1').then(function (res) {
        PROJECTS.loading = false;
        if (res.ok && res.json) {
          PROJECTS.items = asArray(res.json.items);
          PROJECTS.total = Number(res.json.total || PROJECTS.items.length);
        } else {
          PROJECTS.error = apiErrorText(function (k) { return k; }, res);
        }
        notifyStore();
        return PROJECTS;
      });
    }

    function forgetProject() {
      STORE.projectId = '';
      STORE.project = null;
      STORE.state = null;
      STORE.cost = null;
      notifyStore();
    }
