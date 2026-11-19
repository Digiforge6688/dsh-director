    /* ── one session-scoped store (no global project fallback) ─────── */
    var STORE = {
      sessionId: '', loadedFor: '', projectId: '', project: null,
      state: null, cost: null, loading: false, error: '', bound: null,
      // 面板按钮投递失败时的可见提示（静默失败 = 用户以为点坏了）
      notice: '',
    };
    var PROJECTS = { items: [], total: 0, loading: false, error: '', q: '', archived: false };
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

    function pushNotice(text) {
      STORE.notice = String(text || '');
      notifyStore();
      if (typeof setTimeout !== 'function') return;
      setTimeout(function () {
        if (STORE.notice === String(text || '')) { STORE.notice = ''; notifyStore(); }
      }, 8000);
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

    function refreshProjects(q, archived) {
      if (q !== undefined) PROJECTS.q = String(q || '');
      if (archived !== undefined) PROJECTS.archived = archived === true;
      PROJECTS.loading = true;
      PROJECTS.error = '';
      notifyStore();
      var query = '/projects?page=1&page_size=50&gates=1';
      if (PROJECTS.q) query += '&q=' + encodeURIComponent(PROJECTS.q);
      // 归档项目默认不列（后端默认同样排除）；打开「归档」时只看归档。
      if (PROJECTS.archived) query += '&status=archived';
      return call(query).then(function (res) {
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

    /** 改名/归档/恢复的唯一写入口（PATCH /project/{id}）。 */
    function patchProject(projectId, body) {
      return call('/project/' + encodeURIComponent(projectId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
    }

    function forgetProject() {
      STORE.projectId = '';
      STORE.project = null;
      STORE.state = null;
      STORE.cost = null;
      notifyStore();
    }
