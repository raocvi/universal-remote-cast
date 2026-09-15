// Puente TV ⇄ teléfonos para las páginas del escenario (Universal Remote, 2026-09-14).
// Solo datos: cada teléfono abre una conexión WebRTC por la Wi‑Fi de casa con un código de
// 6 letras; por internet solo va la señalización (función voice-signal). Reensambla mensajes
// por trozos (fotos en base64) y entrega objetos ya completos. ES5: motores de TV viejos.
(function () {
  var SIGNAL = 'https://qojtwgzpazwompyvtpjk.supabase.co/functions/v1/voice-signal';
  var api = {};
  api.start = function (opts) {
    var code = String(opts.code || '').toUpperCase();
    var onMessage = opts.onMessage || function () {};
    var onPeers = opts.onPeers || function () {};
    var lastId = 0, peers = {}, npeers = 0, stopped = false, parts = {};

    function post(kind, payload) {
      var x = new XMLHttpRequest(); x.open('POST', SIGNAL, true); x.setRequestHeader('Content-Type', 'application/json');
      x.send(JSON.stringify({ code: code, to: 'phone', kind: kind, payload: payload }));
    }
    function poll() {
      if (stopped) return;
      var x = new XMLHttpRequest();
      x.open('GET', SIGNAL + '?code=' + code + '&to=tv&after=' + lastId, true);
      x.onreadystatechange = function () {
        if (x.readyState !== 4) return;
        if (x.status === 200) { try { var msgs = JSON.parse(x.responseText).messages || []; for (var k = 0; k < msgs.length; k++) { lastId = msgs[k].id; handle(msgs[k].kind, msgs[k].payload); } } catch (e) {} }
        setTimeout(poll, npeers ? 1500 : 400);
      };
      x.send();
    }
    function handle(kind, payload) {
      var pid = payload && payload.peer ? String(payload.peer) : 'p0';
      if (kind === 'offer') { connect(pid, payload); return; }
      if (kind === 'ice' && peers[pid]) { try { peers[pid].pc.addIceCandidate(new RTCIceCandidate(payload.candidate || payload)); } catch (e) {} return; }
      if (kind === 'bye' && peers[pid]) drop(pid);
    }
    function connect(pid, offer) {
      if (!window.RTCPeerConnection) { post('bye', { peer: pid, reason: 'no_webrtc' }); return; }
      if (peers[pid]) drop(pid);
      var pc = new RTCPeerConnection({ iceServers: [] });
      var peer = { pc: pc, ch: null };
      peers[pid] = peer; npeers++; onPeers(npeers);
      pc.onicecandidate = function (e) { if (e.candidate) post('ice', { peer: pid, candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
      pc.oniceconnectionstatechange = function () { var s = pc.iceConnectionState; if (s === 'failed' || s === 'closed') drop(pid); };
      pc.ondatachannel = function (e) {
        peer.ch = e.channel;
        peer.ch.onmessage = function (msg) { var m; try { m = JSON.parse(msg.data); } catch (err) { return; } assemble(pid, m); };
        peer.ch.onopen = function () { send(pid, { t: 'ready' }); };
      };
      pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: offer.sdp })).then(function () { return pc.createAnswer(); })
        .then(function (answer) { return pc.setLocalDescription(answer).then(function () { post('answer', { peer: pid, type: answer.type, sdp: answer.sdp }); }); })
        .catch(function () { drop(pid); });
    }
    function drop(pid) {
      var p = peers[pid]; if (!p) return;
      try { p.pc.close(); } catch (e) {}
      delete peers[pid]; npeers--; onPeers(npeers);
    }
    // Trozos {t:'c'|otro, id, i, n, d}: se juntan y se entregan como {t:'chunked', kind, id, data}
    function assemble(pid, m) {
      if (!m || !m.t) return;
      if (typeof m.i === 'number' && typeof m.n === 'number' && typeof m.d === 'string' && m.id) {
        var key = m.t + ':' + m.id;
        var slot = parts[key] || (parts[key] = { got: 0, n: m.n, arr: new Array(m.n) });
        if (slot.arr[m.i] === undefined) { slot.arr[m.i] = m.d; slot.got++; }
        if (slot.got < slot.n) { if (m.i % 20 === 0) send(pid, { t: 'chunk-ack', id: m.id, i: m.i }); return; }
        var data = slot.arr.join(''); delete parts[key];
        onMessage(pid, { t: 'chunked', kind: m.t, id: m.id, data: data });
        return;
      }
      onMessage(pid, m);
    }
    function send(pid, obj) { var p = peers[pid]; try { if (p && p.ch && p.ch.readyState === 'open') p.ch.send(JSON.stringify(obj)); } catch (e) {} }
    function broadcast(obj) { for (var k in peers) send(k, obj); }
    poll();
    return {
      send: send, broadcast: broadcast,
      stop: function () { stopped = true; for (var k in peers) drop(k); },
    };
  };
  window.UrpStageLink = api;
})();
