// session.js
// The shared shipment session.
//
// Three companies work the same record. What each of them receives is decided
// on the server, not here: a client subscribes as one organisation and the
// stream only ever carries the shared surface plus that organisation's own
// private area. This file cannot ask for another company's numbers, because
// there is no request shape that would return them.

const Session = (() => {

  const state = {
    id: null,
    clientId: Math.random().toString(36).slice(2, 10),
    org: 'exporter',
    name: null,
    version: 0,
    es: null,
    onRemoteState: null,
    onRoster: null,
    onEnvelope: null,
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

  async function join(id, name, org) {
    state.id = id;
    state.name = name;
    state.org = org || state.org;
    const joined = await api(`/api/session/${id}/join`, { clientId: state.clientId, name, org: state.org });
    listen(id);
    if (state.onRoster) state.onRoster(joined.participants);
    return joined;
  }

  function listen(id) {
    if (state.es) state.es.close();
    const es = new EventSource(`/api/session/${id}/events?clientId=${state.clientId}&org=${state.org}`);
    state.es = es;
    es.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'roster' && state.onRoster) state.onRoster(msg.participants);
      if (msg.type === 'hello' && state.onRoster) state.onRoster(msg.participants);
      if (msg.type === 'state') {
        state.version = msg.version;
        if (msg.from !== state.clientId && state.onRemoteState) state.onRemoteState(msg.scope, msg.patch);
      }
      if (msg.type === 'envelope' && state.onEnvelope) state.onEnvelope(msg.envelope);
    };
    window.addEventListener('beforeunload', () => {
      if (state.id) {
        navigator.sendBeacon(`/api/session/${state.id}/leave`,
          new Blob([JSON.stringify({ clientId: state.clientId })], { type: 'application/json' }));
      }
    });
  }

  // scope decides who sees it: 'shared' for the stone and its evidence,
  // an organisation id for that company's own numbers
  async function push(patch, scope) {
    if (!state.id) return;
    try {
      const r = await api(`/api/session/${state.id}/state`, { patch, scope: scope || 'shared', from: state.clientId });
      state.version = r.version;
    } catch (e) { /* sharing is optional, the workspace still runs */ }
  }

  // agents talk to each other through this
  async function post(intent, from, payload, scope) {
    if (!state.id) return null;
    try {
      return await api(`/api/session/${state.id}/envelope`, { intent, from, payload, scope: scope || 'shared' });
    } catch (e) { return null; }
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

  return { state, create, join, push, post, hostInfo, shareUrls };
})();
