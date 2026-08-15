// session.js: multiplayer session sharing. One shared state object per session,
// fanned out over SSE from the local server. Inputs are synced (image, scale,
// objective, run counter); every client recomputes the plan locally from the
// same inputs, so results stay identical without shipping them.

const Session = (() => {

  const state = {
    id: null,
    clientId: Math.random().toString(36).slice(2, 10),
    name: null,
    version: 0,
    es: null,
    onRemoteState: null,   // set by main.js
    onRoster: null,
  };

  async function api(path, body) {
    const res = await fetch(path, body ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    } : undefined);
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json();
  }

  async function create() {
    const { id } = await api('/api/session', {});
    return id;
  }

  async function join(id, name) {
    state.id = id;
    state.name = name;
    const joined = await api(`/api/session/${id}/join`, { clientId: state.clientId, name });
    listen(id);
    const cur = await api(`/api/session/${id}/state`);
    state.version = cur.version;
    if (state.onRoster) state.onRoster(joined.participants);
    if (cur.state && Object.keys(cur.state).length && state.onRemoteState) {
      state.onRemoteState(cur.state, { initial: true });
    }
    return joined;
  }

  function listen(id) {
    if (state.es) state.es.close();
    const es = new EventSource(`/api/session/${id}/events?clientId=${state.clientId}`);
    state.es = es;
    es.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'roster' && state.onRoster) state.onRoster(msg.participants);
      if (msg.type === 'hello' && state.onRoster) state.onRoster(msg.participants);
      if (msg.type === 'state') {
        state.version = msg.version;
        if (msg.from !== state.clientId && state.onRemoteState) {
          state.onRemoteState(msg.patch, { initial: false });
        }
      }
    };
    window.addEventListener('beforeunload', () => {
      if (state.id) {
        navigator.sendBeacon(`/api/session/${state.id}/leave`,
          new Blob([JSON.stringify({ clientId: state.clientId })], { type: 'application/json' }));
      }
    });
  }

  async function push(patch) {
    if (!state.id) return;
    try {
      const r = await api(`/api/session/${state.id}/state`, { patch, from: state.clientId });
      state.version = r.version;
    } catch (e) {
      console.warn('Session push failed', e);
    }
  }

  async function hostInfo() {
    try { return await api('/api/hostinfo'); } catch (e) { return { port: location.port, lan: [] }; }
  }

  function shareUrls(id, info) {
    const port = info.port || location.port || 80;
    const urls = [`http://localhost:${port}/?session=${id}`];
    for (const ip of info.lan || []) urls.push(`http://${ip}:${port}/?session=${id}`);
    return urls;
  }

  return { state, create, join, push, hostInfo, shareUrls };
})();
