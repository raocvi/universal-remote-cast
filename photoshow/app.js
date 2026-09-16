// «Momentos en el TV»: pega el puente (bridge.js) con el escenario visual (stage.js).
// Se monta en la página que toque: el receptor de Cast o index.html en el navegador del TV.
// Protocolo con la app (canal de datos):
//   teléfono → TV: {t:'hello'} · {t:'photo', id, i, n, d} (trozos base64 JPEG) ·
//                  {t:'show', template, title, subtitle, music, lang} · {t:'play'} · {t:'pause'} ·
//                  {t:'template', v} · {t:'music', v} · {t:'clear'}
//   TV → teléfono: {t:'ready'} · {t:'photos', n} · {t:'progress', i, n} · {t:'end'}
(function () {
  var api = { mounted: false };
  function load(src, cb) {
    var s = document.createElement('script'); s.src = src; s.onload = cb; s.onerror = cb; document.head.appendChild(s);
  }
  api.mount = function (container, opts) {
    var base = (opts && opts.base) || (document.currentScript && document.currentScript.src ? document.currentScript.src.replace(/[^\/]*$/, '') : 'https://raocvi.github.io/universal-remote-cast/photoshow/');
    var code = String((opts && opts.code) || '').toUpperCase();
    // Montaje idempotente: un segundo mensaje «page» no vuelve a cargar los guiones
    // (cada carga creaba otro escenario encima del anterior) ni deja el puente anterior vivo.
    if (api.mounted) api.unmount();
    var pending = (window.UrpPhotoShow ? 0 : 1) + (window.UrpStageLink ? 0 : 1);
    function ready() {
      if (pending > 0 && --pending) return;
      if (!window.UrpPhotoShow || !window.UrpStageLink) return;
      var show = window.UrpPhotoShow;
      var photos = 0;
      show.mount(container, {
        template: 'memories', music: 'calm', loop: true,
        onProgress: function (i, n) { link.broadcast({ t: 'progress', i: i, n: n }); },
        onEnd: function () { link.broadcast({ t: 'end' }); },
      });
      var link = window.UrpStageLink.start({
        code: code,
        onMessage: function (pid, m) {
          if (m.t === 'chunked' && m.kind === 'photo') {
            photos++;
            show.addPhoto({ id: m.id, src: 'data:image/jpeg;base64,' + m.data, w: 0, h: 0 });
            link.broadcast({ t: 'photos', n: photos });
            return;
          }
          if (m.t === 'show') { if (m.lang) show.setLang(m.lang); if (m.template) show.setTemplate(m.template); if (m.music) show.setMusic(m.music); show.setTitle(m.title || '', m.subtitle || ''); show.play(); return; }
          if (m.t === 'hello') { if (m.lang) show.setLang(m.lang); link.send(pid, { t: 'photos', n: photos }); return; }
          if (m.t === 'play') { show.play(); return; }
          if (m.t === 'pause') { show.pause(); return; }
          if (m.t === 'template') { show.setTemplate(m.v); return; }
          if (m.t === 'music') { show.setMusic(m.v); return; }
          if (m.t === 'clear') { show.clear(); photos = 0; return; }
        },
      });
      api.link = link; api.show = show; api.mounted = true;
    }
    if (!pending) { ready(); return; }
    if (!window.UrpPhotoShow) load(base + 'stage.js', ready);
    if (!window.UrpStageLink) load(base + 'bridge.js', ready);
  };
  api.unmount = function () {
    try { if (api.link) api.link.stop(); } catch (e) {}
    try { if (api.show) api.show.unmount(); } catch (e) {}
    api.link = null; api.show = null; api.mounted = false;
  };
  window.UrpStagePage = api;
})();
