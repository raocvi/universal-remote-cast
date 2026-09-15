/*
 * Momentos en el TV · Universal Remote
 * Código original, sin dependencias, fuentes remotas ni solicitudes de red.
 * Espacio de composición: 1920 × 1080; los márgenes protegen el overscan del TV.
 *
 * UrpPhotoShow.mount(elemento, { template: 'editorial', lang: 'es', title: 'Nuestro verano',
 *   subtitle: 'Las cosas que se quedan', music: 'warm', loop: false,
 *   total: 10, onProgress: function (indice, total) {}, onEnd: function () {} });
 * UrpPhotoShow.addPhoto({ id: '1', src: jpegDataURL, w: 1600, h: 1200 });
 * UrpPhotoShow.play(); // Invocar desde un gesto para desbloquear WebAudio.
 *
 * Extensión opcional: total (1–10) precisa el contador de recepción. Sin él,
 * se muestra «n de 10» y se admite una colección menor tras 3 s sin llegadas.
 * addPhoto devuelve Promise<boolean>; false indica rechazo/imagen inválida.
 * onProgress usa índices desde 1; 0 identifica espera/portada. Total = fotos
 * decodificadas. Los callbacks se emiten al cambiar estos valores, no por frame.
 */
(function (global) {
  'use strict';

  // ═══ 1. LÓGICA PURA ═══════════════════════════════════════════════════════
  // Módulo privado: ninguna dependencia de DOM, reloj, red o WebAudio.
  // Strategy sí aporta: cada dirección artística decide su composición.
  // No hay Builder/Observer/Decorator: no existe complejidad que los justifique.
  var Logic = (function () {
    var names = ['editorial', 'neon', 'film', 'memories'];
    var moods = ['calm', 'warm', 'night', 'none'];
    var lengths = { editorial: 8.8, neon: 6.4, film: 8.2, memories: 9.2 };
    function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
    function mix(a, b, t) { return a + (b - a) * t; }
    function ease(t) {
      t = clamp(t, 0, 1);
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }
    function out(t) { return 1 - Math.pow(1 - clamp(t, 0, 1), 3); }
    function random(seed) {
      var s = seed >>> 0;
      return function () {
        s = (Math.imul(1664525, s) + 1013904223) >>> 0;
        return s / 4294967296;
      };
    }
    function rgb(c, alpha) {
      return 'rgba(' + c.map(Math.round).join(',') + ',' + (alpha === undefined ? 1 : alpha) + ')';
    }
    function tint(a, b, t) { return a.map(function (n, i) { return mix(n, b[i], t); }); }
    function palette(data) {
      var buckets = {}, sum = [0, 0, 0], count = 0;
      for (var i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        var c = [data[i], data[i + 1], data[i + 2]];
        count++;
        for (var j = 0; j < 3; j++) sum[j] += c[j];
        var hi = Math.max.apply(null, c), lo = Math.min.apply(null, c);
        if (hi < 35 || lo > 238) continue;
        var key = c.map(function (n) { return n >> 5; }).join(':');
        if (!buckets[key]) buckets[key] = { c: [0, 0, 0], n: 0, score: 0 };
        var b = buckets[key];
        b.n++;
        b.score += 0.3 + (hi - lo) / 255;
        for (j = 0; j < 3; j++) b.c[j] += c[j];
      }
      var ranked = Object.keys(buckets).map(function (k) { return buckets[k]; });
      ranked.sort(function (a, b) { return b.score - a.score; });
      var avg = count ? sum.map(function (n) { return n / count; }) : [153, 139, 127];
      var accent = ranked.length ? ranked[0].c.map(function (n) { return n / ranked[0].n; }) : avg;
      var second = avg;
      for (i = 1; i < ranked.length; i++) {
        var candidate = ranked[i].c.map(function (n) { return n / ranked[i].n; });
        if (candidate.reduce(function (v, n, k) { return v + Math.abs(n - accent[k]); }, 0) > 110) {
          second = candidate;
          break;
        }
      }
      return { accent: accent, second: second, paper: tint(avg, [251, 247, 236], 0.91),
        dark: tint(avg, [5, 6, 10], 0.89), light: tint(accent, [255, 255, 255], 0.65) };
    }
    function crop(iw, ih, w, h, p, seed, still) {
      // El zoom reserva margen: el panorámico nunca descubre los bordes.
      var t = ease(p), zoom = still ? 1.025 : mix(1.045, 1.145, seed % 2 ? 1 - t : t);
      var scale = Math.max(w / iw, h / ih) * zoom;
      var dw = iw * scale, dh = ih * scale;
      var x = still ? 0.5 : mix(seed % 2 ? 0.3 : 0.65, seed % 2 ? 0.65 : 0.35, t);
      var y = still ? 0.45 : mix(0.4, seed % 3 ? 0.57 : 0.3, t);
      return { x: -(dw - w) * x, y: -(dh - h) * y, w: dw, h: dh };
    }
    function chord(bar) {
      // Do mayor: I–vi–IV–V. Inversiones cercanas para una conducción suave.
      return [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 67]][bar % 4];
    }
    function notes(mood, step) {
      var slot = step % 8, c = chord(Math.floor(step / 8)), result = [];
      if (mood === 'calm') {
        if (slot === 0) result.push({ kind: 'pad', notes: c.slice(0, 3), length: 7.7, level: 0.13 });
        if (slot % 2 === 0) result.push({ kind: 'piano', notes: [c[[0, 2, 1, 3][slot / 2]] + 12], length: 3.8, level: 0.34 });
      } else if (mood === 'warm') {
        result.push({ kind: 'pluck', notes: [c[[0, 2, 1, 3, 0, 2, 1, 2][slot]] + (slot % 2 ? 12 : 0)], length: 2.3, level: slot === 0 ? 0.42 : 0.3 });
        if (slot === 0) result.push({ kind: 'piano', notes: [c[0] - 12], length: 3, level: 0.24 });
      } else if (mood === 'night') {
        if (slot === 0) result.push({ kind: 'pad', notes: c.slice(1), length: 5.6, level: 0.19 });
        if (slot === 0 || slot === 4) result.push({ kind: 'bass', notes: [c[0] - 24], length: 2.3, level: 0.36 });
        if (slot === 3 || slot === 7) result.push({ kind: 'piano', notes: [c[2] + 12], length: 2.5, level: 0.15 });
      }
      return result;
    }
    function options(o) {
      o = o || {};
      return {
        template: names.indexOf(o.template) >= 0 ? o.template : 'editorial',
        music: moods.indexOf(o.music) >= 0 ? o.music : 'calm',
        lang: language(o.lang),
        title: typeof o.title === 'string' ? o.title.trim().slice(0, 160) : '',
        subtitle: typeof o.subtitle === 'string' ? o.subtitle.trim().slice(0, 220) : '',
        loop: o.loop === true,
        total: Number.isFinite(o.total) ? clamp(Math.round(o.total), 1, 10) : 10,
        onProgress: typeof o.onProgress === 'function' ? o.onProgress : null,
        onEnd: typeof o.onEnd === 'function' ? o.onEnd : null
      };
    }
    return { clamp: clamp, mix: mix, ease: ease, out: out, random: random,
      rgb: rgb, tint: tint, palette: palette, crop: crop, chord: chord,
      notes: notes, options: options, names: names, moods: moods, lengths: lengths };
  }());
  // FIN LÓGICA PURA — permite pruebas aisladas sin iniciar un navegador.

  // ═══ 1b. TEXTOS ═════════════════════════════════════════════════════════
  // Los rótulos decorativos siguen el idioma del teléfono (mensaje «show», campo lang).
  // Sin idioma o idioma no cubierto: inglés, como en la app.
  var COPY = {
    es: {
      title: 'Lo que se queda', subtitle: 'Pequeños instantes. Toda una vida.',
      waitTitle: 'Lo cotidiano. Lo inolvidable.', waitBody: 'Tus fotos están a punto de llenar la pantalla.',
      of: 'de', preparing: 'PREPARANDO TU HISTORIA', awaiting: 'ESPERANDO TUS FOTOS',
      received: 'fotos recibidas', moment: 'Momento', madeWith: 'Hecho con Universal Remote', paused: 'EN PAUSA',
      eTag: 'LA VIDA, EN PEQUEÑO', eVolume: 'VOLUMEN', eTitles: ['El arte de estar aquí', 'Días sin prisa', 'Todo lo que importa'],
      eLine1: 'Una colección de instantes.', eLine2: 'Para volver, una y otra vez.', eSave: 'Si pudiera guardar un día.',
      eNoRush: 'Sin más. Sin prisa.', eSmall: ['Las pequeñas', 'cosas.'], eRemain: 'PERMANECEN',
      eFooter: 'Una vida digna de recordar', eCoverTag: 'UNA COLECCIÓN PERSONAL', eEndTag: 'EL ARCHIVO DE LO NUESTRO',
      eVol: 'VOL. 01', eEnd: 'FIN.', eCoverFooter: 'MOMENTOS EN EL TV', eInstants: 'INSTANTES',
      nLive: 'EN VIVO', nTitles: ['QUE NO TERMINE.', 'LA NOCHE ES NUESTRA.', 'BRILLAR. Y VOLVER.'],
      nInfinite: 'Este instante es infinito.', nFooter: 'MOMENTOS QUE ENCIENDEN TODO',
      nCoverTag: 'UNA HISTORIA EN ALTA INTENSIDAD', nEndTag: 'LA NOCHE SE QUEDA CONTIGO',
      fTag: 'ARCHIVO DE DÍAS FELICES', fCap1: 'Lo volvería a vivir.', fCap2: 'Aquí. Contigo.',
      fHand: ['un día', 'para', 'guardar.'], fCap3: 'De esos días que se quedan.', fMemories: 'RECUERDOS',
      fSession: 'SESIÓN', fFooter: 'La vida se siente así.', fCoverTag: 'COSAS QUE MERECEN QUEDARSE',
      fCoverFooter: 'UN ÁLBUM PARA VOLVER', fCapA: 'otra vez.', fCapB: 'que no se olvide.',
      mTitles: ['Y de pronto, todo.', 'Estábamos aquí.', 'Eso era la felicidad.', 'Para siempre, un instante.'],
      mBody: 'Las cosas que hacen que la vida sea nuestra.', mCoverTag: 'TU VIDA, EN PRIMER PLANO', mEndTag: 'PARA VOLVER A SENTIRLO'
    },
    en: {
      title: 'What stays', subtitle: 'Small moments. A whole life.',
      waitTitle: 'The everyday. The unforgettable.', waitBody: 'Your photos are about to fill the screen.',
      of: 'of', preparing: 'PREPARING YOUR STORY', awaiting: 'WAITING FOR YOUR PHOTOS',
      received: 'photos received', moment: 'Moment', madeWith: 'Made with Universal Remote', paused: 'PAUSED',
      eTag: 'LIFE, UP CLOSE', eVolume: 'VOLUME', eTitles: ['The art of being here', 'Unhurried days', 'All that matters'],
      eLine1: 'A collection of moments.', eLine2: 'To return to, again and again.', eSave: 'If I could keep one day.',
      eNoRush: 'Nothing more. No rush.', eSmall: ['The little', 'things.'], eRemain: 'REMAIN',
      eFooter: 'A life worth remembering', eCoverTag: 'A PERSONAL COLLECTION', eEndTag: 'THE ARCHIVE OF US',
      eVol: 'VOL. 01', eEnd: 'THE END.', eCoverFooter: 'MOMENTS ON TV', eInstants: 'MOMENTS',
      nLive: 'LIVE', nTitles: ['NEVER LET IT END.', 'THE NIGHT IS OURS.', 'SHINE. AND RETURN.'],
      nInfinite: 'This moment is infinite.', nFooter: 'MOMENTS THAT LIGHT UP EVERYTHING',
      nCoverTag: 'A STORY IN HIGH INTENSITY', nEndTag: 'THE NIGHT STAYS WITH YOU',
      fTag: 'ARCHIVE OF HAPPY DAYS', fCap1: 'I would live it again.', fCap2: 'Here. With you.',
      fHand: ['one day', 'to', 'keep.'], fCap3: 'Days like these stay.', fMemories: 'MEMORIES',
      fSession: 'SESSION', fFooter: 'Life feels like this.', fCoverTag: 'THINGS WORTH KEEPING',
      fCoverFooter: 'AN ALBUM TO COME BACK TO', fCapA: 'once more.', fCapB: 'never forget.',
      mTitles: ['And suddenly, everything.', 'We were here.', 'That was happiness.', 'An instant, forever.'],
      mBody: 'The things that make life ours.', mCoverTag: 'YOUR LIFE, UP FRONT', mEndTag: 'TO FEEL IT AGAIN'
    },
    pt: {
      title: 'O que fica', subtitle: 'Pequenos instantes. Uma vida inteira.',
      waitTitle: 'O cotidiano. O inesquecível.', waitBody: 'Suas fotos estão prestes a encher a tela.',
      of: 'de', preparing: 'PREPARANDO SUA HISTÓRIA', awaiting: 'ESPERANDO SUAS FOTOS',
      received: 'fotos recebidas', moment: 'Momento', madeWith: 'Feito com Universal Remote', paused: 'EM PAUSA',
      eTag: 'A VIDA, EM PEQUENO', eVolume: 'VOLUME', eTitles: ['A arte de estar aqui', 'Dias sem pressa', 'Tudo o que importa'],
      eLine1: 'Uma coleção de instantes.', eLine2: 'Para voltar, uma e outra vez.', eSave: 'Se eu pudesse guardar um dia.',
      eNoRush: 'Sem mais. Sem pressa.', eSmall: ['As pequenas', 'coisas.'], eRemain: 'PERMANECEM',
      eFooter: 'Uma vida digna de lembrar', eCoverTag: 'UMA COLEÇÃO PESSOAL', eEndTag: 'O ARQUIVO DO QUE É NOSSO',
      eVol: 'VOL. 01', eEnd: 'FIM.', eCoverFooter: 'MOMENTOS NA TV', eInstants: 'INSTANTES',
      nLive: 'AO VIVO', nTitles: ['QUE NÃO ACABE.', 'A NOITE É NOSSA.', 'BRILHAR. E VOLTAR.'],
      nInfinite: 'Este instante é infinito.', nFooter: 'MOMENTOS QUE ACENDEM TUDO',
      nCoverTag: 'UMA HISTÓRIA EM ALTA INTENSIDADE', nEndTag: 'A NOITE FICA COM VOCÊ',
      fTag: 'ARQUIVO DE DIAS FELIZES', fCap1: 'Eu viveria de novo.', fCap2: 'Aqui. Com você.',
      fHand: ['um dia', 'para', 'guardar.'], fCap3: 'Desses dias que ficam.', fMemories: 'LEMBRANÇAS',
      fSession: 'SESSÃO', fFooter: 'A vida é assim.', fCoverTag: 'COISAS QUE MERECEM FICAR',
      fCoverFooter: 'UM ÁLBUM PARA VOLTAR', fCapA: 'outra vez.', fCapB: 'que não se esqueça.',
      mTitles: ['E de repente, tudo.', 'Estávamos aqui.', 'Isso era a felicidade.', 'Para sempre, um instante.'],
      mBody: 'As coisas que fazem a vida ser nossa.', mCoverTag: 'SUA VIDA, EM PRIMEIRO PLANO', mEndTag: 'PARA SENTIR DE NOVO'
    },
    fr: {
      title: 'Ce qui reste', subtitle: 'De petits instants. Toute une vie.',
      waitTitle: 'Le quotidien. L’inoubliable.', waitBody: 'Vos photos vont bientôt remplir l’écran.',
      of: 'sur', preparing: 'PRÉPARATION DE VOTRE HISTOIRE', awaiting: 'EN ATTENTE DE VOS PHOTOS',
      received: 'photos reçues', moment: 'Moment', madeWith: 'Créé avec Universal Remote', paused: 'EN PAUSE',
      eTag: 'LA VIE, EN PETIT', eVolume: 'VOLUME', eTitles: ['L’art d’être ici', 'Des jours sans hâte', 'Tout ce qui compte'],
      eLine1: 'Une collection d’instants.', eLine2: 'Pour y revenir, encore et encore.', eSave: 'Si je pouvais garder un jour.',
      eNoRush: 'Rien de plus. Sans hâte.', eSmall: ['Les petites', 'choses.'], eRemain: 'RESTENT',
      eFooter: 'Une vie digne d’être retenue', eCoverTag: 'UNE COLLECTION PERSONNELLE', eEndTag: 'LES ARCHIVES DE NOUS',
      eVol: 'VOL. 01', eEnd: 'FIN.', eCoverFooter: 'MOMENTS SUR LA TV', eInstants: 'INSTANTS',
      nLive: 'EN DIRECT', nTitles: ['QUE ÇA NE FINISSE JAMAIS.', 'LA NUIT EST À NOUS.', 'BRILLER. ET REVENIR.'],
      nInfinite: 'Cet instant est infini.', nFooter: 'DES MOMENTS QUI ALLUMENT TOUT',
      nCoverTag: 'UNE HISTOIRE À HAUTE INTENSITÉ', nEndTag: 'LA NUIT RESTE AVEC TOI',
      fTag: 'ARCHIVES DES JOURS HEUREUX', fCap1: 'Je le revivrais.', fCap2: 'Ici. Avec toi.',
      fHand: ['un jour', 'à', 'garder.'], fCap3: 'De ces jours qui restent.', fMemories: 'SOUVENIRS',
      fSession: 'SÉANCE', fFooter: 'La vie, c’est ça.', fCoverTag: 'CE QUI MÉRITE DE RESTER',
      fCoverFooter: 'UN ALBUM OÙ REVENIR', fCapA: 'encore.', fCapB: 'à ne pas oublier.',
      mTitles: ['Et soudain, tout.', 'Nous étions là.', 'C’était ça, le bonheur.', 'Un instant, pour toujours.'],
      mBody: 'Ce qui fait que la vie est à nous.', mCoverTag: 'TA VIE, AU PREMIER PLAN', mEndTag: 'POUR LE RESSENTIR ENCORE'
    },
    de: {
      title: 'Was bleibt', subtitle: 'Kleine Momente. Ein ganzes Leben.',
      waitTitle: 'Der Alltag. Das Unvergessliche.', waitBody: 'Deine Fotos füllen gleich den Bildschirm.',
      of: 'von', preparing: 'DEINE GESCHICHTE WIRD VORBEREITET', awaiting: 'WARTE AUF DEINE FOTOS',
      received: 'Fotos empfangen', moment: 'Moment', madeWith: 'Erstellt mit Universal Remote', paused: 'PAUSE',
      eTag: 'DAS LEBEN, GANZ NAH', eVolume: 'BAND', eTitles: ['Die Kunst, hier zu sein', 'Tage ohne Eile', 'Alles, was zählt'],
      eLine1: 'Eine Sammlung von Augenblicken.', eLine2: 'Zum Zurückkommen, immer wieder.', eSave: 'Könnte ich einen Tag behalten.',
      eNoRush: 'Nicht mehr. Keine Eile.', eSmall: ['Die kleinen', 'Dinge.'], eRemain: 'BLEIBEN',
      eFooter: 'Ein Leben, das man erinnern will', eCoverTag: 'EINE PERSÖNLICHE SAMMLUNG', eEndTag: 'DAS ARCHIV VON UNS',
      eVol: 'BD. 01', eEnd: 'ENDE.', eCoverFooter: 'MOMENTE AUF DEM TV', eInstants: 'MOMENTE',
      nLive: 'LIVE', nTitles: ['ES SOLL NIE ENDEN.', 'DIE NACHT GEHÖRT UNS.', 'LEUCHTEN. UND ZURÜCK.'],
      nInfinite: 'Dieser Moment ist unendlich.', nFooter: 'MOMENTE, DIE ALLES ENTZÜNDEN',
      nCoverTag: 'EINE GESCHICHTE IN HOHER INTENSITÄT', nEndTag: 'DIE NACHT BLEIBT BEI DIR',
      fTag: 'ARCHIV GLÜCKLICHER TAGE', fCap1: 'Ich würde es wieder erleben.', fCap2: 'Hier. Mit dir.',
      fHand: ['ein Tag', 'zum', 'Behalten.'], fCap3: 'Von den Tagen, die bleiben.', fMemories: 'ERINNERUNGEN',
      fSession: 'SITZUNG', fFooter: 'So fühlt sich Leben an.', fCoverTag: 'DINGE, DIE BLEIBEN SOLLEN',
      fCoverFooter: 'EIN ALBUM ZUM ZURÜCKKEHREN', fCapA: 'noch einmal.', fCapB: 'nie vergessen.',
      mTitles: ['Und plötzlich alles.', 'Wir waren hier.', 'Das war Glück.', 'Ein Augenblick, für immer.'],
      mBody: 'Die Dinge, die das Leben zu unserem machen.', mCoverTag: 'DEIN LEBEN, GANZ VORN', mEndTag: 'UM ES WIEDER ZU SPÜREN'
    },
    ja: {
      title: '残るもの', subtitle: '小さな瞬間。ひとつの人生。',
      waitTitle: '日常。忘れられないもの。', waitBody: 'あなたの写真がまもなく画面いっぱいに。',
      of: '/', preparing: 'ストーリーを準備中', awaiting: '写真を待っています',
      received: '枚の写真を受信', moment: '瞬間', madeWith: 'Universal Remote で作成', paused: '一時停止',
      eTag: '小さな日々', eVolume: '第', eTitles: ['ここにいるという芸術', '急がない日々', '大切なものすべて'],
      eLine1: '瞬間のコレクション。', eLine2: '何度でも、戻るために。', eSave: 'もし一日をとっておけたら。',
      eNoRush: 'それだけ。急がずに。', eSmall: ['小さな', 'こと。'], eRemain: '残るもの',
      eFooter: '思い出すに値する人生', eCoverTag: '私だけのコレクション', eEndTag: '私たちの記録',
      eVol: 'VOL. 01', eEnd: '終わり。', eCoverFooter: 'テレビで見る瞬間', eInstants: '枚の瞬間',
      nLive: 'LIVE', nTitles: ['終わらないで。', '夜は私たちのもの。', '輝いて。また戻る。'],
      nInfinite: 'この瞬間は永遠。', nFooter: 'すべてを灯す瞬間',
      nCoverTag: '鮮烈な物語', nEndTag: '夜はあなたと共に',
      fTag: '幸せな日々の記録', fCap1: 'もう一度生きたい。', fCap2: 'ここで。あなたと。',
      fHand: ['とって', 'おきたい', '一日。'], fCap3: '心に残る日々。', fMemories: '思い出',
      fSession: 'セッション', fFooter: '人生はこんな感じ。', fCoverTag: '残しておきたいもの',
      fCoverFooter: 'また開きたいアルバム', fCapA: 'もう一度。', fCapB: '忘れないで。',
      mTitles: ['そして突然、すべてが。', '私たちはここにいた。', 'あれが幸せだった。', '永遠の一瞬。'],
      mBody: '人生を私たちのものにするもの。', mCoverTag: 'あなたの人生を、最前列で', mEndTag: 'もう一度感じるために'
    },
    ko: {
      title: '남는 것', subtitle: '작은 순간들. 온 인생.',
      waitTitle: '일상. 잊을 수 없는 것.', waitBody: '사진이 곧 화면을 가득 채웁니다.',
      of: '/', preparing: '이야기를 준비하는 중', awaiting: '사진을 기다리는 중',
      received: '장 수신됨', moment: '순간', madeWith: 'Universal Remote로 제작', paused: '일시정지',
      eTag: '작은 삶의 조각', eVolume: '제', eTitles: ['여기 있음의 예술', '서두르지 않는 날들', '중요한 모든 것'],
      eLine1: '순간의 컬렉션.', eLine2: '몇 번이고 돌아오기 위해.', eSave: '하루를 간직할 수 있다면.',
      eNoRush: '그뿐. 서두르지 않고.', eSmall: ['작은', '것들.'], eRemain: '남는다',
      eFooter: '기억할 만한 인생', eCoverTag: '나만의 컬렉션', eEndTag: '우리의 기록',
      eVol: 'VOL. 01', eEnd: '끝.', eCoverFooter: 'TV 속 순간들', eInstants: '개의 순간',
      nLive: 'LIVE', nTitles: ['끝나지 않기를.', '밤은 우리의 것.', '빛나고. 다시 돌아오고.'],
      nInfinite: '이 순간은 무한하다.', nFooter: '모든 것을 밝히는 순간들',
      nCoverTag: '강렬한 이야기', nEndTag: '밤은 당신과 함께',
      fTag: '행복한 날들의 기록', fCap1: '다시 살고 싶은 날.', fCap2: '여기. 너와 함께.',
      fHand: ['간직하고', '싶은', '하루.'], fCap3: '마음에 남는 날들.', fMemories: '추억',
      fSession: '세션', fFooter: '인생은 이런 느낌.', fCoverTag: '남겨둘 만한 것들',
      fCoverFooter: '다시 펼칠 앨범', fCapA: '한 번 더.', fCapB: '잊지 않도록.',
      mTitles: ['그리고 갑자기, 모든 것.', '우리는 여기 있었다.', '그게 행복이었다.', '영원한 한순간.'],
      mBody: '인생을 우리 것으로 만드는 것들.', mCoverTag: '당신의 인생, 맨 앞에서', mEndTag: '다시 느끼기 위해'
    },
    it: {
      title: 'Ciò che resta', subtitle: 'Piccoli istanti. Una vita intera.',
      waitTitle: 'Il quotidiano. L’indimenticabile.', waitBody: 'Le tue foto stanno per riempire lo schermo.',
      of: 'di', preparing: 'PREPARANDO LA TUA STORIA', awaiting: 'IN ATTESA DELLE TUE FOTO',
      received: 'foto ricevute', moment: 'Momento', madeWith: 'Creato con Universal Remote', paused: 'IN PAUSA',
      eTag: 'LA VITA, IN PICCOLO', eVolume: 'VOLUME', eTitles: ['L’arte di essere qui', 'Giorni senza fretta', 'Tutto ciò che conta'],
      eLine1: 'Una collezione di istanti.', eLine2: 'Per tornarci, ancora e ancora.', eSave: 'Se potessi tenere un giorno.',
      eNoRush: 'Niente di più. Senza fretta.', eSmall: ['Le piccole', 'cose.'], eRemain: 'RESTANO',
      eFooter: 'Una vita degna di essere ricordata', eCoverTag: 'UNA COLLEZIONE PERSONALE', eEndTag: 'L’ARCHIVIO DI NOI',
      eVol: 'VOL. 01', eEnd: 'FINE.', eCoverFooter: 'MOMENTI SULLA TV', eInstants: 'ISTANTI',
      nLive: 'IN DIRETTA', nTitles: ['CHE NON FINISCA.', 'LA NOTTE È NOSTRA.', 'BRILLARE. E TORNARE.'],
      nInfinite: 'Questo istante è infinito.', nFooter: 'MOMENTI CHE ACCENDONO TUTTO',
      nCoverTag: 'UNA STORIA AD ALTA INTENSITÀ', nEndTag: 'LA NOTTE RESTA CON TE',
      fTag: 'ARCHIVIO DEI GIORNI FELICI', fCap1: 'Lo rivivrei.', fCap2: 'Qui. Con te.',
      fHand: ['un giorno', 'da', 'tenere.'], fCap3: 'Di quei giorni che restano.', fMemories: 'RICORDI',
      fSession: 'SESSIONE', fFooter: 'La vita è così.', fCoverTag: 'COSE CHE MERITANO DI RESTARE',
      fCoverFooter: 'UN ALBUM A CUI TORNARE', fCapA: 'ancora.', fCapB: 'da non dimenticare.',
      mTitles: ['E all’improvviso, tutto.', 'Eravamo qui.', 'Quella era la felicità.', 'Per sempre, un istante.'],
      mBody: 'Le cose che rendono la vita nostra.', mCoverTag: 'LA TUA VITA, IN PRIMO PIANO', mEndTag: 'PER SENTIRLO ANCORA'
    },
    tr: {
      title: 'Geriye kalan', subtitle: 'Küçük anlar. Koca bir hayat.',
      waitTitle: 'Sıradan olan. Unutulmaz olan.', waitBody: 'Fotoğrafların ekranı doldurmak üzere.',
      of: '/', preparing: 'HİKÂYEN HAZIRLANIYOR', awaiting: 'FOTOĞRAFLARIN BEKLENİYOR',
      received: 'fotoğraf alındı', moment: 'An', madeWith: 'Universal Remote ile yapıldı', paused: 'DURAKLATILDI',
      eTag: 'HAYAT, KÜÇÜK HÂLİYLE', eVolume: 'CİLT', eTitles: ['Burada olma sanatı', 'Acelesiz günler', 'Önemli olan her şey'],
      eLine1: 'Anlardan bir koleksiyon.', eLine2: 'Tekrar tekrar dönmek için.', eSave: 'Bir günü saklayabilseydim.',
      eNoRush: 'Daha fazlası yok. Acele yok.', eSmall: ['Küçük', 'şeyler.'], eRemain: 'KALIR',
      eFooter: 'Hatırlanmaya değer bir hayat', eCoverTag: 'KİŞİSEL BİR KOLEKSİYON', eEndTag: 'BİZİM ARŞİVİMİZ',
      eVol: 'CİLT 01', eEnd: 'SON.', eCoverFooter: 'TV’DE ANLAR', eInstants: 'AN',
      nLive: 'CANLI', nTitles: ['HİÇ BİTMESİN.', 'GECE BİZİM.', 'PARLA. VE GERİ DÖN.'],
      nInfinite: 'Bu an sonsuz.', nFooter: 'HER ŞEYİ AYDINLATAN ANLAR',
      nCoverTag: 'YÜKSEK YOĞUNLUKTA BİR HİKÂYE', nEndTag: 'GECE SENİNLE KALIR',
      fTag: 'MUTLU GÜNLER ARŞİVİ', fCap1: 'Yeniden yaşardım.', fCap2: 'Burada. Seninle.',
      fHand: ['saklanacak', 'bir', 'gün.'], fCap3: 'Kalıcı olan günlerden.', fMemories: 'ANILAR',
      fSession: 'OTURUM', fFooter: 'Hayat böyle hissettirir.', fCoverTag: 'KALMAYI HAK EDEN ŞEYLER',
      fCoverFooter: 'DÖNÜLECEK BİR ALBÜM', fCapA: 'bir kez daha.', fCapB: 'unutulmasın.',
      mTitles: ['Ve birden, her şey.', 'Buradaydık.', 'Mutluluk buydu.', 'Sonsuza dek, bir an.'],
      mBody: 'Hayatı bizim yapan şeyler.', mCoverTag: 'HAYATIN, EN ÖNDE', mEndTag: 'YENİDEN HİSSETMEK İÇİN'
    },
    pl: {
      title: 'To, co zostaje', subtitle: 'Małe chwile. Całe życie.',
      waitTitle: 'Codzienność. To, co niezapomniane.', waitBody: 'Twoje zdjęcia zaraz wypełnią ekran.',
      of: 'z', preparing: 'PRZYGOTOWUJĘ TWOJĄ HISTORIĘ', awaiting: 'CZEKAM NA TWOJE ZDJĘCIA',
      received: 'zdjęć odebranych', moment: 'Chwila', madeWith: 'Stworzone w Universal Remote', paused: 'PAUZA',
      eTag: 'ŻYCIE, W MAŁEJ SKALI', eVolume: 'TOM', eTitles: ['Sztuka bycia tutaj', 'Dni bez pośpiechu', 'Wszystko, co ważne'],
      eLine1: 'Kolekcja chwil.', eLine2: 'By wracać, raz za razem.', eSave: 'Gdybym mógł zachować jeden dzień.',
      eNoRush: 'Nic więcej. Bez pośpiechu.', eSmall: ['Małe', 'rzeczy.'], eRemain: 'ZOSTAJĄ',
      eFooter: 'Życie warte zapamiętania', eCoverTag: 'OSOBISTA KOLEKCJA', eEndTag: 'ARCHIWUM NAS',
      eVol: 'TOM 01', eEnd: 'KONIEC.', eCoverFooter: 'CHWILE NA TV', eInstants: 'CHWIL',
      nLive: 'NA ŻYWO', nTitles: ['NIECH SIĘ NIE KOŃCZY.', 'NOC JEST NASZA.', 'LŚNIĆ. I WRACAĆ.'],
      nInfinite: 'Ta chwila jest nieskończona.', nFooter: 'CHWILE, KTÓRE ROZŚWIETLAJĄ WSZYSTKO',
      nCoverTag: 'HISTORIA O WYSOKIEJ INTENSYWNOŚCI', nEndTag: 'NOC ZOSTAJE Z TOBĄ',
      fTag: 'ARCHIWUM SZCZĘŚLIWYCH DNI', fCap1: 'Przeżyłbym to znowu.', fCap2: 'Tutaj. Z tobą.',
      fHand: ['jeden dzień', 'do', 'zachowania.'], fCap3: 'Z tych dni, które zostają.', fMemories: 'WSPOMNIENIA',
      fSession: 'SESJA', fFooter: 'Tak smakuje życie.', fCoverTag: 'RZECZY WARTE ZACHOWANIA',
      fCoverFooter: 'ALBUM, DO KTÓREGO SIĘ WRACA', fCapA: 'jeszcze raz.', fCapB: 'nie zapomnij.',
      mTitles: ['I nagle wszystko.', 'Byliśmy tutaj.', 'To było szczęście.', 'Na zawsze, jedna chwila.'],
      mBody: 'To, co sprawia, że życie jest nasze.', mCoverTag: 'TWOJE ŻYCIE, NA PIERWSZYM PLANIE', mEndTag: 'BY POCZUĆ TO ZNOWU'
    },
    zh: {
      title: '留下的', subtitle: '小小的瞬间。整个人生。',
      waitTitle: '日常。难忘。', waitBody: '你的照片即将铺满屏幕。',
      of: '/', preparing: '正在准备你的故事', awaiting: '等待你的照片',
      received: '张照片已接收', moment: '瞬间', madeWith: '由 Universal Remote 制作', paused: '已暂停',
      eTag: '生活的小片段', eVolume: '第', eTitles: ['在此处的艺术', '不慌不忙的日子', '一切重要的事'],
      eLine1: '瞬间的收藏。', eLine2: '为了一次又一次地回来。', eSave: '如果能留住一天。',
      eNoRush: '仅此而已。不必着急。', eSmall: ['小小的', '事。'], eRemain: '留下',
      eFooter: '值得铭记的人生', eCoverTag: '私人收藏', eEndTag: '我们的档案',
      eVol: 'VOL. 01', eEnd: '完。', eCoverFooter: '电视上的瞬间', eInstants: '个瞬间',
      nLive: 'LIVE', nTitles: ['别让它结束。', '夜晚属于我们。', '闪耀。然后回来。'],
      nInfinite: '这一刻是无限的。', nFooter: '点亮一切的瞬间',
      nCoverTag: '一个高强度的故事', nEndTag: '夜晚与你同在',
      fTag: '快乐日子档案', fCap1: '我愿再活一次。', fCap2: '在这里。和你。',
      fHand: ['值得', '留住的', '一天。'], fCap3: '那些留下来的日子。', fMemories: '回忆',
      fSession: '场次', fFooter: '生活就是这种感觉。', fCoverTag: '值得留下的东西',
      fCoverFooter: '值得重温的相册', fCapA: '再一次。', fCapB: '不要忘记。',
      mTitles: ['然后突然，一切。', '我们曾在这里。', '那就是幸福。', '永恒的一瞬。'],
      mBody: '让生活属于我们的那些事。', mCoverTag: '你的人生，站在最前', mEndTag: '为了再次感受'
    },
    sv: {
      title: 'Det som stannar', subtitle: 'Små ögonblick. Ett helt liv.',
      waitTitle: 'Vardagen. Det oförglömliga.', waitBody: 'Dina bilder fyller snart skärmen.',
      of: 'av', preparing: 'FÖRBEREDER DIN BERÄTTELSE', awaiting: 'VÄNTAR PÅ DINA BILDER',
      received: 'bilder mottagna', moment: 'Ögonblick', madeWith: 'Skapad med Universal Remote', paused: 'PAUSAD',
      eTag: 'LIVET, I DET LILLA', eVolume: 'VOLYM', eTitles: ['Konsten att vara här', 'Dagar utan brådska', 'Allt som betyder något'],
      eLine1: 'En samling ögonblick.', eLine2: 'Att återvända till, gång på gång.', eSave: 'Om jag kunde spara en dag.',
      eNoRush: 'Inget mer. Ingen brådska.', eSmall: ['De små', 'sakerna.'], eRemain: 'STANNAR',
      eFooter: 'Ett liv värt att minnas', eCoverTag: 'EN PERSONLIG SAMLING', eEndTag: 'ARKIVET ÖVER OSS',
      eVol: 'VOL. 01', eEnd: 'SLUT.', eCoverFooter: 'ÖGONBLICK PÅ TV', eInstants: 'ÖGONBLICK',
      nLive: 'LIVE', nTitles: ['LÅT DET ALDRIG TA SLUT.', 'NATTEN ÄR VÅR.', 'LYSA. OCH KOMMA TILLBAKA.'],
      nInfinite: 'Det här ögonblicket är oändligt.', nFooter: 'ÖGONBLICK SOM TÄNDER ALLT',
      nCoverTag: 'EN BERÄTTELSE I HÖG INTENSITET', nEndTag: 'NATTEN STANNAR HOS DIG',
      fTag: 'ARKIV ÖVER LYCKLIGA DAGAR', fCap1: 'Jag skulle leva det igen.', fCap2: 'Här. Med dig.',
      fHand: ['en dag', 'att', 'spara.'], fCap3: 'Av de dagar som stannar.', fMemories: 'MINNEN',
      fSession: 'SESSION', fFooter: 'Livet känns så här.', fCoverTag: 'SAKER VÄRDA ATT BEHÅLLA',
      fCoverFooter: 'ETT ALBUM ATT ÅTERVÄNDA TILL', fCapA: 'en gång till.', fCapB: 'glöm det aldrig.',
      mTitles: ['Och plötsligt, allt.', 'Vi var här.', 'Det var lycka.', 'För alltid, ett ögonblick.'],
      mBody: 'Det som gör livet till vårt.', mCoverTag: 'DITT LIV, LÄNGST FRAM', mEndTag: 'FÖR ATT KÄNNA DET IGEN'
    }
  };
  function language(code) {
    code = String(code || '').toLowerCase().slice(0, 2);
    return COPY[code] ? code : 'en';
  }

  var W = 1920, H = 1080, PI = Math.PI;
  var clamp = Logic.clamp, mix = Logic.mix, ease = Logic.ease, out = Logic.out;
  var rgb = Logic.rgb, tint = Logic.tint;
  var SERIF = 'Georgia, "Times New Roman", serif';
  var SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
  var CONDENSED = '"Arial Narrow", "Franklin Gothic Medium", Impact, sans-serif';
  var MONO = '"Courier New", Courier, monospace';
  var HAND = '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
  var instance = null;

  // ═══ 2. PRIMITIVAS DE DIBUJO / ENTRADA-SALIDA ═══════════════════════════
  function canvas(w, h) {
    var el = document.createElement('canvas');
    el.width = w;
    el.height = h;
    return el;
  }
  function rect(c, x, y, w, h, color) {
    c.fillStyle = color;
    c.fillRect(x, y, w, h);
  }
  function line(c, x, y, ex, ey, color, width) {
    c.beginPath(); c.moveTo(x, y); c.lineTo(ex, ey);
    c.strokeStyle = color; c.lineWidth = width || 1; c.stroke();
  }
  function rounded(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
  }
  function text(c, value, x, y, size, family, color, weight, align) {
    c.fillStyle = color || '#fff';
    c.font = (weight || '400') + ' ' + size + 'px ' + (family || SANS);
    c.textAlign = align || 'left'; c.textBaseline = 'alphabetic';
    c.fillText(String(value), x, y);
  }
  function tracked(c, value, x, y, size, spacing, color, family) {
    c.fillStyle = color; c.font = '500 ' + size + 'px ' + (family || SANS);
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    Array.from(value).forEach(function (char) {
      c.fillText(char, x, y); x += c.measureText(char).width + spacing;
    });
  }
  function wrap(c, value, size, family, weight, maxWidth) {
    c.font = weight + ' ' + size + 'px ' + family;
    var words = value.split(/\s+/), lines = [], row = '';
    words.forEach(function (word) {
      // También se parten palabras largas: un título externo no sale del lienzo.
      if (c.measureText(word).width > maxWidth) {
        if (row) { lines.push(row); row = ''; }
        Array.from(word).forEach(function (ch) {
          if (c.measureText(row + ch).width > maxWidth) { lines.push(row); row = ''; }
          row += ch;
        });
      } else if (row && c.measureText(row + ' ' + word).width > maxWidth) {
        lines.push(row); row = word;
      } else row += (row ? ' ' : '') + word;
    });
    if (row) lines.push(row);
    return lines;
  }
  // Una línea que debe caber: reduce el cuerpo (hasta un 60 %) en idiomas más largos.
  function fit(c, value, x, y, size, family, color, weight, align, maxWidth) {
    var floor = Math.round(size * 0.6);
    c.font = (weight || '400') + ' ' + size + 'px ' + (family || SANS);
    while (size > floor && c.measureText(String(value)).width > maxWidth) {
      size -= 2; c.font = (weight || '400') + ' ' + size + 'px ' + (family || SANS);
    }
    text(c, value, x, y, size, family, color, weight, align);
  }
  function title(c, value, x, y, width, size, family, color, weight, align, maxLines) {
    maxLines = maxLines || 3;
    var lines = wrap(c, value, size, family, weight || '400', width);
    while (lines.length > maxLines && size > 32) {
      size -= 4; lines = wrap(c, value, size, family, weight || '400', width);
    }
    lines.forEach(function (row, i) {
      text(c, row, x, y + i * size * 1.04, size, family, color, weight, align);
    });
    return y + (lines.length - 1) * size * 1.04;
  }
  function photo(c, p, x, y, w, h, progress, seed, still, radius) {
    if (!p || !p.image) return;
    var b = Logic.crop(p.w, p.h, w, h, progress, seed || 0, still);
    c.save();
    if (radius) rounded(c, x, y, w, h, radius);
    else { c.beginPath(); c.rect(x, y, w, h); }
    c.clip(); c.drawImage(p.image, x + b.x, y + b.y, b.w, b.h); c.restore();
  }
  function shade(c, x, y, w, h, alpha, bottom) {
    var g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(0,0,0,' + (bottom ? 0 : alpha) + ')');
    g.addColorStop(1, 'rgba(0,0,0,' + (bottom ? alpha : 0) + ')');
    rect(c, x, y, w, h, g);
  }
  function glow(c, x, y, r, color, opacity) {
    // Gradiente radial: halo amplio sin recalcular filtros gaussianos por frame.
    var g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgb(color, opacity));
    g.addColorStop(0.42, rgb(color, opacity * 0.38));
    g.addColorStop(1, rgb(color, 0));
    rect(c, x - r, y - r, r * 2, r * 2, g);
  }
  function grainTexture() {
    var el = canvas(192, 192), c = el.getContext('2d'), d = c.createImageData(192, 192);
    var rng = Logic.random(774);
    for (var i = 0; i < d.data.length; i += 4) {
      var n = rng() > 0.5 ? 255 : 0;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = n;
      d.data[i + 3] = Math.floor(rng() * 22);
    }
    c.putImageData(d, 0, 0); return el;
  }
  function grain(c, s, alpha, moving) {
    if (s.quality === 0) return;
    c.save(); c.globalAlpha *= alpha;
    var shift = moving && !s.reduced ? Math.floor(s.clock * 8) % 8 * 23 : 0;
    c.translate(-shift, -shift);
    c.fillStyle = s.noisePattern || (s.noisePattern = c.createPattern(s.noise, 'repeat'));
    c.fillRect(0, 0, W + 200, H + 200); c.restore();
  }
  function vignette(c, strength) {
    var g = c.createRadialGradient(960, 490, 270, 960, 540, 1100);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,' + strength + ')');
    rect(c, 0, 0, W, H, g);
  }
  function sample(image) {
    try {
      var el = canvas(40, 40), c = el.getContext('2d');
      c.drawImage(image, 0, 0, 40, 40);
      return Logic.palette(c.getImageData(0, 0, 40, 40).data);
    } catch (_) { return Logic.palette([]); }
  }
  function thumbnail(image) {
    // La profundidad usa una copia pequeña, no un blur de 1920 px por frame.
    var el = canvas(96, 54), c = el.getContext('2d');
    c.drawImage(image, 0, 0, 96, 54); return el;
  }
  function num(n) { return ('0' + n).slice(-2); }
  function copyOf(s) { return COPY[s.opts.lang] || COPY.en; }
  function headingOf(s) { return s.opts.title || copyOf(s).title; }
  function subtitleOf(s) { return s.opts.subtitle || copyOf(s).subtitle; }
  function sessionDate(lang) {
    try { return new Date().toLocaleDateString(lang, { day: '2-digit', month: '2-digit', year: 'numeric' }); }
    catch (_) { return new Date().toLocaleDateString(); }
  }
  function choose(s, i) { return s.photos[((i % s.photos.length) + s.photos.length) % s.photos.length]; }

  // ═══ 3. PLANTILLAS: CUATRO STRATEGIES DE DIRECCIÓN ARTÍSTICA ═════════════
  function editorial(c, s, scene, p) {
    var i = scene.index, current = scene.photos[0], pal = current.palette;
    var paper = rgb(pal.paper), ink = '#24231f', enter = out(scene.time / 1.7), L = copyOf(s);
    rect(c, 0, 0, W, H, paper);
    tracked(c, L.eTag, 96, 85, 28, 5, ink);
    text(c, L.eVolume + ' ' + num(i + 1), 1824, 85, 28, MONO, ink, '400', 'right');
    line(c, 96, 115, 1824, 115, 'rgba(30,30,24,.38)');
    if (i % 3 === 0) {
      // 1 + 2: una vertical dominante y dos contrapuntos con aire entre ellos.
      photo(c, current, 750, 170, 654, 758, p, i, s.reduced);
      if (scene.photos.length > 1) photo(c, scene.photos[1], 1440, 170 + (1 - enter) * 38, 384, 354, p, i + 1, s.reduced);
      if (scene.photos.length > 2) photo(c, scene.photos[2], 1440, 562 + (1 - enter) * 68, 384, 366, p, i + 2, s.reduced);
      text(c, num(i + 1), 92, 352, 192, SERIF, ink);
      line(c, 102, 404, 232, 404, ink, 2);
      title(c, L.eTitles[Math.floor(i / 3) % 3], 96, 562, 580, 92, SERIF, ink);
      fit(c, L.eLine1, 100, 851, 30, SANS, ink, '400', 'left', 600);
      fit(c, L.eLine2, 100, 898, 30, SANS, ink, '400', 'left', 600);
    } else if (i % 3 === 1) {
      // Un pliego panorámico; el número hace de ancla, no tapa la fotografía.
      photo(c, current, 96, 173, 1284, 645, p, i, s.reduced);
      text(c, num(i + 1), 1460, 322, 150, SERIF, ink);
      title(c, L.eSave, 1454, 455, 368, 68, SERIF, ink);
      line(c, 1458, 751, 1824, 751, 'rgba(30,30,24,.4)');
      fit(c, L.eNoRush, 1458, 804, 28, SANS, ink, '400', 'left', 366);
      title(c, headingOf(s), 96, 924, 1300, 66, SERIF, ink, '400', 'left', 1);
    } else {
      // 3 + 1: tres ventanas superiores y una panorámica inferior desplazada.
      var slots = [[96, 172, 440, 344], [560, 172, 440, 344], [1024, 172, 440, 344]];
      slots.forEach(function (r, n) {
        if (scene.photos[n]) photo(c, scene.photos[n], r[0], r[1], r[2], r[3], p, i + n, s.reduced);
      });
      photo(c, scene.photos[3] || current, 560, 552, 904, 376, p, i + 3, s.reduced);
      text(c, L.eSmall[0], 98, 649, 48, SERIF, ink);
      text(c, L.eSmall[1], 98, 717, 72, SERIF, ink);
      text(c, num(i + 1), 1542, 813, 164, SERIF, ink);
      tracked(c, L.eRemain, 1525, 877, 28, 2, ink);
    }
    line(c, 96, 976, 1824, 976, 'rgba(30,30,24,.38)');
    text(c, 'MOMENTOS / ' + num(i + 1), 96, 1030, 28, MONO, ink);
    fit(c, L.eFooter, 1824, 1030, 28, SERIF, ink, 'italic', 'right', 900);
    grain(c, s, 0.32, false);
  }

  var neonColors = [[250, 122, 248], [247, 176, 67], [87, 190, 253], [215, 95, 228]];
  function neonWorld(c, s, pal, time) {
    if (s.reduced) time = 0;
    rect(c, 0, 0, W, H, '#06070b');
    var breath = s.reduced ? 0.6 : 0.56 + Math.sin(time * 0.55) * 0.13;
    glow(c, 410 + Math.sin(time * 0.18) * 90, 405, 840, tint(neonColors[0], pal.accent, 0.28), breath);
    glow(c, 1540, 540, 850, tint(neonColors[2], pal.second, 0.3), breath * 0.8);
    if (s.quality > 0) glow(c, 1090, 900, 580, neonColors[1], 0.14);
    line(c, 96, 829, 1824, 829, rgb(pal.light, 0.18));
    if (s.quality > 0) {
      s.particles.slice(0, s.quality === 1 ? 12 : 26).forEach(function (q) {
        var y = (q.y - time * q.speed + 2160) % 1080;
        var a = 0.2 + 0.28 * (0.5 + 0.5 * Math.sin(time + q.x));
        c.beginPath(); c.arc(q.x + Math.sin(time * 0.2 + q.y) * 18, y, q.r, 0, 2 * PI);
        c.fillStyle = rgb(pal.light, a); c.fill();
      });
    }
  }
  function neon(c, s, scene, p) {
    var current = scene.photos[0], i = scene.index, pal = current.palette, L = copyOf(s);
    neonWorld(c, s, pal, s.clock);
    var e = s.reduced ? 1 : out(scene.time / 1.3);
    var x = i % 2 ? 185 : 720, y = 188, w = 1020, h = 600;
    if (current.h > current.w) { w = 690; x = i % 2 ? 260 : 955; }
    c.save(); c.translate(0, (1 - e) * 48);
    if (s.quality > 0) {
      // Reflejo invertido, comprimido y fundido: conserva el encuadre de la foto.
      // La máscara vive en una superficie pequeña; no oscurece el halo del suelo.
      var rc = s.reflection.getContext('2d');
      rc.setTransform(1, 0, 0, 1, 0, 0);
      rc.clearRect(0, 0, 510, 300);
      rc.setTransform(510 / w, 0, 0, 300 / h, 0, 0);
      photo(rc, current, 0, 0, w, h, p, i, s.reduced, 8);
      rc.globalCompositeOperation = 'destination-in';
      var fade = rc.createLinearGradient(0, 0, 0, h);
      fade.addColorStop(0, 'rgba(0,0,0,0)');
      fade.addColorStop(0.3, 'rgba(0,0,0,.03)');
      fade.addColorStop(1, 'rgba(0,0,0,1)');
      rect(rc, 0, 0, w, h, fade);
      rc.globalCompositeOperation = 'source-over';
      c.save(); c.translate(x, y + h + 26); c.scale(1, -0.33);
      c.globalAlpha = 0.28;
      c.drawImage(s.reflection, 0, -h, w, h);
      c.restore();
    }
    c.save();
    c.shadowColor = rgb(neonColors[i % 4], 0.72);
    c.shadowBlur = s.quality === 2 ? 40 : 0;
    rounded(c, x - 2, y - 2, w + 4, h + 4, 10);
    c.strokeStyle = rgb(tint(neonColors[i % 4], pal.light, 0.3)); c.lineWidth = 3; c.stroke();
    c.restore();
    photo(c, current, x, y, w, h, p, i, s.reduced, 8);
    c.restore();
    var tx = i % 2 ? 1270 : 112, tw = i % 2 ? 540 : 565;
    tracked(c, 'AFTER HOURS / ' + num(i + 1), 112, 104, 28, 5, '#f3e8f5');
    text(c, L.nLive, 1808, 104, 28, MONO, '#f3e8f5', '400', 'right');
    c.save(); c.shadowColor = rgb(neonColors[i % 4], 0.6); c.shadowBlur = s.quality ? 18 : 0;
    title(c, L.nTitles[i % 3], tx, 427, tw, 110, CONDENSED, '#fff4ff', '700');
    c.restore();
    line(c, tx, 724, tx + 105, 724, rgb(neonColors[i % 4]), 3);
    fit(c, L.nInfinite, tx, 774, 29, SANS, '#f3e8f5', '400', 'left', tw);
    tracked(c, L.nFooter, 112, 1000, 28, 4, '#e6dbea');
    text(c, num(i + 1) + ' / ' + num(s.photos.length), 1808, 1000, 30, MONO, '#f3e8f5', '400', 'right');
    vignette(c, 0.28);
  }

  function polaroid(c, s, p, x, y, w, h, angle, progress, seed, caption) {
    c.save(); c.translate(x + w / 2, y + h / 2); c.rotate(angle);
    c.save(); c.shadowColor = 'rgba(32,16,7,.4)';
    c.shadowBlur = s.quality ? 32 : 0; c.shadowOffsetX = 8; c.shadowOffsetY = 22;
    rect(c, -w / 2, -h / 2, w, h, '#fff9e9'); c.restore();
    photo(c, p, -w / 2 + 22, -h / 2 + 22, w - 44, h - 110, progress, seed, s.reduced);
    fit(c, caption, -w / 2 + 29, h / 2 - 33, 31, HAND, '#493a30', '400', 'left', w - 58);
    c.restore();
  }
  function lightLeak(c, s, time, amount) {
    if (s.quality === 0) return;
    if (s.reduced) time = 0;
    c.save(); c.globalCompositeOperation = 'screen';
    var pulse = s.reduced ? 0.2 : Math.pow(0.5 + 0.5 * Math.sin(time * 0.43), 4);
    glow(c, -90 + Math.sin(time * 0.2) * 90, 430, 770, [255, 116, 42], amount * (0.26 + pulse * 0.74));
    glow(c, 1910, 300, 480, [255, 213, 130], amount * 0.34);
    c.restore();
  }
  function film(c, s, scene, p) {
    var i = scene.index, current = scene.photos[0], pal = current.palette, L = copyOf(s);
    rect(c, 0, 0, W, H, rgb(tint(pal.paper, [129, 103, 73], 0.52)));
    glow(c, 800, 300, 1300, [255, 232, 188], 0.48);
    tracked(c, L.fTag, 100, 101, 28, 4, '#35271f', MONO);
    text(c, 'CONTACT SHEET / ' + num(i + 1), 1816, 101, 28, MONO, '#35271f', '400', 'right');
    var hand = s.reduced ? 1 : out(scene.time / 1.45);
    if (i % 2 === 0) {
      if (scene.photos[1]) polaroid(c, s, scene.photos[1], 149, 240, 650, 630, -0.11, p, i + 1, L.fCap1);
      polaroid(c, s, current, 629 + (1 - hand) * 110, 174 - (1 - hand) * 130,
        785, 732, 0.065 + (1 - hand) * 0.12, p, i, L.fCap2);
      // Cinta translúcida: su irregularidad se dibuja una sola vez por plano.
      c.save(); c.translate(1000, 191); c.rotate(0.065);
      rect(c, -103, -25, 206, 49, 'rgba(255,232,182,.45)'); c.restore();
      c.save(); c.translate(1570, 488); c.rotate(-0.07);
      text(c, L.fHand[0], 0, 0, 55, HAND, '#3c2b21');
      text(c, L.fHand[1], 10, 83, 55, HAND, '#3c2b21');
      text(c, L.fHand[2], -20, 167, 55, HAND, '#3c2b21'); c.restore();
    } else {
      polaroid(c, s, current, 184, 190, 985, 720, -0.045 + (1 - hand) * 0.1, p, i, L.fCap3);
      c.save(); c.translate(1500, 533); c.rotate(0.075);
      c.save(); c.shadowColor = 'rgba(25,12,3,.4)'; c.shadowBlur = s.quality ? 25 : 0;
      c.shadowOffsetY = 18; rect(c, -209, -365, 418, 778, '#f9f0d9'); c.restore();
      for (var n = 0; n < Math.min(scene.photos.length, 3); n++) {
        photo(c, scene.photos[n], -183, -339 + n * 229, 366, 206, p, i + n, s.reduced);
      }
      text(c, 'NO. ' + num(i + 1) + ' / ' + L.fMemories, -180, 379, 28, MONO, '#61432b');
      c.restore();
    }
    // La fecha es la de la sesión, nunca se presenta como EXIF de las fotos.
    text(c, L.fSession + ' ' + s.date, 103, 1008, 28, MONO, '#4b3023');
    fit(c, L.fFooter, 1816, 1008, 36, HAND, '#3c2b21', '400', 'right', 760);
    grain(c, s, 0.72, true); lightLeak(c, s, s.clock, 0.5); vignette(c, 0.26);
  }

  function memories(c, s, scene, p) {
    var i = scene.index, current = scene.photos[0], pal = current.palette, L = copyOf(s);
    rect(c, 0, 0, W, H, rgb(pal.dark));
    if (i % 4 === 2 && current.h > current.w) {
      c.save();
      if (s.quality > 0) c.filter = 'blur(26px)';
      c.globalAlpha = 0.62; c.drawImage(current.blur, -65, -65, W + 130, H + 130); c.restore();
      photo(c, current, 543, 50, 834, 980, p, i, s.reduced, 24);
    } else photo(c, current, 0, 0, W, H, p, i, s.reduced);
    shade(c, 0, 520, W, 560, 0.77, true);
    shade(c, 0, 0, W, 265, 0.42, false);
    tracked(c, 'MOMENTOS', 104, 105, 30, 9, '#fff');
    text(c, num(i + 1) + ' / ' + num(s.photos.length), 1816, 105, 30, SANS, '#fff', '500', 'right');
    var e = s.reduced ? 1 : out((scene.time - 0.6) / 1.8);
    c.save(); c.globalAlpha = e; c.translate(0, (1 - e) * 32);
    line(c, 110, 807, 195, 807, rgb(pal.light), 5);
    title(c, L.mTitles[i % 4],
      103, 934, 1610, 100, SANS, '#fff', '600', 'left', 1);
    fit(c, L.mBody, 108, 1001, 32, SANS, '#fff', '400', 'left', 1600);
    c.restore();
  }
  var templates = { editorial: editorial, neon: neon, film: film, memories: memories };

  // ═══ 4. PORTADAS, ESPERA Y CIERRE ═══════════════════════════════════════
  function waiting(c, s) {
    var t = s.reduced ? 0 : s.clock, light = s.opts.template === 'editorial' || s.opts.template === 'film';
    var ink = light ? '#292824' : '#fff5ec', L = copyOf(s);
    rect(c, 0, 0, W, H, light ? '#eeeadf' : '#090b12');
    glow(c, 1260, 520, 850, light ? [228, 178, 139] : [89, 77, 159], light ? 0.5 : 0.48);
    glow(c, 1760, 920, 700, light ? [158, 173, 155] : [215, 95, 159], 0.22);
    tracked(c, 'UNIVERSAL REMOTE / MOMENTOS', 112, 106, 28, 5, ink);
    var base = title(c, L.waitTitle, 106, 388, 960, 122, light ? SERIF : SANS, ink, light ? '400' : '600', 'left', 2);
    fit(c, L.waitBody, 112, Math.max(710, base + 90), 34, SANS, ink, '400', 'left', 960);
    var received = s.photos.length;
    text(c, received + ' ' + L.of + ' ' + s.opts.total, 112, 843, 58, light ? SERIF : SANS, ink);
    text(c, received ? L.preparing : L.awaiting, 113, 904, 28, MONO, ink);
    // Una constelación de diez marcos, cada uno corresponde a una llegada.
    for (var i = 0; i < s.opts.total; i++) {
      var a = i / s.opts.total * PI * 2 - PI / 2;
      var x = 1462 + Math.cos(a) * 258, y = 536 + Math.sin(a) * 275;
      c.save(); c.translate(x, y + Math.sin(t * 0.65 + i * 0.6) * 12);
      c.rotate((i - 4) * 0.045);
      c.shadowColor = 'rgba(0,0,0,.10)'; c.shadowBlur = s.quality ? 20 : 0; c.shadowOffsetY = 12;
      rect(c, -67, -79, 134, 158, light ? '#fffaf0' : '#252530');
      c.shadowBlur = 0; c.shadowOffsetY = 0;
      if (s.photos[i]) photo(c, s.photos[i], -57, -69, 114, 122, 0.5, i, true);
      else {
        var g = c.createLinearGradient(-57, -69, 57, 53);
        g.addColorStop(0, rgb(neonColors[i % 4], light ? 0.36 : 0.25));
        g.addColorStop(1, light ? '#ded8ca' : '#181925');
        rect(c, -57, -69, 114, 122, g);
      }
      c.restore();
    }
    line(c, 112, 969, 740, 969, light ? '#c7c1b6' : '#373640', 2);
    line(c, 112, 969, 112 + 628 * received / s.opts.total, 969, ink, 3);
    grain(c, s, 0.28, false);
  }

  function cover(c, s, scene, closing) {
    var t = scene.time, mode = s.opts.template;
    var current = scene.photos[0], pal = current.palette;
    var e = s.reduced ? 1 : out(t / 2), ending = closing === true, L = copyOf(s);
    var heading = headingOf(s), sub = subtitleOf(s);
    if (mode === 'editorial') {
      rect(c, 0, 0, W, H, rgb(pal.paper));
      tracked(c, ending ? L.eEndTag : L.eCoverTag, 98, 100, 28, 5, '#35332d');
      line(c, 96, 132, 1824, 132, '#a7a295');
      c.save(); c.translate((1 - e) * 55, 0);
      photo(c, current, 1165, 192, 657, 742, clamp(t / 7, 0, 1), 0, s.reduced);
      c.restore();
      text(c, ending ? L.eEnd : L.eVol, 100, 242, 30, MONO, '#35332d');
      var baseline = title(c, heading, 91, 444, 1020, 155, SERIF, '#24231f');
      title(c, sub, 100, Math.max(817, baseline + 75), 980, 33, SANS, '#38362f', '400', 'left', 2);
      line(c, 96, 975, 1824, 975, '#a7a295');
      text(c, ending ? L.madeWith : L.eCoverFooter, 100, 1030, 28, MONO, '#35332d');
      text(c, num(s.photos.length) + ' ' + L.eInstants, 1824, 1030, 28, MONO, '#35332d', '400', 'right');
      grain(c, s, 0.32, false);
    } else if (mode === 'neon') {
      neonWorld(c, s, pal, s.clock);
      c.save(); c.globalAlpha = 0.35;
      photo(c, current, 620, 145, 680, 790, t / 7, 1, s.reduced, 180 * (1 - e) + 6);
      c.restore();
      shade(c, 0, 180, W, 900, 0.8, true);
      tracked(c, ending ? L.nEndTag : L.nCoverTag, 112, 110, 28, 5, '#fff1fd');
      c.save(); c.shadowColor = '#fa7af8'; c.shadowBlur = s.quality ? 24 : 0;
      title(c, heading.toLocaleUpperCase(s.opts.lang), 960, 473, 1610, 175, CONDENSED, '#fff4ff', '700', 'center', 2);
      c.restore();
      title(c, sub, 960, 818, 1460, 35, SANS, '#fbe9fa', '400', 'center', 2);
      line(c, 860, 891, 1060, 891, '#fa7af8', 3);
      text(c, ending ? L.madeWith : 'MOMENTOS / AFTER HOURS', 960, 1002, 28, MONO, '#fbe9fa', '400', 'center');
    } else if (mode === 'film') {
      rect(c, 0, 0, W, H, rgb(tint(pal.paper, [154, 121, 83], 0.4)));
      if (scene.photos[1]) polaroid(c, s, scene.photos[1], 1300, 380, 465, 524, 0.13, t / 7, 2, L.fCapA);
      polaroid(c, s, current, 958, 158, 626, 690, -0.105 + (1 - e) * 0.12, t / 7, 0, L.fCapB);
      tracked(c, L.fCoverTag, 104, 104, 28, 3, '#3e2c21', MONO);
      var base = title(c, heading, 105, 393, 790, 116, HAND, '#39281d', '400', 'left', 3);
      title(c, sub, 113, Math.max(788, base + 70), 740, 32, MONO, '#463125', '400', 'left', 2);
      text(c, L.fSession + ' ' + s.date, 109, 1009, 28, MONO, '#493327');
      text(c, ending ? L.madeWith : L.fCoverFooter, 1810, 1009, 28, MONO, '#493327', '400', 'right');
      lightLeak(c, s, s.clock, 0.48); grain(c, s, 0.66, true); vignette(c, 0.18);
    } else {
      photo(c, current, 0, 0, W, H, clamp(t / 7, 0, 1), 0, s.reduced);
      rect(c, 0, 0, W, H, 'rgba(0,0,0,.4)');
      shade(c, 0, 480, W, 600, 0.72, true);
      c.save(); c.globalAlpha = e; c.translate(0, (1 - e) * 35);
      tracked(c, ending ? L.mEndTag : L.mCoverTag, 112, 123, 30, 7, '#fff');
      var b = title(c, heading, 102, 560, 1660, 157, SANS, '#fff', '600', 'left', 2);
      title(c, sub, 112, b + 88, 1570, 38, SANS, '#fff', '400', 'left', 2);
      line(c, 112, 932, 212, 932, rgb(pal.light), 5);
      text(c, ending ? L.madeWith : 'MOMENTOS', 112, 1010, 30, SANS, '#fff', '500');
      c.restore();
    }
  }

  // ═══ 5. TRANSICIONES ════════════════════════════════════════════════════
  function mask(c, kind, progress) {
    var t = ease(progress), radius = mix(65, 1320, t);
    c.beginPath();
    if (kind === 0) {
      // La superelipse interpola círculo → rectángulo redondeado, sin SVG externo.
      var power = mix(2, 9, t), rx = radius, ry = radius * mix(1, 0.67, t);
      for (var i = 0; i <= 96; i++) {
        var angle = i / 96 * PI * 2, co = Math.cos(angle), si = Math.sin(angle);
        var x = 960 + Math.sign(co) * Math.pow(Math.abs(co), 2 / power) * rx;
        var y = 540 + Math.sign(si) * Math.pow(Math.abs(si), 2 / power) * ry;
        if (i) c.lineTo(x, y); else c.moveTo(x, y);
      }
    } else if (kind === 1) {
      // Corazón paramétrico que sobrepasa todo el cuadro al terminar.
      var scale = mix(5, 165, t);
      for (var j = 0; j <= 100; j++) {
        var a = j / 100 * PI * 2;
        var hx = 960 + scale * 16 * Math.pow(Math.sin(a), 3);
        var hy = 480 - scale * (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
        if (j) c.lineTo(hx, hy); else c.moveTo(hx, hy);
      }
    } else {
      var r = mix(70, 1750, t);
      c.moveTo(960, 540 - r); c.lineTo(960 + r, 540);
      c.lineTo(960, 540 + r); c.lineTo(960 - r, 540);
    }
    c.closePath();
  }
  function composite(c, s, blend) {
    var t = s.reduced ? 1 : blend, mode = s.opts.template;
    c.drawImage(s.back, 0, 0, W, H);
    c.save();
    if (mode === 'memories' && s.scene.kind === 'photo' && s.quality > 0 && !s.reduced) {
      // Un primer fundido elimina la aparición abrupta del centro de la máscara.
      if (t < 0.08) c.globalAlpha = t / 0.08;
      mask(c, s.scene.index % 3, t); c.clip();
    } else if (mode === 'editorial') {
      c.beginPath(); c.rect(0, 0, W * out(t), H); c.clip();
    } else if (mode === 'film') {
      c.globalAlpha = out(t);
      c.translate((1 - out(t)) * 105, (1 - out(t)) * -45);
      c.translate(960, 540); c.rotate((1 - out(t)) * 0.035); c.translate(-960, -540);
    } else {
      c.globalAlpha = ease(t);
    }
    c.drawImage(s.front, 0, 0, W, H); c.restore();
    if (mode === 'neon' && !s.reduced && s.quality > 0) {
      glow(c, 960, 570, 1100, neonColors[s.scene.index % 4 || 0], Math.sin(PI * t) * 0.16);
    }
  }

  // ═══ 6. MÚSICA PROCEDURAL ═══════════════════════════════════════════════
  // WebAudio sólo existe en esta pasarela. Logic.notes decide la partitura.
  function Music(Context) {
    this.Context = Context;
    this.ctx = null; this.master = null; this.mode = 'none';
    this.timer = null; this.stopTimer = null; this.voices = [];
    this.buffers = {}; this.step = 0; this.next = 0;
    this.active = false; this.generation = 0; this.remaining = 0;
  }
  Music.prototype.init = function () {
    if (this.ctx) return true;
    if (!this.Context) return false;
    try {
      var c = this.ctx = new this.Context();
      this.master = c.createGain(); this.master.gain.value = 0;
      var compressor = c.createDynamicsCompressor();
      compressor.threshold.value = -20; compressor.knee.value = 18;
      compressor.ratio.value = 3; compressor.attack.value = 0.015; compressor.release.value = 0.3;
      this.bus = c.createBiquadFilter(); this.bus.type = 'lowpass'; this.bus.frequency.value = 4200;
      this.bus.connect(compressor); compressor.connect(this.master); this.master.connect(c.destination);
      var reverb = c.createConvolver(), duration = 2.8;
      var impulse = c.createBuffer(2, Math.floor(c.sampleRate * duration), c.sampleRate);
      var rng = Logic.random(805);
      for (var ch = 0; ch < 2; ch++) {
        var d = impulse.getChannelData(ch), last = 0;
        for (var i = 0; i < d.length; i++) {
          last = last * 0.55 + (rng() * 2 - 1) * 0.45;
          d[i] = last * Math.pow(1 - i / d.length, 2.8);
        }
      }
      reverb.buffer = impulse;
      this.wet = c.createGain(); this.wet.gain.value = 0.24;
      this.bus.connect(reverb); reverb.connect(this.wet); this.wet.connect(compressor);
      this.delay = c.createDelay(1); this.delay.delayTime.value = 0.42;
      this.feedback = c.createGain(); this.feedback.gain.value = 0.25;
      this.delayLevel = c.createGain(); this.delayLevel.gain.value = 0;
      this.bus.connect(this.delay); this.delay.connect(this.feedback); this.feedback.connect(this.delay);
      this.delay.connect(this.delayLevel); this.delayLevel.connect(compressor);
      return true;
    } catch (_) {
      if (this.ctx) { try { this.ctx.close().catch(function () {}); } catch (ignore) {} }
      this.ctx = null; return false;
    }
  };
  Music.prototype.buffer = function (kind, midi, duration) {
    var key = kind + ':' + midi + ':' + duration;
    if (this.buffers[key]) return this.buffers[key];
    var c = this.ctx, rate = c.sampleRate, length = Math.floor(rate * duration);
    var buffer = c.createBuffer(1, length, rate), d = buffer.getChannelData(0);
    var f = 440 * Math.pow(2, (midi - 69) / 12), rng = Logic.random(midi * 714 + 3);
    if (kind === 'pluck') {
      // Cuerda amortiguada de Karplus–Strong; excitación de ruido, no un «bip».
      var period = Math.max(2, Math.round(rate / f)), ring = new Float32Array(period);
      var mean = 0;
      for (var j = 0; j < period; j++) { ring[j] = rng() * 2 - 1; mean += ring[j]; }
      // Quitar la componente continua evita golpes graves ajenos a la cuerda.
      for (j = 0; j < period; j++) ring[j] -= mean / period;
      for (var i = 0; i < length; i++) {
        var k = i % period, value = ring[k];
        ring[k] = 0.497 * (ring[k] + ring[(k + 1) % period]);
        d[i] = value * Math.min(1, i / (rate * 0.005)) * Math.min(1, (length - i) / (rate * 0.08));
      }
    } else {
      for (var n = 0; n < length; n++) {
        var t = n / rate, signal = 0;
        // Parciales con decaimientos distintos: ataque de martillo y cuerpo cálido.
        for (var h = 1; h <= 5; h++) {
          signal += Math.sin(2 * PI * f * h * (1 + (h - 1) * 0.00035) * t)
            * Math.exp(-t * (0.85 + h * 0.55)) / Math.pow(h, 1.65);
        }
        d[n] = signal * 0.64 * Math.min(1, t / 0.012) * Math.min(1, (duration - t) / 0.1);
      }
    }
    this.buffers[key] = buffer; return buffer;
  };
  Music.prototype.voice = function (kind, midi, time, duration, level) {
    var self = this, c = this.ctx, envelope = c.createGain(), sources = [];
    envelope.gain.setValueAtTime(0.0001, time); envelope.connect(this.bus);
    if (kind === 'pad' || kind === 'bass') {
      var freq = 440 * Math.pow(2, (midi - 69) / 12), count = kind === 'pad' ? 2 : 1;
      for (var n = 0; n < count; n++) {
        var osc = c.createOscillator(); osc.type = kind === 'pad' ? 'triangle' : 'sine';
        osc.frequency.value = freq; osc.detune.value = count === 2 ? (n ? 4 : -4) : 0;
        osc.connect(envelope); sources.push(osc);
      }
      envelope.gain.linearRampToValueAtTime(level / count, time + (kind === 'pad' ? 0.95 : 0.08));
      envelope.gain.setTargetAtTime(0.0001, time + duration * 0.48, duration * 0.16);
      envelope.gain.linearRampToValueAtTime(0.0001, time + duration);
    } else {
      var src = c.createBufferSource(); src.buffer = this.buffer(kind, midi, duration);
      src.connect(envelope); sources.push(src);
      envelope.gain.linearRampToValueAtTime(level, time + 0.007);
      envelope.gain.setValueAtTime(level, time + duration - 0.1);
      envelope.gain.linearRampToValueAtTime(0.0001, time + duration);
    }
    var record = { sources: sources, gain: envelope };
    this.voices.push(record);
    sources[0].onended = function () {
      sources.forEach(function (source) { source.disconnect(); }); envelope.disconnect();
      var index = self.voices.indexOf(record); if (index >= 0) self.voices.splice(index, 1);
    };
    sources.forEach(function (source) { source.start(time); source.stop(time + duration + 0.04); });
  };
  Music.prototype.schedule = function () {
    if (!this.active || !this.ctx || this.ctx.state !== 'running') return;
    var c = this.ctx, self = this;
    var interval = this.mode === 'calm' ? 1 : this.mode === 'warm' ? 0.6 : 0.7;
    if (this.next < c.currentTime) this.next = c.currentTime + 0.035;
    while (this.next < c.currentTime + 0.22) {
      Logic.notes(this.mode, this.step).forEach(function (event) {
        event.notes.forEach(function (midi, i) {
          self.voice(event.kind, midi, self.next + i * 0.018, event.length, event.level);
        });
      });
      this.step++; this.next += interval;
    }
  };
  Music.prototype.start = function (mode) {
    if (mode === 'none') { this.stop(false); this.mode = mode; return; }
    if (!this.init()) return;
    var self = this, c = this.ctx;
    clearTimeout(this.stopTimer); clearInterval(this.timer);
    var gen = ++this.generation;
    var changed = mode !== this.mode;
    if (changed) {
      // Las notas anteriores se liberan suavemente incluso al cambiar de ambiente.
      this.voices.slice().forEach(function (v) {
        v.gain.gain.cancelScheduledValues(c.currentTime);
        v.gain.gain.setValueAtTime(v.gain.gain.value, c.currentTime);
        v.gain.gain.linearRampToValueAtTime(0.0001, c.currentTime + 0.18);
        v.sources.forEach(function (source) { try { source.stop(c.currentTime + 0.2); } catch (_) {} });
      });
      this.step = 0; this.remaining = 0;
    }
    this.mode = mode; this.active = true;
    this.delayLevel.gain.setTargetAtTime(mode === 'night' ? 0.22 : 0.03, c.currentTime, 0.2);
    this.wet.gain.setTargetAtTime(mode === 'calm' ? 0.3 : 0.16, c.currentTime, 0.2);
    this.master.gain.cancelScheduledValues(c.currentTime);
    this.master.gain.setValueAtTime(this.master.gain.value, c.currentTime);
    this.master.gain.linearRampToValueAtTime(0.23, c.currentTime + 1.8);
    this.next = c.currentTime + Math.max(0.06, this.remaining);
    // resume ocurre dentro de play, conservando el gesto de usuario del llamante.
    try {
      c.resume().then(function () {
        if (!self.active || gen !== self.generation) return;
        self.schedule(); self.timer = setInterval(function () { self.schedule(); }, 100);
      }).catch(function () {});
    } catch (_) { /* Un TV sin audio sigue mostrando la pieza. */ }
  };
  Music.prototype.clearVoices = function () {
    this.voices.slice().forEach(function (v) {
      v.sources.forEach(function (source) { try { source.stop(); } catch (_) {} source.disconnect(); });
      v.gain.disconnect();
    });
    this.voices.length = 0;
  };
  Music.prototype.stop = function (dispose) {
    this.active = false; clearInterval(this.timer); clearTimeout(this.stopTimer);
    var c = this.ctx, self = this, gen = ++this.generation;
    if (!c) return;
    this.remaining = Math.max(0, this.next - c.currentTime);
    var time = c.currentTime;
    this.master.gain.cancelScheduledValues(time);
    this.master.gain.setValueAtTime(this.master.gain.value, time);
    this.master.gain.linearRampToValueAtTime(0, time + 0.16);
    this.stopTimer = setTimeout(function () {
      if (gen !== self.generation) return;
      self.clearVoices();
      try {
        if (dispose) { c.close().catch(function () {}); self.ctx = null; self.buffers = {}; }
        else c.suspend().catch(function () {});
      } catch (_) { /* Algunos receptores destruyen el contexto al cambiar de app. */ }
    }, 180);
  };

  // ═══ 7. NÚCLEO / CICLO DE VIDA ═══════════════════════════════════════════
  var STYLES = [
    '.urp-photoshow{position:fixed;inset:0;z-index:2147483000;background:#08090c;',
    'overflow:hidden;isolation:isolate;contain:layout paint style;color:#fff;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;}',
    '.urp-photoshow *{box-sizing:border-box;}',
    '.urp-photoshow canvas{display:block;position:absolute;left:50%;top:50%;',
    'transform:translate(-50%,-50%);}',
    '.urp-photoshow .urp-status{position:absolute;width:1px;height:1px;',
    'padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;}',
    '.urp-photoshow .urp-pause{position:absolute;right:5.5%;top:14%;padding:10px 18px;',
    'border:1px solid rgba(255,255,255,.35);background:rgba(0,0,0,.7);color:#fff;',
    'font-size:clamp(16px,1.6vw,32px);letter-spacing:.12em;border-radius:4px;}',
    '.urp-photoshow [hidden]{display:none!important;}'
  ].join('');

  function Show(container, opts) {
    this.opts = Logic.options(opts); this.container = container;
    this.photos = []; this.reservations = new Map(); this.sequence = 0;
    this.dead = false; this.playing = false; this.intent = false; this.ended = false;
    this.clock = 0; this.lastArrival = 0; this.lastStamp = 0; this.raf = 0;
    this.scene = null; this.previous = false; this.transition = 0; this.transitionLength = 1.35;
    this.quality = 2; this.slow = 0; this.frameCount = 0; this.cost = 0;
    this.progressKey = ''; this.pending = 0; this.decodeTimers = new Set();
    this.reducedQuery = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.reduced = !!(this.reducedQuery && this.reducedQuery.matches);
    this.date = sessionDate(this.opts.lang);
    this.music = new Music(global.AudioContext || global.webkitAudioContext);
    this.noise = grainTexture(); this.noisePattern = null;
    var rng = Logic.random(499);
    this.particles = Array.from({ length: 26 }, function () {
      return { x: rng() * W, y: rng() * H, r: 1 + rng() * 1.7, speed: 4 + rng() * 11 };
    });
    this.root = document.createElement('div'); this.root.className = 'urp-photoshow';
    this.root.setAttribute('role', 'region'); this.root.setAttribute('aria-label', 'Momentos en el TV');
    this.style = document.createElement('style'); this.style.textContent = STYLES;
    this.view = canvas(W, H); this.view.setAttribute('aria-hidden', 'true');
    this.front = canvas(W, H); this.back = canvas(W, H);
    this.reflection = canvas(510, 300);
    this.ctx = this.view.getContext('2d', { alpha: false });
    this.fc = this.front.getContext('2d', { alpha: false });
    this.bc = this.back.getContext('2d', { alpha: false });
    this.status = document.createElement('div'); this.status.className = 'urp-status';
    this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.badge = document.createElement('div'); this.badge.className = 'urp-pause';
    this.badge.textContent = copyOf(this).paused; this.badge.hidden = true;
    this.root.appendChild(this.style); this.root.appendChild(this.view);
    this.root.appendChild(this.status); this.root.appendChild(this.badge); container.appendChild(this.root);
    this.boundFrame = this.frame.bind(this); this.boundResize = this.resize.bind(this);
    this.boundVisibility = this.visibility.bind(this); this.boundMotion = this.motion.bind(this);
    global.addEventListener('resize', this.boundResize);
    document.addEventListener('visibilitychange', this.boundVisibility);
    if (this.reducedQuery) {
      if (this.reducedQuery.addEventListener) this.reducedQuery.addEventListener('change', this.boundMotion);
      else this.reducedQuery.addListener(this.boundMotion);
    }
    this.resize(); this.report(); this.request();
  }
  Show.prototype.resize = function () {
    if (this.dead) return;
    var w = this.root.clientWidth || global.innerWidth, h = this.root.clientHeight || global.innerHeight;
    var fit = Math.min(w / W, h / H);
    this.view.style.width = Math.round(W * fit) + 'px';
    this.view.style.height = Math.round(H * fit) + 'px';
    // Nunca se renderiza a 4K por accidente: el contenido fuente es ≤1920 px.
    var limit = [960, 1280, 1920][this.quality];
    var pixels = Math.min(limit, Math.max(640, Math.round(W * fit * Math.min(global.devicePixelRatio || 1, 1.5))));
    this.view.width = this.front.width = this.back.width = pixels;
    this.view.height = this.front.height = this.back.height = Math.round(pixels * 9 / 16);
    this.scaleX = pixels / W; this.scaleY = this.view.height / H;
    this.noisePattern = null;
    // Un resize invalida la captura antigua: se termina sólo esa transición.
    this.previous = false; this.draw();
  };
  Show.prototype.motion = function () {
    this.reduced = this.reducedQuery.matches; this.previous = false; this.draw();
  };
  Show.prototype.request = function () {
    if (!this.dead && !this.raf && !document.hidden && (this.playing || (!this.scene && this.badge.hidden))) {
      this.raf = global.requestAnimationFrame(this.boundFrame);
    }
  };
  Show.prototype.report = function () {
    var index = this.scene && this.scene.kind === 'photo' ? this.scene.index + 1 :
      this.scene && this.scene.kind === 'outro' ? this.photos.length : 0;
    var key = index + ':' + this.photos.length;
    var L = copyOf(this);
    this.status.textContent = !this.scene ? this.photos.length + ' ' + L.of + ' ' + this.opts.total + ' ' + L.received :
      this.scene.kind === 'intro' ? headingOf(this) : this.scene.kind === 'outro' ? L.madeWith :
        L.moment + ' ' + index + ' ' + L.of + ' ' + this.photos.length;
    if (key !== this.progressKey) {
      this.progressKey = key; this.callback('onProgress', index, this.photos.length);
    }
  };
  Show.prototype.callback = function (name, a, b) {
    if (this.opts[name]) {
      try { this.opts[name](a, b); }
      catch (error) { if (global.console) console.warn('UrpPhotoShow: callback ' + name, error); }
    }
  };
  Show.prototype.add = function (input) {
    var self = this;
    if (this.dead || !input || (typeof input.id !== 'string' && typeof input.id !== 'number') ||
        !String(input.id).trim() || typeof input.src !== 'string' ||
        !/^data:image\/jpe?g;base64,/i.test(input.src) || input.src.length > 18 * 1024 * 1024 ||
        this.reservations.has(String(input.id)) || this.reservations.size >= 10) return Promise.resolve(false);
    var id = String(input.id), order = this.sequence++, image = new Image();
    this.reservations.set(id, order); this.pending++;
    return new Promise(function (resolve) {
      var finished = false;
      var timer = setTimeout(function () { finish(false); }, 15000);
      function finish(ok) {
        if (finished) return;
        finished = true; clearTimeout(timer); self.decodeTimers.delete(cancel);
        image.onload = image.onerror = null; self.pending--;
        if (self.dead || !ok) {
          self.reservations.delete(id); image.src = ''; resolve(false); return;
        }
        // Las dimensiones decodificadas son la autoridad; no confiamos en w/h remotos.
        var item = { id: id, order: order, image: image, w: image.naturalWidth, h: image.naturalHeight,
          palette: sample(image), blur: thumbnail(image) };
        self.photos.push(item); self.photos.sort(function (a, b) { return a.order - b.order; });
        self.opts.total = Math.max(self.opts.total, self.photos.length);
        self.lastArrival = self.clock;
        if (self.scene && self.scene.kind === 'photo') self.scene.index = self.photos.indexOf(self.scene.photos[0]);
        if (self.playing && (!self.scene || self.scene.kind === 'outro')) {
          self.change(self.scene ? 'photo' : 'intro', self.scene ? self.photos.indexOf(item) : 0);
        }
        self.report(); self.draw(); self.request(); resolve(true);
      }
      function cancel() { finish(false); }
      self.decodeTimers.add(cancel);
      image.onload = function () { finish(image.naturalWidth > 0 && image.naturalHeight > 0); };
      image.onerror = function () { finish(false); };
      image.src = input.src;
    });
  };
  Show.prototype.change = function (kind, index) {
    // Captura de salida: sólo una escena viva durante la transición. Memoria acotada.
    this.bc.setTransform(1, 0, 0, 1, 0, 0);
    this.bc.drawImage(this.view, 0, 0, this.back.width, this.back.height);
    this.previous = !this.reduced; this.transition = 0;
    var picks = [], start = kind === 'outro' ? Math.max(0, this.photos.length - 1) : index;
    for (var n = 0; n < Math.min(4, this.photos.length); n++) picks.push(choose(this, start + n));
    this.scene = { kind: kind, index: index, time: 0, photos: picks,
      length: kind === 'photo' ? Logic.lengths[this.opts.template] : kind === 'intro' ? 6.2 : 6.8 };
    this.report();
  };
  Show.prototype.play = function () {
    if (this.dead) return;
    this.intent = true; this.badge.hidden = true;
    if (document.hidden) return;
    if (this.playing) {
      if (this.music.ctx && this.music.ctx.state === 'suspended') this.music.start(this.opts.music);
      return;
    }
    this.playing = true; this.lastStamp = 0;
    if (this.ended) { this.ended = false; this.music.step = 0; this.change('intro', 0); }
    else if (!this.scene && this.photos.length) this.change('intro', 0);
    this.music.start(this.opts.music); this.request();
  };
  Show.prototype.pause = function (visibility) {
    if (this.dead) return;
    if (!visibility) this.intent = false;
    this.playing = false; this.badge.hidden = !!visibility;
    this.music.stop(false); global.cancelAnimationFrame(this.raf); this.raf = 0;
    this.lastStamp = 0;
  };
  Show.prototype.visibility = function () {
    if (document.hidden) {
      if (this.playing) this.pause(true);
      else { global.cancelAnimationFrame(this.raf); this.raf = 0; }
    } else if (this.intent) this.play();
    else this.request();
  };
  Show.prototype.setTemplate = function (name) {
    if (Logic.names.indexOf(name) < 0 || name === this.opts.template) return;
    this.opts.template = name;
    if (this.scene) this.change(this.scene.kind, this.scene.index);
    if (!this.playing) this.previous = false;
    this.draw();
  };
  Show.prototype.setLang = function (code) {
    var lang = language(code);
    if (lang === this.opts.lang) return;
    this.opts.lang = lang; this.date = sessionDate(lang);
    this.badge.textContent = copyOf(this).paused;
    if (!this.playing) this.previous = false;
    this.report(); this.draw();
  };
  Show.prototype.setTitle = function (title, subtitle) {
    this.opts.title = typeof title === 'string' ? title.trim().slice(0, 160) : '';
    this.opts.subtitle = typeof subtitle === 'string' ? subtitle.trim().slice(0, 220) : '';
    if (!this.playing) this.previous = false;
    this.report(); this.draw();
  };
  Show.prototype.clear = function () {
    // Vuelve a la espera: sin fotos, sin escena, música parada. El escenario sigue montado.
    if (this.dead) return;
    this.decodeTimers.forEach(function (cancel) { cancel(); }); this.decodeTimers.clear();
    this.photos.forEach(function (p) { p.image.src = ''; p.blur.width = p.blur.height = 1; });
    this.photos.length = 0; this.reservations.clear(); this.sequence = 0; this.pending = 0;
    this.playing = this.intent = this.ended = false; this.badge.hidden = true;
    this.music.stop(false); this.music.step = 0;
    this.scene = null; this.previous = false; this.progressKey = '';
    this.report(); this.draw(); this.request();
  };
  Show.prototype.setMusic = function (name) {
    if (Logic.moods.indexOf(name) < 0 || name === this.opts.music) return;
    this.opts.music = name;
    if (this.playing) this.music.start(name);
  };
  Show.prototype.advance = function (dt) {
    this.clock += dt;
    if (!this.scene || !this.playing) return;
    this.scene.time += dt; this.transition += dt;
    if (this.transition >= this.transitionLength) this.previous = false;
    if (this.scene.time < this.scene.length) return;
    var scene = this.scene;
    if (scene.kind === 'intro') this.change('photo', 0);
    else if (scene.kind === 'photo') {
      if (scene.index + 1 < this.photos.length) this.change('photo', scene.index + 1);
      else if (!this.pending && (this.photos.length >= this.opts.total || this.clock - this.lastArrival >= 3)) this.change('outro', scene.index);
    } else {
      if (this.opts.loop) {
        this.change('intro', 0); this.callback('onEnd');
      } else {
        this.playing = false; this.intent = false; this.ended = true;
        this.music.stop(false); this.callback('onEnd');
      }
    }
  };
  Show.prototype.draw = function () {
    if (this.dead) return;
    var c = this.fc;
    c.setTransform(this.scaleX, 0, 0, this.scaleY, 0, 0);
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    if (!this.scene) waiting(c, this);
    else if (this.scene.kind !== 'photo') cover(c, this, this.scene, this.scene.kind === 'outro');
    else templates[this.opts.template](c, this, this.scene, clamp(this.scene.time / this.scene.length, 0, 1));
    var view = this.ctx;
    view.setTransform(this.scaleX, 0, 0, this.scaleY, 0, 0);
    if (this.previous) composite(view, this, clamp(this.transition / this.transitionLength, 0, 1));
    else view.drawImage(this.front, 0, 0, W, H);
    if (this.scene) {
      var light = this.opts.template === 'editorial' || this.opts.template === 'film';
      var count = this.photos.length, scene = this.scene;
      var progress = scene.kind === 'intro' ? 0 : scene.kind === 'outro' ? 1 :
        (scene.index + clamp(scene.time / scene.length, 0, 1)) / count;
      rect(view, 96, 1058, 1728, 3, light ? 'rgba(25,24,21,.14)' : 'rgba(255,255,255,.2)');
      rect(view, 96, 1058, 1728 * progress, 3, light ? '#4b4437' : '#fff');
    }
  };
  Show.prototype.frame = function (stamp) {
    this.raf = 0; if (this.dead || document.hidden) return;
    var delta = this.lastStamp ? (stamp - this.lastStamp) / 1000 : 0;
    this.lastStamp = stamp;
    var start = performance.now();
    // Un TV ocupado no salta capítulos; al volver de background no pasa el álbum entero.
    this.advance(Math.min(delta, 0.1)); this.draw();
    var cost = performance.now() - start;
    this.cost += cost; this.frameCount++;
    if (delta > 0.025 || cost > 18) this.slow++;
    if (this.frameCount >= 120) {
      if (this.quality > 0 && (this.slow > 45 || this.cost / this.frameCount > 15)) {
        this.quality--; this.resize();
      }
      this.frameCount = this.slow = this.cost = 0;
    }
    this.request();
  };
  Show.prototype.destroy = function () {
    if (this.dead) return;
    this.dead = true; this.playing = this.intent = false;
    global.cancelAnimationFrame(this.raf); this.music.stop(true);
    global.removeEventListener('resize', this.boundResize);
    document.removeEventListener('visibilitychange', this.boundVisibility);
    if (this.reducedQuery) {
      if (this.reducedQuery.removeEventListener) this.reducedQuery.removeEventListener('change', this.boundMotion);
      else this.reducedQuery.removeListener(this.boundMotion);
    }
    this.decodeTimers.forEach(function (cancel) { cancel(); }); this.decodeTimers.clear();
    this.photos.forEach(function (p) { p.image.src = ''; p.blur.width = p.blur.height = 1; });
    this.photos.length = 0; this.reservations.clear(); this.scene = null;
    this.root.remove(); this.view.width = this.front.width = this.back.width = 1;
    this.reflection.width = this.reflection.height = 1;
    this.noise.width = 1; this.noisePattern = null;
  };

  // ═══ 8. API PÚBLICA ═════════════════════════════════════════════════════
  // Un único escenario por receptor; unmount deja la instancia reiniciable.
  global.UrpPhotoShow = {
    mount: function (container, opts) {
      if (!container || container.nodeType !== 1 || typeof container.appendChild !== 'function') {
        throw new TypeError('UrpPhotoShow.mount necesita un elemento contenedor.');
      }
      if (instance) instance.destroy();
      instance = new Show(container, opts); return global.UrpPhotoShow;
    },
    addPhoto: function (photoData) { return instance ? instance.add(photoData) : Promise.resolve(false); },
    play: function () { if (instance) instance.play(); },
    pause: function () { if (instance) instance.pause(false); },
    setTemplate: function (name) { if (instance) instance.setTemplate(name); },
    setMusic: function (name) { if (instance) instance.setMusic(name); },
    setLang: function (code) { if (instance) instance.setLang(code); },
    setTitle: function (title, subtitle) { if (instance) instance.setTitle(title, subtitle); },
    clear: function () { if (instance) instance.clear(); },
    unmount: function () { if (instance) instance.destroy(); instance = null; }
  };
}(window));
