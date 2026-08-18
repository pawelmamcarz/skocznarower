/* ───────────────────────────────────────────────────────────────────────────
   SKOCZNA RIDER - gra rowerowa skocznarower.pl
   Jeden silnik dla /gra, /en/gra i /ua/gra. Strona podaje przetlumaczone
   teksty w window.GAME_I18N i opcjonalną konfigurację w window.GAME_CONFIG.
   Ranking: localStorage teraz, adapter zdalny gotowy pod spodem
   (GAME_CONFIG.remoteLeaderboard = true wlacza /api/game/*).
   ─────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const root = document.getElementById('game');
  if (!root) return;
  const cfg = Object.assign({
    storageKey: 'skocznarower.gra.v1',
    remoteLeaderboard: true,
    apiBase: '/api/game',
    swPath: '/game-sw.js',
  }, window.GAME_CONFIG || {});

  // ─── TEKSTY (polskie domyslne, strona nadpisuje tlumaczeniem) ─────────────
  const PL = {
    title: 'Skoczna Rider',
    tagline: 'Królik na rowerze, osiem tras i garść monet. Korba prawą, hamulec lewą.',
    tabs: { play: 'Trasy', bikes: 'Rowery', scores: 'Rekordy' },
    wallet: 'Monety',
    start: 'Startuj',
    locked: 'Zablokowana',
    unlockHint: 'Ukończ poprzednią trasę',
    best: 'Rekord',
    noRecord: 'brak wyniku',
    meters: 'm',
    owned: 'Masz',
    selected: 'Wybrany',
    select: 'Wybierz',
    buy: 'Kup za',
    notEnough: 'Za mało monet',
    stats: { speed: 'Prędkość', grip: 'Przyczepność', air: 'Powietrze' },
    hud: { dist: 'Dystans', coins: 'Monety', fuel: 'Marchewki', flips: 'Salta' },
    controls: { gas: 'Korba', brake: 'Hamulec', hint: 'Strzałki, A i D albo dotknij lewej lub prawej połowy ekranu.' },
    flip: 'Salto',
    install: { button: 'Zainstaluj grę', ios: 'Na iPhonie: Udostępnij, potem Do ekranu początkowego.', done: 'Gra zainstalowana' },
    over: {
      crash: 'Gleba!',
      fuel: 'Koniec marchewek',
      finish: 'Meta!',
      score: 'Wynik',
      dist: 'Dystans',
      coins: 'Monety',
      flips: 'Salta',
      unlocked: 'Odblokowana nowa trasa:',
      nick: 'Twój nick',
      save: 'Zapisz wynik',
      saved: 'Zapisane w rekordach',
      retry: 'Jeszcze raz',
      menu: 'Menu',
    },
    scores: { empty: 'Jeszcze nikt tędy nie jechał.', local: 'Wyniki z tej przeglądarki', global: 'Ranking globalny' },
    account: {
      title: 'Ranking globalny',
      intro: 'Potwierdź numer SMS-em, a Twój wynik trafi do wspólnej tabeli. Numer trzymamy w bazie serwisu skocznarower.pl, usuniemy go na jedno życzenie pod numerem 600 370 810.',
      nick: 'Nick w rankingu',
      phone: 'Numer telefonu',
      consent: 'Zgadzam się na przetwarzanie numeru telefonu w celu prowadzenia rankingu gry.',
      marketing: 'Chcę dostawać SMS-y o serwisie, wolnych terminach i warsztatach.',
      send: 'Wyślij kod SMS',
      sending: 'Wysyłam...',
      code: 'Kod z SMS',
      confirm: 'Potwierdź',
      sent: 'Kod poszedł SMS-em. Wpisz go poniżej.',
      ok: 'Numer potwierdzony. Wyniki lecą do rankingu.',
      playingAs: 'Grasz jako',
      change: 'Zmień numer',
      error: 'Coś poszło nie tak. Spróbuj ponownie.',
      rank: 'Miejsce w rankingu:',
    },
    share: {
      title: 'Pochwal się wynikiem',
      button: 'Udostępnij',
      download: 'Zapisz obrazek',
      copy: 'Kopiuj tekst',
      copied: 'Skopiowane',
      fb: 'Facebook',
      hint: 'Instagram i TikTok: zapisz obrazek, wrzuć na relację i oznacz skocznarower.pl',
      caption: 'pkt w grze Skoczna Rider',
      play: 'Zagraj: skocznarower.pl/gra',
    },
    bikes: {
      bmx: { name: 'BMX', desc: 'Lekki i zwrotny. Król powietrza, ale wolny na prostej.' },
      dirt: { name: 'Dirt', desc: 'Uniwersalny. Trzyma się ziemi i wybacza twarde lądowania.' },
      gravel: { name: 'Gravel', desc: 'Szybki na szutrze, spokojny w powietrzu. Dobry na długie trasy.' },
      kolarka: { name: 'Kolarka', desc: 'Najszybsza na płaskim, nerwowa na hopkach.' },
    },
    levels: {
      pumptrack: { name: 'Pumptrack', desc: 'Miękkie fale na rozgrzewkę.' },
      las: { name: 'Leśna ścieżka', desc: 'Korzenie, garby i długie podjazdy.' },
      hopki: { name: 'Hopki', desc: 'Kickery i dziury. Tu się lata.' },
      szutrowka: { name: 'Szutrówka', desc: 'Długie faliste pola, teren dla gravela.' },
      kamieniec: { name: 'Kamieniste zbocze', desc: 'Strome podjazdy i mała trakcja.' },
      wydmy: { name: 'Wydmy', desc: 'Piach nad morzem i miękkie lądowania.' },
      zima: { name: 'Zimowy szlak', desc: 'Śnieg, lód i zero przyczepności.' },
      noc: { name: 'Nocna zmiana', desc: 'Ciemno, zimno i najdłuższa trasa.' },
    },
  };

  function mergeDeep(base, extra) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (const key of Object.keys(extra || {})) {
      const val = extra[key];
      if (val && typeof val === 'object' && !Array.isArray(val) && base && typeof base[key] === 'object') {
        out[key] = mergeDeep(base[key], val);
      } else if (val !== undefined && val !== null && val !== '') {
        out[key] = val;
      }
    }
    return out;
  }
  const T = mergeDeep(PL, window.GAME_I18N || {});

  // ─── DANE: rowery i trasy ─────────────────────────────────────────────────
  // power/top/grip/air to mnozniki, radius i length sa w pikselach swiata.
  const BIKES = [
    { id: 'bmx', cost: 0, radius: 15, length: 52, power: 1.00, top: 0.88, grip: 0.98, air: 1.26, tire: 6 },
    { id: 'dirt', cost: 450, radius: 19, length: 62, power: 1.16, top: 1.00, grip: 1.12, air: 1.00, tire: 7 },
    { id: 'gravel', cost: 950, radius: 21, length: 66, power: 1.22, top: 1.18, grip: 1.04, air: 0.86, tire: 5 },
    { id: 'kolarka', cost: 1600, radius: 22, length: 70, power: 1.30, top: 1.36, grip: 0.84, air: 0.70, tire: 3 },
  ];

  // Kazda trasa ma wlasna sceneria: niebo, wzgorza w tle, kolor gruntu i dekoracje.
  const LEVELS = [
    {
      id: 'pumptrack', seed: 10723, meters: 620,
      waves: [{ w: 210, a: 16 }, { w: 92, a: 7 }, { w: 41, a: 2.5 }],
      kickers: 2, pits: 0, grip: 1.0, decor: 'pine', decorRate: 0.5, rockRate: 0.3,
      coinRate: 1.0, carrotEvery: 150,
      sky: ['#1b2a3c', '#54708a'], hillFar: '#31465a', hillMid: '#243543',
      ground: '#2f2a22', crust: '#9fe22e', decorColor: '#3c5a30', night: false, weather: null,
    },
    {
      id: 'las', seed: 55219, meters: 900,
      waves: [{ w: 320, a: 34 }, { w: 140, a: 14 }, { w: 55, a: 5 }],
      kickers: 3, pits: 1, grip: 1.0, decor: 'leaf', decorRate: 1.1, rockRate: 0.5,
      coinRate: 1.0, carrotEvery: 160,
      sky: ['#16241c', '#4a6b4c'], hillFar: '#28402e', hillMid: '#1d3024',
      ground: '#2b2519', crust: '#8fd42a', decorColor: '#31502f', night: false, weather: null,
    },
    {
      id: 'hopki', seed: 90311, meters: 1100,
      waves: [{ w: 380, a: 30 }, { w: 150, a: 16 }, { w: 60, a: 4 }],
      kickers: 7, pits: 3, grip: 1.0, decor: 'cactus', decorRate: 0.4, rockRate: 0.5,
      coinRate: 1.25, carrotEvery: 150,
      sky: ['#2c1c14', '#c2703a'], hillFar: '#5a3a24', hillMid: '#3d281a',
      ground: '#3a2b1c', crust: '#d8a53c', decorColor: '#5d6b32', night: false, weather: null,
    },
    {
      id: 'szutrowka', seed: 33098, meters: 1250,
      waves: [{ w: 520, a: 44 }, { w: 190, a: 15 }, { w: 44, a: 4 }],
      kickers: 3, pits: 1, grip: 0.94, decor: 'field', decorRate: 1.3, rockRate: 0.8,
      coinRate: 1.15, carrotEvery: 155,
      sky: ['#2a2a18', '#c9b566'], hillFar: '#5c5533', hillMid: '#3f3b23',
      ground: '#4a4232', crust: '#cbb26a', decorColor: '#7d7a3c', night: false, weather: null,
    },
    {
      id: 'kamieniec', seed: 41877, meters: 1400,
      waves: [{ w: 430, a: 66 }, { w: 165, a: 24 }, { w: 48, a: 9 }],
      kickers: 4, pits: 2, grip: 0.9, decor: 'rock', decorRate: 1.2, rockRate: 1.4,
      coinRate: 1.1, carrotEvery: 140,
      sky: ['#1d1f26', '#68707f'], hillFar: '#3a4150', hillMid: '#2a2f3a',
      ground: '#33343a', crust: '#98a3ae', decorColor: '#41454f', night: false, weather: null,
    },
    {
      id: 'wydmy', seed: 61240, meters: 1350,
      waves: [{ w: 470, a: 40 }, { w: 175, a: 17 }, { w: 62, a: 5 }],
      kickers: 4, pits: 2, grip: 0.88, decor: 'palm', decorRate: 0.55, rockRate: 0.2,
      coinRate: 1.2, carrotEvery: 150,
      sky: ['#123043', '#7fc6d8'], hillFar: '#2f6a7c', hillMid: '#c9b184',
      ground: '#c2a678', crust: '#f0dca8', decorColor: '#2f6b45', night: false, weather: null,
    },
    {
      id: 'zima', seed: 20455, meters: 1500,
      waves: [{ w: 450, a: 52 }, { w: 170, a: 20 }, { w: 50, a: 6 }],
      kickers: 5, pits: 2, grip: 0.74, decor: 'fir', decorRate: 1.0, rockRate: 0.3,
      coinRate: 1.25, carrotEvery: 145,
      sky: ['#243a52', '#b9cfdd'], hillFar: '#6d8397', hillMid: '#8ea6b6',
      ground: '#d8e6ef', crust: '#ffffff', decorColor: '#2c4a3c', night: false, weather: 'snow',
    },
    {
      id: 'noc', seed: 77401, meters: 1800,
      waves: [{ w: 400, a: 48 }, { w: 158, a: 21 }, { w: 52, a: 7 }],
      kickers: 6, pits: 3, grip: 0.95, decor: 'lamp', decorRate: 0.7, rockRate: 0.5,
      coinRate: 1.35, carrotEvery: 135,
      sky: ['#05070f', '#1b2747'], hillFar: '#141d33', hillMid: '#0d1424',
      ground: '#191a22', crust: '#5b7de0', decorColor: '#1e2740', night: true, weather: null,
    },
  ];

  const bikeById = (id) => BIKES.find(b => b.id === id) || BIKES[0];

  // ─── ZAPIS STANU GRACZA ───────────────────────────────────────────────────
  const DEFAULT_SAVE = { coins: 0, bikes: ['bmx'], bike: 'bmx', done: [], best: {}, scores: {}, nick: '', token: '' };

  function loadSave() {
    try {
      const raw = localStorage.getItem(cfg.storageKey);
      if (!raw) return Object.assign({}, DEFAULT_SAVE);
      const parsed = JSON.parse(raw) || {};
      const state = Object.assign({}, DEFAULT_SAVE, parsed);
      state.bikes = Array.isArray(state.bikes) && state.bikes.length ? state.bikes : ['bmx'];
      state.done = Array.isArray(state.done) ? state.done : [];
      state.best = state.best && typeof state.best === 'object' ? state.best : {};
      state.scores = state.scores && typeof state.scores === 'object' ? state.scores : {};
      state.coins = Number.isFinite(state.coins) ? Math.max(0, Math.floor(state.coins)) : 0;
      if (!state.bikes.includes(state.bike)) state.bike = state.bikes[0];
      return state;
    } catch (_) {
      return Object.assign({}, DEFAULT_SAVE);
    }
  }

  const save = loadSave();
  function persist() {
    try { localStorage.setItem(cfg.storageKey, JSON.stringify(save)); } catch (_) {}
  }
  const isUnlocked = (level) => {
    const idx = LEVELS.indexOf(level);
    return idx <= 0 || save.done.includes(LEVELS[idx - 1].id);
  };

  // ─── RANKING: lokalny teraz, zdalny gotowy pod spodem ─────────────────────
  const Leaderboard = {
    remote: cfg.remoteLeaderboard === true,
    localTop(levelId) {
      const rows = Array.isArray(save.scores[levelId]) ? save.scores[levelId] : [];
      return rows.slice().sort((a, b) => b.score - a.score).slice(0, 10);
    },
    localAdd(entry) {
      const rows = Array.isArray(save.scores[entry.level]) ? save.scores[entry.level] : [];
      rows.push(entry);
      rows.sort((a, b) => b.score - a.score);
      save.scores[entry.level] = rows.slice(0, 10);
      persist();
    },
    async top(levelId) {
      if (this.remote) {
        try {
          const res = await fetch(cfg.apiBase + '/leaderboard?level=' + encodeURIComponent(levelId), { headers: { Accept: 'application/json' } });
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.scores)) return { scope: 'global', rows: data.scores.slice(0, 10) };
          }
        } catch (_) {}
      }
      return { scope: 'local', rows: this.localTop(levelId) };
    },
    async submit(entry) {
      this.localAdd(entry);
      if (!this.remote || !save.token) return null;
      try {
        const res = await fetch(cfg.apiBase + '/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({ token: save.token }, entry)),
        });
        if (res.ok) return await res.json();
      } catch (_) {}
      return null;
    },
  };

  // ─── SWIAT: teren proceduralny ────────────────────────────────────────────
  const PPM = 32;          // pikseli swiata na metr
  const GRAV = 1250;
  const DX = 10;           // rozdzielczosc heightmapy
  const START_X = 160;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildTerrain(level) {
    const rnd = mulberry32(level.seed);
    const finishX = START_X + level.meters * PPM;
    const totalPx = finishX + 900;
    const n = Math.ceil(totalPx / DX) + 4;
    const hs = new Float32Array(n);
    const phases = level.waves.map(() => rnd() * Math.PI * 2);

    for (let i = 0; i < n; i++) {
      const x = i * DX;
      let y = 0;
      for (let k = 0; k < level.waves.length; k++) {
        y += Math.sin(x / level.waves[k].w + phases[k]) * level.waves[k].a;
      }
      hs[i] = y;
    }
    // plaski wybieg na starcie i plaski wypad za meta
    for (let i = 0; i < n; i++) {
      const x = i * DX;
      if (x < START_X + 220) {
        const t = Math.max(0, Math.min(1, (x - 60) / 240));
        hs[i] *= t * t;
      }
      if (x > finishX - 180) {
        const t = Math.max(0, Math.min(1, (finishX + 160 - x) / 340));
        hs[i] *= t * t;
      }
    }

    const spanA = START_X + 320;
    const spanB = finishX - 260;
    const place = (idx, count) => spanA + (spanB - spanA) * ((idx + 0.5 + (rnd() - 0.5) * 0.5) / count);

    for (let k = 0; k < level.kickers; k++) {
      const cx = place(k, level.kickers);
      const w = 70 + rnd() * 45;
      const h = 44 + rnd() * 40;
      const i0 = Math.max(0, Math.floor((cx - w) / DX));
      const i1 = Math.min(n - 1, Math.floor(cx / DX));
      for (let i = i0; i <= i1; i++) {
        const t = (i * DX - (cx - w)) / w;
        hs[i] -= h * Math.pow(Math.max(0, t), 1.7);
      }
    }
    for (let k = 0; k < level.pits; k++) {
      const cx = place(k + 0.35, Math.max(1, level.pits));
      const w = 90 + rnd() * 60;
      const depth = 70 + rnd() * 50;
      const i0 = Math.max(0, Math.floor((cx - w) / DX));
      const i1 = Math.min(n - 1, Math.ceil((cx + w) / DX));
      for (let i = i0; i <= i1; i++) {
        const t = (i * DX - cx) / w;
        if (Math.abs(t) > 1) continue;
        hs[i] += depth * Math.pow(Math.cos(t * Math.PI / 2), 2);
      }
    }

    const terrain = {
      hs, n, finishX,
      y(x) {
        const p = x / DX;
        if (p <= 0) return hs[0];
        if (p >= n - 1) return hs[n - 1];
        const i = Math.floor(p);
        const t = p - i;
        return hs[i] + (hs[i + 1] - hs[i]) * t;
      },
      slope(x) {
        const s = (terrain.y(x + 7) - terrain.y(x - 7)) / 14;
        return Math.max(-3.2, Math.min(3.2, s));
      },
    };

    // ─── przedmioty na trasie ───
    const coins = [];
    const carrots = [];
    let x = START_X + 260;
    while (x < finishX - 120) {
      if (rnd() < 0.8 * level.coinRate) {
        const count = 3 + Math.floor(rnd() * 3);
        const arc = rnd() < 0.4;
        for (let i = 0; i < count; i++) {
          const cx = x + i * 34;
          const lift = arc ? 40 + Math.sin((i / (count - 1 || 1)) * Math.PI) * 90 : 44 + rnd() * 22;
          coins.push({ x: cx, y: terrain.y(cx) - lift, got: false, spin: rnd() * 6.283 });
        }
      }
      x += 820 + rnd() * 620;
    }
    let cx = START_X + level.carrotEvery * PPM * 0.6;
    while (cx < finishX - 100) {
      carrots.push({ x: cx, y: terrain.y(cx) - 46, got: false });
      cx += level.carrotEvery * PPM * (0.85 + rnd() * 0.3);
    }

    // ─── dekoracje sceneryjne ───
    const decor = [];
    let dx2 = START_X;
    while (dx2 < finishX + 400) {
      if (rnd() < level.decorRate * 0.5) {
        decor.push({ x: dx2, kind: level.decor, scale: 0.75 + rnd() * 0.7, layer: rnd() < 0.35 ? 'back' : 'front' });
      }
      if (rnd() < level.rockRate * 0.35) {
        decor.push({ x: dx2 + 40, kind: 'stone', scale: 0.6 + rnd() * 0.8, layer: 'front' });
      }
      dx2 += 110 + rnd() * 130;
    }
    decor.sort((a, b) => a.x - b.x);

    return { terrain, coins, carrots, decor, finishX };
  }

  // ─── STAN BIEGU ───────────────────────────────────────────────────────────
  const FUEL_GAS = 0.036;
  const FUEL_IDLE = 0.005;
  const input = { gas: false, brake: false };
  let run = null;

  function startRun(level, bikeCfg) {
    const world = buildTerrain(level);
    const y0 = world.terrain.y(START_X) - bikeCfg.radius;
    run = {
      level, bike: bikeCfg, world,
      rear: { x: START_X, y: y0, vx: 0, vy: 0, on: false },
      front: { x: START_X + bikeCfg.length, y: world.terrain.y(START_X + bikeCfg.length) - bikeCfg.radius, vx: 0, vy: 0, on: false },
      wheelSpin: 0, fuel: 1, coins: 0, flips: 0, dist: 0, maxX: START_X,
      airTime: 0, airRot: 0, lastAngle: 0, flipsInAir: 0,
      over: null, particles: [], pops: [], flakes: [], time: 0, headSafe: 0,
    };
    if (level.weather === 'snow') {
      for (let i = 0; i < 90; i++) run.flakes.push({ x: Math.random(), y: Math.random(), s: 0.4 + Math.random() * 0.9 });
    }
    camera.x = START_X; camera.y = y0 - 120; camera.ready = false;
  }

  function bikeAngle() {
    return Math.atan2(run.front.y - run.rear.y, run.front.x - run.rear.x);
  }

  function collideWheel(w, radius, dt, bounce) {
    const gy = run.world.terrain.y(w.x);
    const pen = (w.y + radius) - gy;
    w.on = false;
    if (pen <= 0) return;
    const s = run.world.terrain.slope(w.x);
    const inv = 1 / Math.hypot(1, s);
    const tx = inv, ty = s * inv;        // styczna do gruntu
    const nx = -s * inv, ny = -inv;      // normalna w gore
    w.y -= pen;
    w.on = true;
    const vn = w.vx * nx + w.vy * ny;
    if (vn < 0) {
      const push = -(1 + bounce) * vn;
      w.vx += nx * push;
      w.vy += ny * push;
    }
    // opor toczenia
    const vt = w.vx * tx + w.vy * ty;
    const drag = vt * Math.min(1, 0.55 * dt);
    w.vx -= tx * drag;
    w.vy -= ty * drag;
  }

  function solveRod(len) {
    const r = run.rear, f = run.front;
    for (let it = 0; it < 3; it++) {
      const dx = f.x - r.x, dy = f.y - r.y;
      const d = Math.hypot(dx, dy) || 0.0001;
      const diff = ((d - len) / d) * 0.5;
      r.x += dx * diff; r.y += dy * diff;
      f.x -= dx * diff; f.y -= dy * diff;
      const nx = dx / d, ny = dy / d;
      const rel = (f.vx - r.vx) * nx + (f.vy - r.vy) * ny;
      r.vx += nx * rel * 0.5; r.vy += ny * rel * 0.5;
      f.vx -= nx * rel * 0.5; f.vy -= ny * rel * 0.5;
    }
  }

  function step(dt) {
    const b = run.bike;
    const lvl = run.level;
    const r = run.rear, f = run.front;
    const grounded = r.on || f.on;
    const gas = input.gas && run.fuel > 0;
    const brake = input.brake;

    const ang = bikeAngle();
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const px = -uy, py = ux;

    if (grounded) {
      const speed = r.vx * ux + r.vy * uy;
      const maxSpeed = 520 * b.top;
      if (gas && speed < maxSpeed) {
        const accel = 900 * b.power * b.grip * lvl.grip;
        r.vx += ux * accel * dt;
        r.vy += uy * accel * dt;
        f.vx += ux * accel * 0.25 * dt;
        f.vy += uy * accel * 0.25 * dt;
        // moment reakcji: przod idzie do gory (wheelie)
        f.vy -= 210 * b.air * dt;
        r.vy += 120 * dt;
      }
      if (brake) {
        const decel = speed > 0 ? -820 : 380;
        r.vx += ux * decel * dt; r.vy += uy * decel * dt;
        f.vx += ux * decel * dt; f.vy += uy * decel * dt;
        f.vy += 150 * dt;
      }
      if (!gas && !brake) {
        const keep = Math.max(0, 1 - 0.35 * dt);
        r.vx *= keep; f.vx *= keep;
      }
      run.airTime = 0;
      run.airRot = 0;
      run.flipsInAir = 0;
    } else {
      run.airTime += dt;
      const torque = (run.airTime > 0.12 ? 520 : 0) * b.air * dt;
      if (gas) { r.vx += px * torque; r.vy += py * torque; f.vx -= px * torque; f.vy -= py * torque; }
      if (brake) { r.vx -= px * torque; r.vy -= py * torque; f.vx += px * torque; f.vy += py * torque; }
    }

    r.vy += GRAV * dt; f.vy += GRAV * dt;
    r.x += r.vx * dt; r.y += r.vy * dt;
    f.x += f.vx * dt; f.y += f.vy * dt;
    solveRod(b.length);

    const bounce = 0.10 + 0.16 * (b.id === 'kolarka' ? 1.6 : 1);
    collideWheel(r, b.radius, dt, bounce);
    collideWheel(f, b.radius, dt, bounce);

    // obrot kola do rysowania
    const spd = Math.hypot(r.vx, r.vy) * Math.sign(r.vx * ux + r.vy * uy || 1);
    run.wheelSpin += (spd / b.radius) * dt;

    // salta w powietrzu
    const newAng = bikeAngle();
    if (!(r.on || f.on)) {
      let d = newAng - run.lastAngle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      run.airRot += d;
      const done = Math.floor(Math.abs(run.airRot) / (Math.PI * 2));
      if (done > run.flipsInAir) {
        run.flipsInAir = done;
        run.flips += 1;
        run.coins += 30;
        pop(T.flip + ' x' + run.flips, '#9fe22e');
      }
    }
    run.lastAngle = newAng;

    // paliwo
    run.fuel = Math.max(0, run.fuel - (gas ? FUEL_GAS : FUEL_IDLE) * dt);

    // dystans
    run.maxX = Math.max(run.maxX, r.x);
    run.dist = Math.max(0, (run.maxX - START_X) / PPM);

    // zbieranie
    const mx = (r.x + f.x) / 2, my = (r.y + f.y) / 2;
    for (const c of run.world.coins) {
      if (c.got || Math.abs(c.x - mx) > 60) continue;
      if (Math.hypot(c.x - mx, c.y - my) < 42) { c.got = true; run.coins += 5; puff(c.x, c.y, '#ffd23f'); }
    }
    for (const c of run.world.carrots) {
      if (c.got || Math.abs(c.x - mx) > 60) continue;
      if (Math.hypot(c.x - mx, c.y - my) < 46) {
        c.got = true; run.fuel = Math.min(1, run.fuel + 0.4); puff(c.x, c.y, '#f2913d');
      }
    }

    // kurz spod kola
    if (r.on && Math.abs(spd) > 120 && Math.random() < 0.5) {
      run.particles.push({ x: r.x - 6, y: r.y + b.radius - 2, vx: -spd * 0.15 + (Math.random() - 0.5) * 40, vy: -30 - Math.random() * 60, life: 0.5, color: run.level.crust });
    }

    // glowa krolika w ziemi = gleba
    const nAng = newAng;
    const hx = mx + Math.sin(nAng) * 46 - Math.cos(nAng) * 4;
    const hy = my - Math.cos(nAng) * 46 - Math.sin(nAng) * 4;
    if (run.time > 0.6 && hy > run.world.terrain.y(hx) - 4) finishRun('crash');
    if (run.fuel <= 0 && Math.abs(r.vx) < 22 && grounded && run.time > 1) finishRun('fuel');
    if (r.x >= run.world.finishX) finishRun('finish');

    run.time += dt;
  }

  // ─── RYSOWANIE ────────────────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.className = 'game-canvas';
  const ctx = canvas.getContext('2d');
  const camera = { x: 0, y: 0, ready: false };
  let W = 0, H = 0, DPR = 1, scale = 1;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    W = Math.max(320, Math.round(rect.width));
    H = Math.max(220, Math.round(rect.height));
    DPR = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    scale = Math.max(0.52, Math.min(1.1, W / 1150));
  }

  function screenSpace() { ctx.setTransform(DPR, 0, 0, DPR, 0, 0); }
  function worldSpace() {
    ctx.setTransform(DPR * scale, 0, 0, DPR * scale,
      DPR * (W * 0.34 - camera.x * scale), DPR * (H * 0.58 - camera.y * scale));
  }

  function puff(x, y, color) {
    for (let i = 0; i < 7; i++) {
      run.particles.push({
        x, y, vx: (Math.random() - 0.5) * 130, vy: -40 - Math.random() * 110,
        life: 0.45 + Math.random() * 0.3, color,
      });
    }
  }
  function pop(text, color) {
    const mx = (run.rear.x + run.front.x) / 2;
    const my = (run.rear.y + run.front.y) / 2;
    run.pops.push({ x: mx, y: my - 70, text, color, life: 1.1 });
  }

  function drawHills(color, amp, wave, parallax, baseFrac) {
    screenSpace();
    const base = H * baseFrac - camera.y * scale * parallax * 0.28;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W + 12; x += 14) {
      const wx = camera.x * parallax + x / scale;
      const y = base + Math.sin(wx / wave) * amp + Math.sin(wx / (wave * 0.37) + 1.7) * amp * 0.34;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
  }

  function drawSky(level) {
    screenSpace();
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, level.sky[0]);
    g.addColorStop(1, level.sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    if (level.night) {
      const rnd = mulberry32(level.seed + 7);
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      for (let i = 0; i < 70; i++) {
        const sxp = (rnd() * 2400 - camera.x * 0.05) % 2400;
        const x = ((sxp % W) + W) % W;
        const y = rnd() * H * 0.55;
        ctx.globalAlpha = 0.3 + rnd() * 0.7;
        ctx.fillRect(x, y, 2, 2);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#e7ecf7';
      ctx.beginPath(); ctx.arc(W * 0.78 - camera.x * 0.01 % 50, H * 0.18, 34, 0, 6.283); ctx.fill();
      ctx.fillStyle = level.sky[0];
      ctx.beginPath(); ctx.arc(W * 0.78 - camera.x * 0.01 % 50 - 14, H * 0.18 - 8, 30, 0, 6.283); ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(255,246,214,.9)';
      ctx.beginPath(); ctx.arc(W * 0.76, H * 0.2, 40, 0, 6.283); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.10)';
      for (let i = 0; i < 5; i++) {
        const wx = (i * 760 - camera.x * 0.12) % 2400;
        const x = ((wx % (W + 500)) + (W + 500)) % (W + 500) - 250;
        const y = H * (0.12 + (i % 3) * 0.09);
        ctx.beginPath();
        ctx.ellipse(x, y, 90, 26, 0, 0, 6.283);
        ctx.ellipse(x + 60, y - 12, 60, 20, 0, 0, 6.283);
        ctx.fill();
      }
    }
    drawHills(level.hillFar, 34, 320, 0.22, 0.72);
    drawHills(level.hillMid, 52, 190, 0.45, 0.84);
  }

  function drawGround(level) {
    worldSpace();
    const half = W / scale;
    const left = camera.x - half * 0.5;
    const right = camera.x + half * 0.8;
    const bottom = camera.y + H / scale + 400;
    ctx.beginPath();
    ctx.moveTo(left, run.world.terrain.y(left));
    for (let x = left; x <= right; x += DX) ctx.lineTo(x, run.world.terrain.y(x));
    ctx.lineTo(right, bottom); ctx.lineTo(left, bottom); ctx.closePath();
    ctx.fillStyle = level.ground; ctx.fill();

    ctx.beginPath();
    ctx.moveTo(left, run.world.terrain.y(left));
    for (let x = left; x <= right; x += DX) ctx.lineTo(x, run.world.terrain.y(x));
    ctx.strokeStyle = level.crust; ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.stroke();

    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = level.crust; ctx.lineWidth = 2;
    for (let x = Math.floor(left / 60) * 60; x <= right; x += 60) {
      const gy = run.world.terrain.y(x);
      ctx.beginPath(); ctx.moveTo(x, gy + 16); ctx.lineTo(x + 22, gy + 46); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawDecorItem(d, level) {
    const gy = run.world.terrain.y(d.x);
    ctx.save();
    ctx.translate(d.x, gy);
    ctx.scale(d.scale, d.scale);
    const c = level.decorColor;
    if (d.kind === 'pine' || d.kind === 'fir') {
      ctx.fillStyle = '#3a2a1c';
      ctx.fillRect(-4, -22, 8, 24);
      ctx.fillStyle = c;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(0, -96 + i * 26);
        ctx.lineTo(-28 + i * 4, -46 + i * 24);
        ctx.lineTo(28 - i * 4, -46 + i * 24);
        ctx.closePath(); ctx.fill();
      }
      if (d.kind === 'fir') {
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(0, -96 + i * 26);
          ctx.lineTo(-16 + i * 3, -70 + i * 25);
          ctx.lineTo(16 - i * 3, -70 + i * 25);
          ctx.closePath(); ctx.fill();
        }
      }
    } else if (d.kind === 'leaf') {
      ctx.fillStyle = '#3a2a1c';
      ctx.fillRect(-5, -40, 10, 42);
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(0, -58, 30, 0, 6.283);
      ctx.arc(-22, -44, 20, 0, 6.283); ctx.arc(22, -44, 20, 0, 6.283); ctx.fill();
    } else if (d.kind === 'cactus') {
      ctx.fillStyle = c;
      ctx.fillRect(-7, -62, 14, 64);
      ctx.fillRect(-26, -44, 14, 10); ctx.fillRect(-26, -44, 10, 26);
      ctx.fillRect(12, -54, 14, 10); ctx.fillRect(16, -54, 10, 22);
    } else if (d.kind === 'palm') {
      ctx.strokeStyle = '#6b4d2c'; ctx.lineWidth = 8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(10, -40, 2, -74); ctx.stroke();
      ctx.fillStyle = c;
      for (let i = 0; i < 5; i++) {
        ctx.save(); ctx.translate(2, -74); ctx.rotate(-1.5 + i * 0.62);
        ctx.beginPath(); ctx.ellipse(26, 0, 28, 8, 0, 0, 6.283); ctx.fill();
        ctx.restore();
      }
    } else if (d.kind === 'field') {
      ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath(); ctx.moveTo(i * 7, 0); ctx.quadraticCurveTo(i * 9, -14, i * 13, -26); ctx.stroke();
      }
    } else if (d.kind === 'lamp') {
      ctx.strokeStyle = '#2b3350'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -86); ctx.lineTo(20, -92); ctx.stroke();
      ctx.fillStyle = 'rgba(255,226,140,.85)';
      ctx.beginPath(); ctx.arc(22, -90, 7, 0, 6.283); ctx.fill();
      ctx.fillStyle = 'rgba(255,226,140,.10)';
      ctx.beginPath(); ctx.moveTo(22, -86); ctx.lineTo(-40, 6); ctx.lineTo(84, 6); ctx.closePath(); ctx.fill();
    } else if (d.kind === 'rock' || d.kind === 'stone') {
      ctx.fillStyle = d.kind === 'stone' ? 'rgba(0,0,0,.35)' : c;
      ctx.beginPath();
      ctx.moveTo(-22, 2); ctx.lineTo(-11, -20); ctx.lineTo(8, -26); ctx.lineTo(23, -6); ctx.lineTo(18, 2);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  function drawDecor(level, layer) {
    worldSpace();
    const left = camera.x - W / scale, right = camera.x + W / scale;
    for (const d of run.world.decor) {
      if (d.x < left || d.x > right) continue;
      if (d.layer !== layer) continue;
      drawDecorItem(d, level);
    }
  }

  function drawPickups(level, dt) {
    worldSpace();
    const left = camera.x - W / scale, right = camera.x + W / scale;
    for (const c of run.world.coins) {
      if (c.got || c.x < left || c.x > right) continue;
      c.spin += dt * 5;
      const w = Math.abs(Math.cos(c.spin)) * 11 + 2;
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath(); ctx.ellipse(c.x, c.y, w, 12, 0, 0, 6.283); ctx.fill();
      ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(c.x, c.y, w * 0.55, 6, 0, 0, 6.283); ctx.stroke();
    }
    for (const c of run.world.carrots) {
      if (c.got || c.x < left || c.x > right) continue;
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(Math.sin(run.time * 2 + c.x) * 0.15);
      ctx.fillStyle = '#f2913d';
      ctx.beginPath(); ctx.moveTo(0, 20); ctx.lineTo(-9, -10); ctx.lineTo(9, -10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#4d8a34';
      ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(-12, -26); ctx.lineTo(-2, -12); ctx.lineTo(2, -28);
      ctx.lineTo(6, -12); ctx.lineTo(14, -24); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // meta
    const fx = run.world.finishX;
    if (fx > left && fx < right) {
      const gy = run.world.terrain.y(fx);
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(fx - 3, gy - 150, 6, 150);
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 3; j++) {
          ctx.fillStyle = (i + j) % 2 ? '#0d0d0d' : '#f0f0f0';
          ctx.fillRect(fx + 3 + i * 16, gy - 150 + j * 16, 16, 16);
        }
      }
    }
  }

  function drawWheel(x, y, r, tire, level) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(run.wheelSpin);
    ctx.strokeStyle = '#141414'; ctx.lineWidth = tire;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.283); ctx.stroke();
    ctx.strokeStyle = '#8d8d8d'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r - tire * 0.6, 0, 6.283); ctx.stroke();
    ctx.strokeStyle = 'rgba(220,220,220,.75)'; ctx.lineWidth = 1.4;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * (r - tire * 0.7), Math.sin(a) * (r - tire * 0.7)); ctx.stroke();
    }
    ctx.fillStyle = level.crust;
    ctx.beginPath(); ctx.arc(0, 0, 3.2, 0, 6.283); ctx.fill();
    ctx.restore();
  }

  function drawRider(b) {
    // ukladu lokalnego: (0,0) to srodek miedzy kolami, os X do przodu
    const seatH = b.id === 'bmx' ? 30 : b.id === 'kolarka' ? 44 : 38;
    const barH = b.id === 'kolarka' ? 30 : b.id === 'bmx' ? 34 : 36;
    const hx = b.length / 2, rx = -b.length / 2;
    const crank = run.wheelSpin * (b.id === 'kolarka' ? 0.85 : 1);

    // rama
    ctx.strokeStyle = '#d8d8d8'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(rx, 0); ctx.lineTo(-4, -seatH); ctx.lineTo(hx - 6, -barH);
    ctx.lineTo(hx, 0); ctx.moveTo(-4, -seatH); ctx.lineTo(0, -6);
    ctx.moveTo(0, -6); ctx.lineTo(hx - 6, -barH); ctx.moveTo(0, -6); ctx.lineTo(rx, 0);
    ctx.stroke();
    // siodlo i kierownica
    ctx.fillStyle = '#111';
    ctx.fillRect(-12, -seatH - 5, 20, 5);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 3.5;
    ctx.beginPath();
    if (b.id === 'kolarka' || b.id === 'gravel') {
      ctx.moveTo(hx - 12, -barH); ctx.lineTo(hx + 2, -barH); ctx.quadraticCurveTo(hx + 12, -barH, hx + 8, -barH + 14);
    } else {
      ctx.moveTo(hx - 14, -barH - 2); ctx.lineTo(hx + 8, -barH - 2);
    }
    ctx.stroke();
    // korba
    ctx.strokeStyle = '#bdbdbd'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(Math.cos(crank) * 11, -6 + Math.sin(crank) * 11);
    ctx.moveTo(0, -6);
    ctx.lineTo(-Math.cos(crank) * 11, -6 - Math.sin(crank) * 11);
    ctx.stroke();

    // krolik
    const lean = b.id === 'kolarka' ? 0.55 : b.id === 'gravel' ? 0.42 : 0.3;
    const hipX = -6, hipY = -seatH - 6;
    const headX = hipX + Math.cos(-lean) * 30 + 6, headY = hipY - 26;
    const fur = '#e9e5dd';
    // noga do pedalu
    ctx.strokeStyle = '#2c2c2c'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(hipX + 6, hipY + 16);
    ctx.lineTo(Math.cos(crank) * 11, -6 + Math.sin(crank) * 11);
    ctx.stroke();
    // tulow
    ctx.strokeStyle = '#9fe22e'; ctx.lineWidth = 13; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(headX - 4, headY + 12); ctx.stroke();
    // ogon
    ctx.fillStyle = fur;
    ctx.beginPath(); ctx.arc(hipX - 8, hipY + 2, 6, 0, 6.283); ctx.fill();
    // reka do kierownicy
    ctx.strokeStyle = fur; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(headX - 6, headY + 14); ctx.lineTo(hx - 4, -barH - 4); ctx.stroke();
    // uszy
    const flap = Math.sin(run.time * 9) * 0.12 + (run.rear.on ? 0 : 0.25);
    ctx.save(); ctx.translate(headX, headY);
    for (let i = 0; i < 2; i++) {
      ctx.save();
      ctx.rotate(-2.35 + i * 0.34 + flap * (i ? 1 : 0.7));
      ctx.fillStyle = fur;
      ctx.beginPath(); ctx.ellipse(20, 0, 20, 6.5, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#f0a8b8';
      ctx.beginPath(); ctx.ellipse(20, 0, 14, 3, 0, 0, 6.283); ctx.fill();
      ctx.restore();
    }
    // glowa
    ctx.fillStyle = fur;
    ctx.beginPath(); ctx.ellipse(0, 0, 13, 11, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#141414';
    ctx.beginPath(); ctx.arc(6, -2, 2.1, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#f0a8b8';
    ctx.beginPath(); ctx.arc(12, 2, 2.4, 0, 6.283); ctx.fill();
    // kask
    ctx.fillStyle = '#9fe22e';
    ctx.beginPath(); ctx.arc(0, -4, 13, Math.PI, 6.283); ctx.fill();
    ctx.fillRect(2, -6, 15, 3.5);
    ctx.restore();
  }

  function drawBike(level) {
    worldSpace();
    const b = run.bike, r = run.rear, f = run.front;
    const ang = bikeAngle();
    if (level.night) {
      ctx.save();
      ctx.translate(f.x, f.y - 20); ctx.rotate(ang);
      const g = ctx.createLinearGradient(0, 0, 320, 0);
      g.addColorStop(0, 'rgba(255,240,190,.30)');
      g.addColorStop(1, 'rgba(255,240,190,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(320, -90); ctx.lineTo(320, 90); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    drawWheel(r.x, r.y, b.radius, b.tire, level);
    drawWheel(f.x, f.y, b.radius, b.tire, level);
    ctx.save();
    ctx.translate((r.x + f.x) / 2, (r.y + f.y) / 2);
    ctx.rotate(ang);
    drawRider(b);
    ctx.restore();
  }

  function drawEffects(dt, level) {
    worldSpace();
    for (let i = run.particles.length - 1; i >= 0; i--) {
      const p = run.particles[i];
      p.life -= dt;
      if (p.life <= 0) { run.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, 3.4, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.font = '700 22px "DM Sans", system-ui, sans-serif';
    for (let i = run.pops.length - 1; i >= 0; i--) {
      const p = run.pops[i];
      p.life -= dt;
      if (p.life <= 0) { run.pops.splice(i, 1); continue; }
      p.y -= 40 * dt;
      ctx.globalAlpha = Math.min(1, p.life);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    if (level.weather === 'snow') {
      screenSpace();
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      for (const fl of run.flakes) {
        fl.y += dt * 0.06 * fl.s;
        fl.x += dt * 0.01 * Math.sin(run.time + fl.y * 10);
        if (fl.y > 1) { fl.y = 0; fl.x = Math.random(); }
        const px2 = (((fl.x * 1.7 - camera.x * 0.00012 * fl.s) % 1) + 1) % 1;
        ctx.globalAlpha = 0.35 + fl.s * 0.4;
        ctx.beginPath(); ctx.arc(px2 * W, fl.y * H, 1.6 * fl.s + 0.6, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (level.night) {
      screenSpace();
      const g = ctx.createRadialGradient(W * 0.4, H * 0.5, H * 0.2, W * 0.4, H * 0.5, H * 0.95);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,.55)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
  }

  function render(dt) {
    const level = run.level;
    screenSpace();
    ctx.clearRect(0, 0, W, H);
    drawSky(level);
    drawDecor(level, 'back');
    drawGround(level);
    drawDecor(level, 'front');
    drawPickups(level, dt);
    drawBike(level);
    drawEffects(dt, level);
  }

  // ─── INTERFEJS ────────────────────────────────────────────────────────────
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const ui = {};
  function buildDom() {
    root.appendChild(canvas);

    ui.hud = el('div', 'game-hud');
    ui.hudDist = el('span', 'hud-val', '0 ' + T.meters);
    ui.hudCoins = el('span', 'hud-val', '0');
    ui.hudFlips = el('span', 'hud-val', '0');
    ui.fuelFill = el('i', 'fuel-fill');
    const fuelBar = el('div', 'fuel-bar');
    fuelBar.appendChild(ui.fuelFill);
    const mk = (label, node) => {
      const box = el('div', 'hud-box');
      box.appendChild(el('span', 'hud-label', label));
      box.appendChild(node);
      return box;
    };
    ui.hud.appendChild(mk(T.hud.dist, ui.hudDist));
    ui.hud.appendChild(mk(T.hud.coins, ui.hudCoins));
    ui.hud.appendChild(mk(T.hud.flips, ui.hudFlips));
    ui.hud.appendChild(mk(T.hud.fuel, fuelBar));
    root.appendChild(ui.hud);

    ui.touch = el('div', 'game-touch');
    ui.btnBrake = el('button', 'g-btn g-brake', T.controls.brake);
    ui.btnGas = el('button', 'g-btn g-gas', T.controls.gas);
    ui.btnBrake.type = 'button'; ui.btnGas.type = 'button';
    ui.touch.appendChild(ui.btnBrake);
    ui.touch.appendChild(ui.btnGas);
    root.appendChild(ui.touch);

    // ── menu ──
    ui.menu = el('div', 'game-panel game-menu');
    const head = el('div', 'panel-head');
    head.appendChild(el('h2', 'panel-title', T.title));
    ui.wallet = el('span', 'wallet', T.wallet + ': 0');
    head.appendChild(ui.wallet);
    ui.menu.appendChild(head);
    ui.menu.appendChild(el('p', 'panel-lead', T.tagline));

    ui.installBtn = el('button', 'g-install', T.install.button);
    ui.installBtn.type = 'button';
    ui.installBtn.hidden = true;
    ui.installHint = el('p', 'panel-hint', T.install.ios);
    ui.installHint.hidden = true;
    ui.menu.appendChild(ui.installBtn);
    ui.menu.appendChild(ui.installHint);

    const tabs = el('div', 'panel-tabs');
    ui.tabs = {};
    for (const key of ['play', 'bikes', 'scores']) {
      const btn = el('button', 'tab', T.tabs[key]);
      btn.type = 'button';
      btn.addEventListener('click', () => showTab(key));
      tabs.appendChild(btn);
      ui.tabs[key] = btn;
    }
    ui.menu.appendChild(tabs);

    ui.tabPlay = el('div', 'tab-body cards');
    ui.tabBikes = el('div', 'tab-body cards');
    ui.tabScores = el('div', 'tab-body');
    ui.menu.appendChild(ui.tabPlay);
    ui.menu.appendChild(ui.tabBikes);
    ui.menu.appendChild(ui.tabScores);
    ui.menu.appendChild(el('p', 'panel-hint', T.controls.hint));
    root.appendChild(ui.menu);

    // ── ekran konca biegu ──
    ui.over = el('div', 'game-panel game-over');
    ui.overTitle = el('h2', 'panel-title', '');
    ui.overStats = el('div', 'over-stats');
    ui.overUnlock = el('p', 'over-unlock', '');
    ui.overUnlock.hidden = true;
    const saveRow = el('div', 'save-row');
    ui.nick = document.createElement('input');
    ui.nick.type = 'text';
    ui.nick.maxLength = 14;
    ui.nick.className = 'nick-input';
    ui.nick.placeholder = T.over.nick;
    ui.nick.value = save.nick || '';
    ui.saveBtn = el('button', 'g-btn-sm', T.over.save);
    ui.saveBtn.type = 'button';
    saveRow.appendChild(ui.nick);
    saveRow.appendChild(ui.saveBtn);
    ui.overActions = el('div', 'over-actions');
    ui.retryBtn = el('button', 'g-btn-main', T.over.retry);
    ui.menuBtn = el('button', 'g-btn-sm', T.over.menu);
    ui.retryBtn.type = 'button'; ui.menuBtn.type = 'button';
    ui.overActions.appendChild(ui.retryBtn);
    ui.overActions.appendChild(ui.menuBtn);
    ui.over.appendChild(ui.overTitle);
    ui.over.appendChild(ui.overStats);
    ui.over.appendChild(ui.overUnlock);
    ui.over.appendChild(saveRow);
    ui.shareBox = el('div', 'share-box');
    ui.shareTitle = el('h3', 'card-title', T.share.title);
    ui.shareHint = el('p', 'panel-hint', T.share.hint);
    ui.shareBox.appendChild(ui.shareTitle);
    ui.over.appendChild(ui.shareBox);
    ui.over.appendChild(ui.shareHint);
    ui.over.appendChild(ui.overActions);
    root.appendChild(ui.over);

    ui.retryBtn.addEventListener('click', () => launch(currentLevel));
    ui.menuBtn.addEventListener('click', () => openMenu('play'));
    ui.saveBtn.addEventListener('click', saveScore);
  }

  let currentLevel = LEVELS[0];
  let activeTab = 'play';

  function showTab(key) {
    activeTab = key;
    for (const k of Object.keys(ui.tabs)) ui.tabs[k].classList.toggle('active', k === key);
    ui.tabPlay.hidden = key !== 'play';
    ui.tabBikes.hidden = key !== 'bikes';
    ui.tabScores.hidden = key !== 'scores';
    if (key === 'play') renderLevels();
    if (key === 'bikes') renderBikes();
    if (key === 'scores') renderScores();
  }

  function renderWallet() {
    ui.wallet.textContent = T.wallet + ': ' + save.coins;
  }

  function renderLevels() {
    ui.tabPlay.textContent = '';
    LEVELS.forEach((level) => {
      const open = isUnlocked(level);
      const card = el('button', 'card' + (open ? '' : ' locked'));
      card.type = 'button';
      card.appendChild(el('h3', 'card-title', T.levels[level.id].name));
      card.appendChild(el('p', 'card-desc', T.levels[level.id].desc));
      const meta = el('div', 'card-meta');
      meta.appendChild(el('span', 'chip', level.meters + ' ' + T.meters));
      const best = save.best[level.id];
      meta.appendChild(el('span', 'chip', T.best + ': ' + (best ? best : T.noRecord)));
      if (!open) meta.appendChild(el('span', 'chip chip-lock', T.locked));
      card.appendChild(meta);
      if (!open) {
        card.appendChild(el('p', 'card-hint', T.unlockHint));
        card.disabled = true;
      }
      card.addEventListener('click', () => launch(level));
      ui.tabPlay.appendChild(card);
    });
  }

  function statBar(label, value) {
    const row = el('div', 'stat');
    row.appendChild(el('span', 'stat-label', label));
    const track = el('span', 'stat-track');
    const fill = el('i', 'stat-fill');
    fill.style.width = Math.round(Math.max(6, Math.min(100, value * 100))) + '%';
    track.appendChild(fill);
    row.appendChild(track);
    return row;
  }

  function renderBikes() {
    ui.tabBikes.textContent = '';
    BIKES.forEach((bike) => {
      const owned = save.bikes.includes(bike.id);
      const active = save.bike === bike.id;
      const card = el('div', 'card' + (active ? ' active' : ''));
      card.appendChild(el('h3', 'card-title', T.bikes[bike.id].name));
      card.appendChild(el('p', 'card-desc', T.bikes[bike.id].desc));
      card.appendChild(statBar(T.stats.speed, bike.top / 1.4));
      card.appendChild(statBar(T.stats.grip, bike.grip / 1.2));
      card.appendChild(statBar(T.stats.air, bike.air / 1.3));
      const action = el('button', 'g-btn-sm');
      action.type = 'button';
      if (active) {
        action.textContent = T.selected;
        action.disabled = true;
      } else if (owned) {
        action.textContent = T.select;
        action.addEventListener('click', () => { save.bike = bike.id; persist(); renderBikes(); });
      } else {
        action.textContent = T.buy + ' ' + bike.cost;
        action.addEventListener('click', () => {
          if (save.coins < bike.cost) {
            action.textContent = T.notEnough;
            setTimeout(renderBikes, 1400);
            return;
          }
          save.coins -= bike.cost;
          save.bikes.push(bike.id);
          save.bike = bike.id;
          persist();
          renderWallet();
          renderBikes();
        });
      }
      card.appendChild(action);
      ui.tabBikes.appendChild(card);
    });
  }

  function renderScores() {
    ui.tabScores.textContent = '';
    ui.tabScores.appendChild(buildAccountBox());
    const select = document.createElement('select');
    select.className = 'score-select';
    LEVELS.forEach((level) => {
      const opt = document.createElement('option');
      opt.value = level.id;
      opt.textContent = T.levels[level.id].name;
      if (level.id === currentLevel.id) opt.selected = true;
      select.appendChild(opt);
    });
    const list = el('ol', 'score-list');
    const scope = el('p', 'panel-hint', '');
    const fill = async (levelId) => {
      list.textContent = '';
      const result = await Leaderboard.top(levelId);
      scope.textContent = result.scope === 'global' ? T.scores.global : T.scores.local;
      if (!result.rows.length) {
        list.appendChild(el('li', 'score-empty', T.scores.empty));
        return;
      }
      result.rows.forEach((row) => {
        const li = el('li', 'score-row');
        li.appendChild(el('span', 'score-name', row.name || '?'));
        li.appendChild(el('span', 'score-val', String(row.score)));
        list.appendChild(li);
      });
    };
    select.addEventListener('change', () => fill(select.value));
    ui.tabScores.appendChild(select);
    ui.tabScores.appendChild(scope);
    ui.tabScores.appendChild(list);
    fill(select.value);
  }

  function openMenu(tab) {
    input.gas = false; input.brake = false;
    ui.menu.hidden = false;
    ui.over.hidden = true;
    ui.hud.hidden = true;
    ui.touch.hidden = true;
    root.classList.remove('playing');
    resize();
    startRun(currentLevel, bikeById(save.bike));
    run.preview = true;
    renderWallet();
    showTab(tab || activeTab);
  }

  function launch(level) {
    if (!isUnlocked(level)) return;
    currentLevel = level;
    ui.menu.hidden = true;
    ui.over.hidden = true;
    ui.hud.hidden = false;
    ui.touch.hidden = false;
    root.classList.add('playing');
    resize();
    startRun(level, bikeById(save.bike));
  }

  function finishRun(reason) {
    if (!run || run.over) return;
    run.over = reason;
    const level = run.level;
    const finished = reason === 'finish';
    const score = Math.round(run.dist) + run.coins + (finished ? 400 : 0);
    save.coins += run.coins;
    if (!save.best[level.id] || score > save.best[level.id]) save.best[level.id] = score;
    let unlockedName = '';
    if (finished && !save.done.includes(level.id)) {
      save.done.push(level.id);
      const next = LEVELS[LEVELS.indexOf(level) + 1];
      if (next) unlockedName = T.levels[next.id].name;
    }
    persist();

    pendingScore = {
      level: level.id, score,
      dist: Math.round(run.dist), coins: run.coins, flips: run.flips,
      bike: run.bike.id, ts: Date.now(),
    };

    ui.overTitle.textContent = T.over[reason] || T.over.crash;
    ui.overStats.textContent = '';
    const rows = [
      [T.over.score, String(score)],
      [T.over.dist, Math.round(run.dist) + ' ' + T.meters],
      [T.over.coins, String(run.coins)],
      [T.over.flips, String(run.flips)],
    ];
    for (const [label, value] of rows) {
      const box = el('div', 'over-stat');
      box.appendChild(el('span', 'hud-label', label));
      box.appendChild(el('strong', '', value));
      ui.overStats.appendChild(box);
    }
    ui.overUnlock.hidden = !unlockedName;
    ui.overUnlock.textContent = unlockedName ? T.over.unlocked + ' ' + unlockedName : '';
    ui.saveBtn.disabled = false;
    ui.saveBtn.textContent = T.over.save;
    ui.shareBox.textContent = '';
    ui.shareBox.appendChild(el('h3', 'card-title', T.share.title));
    ui.shareBox.appendChild(buildShareRow(pendingScore));
    ui.over.hidden = false;
    ui.touch.hidden = true;
    input.gas = false; input.brake = false;
  }

  let pendingScore = null;
  async function saveScore() {
    if (!pendingScore) return;
    const nick = (ui.nick.value || '').replace(/[<>]/g, '').trim().slice(0, 14) || 'Anonim';
    save.nick = nick;
    persist();
    ui.saveBtn.disabled = true;
    ui.saveBtn.textContent = T.over.saved;
    const result = await Leaderboard.submit(Object.assign({ name: nick }, pendingScore));
    if (result && result.rank) {
      ui.overUnlock.hidden = false;
      ui.overUnlock.textContent = T.account.rank + ' ' + result.rank;
    } else if (!save.token) {
      ui.overUnlock.hidden = false;
      ui.overUnlock.textContent = T.account.intro;
    }
    renderWallet();
  }

  // ─── KONTO GRACZA (potwierdzenie numeru SMS-em) ───────────────────────────
  function checkRow(text) {
    const label = el('label', 'check-row');
    const box = document.createElement('input');
    box.type = 'checkbox';
    label.appendChild(box);
    label.appendChild(el('span', '', text));
    return { label, box };
  }

  function textField(placeholder, value, type) {
    const field = document.createElement('input');
    field.type = type || 'text';
    field.className = 'nick-input';
    field.placeholder = placeholder;
    if (value) field.value = value;
    return field;
  }

  function buildAccountBox() {
    const box = el('div', 'account-box');
    box.appendChild(el('h3', 'card-title', T.account.title));
    if (save.token) {
      box.appendChild(el('p', 'panel-hint', T.account.playingAs + ' ' + (save.nick || '?')));
      const change = el('button', 'g-btn-sm', T.account.change);
      change.type = 'button';
      change.addEventListener('click', () => { save.token = ''; persist(); renderScores(); });
      box.appendChild(change);
      return box;
    }
    box.appendChild(el('p', 'panel-hint', T.account.intro));
    const nick = textField(T.account.nick, save.nick, 'text');
    nick.maxLength = 14;
    const phone = textField(T.account.phone, '', 'tel');
    phone.autocomplete = 'tel';
    const consent = checkRow(T.account.consent);
    const marketing = checkRow(T.account.marketing);
    const status = el('p', 'panel-hint', '');
    const send = el('button', 'g-btn-sm', T.account.send);
    send.type = 'button';
    const code = textField(T.account.code, '', 'text');
    code.inputMode = 'numeric';
    code.maxLength = 6;
    const confirm = el('button', 'g-btn-sm', T.account.confirm);
    confirm.type = 'button';
    const codeRow = el('div', 'save-row');
    codeRow.appendChild(code);
    codeRow.appendChild(confirm);
    codeRow.hidden = true;

    send.addEventListener('click', async () => {
      if (!consent.box.checked) { status.textContent = T.account.consent; return; }
      send.disabled = true;
      send.textContent = T.account.sending;
      try {
        const res = await fetch(cfg.apiBase + '/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: phone.value, nick: nick.value,
            consent: true, marketing: marketing.box.checked,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          codeRow.hidden = false;
          status.textContent = T.account.sent;
          save.nick = nick.value.trim();
          persist();
        } else {
          status.textContent = data.error || T.account.error;
        }
      } catch (_) {
        status.textContent = T.account.error;
      }
      send.disabled = false;
      send.textContent = T.account.send;
    });

    confirm.addEventListener('click', async () => {
      confirm.disabled = true;
      try {
        const res = await fetch(cfg.apiBase + '/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phone.value, code: code.value }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.token) {
          save.token = data.token;
          save.nick = data.nick || save.nick;
          persist();
          renderScores();
          return;
        }
        status.textContent = data.error || T.account.error;
      } catch (_) {
        status.textContent = T.account.error;
      }
      confirm.disabled = false;
    });

    const form = el('div', 'account-form');
    form.appendChild(nick);
    form.appendChild(phone);
    box.appendChild(form);
    box.appendChild(consent.label);
    box.appendChild(marketing.label);
    box.appendChild(send);
    box.appendChild(codeRow);
    box.appendChild(status);
    return box;
  }

  // ─── KARTA WYNIKU NA SOCIALE ──────────────────────────────────────────────
  function shareText(result) {
    const levelName = T.levels[result.level] ? T.levels[result.level].name : '';
    return result.score + ' ' + T.share.caption + ' (' + levelName + '). ' + T.share.play;
  }

  async function buildShareCanvas(result) {
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (_) {}
    const card = document.createElement('canvas');
    card.width = 1080; card.height = 1350;
    const x = card.getContext('2d');
    x.fillStyle = '#080808';
    x.fillRect(0, 0, 1080, 1350);

    // kadr z ostatniej klatki gry, kadrowany centralnie
    const sw = canvas.width, sh = canvas.height;
    const ratio = 1080 / 780;
    let cw = sw, ch = sw / ratio;
    if (ch > sh) { ch = sh; cw = sh * ratio; }
    try { x.drawImage(canvas, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, 1080, 780); } catch (_) {}
    x.fillStyle = '#9fe22e';
    x.fillRect(0, 780, 1080, 9);

    // plakietka marki na kadrze
    x.fillStyle = 'rgba(8,8,8,.72)';
    x.fillRect(40, 40, 372, 74);
    x.fillStyle = '#9fe22e';
    x.fillRect(40, 40, 8, 74);
    x.fillStyle = '#f0f0f0';
    x.textAlign = 'left';
    x.font = '52px "Bebas Neue", system-ui, sans-serif';
    x.fillText('SKOCZNA RIDER', 70, 94);

    const levelName = T.levels[result.level] ? T.levels[result.level].name : '';
    x.textAlign = 'left';
    x.fillStyle = '#969696';
    x.font = '500 24px "DM Sans", system-ui, sans-serif';
    x.fillText((save.nick || 'RIDER').toUpperCase(), 64, 858);
    x.fillStyle = '#f0f0f0';
    x.font = '46px "Bebas Neue", system-ui, sans-serif';
    x.fillText(levelName.toUpperCase(), 64, 906);

    x.fillStyle = '#9fe22e';
    x.font = '170px "Bebas Neue", system-ui, sans-serif';
    x.fillText(String(result.score), 60, 1070);

    const stats = [
      [T.over.dist, result.dist + ' ' + T.meters],
      [T.over.coins, String(result.coins)],
      [T.over.flips, String(result.flips)],
    ];
    stats.forEach((pair, i) => {
      const bx = 64 + i * 330;
      x.fillStyle = '#969696';
      x.font = '500 22px "DM Sans", system-ui, sans-serif';
      x.fillText(pair[0].toUpperCase(), bx, 1150);
      x.fillStyle = '#f0f0f0';
      x.font = '58px "Bebas Neue", system-ui, sans-serif';
      x.fillText(pair[1], bx, 1210);
    });

    x.fillStyle = '#9fe22e';
    x.font = '52px "Bebas Neue", system-ui, sans-serif';
    x.fillText('SKOCZNAROWER.PL/GRA', 64, 1300);
    return card;
  }

  async function shareCardBlob(result) {
    const card = await buildShareCanvas(result);
    return await new Promise((resolve) => card.toBlob(resolve, 'image/png'));
  }

  function buildShareRow(result) {
    const row = el('div', 'share-row');
    const btnShare = el('button', 'g-btn-sm', T.share.button);
    const btnSave = el('button', 'g-btn-sm', T.share.download);
    const btnCopy = el('button', 'g-btn-sm', T.share.copy);
    const btnFb = el('button', 'g-btn-sm', T.share.fb);
    [btnShare, btnSave, btnCopy, btnFb].forEach((b) => { b.type = 'button'; row.appendChild(b); });

    btnShare.addEventListener('click', async () => {
      const text = shareText(result);
      try {
        const blob = await shareCardBlob(result);
        const file = blob ? new File([blob], 'skoczna-rider.png', { type: 'image/png' }) : null;
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], text, title: T.title });
          return;
        }
        if (navigator.share) {
          await navigator.share({ text, url: 'https://www.skocznarower.pl/gra', title: T.title });
          return;
        }
        if (blob) downloadBlob(blob);
      } catch (_) {}
    });

    btnSave.addEventListener('click', async () => {
      const blob = await shareCardBlob(result);
      if (blob) downloadBlob(blob);
    });

    btnCopy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(shareText(result));
        btnCopy.textContent = T.share.copied;
        setTimeout(() => { btnCopy.textContent = T.share.copy; }, 1600);
      } catch (_) {}
    });

    btnFb.addEventListener('click', () => {
      window.open('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent('https://www.skocznarower.pl/gra'), '_blank', 'noopener,width=640,height=640');
    });

    return row;
  }

  function downloadBlob(blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'skoczna-rider.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function updateHud() {
    if (!run || ui.hud.hidden) return;
    ui.hudDist.textContent = Math.round(run.dist) + ' ' + T.meters;
    ui.hudCoins.textContent = String(run.coins);
    ui.hudFlips.textContent = String(run.flips);
    ui.fuelFill.style.width = Math.round(run.fuel * 100) + '%';
    ui.fuelFill.style.background = run.fuel < 0.2 ? '#e2542e' : '#f2913d';
  }

  function updateCamera(dt) {
    const mx = (run.rear.x + run.front.x) / 2;
    const my = (run.rear.y + run.front.y) / 2;
    const targetX = mx + 70 + Math.min(200, Math.abs(run.rear.vx) * 0.22);
    const targetY = my - 30;
    if (!camera.ready) { camera.x = targetX; camera.y = targetY; camera.ready = true; return; }
    camera.x += (targetX - camera.x) * Math.min(1, dt * 5);
    camera.y += (targetY - camera.y) * Math.min(1, dt * 3.4);
  }

  // ─── STEROWANIE ───────────────────────────────────────────────────────────
  function bindHold(node, key) {
    const on = (e) => { e.preventDefault(); input[key] = true; };
    const off = () => { input[key] = false; };
    node.addEventListener('pointerdown', on);
    node.addEventListener('pointerup', off);
    node.addEventListener('pointerleave', off);
    node.addEventListener('pointercancel', off);
    node.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function bindInput() {
    bindHold(ui.btnGas, 'gas');
    bindHold(ui.btnBrake, 'brake');
    canvas.addEventListener('pointerdown', (e) => {
      if (!run || run.over) return;
      const rect = canvas.getBoundingClientRect();
      input[(e.clientX - rect.left) < rect.width / 2 ? 'brake' : 'gas'] = true;
    });
    const release = () => { input.gas = false; input.brake = false; };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('pointerleave', release);
    window.addEventListener('keydown', (e) => {
      if (!run || run.over) return;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D' || e.key === ' ') { input.gas = true; e.preventDefault(); }
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { input.brake = true; e.preventDefault(); }
      if (e.key === 'Escape') openMenu();
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D' || e.key === ' ') input.gas = false;
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') input.brake = false;
    });
    document.addEventListener('visibilitychange', release);
    window.addEventListener('blur', release);
    window.addEventListener('resize', resize);
  }

  // ─── PWA: instalacja na iOS i Androidzie ──────────────────────────────────
  function setupPwa() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    let deferred = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferred = e;
      if (!standalone) ui.installBtn.hidden = false;
    });
    ui.installBtn.addEventListener('click', async () => {
      if (!deferred) return;
      deferred.prompt();
      try { await deferred.userChoice; } catch (_) {}
      deferred = null;
      ui.installBtn.hidden = true;
    });
    window.addEventListener('appinstalled', () => {
      ui.installBtn.hidden = true;
      ui.installHint.hidden = true;
    });
    if (iOS && !standalone) ui.installHint.hidden = false;
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register(cfg.swPath).catch(() => {});
      });
    }
  }

  // ─── PETLA ────────────────────────────────────────────────────────────────
  const FIXED = 1 / 120;
  let last = 0, acc = 0;

  function frame(ts) {
    requestAnimationFrame(frame);
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
    last = ts;
    if (!run) return;
    if (run.preview) { render(dt); return; }
    if (!run.over) {
      acc += dt;
      let steps = 0;
      while (acc >= FIXED && steps < 8) {
        step(FIXED);
        acc -= FIXED;
        steps += 1;
        if (run.over) break;
      }
      updateCamera(dt);
    }
    render(dt);
    updateHud();
  }

  if (/[?&]debug=1/.test(location.search)) {
    window.__skocznaRider = {
      get run() { return run; }, LEVELS, BIKES, save,
      launch: (id) => launch(LEVELS.find(l => l.id === id) || LEVELS[0]),
      buildShareCanvas, finish: (reason) => finishRun(reason),
    };
  }

  buildDom();
  bindInput();
  setupPwa();
  resize();
  openMenu('play');
  requestAnimationFrame(frame);
})();
