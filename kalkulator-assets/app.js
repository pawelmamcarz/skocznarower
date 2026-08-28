(function () {
  const B = window.Bieznik;
  const Tires = window.BieznikTires;
  const Parse = window.BieznikParse;
  const I = window.BieznikI18n;

  const POS_FOR = {
    szosa: ["tops", "hoods", "drops", "elbows"],
    gravel: ["tops", "hoods", "drops", "elbows"],
    mtb: ["seated", "seated_low", "standing"],
    dh: ["seated", "attack", "tuck"],
    dirt: ["stand", "pump"],
    bmx: ["stand", "pump"],
  };

  const WHEELS = {
    szosa: [700],
    gravel: [700],
    mtb: [29, 27.5, 26],
    dh: [29, 27.5],
    dirt: [26],
    bmx: [20],
  };

  const state = {
    lang: "pl",
    disc: null,
    mass: 82,
    lose: 0,
    height: 176,
    bike: 9,
    cargo: 2,
    tireMm: 32,
    pressure: 0,
    rough: "medium",
    setup: "tubeless",
    tireClass: "allround",
    tireCrr: null,
    tireName: "",
    rim: "low",
    wheelG: 1700,
    wheelInch: 700,
    sus: "rigid",
    bmxMode: "park",
    pos: "hoods",
    lowPct: 25,
    terrain: "flat",
    v: 28,
    style: "normal",
    forma: "fun",
    gpx: null,
    gpxTerrain: null,
    windHead: 0,
    windMeta: null,
    dirty: {},
  };

  function t(path) {
    const dict = I[state.lang] || I.uk || I.pl;
    const parts = path.split(".");
    let cur = dict;
    for (const p of parts) {
      if (cur == null) return path;
      cur = cur[p];
    }
    if (cur && typeof cur === "object" && !Array.isArray(cur)) {
      return cur[state.disc] || cur.szosa || path;
    }
    return cur == null ? path : cur;
  }

  function fmt(n, d) {
    if (!isFinite(n)) return "—";
    const s = Number(n).toFixed(d);
    return state.lang === "en" ? s : s.replace(".", ",");
  }

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $all(sel, root) {
    return [...(root || document).querySelectorAll(sel)];
  }

  function applyDisc(id, force) {
    const d = B.DISC[id];
    if (!d) return;
    state.disc = id;
    const set = (k, v) => {
      if (force || !state.dirty[k]) state[k] = v;
    };
    set("bike", d.bike);
    set("cargo", d.cargo);
    set("tireMm", d.tireMm);
    set("v", d.v);
    set("wheelG", d.wheelG);
    set("rim", d.rim);
    set("pos", d.pos);
    set("lowPct", d.lowPct);
    set("terrain", d.terrain);
    set("rough", d.rough);
    set("setup", d.setup);
    set("tireClass", d.tireClass);
    set("wheelInch", d.wheelInch);
    set("sus", d.sus);
    if (d.bmxMode) set("bmxMode", d.bmxMode);
    if (!POS_FOR[id].includes(state.pos)) state.pos = d.pos;
    state.tireCrr = null;
    state.tireName = "";
  }

  function sNow() {
    return {
      disc: state.disc || "szosa",
      mass: state.mass,
      lose: state.lose,
      height: state.height,
      bike: state.bike,
      cargo: state.cargo,
      tireMm: state.tireMm,
      pressure: state.pressure,
      rough: state.rough,
      setup: state.setup,
      tireClass: state.tireClass,
      tireCrr: state.tireCrr,
      rim: state.rim,
      wheelG: state.wheelG,
      wheelInch: state.wheelInch,
      sus: state.sus,
      bmxMode: state.bmxMode,
      pos: state.pos,
      lowPct: state.lowPct,
      terrain: state.terrain,
      v: state.v,
      style: state.style,
      forma: state.forma,
      gpxTerrain: state.gpxTerrain,
      windHead: state.windHead,
    };
  }

  function inchOf(mm) {
    return mm / 25.4;
  }

  function numInput(id, key, min, max, step, unit, oninput) {
    return `<div class="field">
      <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${state[key]}">
      <div class="val" id="${id}Val">${fmt(state[key], step < 1 ? 1 : 0)} ${unit}</div>
    </div>`;
  }

  function chips(id, key, opts, labels) {
    return `<div class="chips" id="${id}">${opts
      .map(
        (o) =>
          `<button type="button" class="chip${state[key] === o ? " on" : ""}" data-v="${o}">${
            labels[o] || o
          }</button>`
      )
      .join("")}</div>`;
  }

  function plateSvg(n) {
    return `<span class="no">NO. ${String(n).padStart(2, "0")}</span>`;
  }

  function renderApp() {
    const app = $("#app");
    const discs = ["szosa", "gravel", "mtb", "dh", "dirt", "bmx"];
    const showRoad = state.disc === "szosa" || state.disc === "gravel";
    const showSus = state.disc === "mtb" || state.disc === "dh" || state.disc === "dirt";
    const showBmx = state.disc === "bmx";
    const showWheels = (WHEELS[state.disc] || [700]).length > 1;
    const posList = POS_FOR[state.disc] || POS_FOR.szosa;
    const setups =
      state.disc === "mtb" || state.disc === "dh" || state.disc === "dirt"
        ? ["tubeless", "insert", "butyl"]
        : state.disc === "bmx"
          ? ["butyl", "tubeless", "latex"]
          : ["tubeless", "latex", "butyl"];
    const classes =
      state.disc === "dirt" || state.disc === "bmx"
        ? ["race", "park", "allround", "knobby"]
        : ["race", "allround", "knobby"];

    const head = state.embed
      ? `<section class="hero embed-hero"><div class="stack" id="heroStack"></div></section>`
      : `<header class="top">
        <div class="brand">
          <div class="logo">BIE<i>Ż</i>NIK</div>
          <div class="tag">${t("tag")} · v1.0</div>
        </div>
        <div class="lang" role="group" aria-label="language">
          <button type="button" data-lang="pl" class="${state.lang === "pl" ? "on" : ""}">${t("langPL")}</button>
          <button type="button" data-lang="en" class="${state.lang === "en" ? "on" : ""}">${t("langEN")}</button>
        </div>
      </header>
      <section class="hero">
        <div>
          <h1>${t("h1a")}<br><span class="hl">${t("h1b")}</span></h1>
          <p class="lead">${t("lead")}</p>
        </div>
        <div class="stack" id="heroStack"></div>
      </section>`;

    app.innerHTML = `
      ${head}

      <div class="plates" id="plates">
        ${discs
          .map(
            (d, i) => `<button type="button" class="plate${state.disc === d ? " on" : ""}" data-d="${d}">
            <span class="bolt tl"></span><span class="bolt tr"></span>
            <span class="bolt bl"></span><span class="bolt br"></span>
            ${plateSvg(i + 1)}
            <div class="nm">${t("d_" + d)}</div>
            <div class="sub">${t("d_" + d + "_s")}</div>
          </button>`
          )
          .join("")}
      </div>

      <div class="grid">
        <form class="job" id="job" onsubmit="return false">
          <div class="kicker">${t("step1")}</div>
          <h2>${t("step1h")}</h2>
          <p class="sec-lead">${t("step1s")}</p>

          <div class="block">
            <div class="kicker">${t("step2")}</div>
            <h2>${t("step2h")}</h2>
            <div class="row">
              <div>
                <label class="lab" for="mass">${t("lMass")}</label>
                ${numInput("mass", "mass", 45, 140, 1, t("kg"))}
              </div>
              <div>
                <label class="lab" for="lose">${t("lLose")}</label>
                ${numInput("lose", "lose", 0, 20, 0.5, t("kg"))}
                <p class="hint">${t("loseHint")}</p>
              </div>
            </div>
            <label class="lab" for="height">${t("lHeight")}</label>
            ${numInput("height", "height", 140, 210, 1, t("cm"))}
            <p class="hint">${t("heightHint")}</p>
            <div class="row">
              <div>
                <label class="lab" for="bike">${t("lBike")}</label>
                ${numInput("bike", "bike", 5, 22, 0.1, t("kg"))}
                <p class="hint">${t("bikeHint")}</p>
              </div>
              <div>
                <label class="lab" for="cargo">${t("lCargo")}</label>
                ${numInput("cargo", "cargo", 0, 15, 0.1, t("kg"))}
                <p class="hint">${t("cargoHint")}</p>
              </div>
            </div>
            <label class="lab" for="tire">${t("lTire")}</label>
            ${numInput("tire", "tireMm", 23, 70, 1, t("mm"))}
            <p class="hint">${t("tireHint")} · <span id="tireInch"></span></p>
            <label class="lab" for="psi">${t("lPsi")}</label>
            ${numInput("psi", "pressure", 0, 9, 0.1, t("bar"))}
            <p class="hint">${t("psiHint")}</p>
            <label class="lab">${t("lRough")}</label>
            ${chips(
              "rough",
              "rough",
              ["smooth", "medium", "rough"],
              (I[state.lang] || I.pl).rough[state.disc || "szosa"]
            )}
            <p class="hint">${t("roughHint")}</p>
            <label class="lab">${t("lSetup")}</label>
            ${chips(
              "setup",
              "setup",
              setups,
              Object.fromEntries(setups.map((x) => [x, t("setup_" + x)]))
            )}
            <p class="hint">${t("setupHint")}</p>
            <label class="lab">${t("lClass")}</label>
            ${chips(
              "klass",
              "tireClass",
              classes,
              Object.fromEntries(classes.map((x) => [x, t("class_" + x)]))
            )}
            <p class="hint">${t("classHint")}</p>
            <label class="lab">${t("tireSearch")}</label>
            <input class="search" id="tireSearch" placeholder="${t("tirePlaceholder")}" list="tireList" autocomplete="off">
            <datalist id="tireList"></datalist>
            <p class="hint" id="tireInfo"></p>
            <p class="hint">${t("tireManual")}</p>
            <div class="row">
              <div>
                <label class="lab" for="brrW">${t("lBrrW")}</label>
                <div class="field"><input id="brrW" type="number" step="0.1" min="0" max="80" style="width:100%;border:0;background:transparent"></div>
              </div>
              <div>
                <label class="lab" for="brrCrr">${t("lBrrCrr")}</label>
                <div class="field"><input id="brrCrr" type="number" step="0.0001" min="0" max="0.05" style="width:100%;border:0;background:transparent"></div>
              </div>
            </div>
            <p class="hint" id="crrInfo"></p>
            <div id="rimBlock" style="${showRoad ? "" : "display:none"}">
              <label class="lab">${t("lRim")}</label>
              ${chips("rim", "rim", ["low", "mid", "aero", "deep"], {
                low: t("rim_low"),
                mid: t("rim_mid"),
                aero: t("rim_aero"),
                deep: t("rim_deep"),
              })}
              <p class="hint">${t("rimHint")}</p>
            </div>
            <label class="lab" for="wheels">${t("lWheelKg")}</label>
            ${numInput("wheels", "wheelG", 800, 3200, 10, t("g"))}
            <p class="hint">${t("wheelHint")}</p>
            <div id="sizeBlock" style="${showWheels ? "" : "display:none"}">
              <label class="lab">${t("lWheelSize")}</label>
              ${chips(
                "wsize",
                "wheelInch",
                WHEELS[state.disc] || [700],
                Object.fromEntries((WHEELS[state.disc] || [700]).map((x) => [x, x === 700 ? "700c" : x + '"']))
              )}
            </div>
            <div id="susBlock" style="${showSus ? "" : "display:none"}">
              <label class="lab">${t("lSus")}</label>
              ${chips(
                "sus",
                "sus",
                state.disc === "dh" ? ["fs", "dh"] : state.disc === "dirt" ? ["rigid", "hardtail"] : ["rigid", "hardtail", "fs"],
                { rigid: t("sus_rigid"), hardtail: t("sus_hardtail"), fs: t("sus_fs"), dh: t("sus_dh") }
              )}
              <p class="hint">${t("susHint")}</p>
            </div>
            <div id="bmxBlock" style="${showBmx ? "" : "display:none"}">
              <label class="lab">${t("lBmx")}</label>
              ${chips("bmxMode", "bmxMode", ["park", "race", "dirt"], {
                park: t("bmx_park"),
                race: t("bmx_race"),
                dirt: t("bmx_dirt"),
              })}
            </div>
            <label class="lab">${t("lPos")}</label>
            ${chips(
              "pos",
              "pos",
              posList,
              Object.fromEntries(posList.map((x) => [x, t("pos." + x)]))
            )}
            <p class="hint">${t("posHint")}</p>
            <div id="lowBlock">
              <label class="lab" for="low">${t("lLow")}</label>
              ${numInput("low", "lowPct", 0, 80, 1, "%")}
              <p class="hint">${t("lowHint")}</p>
            </div>
          </div>

          <div class="block">
            <div class="kicker">${t("step3")}</div>
            <h2>${t("step3h")}</h2>
            <div class="tereny" id="tereny">
              <button type="button" class="teren${state.terrain === "flat" ? " on" : ""}" data-t="flat">
                <svg viewBox="0 0 120 44"><path d="M4 28 h112"/></svg>${t("ter_flat")}
              </button>
              <button type="button" class="teren${state.terrain === "mixed" ? " on" : ""}" data-t="mixed">
                <svg viewBox="0 0 120 44"><path d="M4 32 h28 l16 -12 h20 l16 12 h32"/></svg>${t("ter_mixed")}
              </button>
              <button type="button" class="teren${state.terrain === "mountains" ? " on" : ""}" data-t="mountains">
                <svg viewBox="0 0 120 44"><path d="M4 38 l22 -22 l12 10 l18 -18 l14 12 l16 -14 l30 32"/></svg>${t("ter_mountains")}
              </button>
            </div>
            <div class="gpx">
              <strong>${t("gpxH")}</strong>
              <p class="hint">${t("gpxP")}</p>
              <label class="btn">${t("gpxBtn")}<input class="hidden" type="file" id="gpxFile" accept=".gpx,.fit,.FIT,.GPX"></label>
              <button type="button" class="btn ghost" id="gpxClear">${t("gpxClear")}</button>
              <p class="hint" id="gpxSum"></p>
            </div>
            <label class="lab" for="pace">${t("lV")}</label>
            ${numInput("pace", "v", 10, 55, 0.5, t("kmh"))}
            <p class="hint">${t("vHint")}</p>
            <label class="lab">${t("lStyle")}</label>
            ${chips("style", "style", ["smooth", "normal", "choppy"], {
              smooth: t("style_smooth"),
              normal: t("style_normal"),
              choppy: t("style_choppy"),
            })}
            <p class="hint">${t("styleHint")}</p>
          </div>
        </form>

        <aside class="bill" id="bill"></aside>
      </div>
      ${state.embed ? "" : `<p class="foot">Bieżnik · model własny, stałe z literatury (Heil, Kyle, Wilson, BRR, SILCA/Anhalt).</p>`}
    `;

    bind();
    fillTires();
    refreshRoughChips();
    paint();
  }

  function refreshRoughChips() {
    const box = $("#rough");
    if (!box) return;
    const disc = state.disc || "szosa";
    const dict = I[state.lang] || I.pl;
    const labels = (dict.rough && dict.rough[disc]) || dict.rough.szosa;
    $all(".chip", box).forEach((b) => {
      b.textContent = labels[b.dataset.v] || b.dataset.v;
    });
  }

  function fillTires() {
    const list = $("#tireList");
    if (!list) return;
    const rows = Tires.forDisc(state.disc || "szosa");
    list.innerHTML = rows
      .map((o) => `<option value="${o.n}"></option>`)
      .join("");
  }

  function bindRange(id, key, digits, unit, dirty) {
    const el = $("#" + id);
    const val = $("#" + id + "Val");
    if (!el) return;
    el.addEventListener("input", () => {
      state[key] = +el.value;
      if (dirty) state.dirty[key] = true;
      if (val) val.textContent = fmt(state[key], digits) + " " + unit;
      if (key === "tireMm") {
        const inch = $("#tireInch");
        if (inch) inch.textContent = fmt(inchOf(state.tireMm), 2) + t("inch");
      }
      paint();
    });
  }

  function bindChips(id, key, coerce) {
    const box = $("#" + id);
    if (!box) return;
    box.addEventListener("click", (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      $all(".chip", box).forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      state[key] = coerce ? coerce(b.dataset.v) : b.dataset.v;
      state.dirty[key] = true;
      if (key === "tireClass") {
        state.tireCrr = null;
        state.tireName = "";
      }
      if (key === "bmxMode" && !state.dirty.tireMm) {
        state.tireMm = { park: 54, race: 44, dirt: 56 }[state.bmxMode] || 54;
        renderApp();
        return;
      }
      paint();
    });
  }

  function bind() {
    const langBox = $(".lang");
    if (langBox) {
      langBox.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        state.lang = b.dataset.lang;
        document.documentElement.lang = state.lang;
        try { localStorage.setItem("bieznik_lang", state.lang); } catch (_) {}
        renderApp();
      });
    }
    $("#plates").addEventListener("click", (e) => {
      const b = e.target.closest(".plate");
      if (!b) return;
      applyDisc(b.dataset.d, false);
      try { history.replaceState(null, "", "#" + b.dataset.d); } catch (_) {}
      renderApp();
    });
    bindRange("mass", "mass", 0, t("kg"), true);
    bindRange("lose", "lose", 1, t("kg"), true);
    bindRange("height", "height", 0, t("cm"), true);
    bindRange("bike", "bike", 1, t("kg"), true);
    bindRange("cargo", "cargo", 1, t("kg"), true);
    bindRange("tire", "tireMm", 0, t("mm"), true);
    bindRange("psi", "pressure", 1, t("bar"), true);
    bindRange("wheels", "wheelG", 0, t("g"), true);
    bindRange("low", "lowPct", 0, "%", true);
    bindRange("pace", "v", 1, t("kmh"), true);
    bindChips("rough", "rough");
    bindChips("setup", "setup");
    bindChips("klass", "tireClass");
    bindChips("rim", "rim");
    bindChips("wsize", "wheelInch", (v) => +v);
    bindChips("sus", "sus");
    bindChips("bmxMode", "bmxMode");
    bindChips("pos", "pos");
    bindChips("style", "style");
    $("#tereny").addEventListener("click", (e) => {
      const b = e.target.closest(".teren");
      if (!b) return;
      state.terrain = b.dataset.t;
      state.gpxTerrain = null;
      $all(".teren").forEach((x) => x.classList.toggle("on", x === b));
      paint();
    });
    const search = $("#tireSearch");
    search.addEventListener("change", () => pickTire(search.value));
    search.addEventListener("keydown", (e) => {
      if (e.key === "Enter") pickTire(search.value);
    });
    $("#brrW").addEventListener("input", () => manualCrr("w"));
    $("#brrCrr").addEventListener("input", () => manualCrr("crr"));
    $("#gpxFile").addEventListener("change", onFile);
    $("#gpxClear").addEventListener("click", () => {
      state.gpx = null;
      state.gpxTerrain = null;
      state.windHead = 0;
      state.windMeta = null;
      $("#gpxFile").value = "";
      paint();
    });
    const inch = $("#tireInch");
    if (inch) inch.textContent = fmt(inchOf(state.tireMm), 2) + t("inch");
  }

  function pickTire(name) {
    const rows = Tires.forDisc(state.disc || "szosa");
    const m = rows.find((o) => o.n.toLowerCase() === name.toLowerCase()) ||
      rows.find((o) => o.n.toLowerCase().includes(name.toLowerCase()));
    const info = $("#tireInfo");
    if (!m) {
      if (info) info.textContent = "";
      return;
    }
    state.tireCrr = m.crr;
    state.tireName = m.n;
    state.tireClass = m.klasa;
    if (info)
      info.textContent =
        "✓ " + m.n + " · Crr " + fmt(m.crr, 4) + " (bęben) — " + t("crrSet");
    paint();
  }

  function manualCrr(src) {
    const wEl = $("#brrW"),
      cEl = $("#brrCrr");
    let crr = null;
    if (src === "w" && wEl.value) {
      crr = +wEl.value / B.BRR_DIV;
      cEl.value = crr.toFixed(4);
    } else if (src === "crr" && cEl.value) {
      crr = +cEl.value;
      wEl.value = (crr * B.BRR_DIV).toFixed(1);
    }
    const info = $("#crrInfo");
    if (crr && crr > 0.0015 && crr < 0.04) {
      state.tireCrr = crr;
      state.tireName = state.lang === "pl" ? "opona wpisana ręcznie" : "tire entered by hand";
      if (info) info.textContent = "✓ Crr " + fmt(crr, 4) + " — " + t("crrSet");
    } else {
      if (info) info.textContent = "";
    }
    paint();
  }

  async function onFile(e) {
    const f = e.target.files && e.target.files[0];
    const sum = $("#gpxSum");
    if (!f) return;
    try {
      let g;
      if (/\.fit$/i.test(f.name)) {
        const buf = await f.arrayBuffer();
        g = Parse.parseFit(buf);
      } else {
        const text = await f.text();
        g = Parse.parseGpx(text);
      }
      if (!g) throw new Error("empty");
      state.gpx = g;
      state.gpxTerrain = g.terrain;
      if (sum)
        sum.textContent =
          t("gpxOk") +
          " · " +
          fmt(g.km, 1) +
          " km · +" +
          Math.round(g.gain) +
          " m";
      paint();
      if (g.start) {
        try {
          const w = await Parse.windAt(g.start.lat, g.start.lon, g.t0);
          if (w) {
            state.windHead = w.vRider * 0.25;
            state.windMeta = w;
            if (sum)
              sum.textContent +=
                " · " + t("windOk") + " " + fmt(w.vRider, 0) + " km/h";
            paint();
          }
        } catch (_) {}
      }
    } catch (err) {
      if (sum) sum.textContent = t("gpxFail");
    }
  }

  function paint() {
    const hero = $("#heroStack");
    const bill = $("#bill");
    if (!state.disc) {
      if (hero)
        hero.innerHTML = `<div class="stack-head">${t("result")}</div><p class="muted">${t("needDisc")}</p>`;
      if (bill)
        bill.innerHTML = `<div class="kicker">${t("result")}</div><h2>${t("resultH")}</h2><p class="muted">${t("needDisc")}</p>`;
      return;
    }
    const s = sNow();
    const R = B.compute(s);
    const parts = [
      { k: "roll", w: Math.max(0, R.roll), cls: "l-roll", lab: t("bRoll") },
      { k: "aero", w: Math.max(0, R.aero), cls: "l-aero", lab: t("bAero") },
      { k: "grav", w: Math.max(0, R.grav), cls: "l-grav", lab: t("bGrav") },
      { k: "surge", w: Math.max(0, R.zrywy), cls: "l-surge", lab: t("bSurge") },
      { k: "drv", w: Math.max(0, R.drv), cls: "l-drv", lab: t("bDrv") },
    ];
    const sumP = parts.reduce((a, b) => a + b.w, 0) || 1;
    if (hero) {
      hero.innerHTML = `<div class="stack-head">${t("d_" + state.disc)} · Crr ${fmt(R.crr, 4)} · CdA ${fmt(R.cda, 3)}</div>
        <div class="stack-tot">${fmt(R.total, 0)}<span>W</span></div>
        <div class="layers">${parts
          .map((p) => {
            const h = 18 + (p.w / sumP) * 90;
            return `<div class="layer ${p.cls}" style="height:${h}px"><span>${p.lab}</span><b>${fmt(p.w, 0)} W</b></div>`;
          })
          .join("")}</div>`;
    }

    const acts = B.actions(s, R);
    const train = B.trainingWatts(s);
    const gearW = acts.reduce((a, x) => a + Math.max(0, x.w), 0);
    const feel = B.wattsToFeel(R.wkg);
    const healthy = B.healthyMass(state.height);
    const pro = B.proMass(state.height);
    const minM = healthy.lo - 8;
    const maxM = healthy.hi + 18;
    const pct = (m) => ((m - minM) / (maxM - minM)) * 100;
    const drop = B.dropTarget(s);
    const rx = 18 + state.tireMm * 0.35;
    const ry = 8 + drop * 42;

    if (bill) {
      bill.innerHTML = `
        <div class="kicker">${t("result")}</div>
        <h2>${t("resultH")}</h2>
        <div class="tot"><b>${fmt(R.total, 0)}</b><i>W</i></div>
        <p class="hint">${state.disc === "dh" ? t("totHintDh") : t("totHint")} · ${fmt(R.wkg, 2)} W/kg${
          state.disc === "dh" && R.gravGift > 20
            ? " · " + t("gravGift") + " " + fmt(R.gravGift, 0) + " " + t("gravGift2")
            : ""
        }</p>
        <div class="bars">${parts
          .map((p) => {
            const w = (p.w / sumP) * 100;
            return `<div class="bar-row" data-k="${p.k}"><span>${p.lab}</span><div class="bar-track"><div class="bar-fill" style="width:${w}%"></div></div><b>${fmt(p.w, 0)}</b></div>`;
          })
          .join("")}</div>
        <h3>${t("psiH")}</h3>
        <div class="psi-grid">
          <div class="psi-card"><span>${t("psiF")}</span><b>${fmt(R.opt.front, 1)}</b> ${t("bar")} <span>${fmt(R.opt.front * 14.504, 0)} psi</span></div>
          <div class="psi-card"><span>${t("psiR")}</span><b>${fmt(R.opt.rear, 1)}</b> ${t("bar")} <span>${fmt(R.opt.rear * 14.504, 0)} psi</span></div>
        </div>
        <p class="hint">${t("psiRule")}</p>
        <h3>${t("patchH")}</h3>
        <p class="hint">${t("patchS")}</p>
        <div class="patch" aria-hidden="true">
          <svg viewBox="0 0 200 84">
            <ellipse cx="100" cy="42" rx="${rx}" ry="${ry}" fill="#2a241e" stroke="${getComputedStyle(document.documentElement).getPropertyValue("--tape") || "#ff4d1a"}" stroke-width="3"/>
            <text x="100" y="46" text-anchor="middle" fill="#f3eee3" font-size="10" font-family="Red Hat Mono, monospace">${fmt(state.tireMm, 0)} mm · ${fmt(drop * 100, 0)}% drop</text>
          </svg>
        </div>
        <h3>${t("doH")}</h3>
        <p class="hint">${t("doSub")}</p>
        ${
          acts.length
            ? acts
                .map(
                  (a) =>
                    `<div class="act"><span>${t("act_" + a.id)}</span><span class="w">−${fmt(a.w, 1)} W</span><span class="c">${a.cost ? (state.lang === "en" ? "$" + a.cost : a.cost + " zł") : t("free")}</span></div>`
                )
                .join("")
            : `<p class="hint">—</p>`
        }
        <h3>${t("engineH")}</h3>
        <p class="hint">${t("engineS")}</p>
        <p class="muted">${t("engineP")}</p>
        <label class="lab">${t("lForma")}</label>
        ${chips("forma", "forma", ["start", "fun", "regular", "plan", "race"], {
          start: t("forma_start"),
          fun: t("forma_fun"),
          regular: t("forma_regular"),
          plan: t("forma_plan"),
          race: t("forma_race"),
        })}
        <div class="compare">
          <div class="cmp"><span>${t("gearLab")}</span><b>−${fmt(gearW, 0)} W</b></div>
          <div class="cmp good"><span>${t("trainLab")}</span><b>+${fmt(train, 0)} W</b><span>${t("trainCost")}</span></div>
        </div>
        <p class="hint">${t("engineNote")}</p>
        <p class="muted">${t("engineRule")}</p>
        <h3>${t("scaleH")}</h3>
        <div class="scale">
          <div class="healthy" style="left:${pct(healthy.lo)}%;width:${pct(healthy.hi) - pct(healthy.lo)}%"></div>
          <div class="pro" style="left:${pct(pro.lo)}%;width:${pct(pro.hi) - pct(pro.lo)}%"></div>
          <div class="you" style="left:${pct(state.mass)}%"></div>
        </div>
        <div class="scale-labs"><span>${t("scaleHealthy")}</span><span>${t("scaleYou")} ${fmt(state.mass, 0)} kg</span><span>${t("scalePro")}</span></div>
        <p class="hint">${t("scaleP")}</p>
        <h3>${t("feelH")}</h3>
        <p class="hint">${t("feelS")}</p>
        <p class="muted">${t("feelP")}</p>
        <p class="hint">${t("feelSpeed")}</p>
        <div class="feel-num">${fmt(R.vEq, 1)} ${t("kmh")}</div>
        <p>${t("feelNow")} <b>${fmt(R.wkg, 2)} W/kg</b> — ${t("feelMap." + feel)}</p>
        <details class="assum">
          <summary>${t("assumH")}</summary>
          <div class="body">
            <p>${t("assumP")}</p>
            <p style="margin-top:8px">
              P = F·v. Toczenie: Crr·m·g·v. Aero: ½ρ·CdA·v³.
              Crr bębnowe × mnożnik nawierzchni
              (szosa 1,06–1,42 · gravel 1,35–2,55 · MTB 1,9–3,7 · DH 2,1–3,9 · dirt 1,7–3,1 · BMX 1,12–1,85).
              Cd = ${fmt(B.CD0, 2)}.
              Pozycje: ${Object.entries(B.POS_MUL)
                .map(([k, v]) => k + " ×" + fmt(v, 2))
                .join(" · ")}.
              Koła ΔCdA: 35 mm −0,003 · 50 mm −0,008 · 60+ −0,012.
              Setup: butyl +0,00045 Crr (gravel/MTB więcej).
              Ciśnienie z geometrii odcisku (drop ${fmt(drop * 100, 0)}%).
              Napęd η ${fmt(R.eta * 100, 1)}%.
              ρ = 1,225 kg/m³.
            </p>
          </div>
        </details>
      `;
      const formaBox = $("#forma");
      if (formaBox) {
        formaBox.onclick = (e) => {
          const b = e.target.closest(".chip");
          if (!b) return;
          $all(".chip", formaBox).forEach((x) => x.classList.remove("on"));
          b.classList.add("on");
          state.forma = b.dataset.v;
          paint();
        };
      }
    }
  }

  const pageLang = (document.documentElement.lang || "pl").toLowerCase();
  state.embed = document.getElementById("app")?.dataset.embed === "1";
  if (pageLang.startsWith("uk") || pageLang.startsWith("ua")) state.lang = "uk";
  else if (pageLang.startsWith("en")) state.lang = "en";
  else state.lang = "pl";
  const boot = (location.hash || "").replace("#", "").toLowerCase();
  if (B.DISC[boot]) applyDisc(boot, true);
  renderApp();
  window.addEventListener("hashchange", () => {
    const id = (location.hash || "").replace("#", "").toLowerCase();
    if (B.DISC[id]) {
      applyDisc(id, true);
      renderApp();
    }
  });
})();
