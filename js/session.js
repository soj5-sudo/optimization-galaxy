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
    const here = `${location.origin}${location.pathname}?session=${id}`;
    const urls = [here];
    // on a machine serving to the local network, offer the address others can reach
    const port = (info && info.port) || location.port;
    for (const ip of (info && info.lan) || []) {
      const lan = `http://${ip}:${port}/?session=${id}`;
      if (lan !== here) urls.push(lan);
    }
    return urls;
  }

  // ---------- when there is no server ----------
  // A static host has no place to keep a session, so the browser keeps it. Two
  // windows on the same machine share it through a broadcast channel, which is
  // exactly the case being demonstrated: three roles, three windows, one record.
  // Across machines the server is required, and the interface says so rather
  // than pretending.
  const local = {
    channel: null,
    key: id => 'og.session.' + id,

    connect(id) {
      if (this.channel) this.channel.close();
      this.channel = new BroadcastChannel('og.session.' + id);
      this.channel.onmessage = ev => {
        const msg = ev.data || {};
        if (msg.type === 'roster' && state.onRoster) state.onRoster(msg.participants);
        if (msg.type === 'envelope' && state.onEnvelope && msg.from !== state.clientId) {
          state.onEnvelope(msg.envelope);
        }
        if (msg.type === 'state' && msg.from !== state.clientId && state.onRemoteState) {
          state.onRemoteState(msg.scope, msg.patch);
        }
      };
    },

    read(id) {
      try { return JSON.parse(localStorage.getItem(this.key(id)) || '{}'); } catch (e) { return {}; }
    },
    write(id, data) {
      try { localStorage.setItem(this.key(id), JSON.stringify(data)); } catch (e) { /* full or private mode */ }
    },

    join(id, name, org) {
      const data = this.read(id);
      data.participants = (data.participants || []).filter(p => p.clientId !== state.clientId);
      data.participants.push({ clientId: state.clientId, name, org });
      this.write(id, data);
      this.connect(id);
      if (this.channel) this.channel.postMessage({ type: 'roster', participants: data.participants });
      return { clientId: state.clientId, org, participants: data.participants };
    },

    post(intent, from, payload, scope) {
      if (!this.channel) return null;
      const envelope = { intent, from, payload, scope, at: new Date().toISOString() };
      this.channel.postMessage({ type: 'envelope', envelope, from: state.clientId });
      return envelope;
    },

    push(patch, scope) {
      if (!this.channel) return;
      this.channel.postMessage({ type: 'state', patch, scope, from: state.clientId });
    },
  };

  let usingLocal = false;

  async function serverReachable() {
    try {
      const r = await fetch('/api/hostinfo', { cache: 'no-store' });
      return r.ok;
    } catch (e) { return false; }
  }

  // Creates a session on the server when there is one, in the browser when not.
  async function open(name, org) {
    if (await serverReachable()) {
      usingLocal = false;
      const id = await create();
      await join(id, name, org);
      return { id, local: false };
    }
    usingLocal = true;
    const id = Math.random().toString(36).slice(2, 8).toUpperCase();
    state.id = id; state.name = name; state.org = org || state.org;
    local.join(id, name, state.org);
    return { id, local: true };
  }

  async function joinAnywhere(id, name, org) {
    if (await serverReachable()) {
      usingLocal = false;
      return join(id, name, org);
    }
    usingLocal = true;
    state.id = id; state.name = name; state.org = org || state.org;
    const joined = local.join(id, name, state.org);
    if (state.onRoster) state.onRoster(joined.participants);
    return joined;
  }

  function isLocal() { return usingLocal; }

  // route through whichever transport is live
  async function postAnywhere(intent, from, payload, scope) {
    if (usingLocal) return local.post(intent, from, payload, scope);
    return post(intent, from, payload, scope);
  }
  async function pushAnywhere(patch, scope) {
    if (usingLocal) return local.push(patch, scope);
    return push(patch, scope);
  }

  return {
    state, create, join, hostInfo, shareUrls,
    open, joinAnywhere, isLocal,
    push: pushAnywhere, post: postAnywhere,
  };
})();
