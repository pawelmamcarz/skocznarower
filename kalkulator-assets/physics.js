/* Bieżnik — model oporów. Wzory z mechaniki jazdy (Wilson, Kyle, Heil),
   Crr z testów bębnowych (BRR: 29 km/h, 42,5 kg), ciśnienie z geometrii
   odcisku opony (drop 10–20%). Stałe i założenia są wypisane w UI. */
(function (root) {
  const G = 9.80665;
  const RHO = 1.225;
  const BRR_DIV = 42.5 * G * (29 / 3.6); // W → Crr

  const DISC = {
    szosa: {
      id: "szosa",
      bike: 7.8,
      cargo: 1.2,
      tireMm: 28,
      v: 32,
      wheelG: 1550,
      rim: "mid",
      pos: "hoods",
      lowPct: 30,
      terrain: "flat",
      rough: "smooth",
      setup: "tubeless",
      tireClass: "race",
      wheelInch: 700,
      sus: "rigid",
      bikeArea: 0.072,
      eta: 0.972,
      frontShare: 0.45,
    },
    gravel: {
      id: "gravel",
      bike: 9.2,
      cargo: 2.4,
      tireMm: 42,
      v: 26,
      wheelG: 1750,
      rim: "low",
      pos: "hoods",
      lowPct: 18,
      terrain: "mixed",
      rough: "medium",
      setup: "tubeless",
      tireClass: "allround",
      wheelInch: 700,
      sus: "rigid",
      bikeArea: 0.082,
      eta: 0.965,
      frontShare: 0.43,
    },
    mtb: {
      id: "mtb",
      bike: 12.8,
      cargo: 1.4,
      tireMm: 58,
      v: 16,
      wheelG: 2100,
      rim: "low",
      pos: "seated",
      lowPct: 22,
      terrain: "mixed",
      rough: "medium",
      setup: "tubeless",
      tireClass: "allround",
      wheelInch: 29,
      sus: "fs",
      bikeArea: 0.105,
      eta: 0.948,
      frontShare: 0.4,
    },
    dh: {
      id: "dh",
      bike: 16.8,
      cargo: 0.4,
      tireMm: 64,
      v: 32,
      wheelG: 2500,
      rim: "low",
      pos: "attack",
      lowPct: 35,
      terrain: "mountains",
      rough: "medium",
      setup: "insert",
      tireClass: "knobby",
      wheelInch: 29,
      sus: "dh",
      bikeArea: 0.125,
      eta: 0.935,
      frontShare: 0.46,
    },
    dirt: {
      id: "dirt",
      bike: 12.2,
      cargo: 0,
      tireMm: 56,
      v: 22,
      wheelG: 2200,
      rim: "low",
      pos: "stand",
      lowPct: 0,
      terrain: "flat",
      rough: "medium",
      setup: "tubeless",
      tireClass: "park",
      wheelInch: 26,
      sus: "hardtail",
      bikeArea: 0.1,
      eta: 0.97,
      frontShare: 0.48,
    },
    bmx: {
      id: "bmx",
      bike: 10.4,
      cargo: 0,
      tireMm: 54,
      v: 20,
      wheelG: 1750,
      rim: "low",
      pos: "stand",
      lowPct: 0,
      terrain: "flat",
      rough: "smooth",
      setup: "butyl",
      tireClass: "park",
      wheelInch: 20,
      sus: "rigid",
      bikeArea: 0.09,
      eta: 0.978,
      frontShare: 0.49,
      bmxMode: "park",
    },
  };

  const CRR_CLASS = {
    szosa: { race: 0.0034, allround: 0.0046, knobby: 0.0074, park: 0.0068 },
    gravel: { race: 0.0064, allround: 0.0088, knobby: 0.0116, park: 0.0105 },
    mtb: { race: 0.0062, allround: 0.0084, knobby: 0.0118, park: 0.0095 },
    dh: { race: 0.0095, allround: 0.0115, knobby: 0.0138, park: 0.012 },
    dirt: { race: 0.0075, allround: 0.009, knobby: 0.011, park: 0.0082 },
    bmx: { race: 0.0055, allround: 0.0072, knobby: 0.0095, park: 0.0068 },
  };

  const SETUP_CRR = {
    tubeless: 0,
    latex: 0.00005,
    butyl: 0.00045,
    insert: 0.00025,
  };

  const SURFACE_MULT = {
    szosa: { smooth: 1.06, medium: 1.2, rough: 1.42 },
    gravel: { smooth: 1.35, medium: 1.85, rough: 2.55 },
    mtb: { smooth: 1.7, medium: 2.4, rough: 3.3 },
    dh: { smooth: 1.55, medium: 2.15, rough: 2.9 },
    dirt: { smooth: 1.7, medium: 2.35, rough: 3.1 },
    bmx: { smooth: 1.12, medium: 1.35, rough: 1.85 },
  };

  const WHEEL_ROUGH = { 20: 1.16, 26: 1.07, 27.5: 1.025, 29: 1, 700: 1 };

  const POS_MUL = {
    tops: 1.0,
    hoods: 0.82,
    drops: 0.76,
    elbows: 0.72,
    seated: 1.08,
    seated_low: 0.96,
    standing: 1.22,
    attack: 0.94,
    tuck: 0.7,
    stand: 1.18,
    pump: 1.05,
  };

  const LOWER_POS = {
    tops: "hoods",
    hoods: "elbows",
    drops: "elbows",
    elbows: "elbows",
    seated: "seated_low",
    seated_low: "seated_low",
    standing: "seated_low",
    attack: "tuck",
    tuck: "tuck",
    stand: "pump",
    pump: "pump",
  };

  const RIM_D_CDA = { low: 0, mid: 0.0032, aero: 0.008, deep: 0.0125 };

  const TERRAIN = {
    flat: { climbShare: 0.03, climbGrade: 0.02, descShare: 0.03, descGrade: -0.02 },
    mixed: { climbShare: 0.16, climbGrade: 0.045, descShare: 0.15, descGrade: -0.045 },
    mountains: { climbShare: 0.3, climbGrade: 0.065, descShare: 0.28, descGrade: -0.075 },
  };

  const STYLE = {
    smooth: { n: 10, frac: 0.18 },
    normal: { n: 28, frac: 0.36 },
    choppy: { n: 62, frac: 0.7 },
  };

  const STYLE_DISC = {
    dirt: { n: 88, frac: 0.55 },
    bmx: { n: 96, frac: 0.62 },
    dh: { n: 22, frac: 0.45 },
  };

  const FORMA = {
    start: { gain: 0.8, label: "start" },
    fun: { gain: 0.42, label: "fun" },
    regular: { gain: 0.22, label: "regular" },
    plan: { gain: 0.11, label: "plan" },
    race: { gain: 0.04, label: "race" },
  };

  const CD0 = 0.71;

  function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
  }

  function bsa(mass, heightCm) {
    return 0.007184 * Math.pow(mass, 0.425) * Math.pow(heightCm, 0.725);
  }

  function bodyArea(mass, heightCm) {
    return 0.248 * bsa(mass, heightCm);
  }

  function wheelKey(inch) {
    if (inch <= 22) return 20;
    if (inch <= 26.4) return 26;
    if (inch < 28.2) return 27.5;
    if (inch < 100) return 29;
    return 700;
  }

  function crrOf(s) {
    const disc = s.disc;
    let base =
      s.tireCrr != null
        ? s.tireCrr
        : (CRR_CLASS[disc] || CRR_CLASS.szosa)[s.tireClass] || CRR_CLASS.szosa.allround;
    base += SETUP_CRR[s.setup] || 0;
    if (s.setup === "butyl" && (disc === "gravel" || disc === "mtb" || disc === "dirt")) {
      base += 0.00035;
    }
    const surf = (SURFACE_MULT[disc] || SURFACE_MULT.szosa)[s.rough] || 1.2;
    let wheelF = WHEEL_ROUGH[wheelKey(s.wheelInch)] || 1;
    if (s.rough === "smooth") wheelF = 1 + (wheelF - 1) * 0.15;
    let crr = base * surf * wheelF;
    if (s.bmxMode === "dirt" && disc === "bmx") crr *= 1.55;
    if (s.bmxMode === "race" && disc === "bmx") crr *= 0.88;
    return crr;
  }

  function cdaOf(s) {
    const A = bodyArea(s.mass, s.height) + (DISC[s.disc] || DISC.szosa).bikeArea;
    const mul0 = POS_MUL[s.pos] || 1;
    const mul1 = POS_MUL[LOWER_POS[s.pos] || s.pos] || mul0;
    const t = clamp((s.lowPct || 0) / 100, 0, 0.9);
    let cda = CD0 * A * (mul0 * (1 - t) + mul1 * t);
    if (s.disc === "szosa" || s.disc === "gravel") {
      let d = RIM_D_CDA[s.rim] || 0;
      if (s.tireMm > 35 && s.rim !== "low") d *= clamp(1 - (s.tireMm - 35) / 40, 0.25, 1);
      cda -= d;
    } else {
      cda += Math.max(0, (s.tireMm - 32) * 0.00022);
    }
    if (s.disc === "bmx" && s.bmxMode === "race") cda *= 0.9;
    return Math.max(0.18, cda);
  }

  function rotationalMass(s) {
    const wheels = (s.wheelG || 1700) / 1000;
    const tireG = (s.tireMm * (s.disc === "szosa" ? 6.2 : s.disc === "gravel" ? 8.4 : 11.5) * 2) / 1000;
    return wheels * 0.48 + tireG * 0.85;
  }

  function dropTarget(s) {
    let d = { smooth: 0.1, medium: 0.14, rough: 0.185 }[s.rough] || 0.14;
    if (s.disc === "dh" || s.disc === "mtb") d += 0.02;
    if (s.disc === "dirt" || s.disc === "bmx") d -= 0.03;
    if (s.setup === "insert") d += 0.02;
    if (s.bmxMode === "race") d = 0.08;
    return clamp(d, 0.07, 0.26);
  }

  function beadMm(s) {
    const w = wheelKey(s.wheelInch);
    if (w === 20) return 406;
    if (w === 26) return 559;
    if (w === 27.5) return 584;
    if (w === 29 || w === 700) return 622;
    return 622;
  }

  function pressureForLoad(loadKg, s) {
    const drop = dropTarget(s);
    const width = Math.max(18, s.tireMm);
    const R = beadMm(s) / 2 + width;
    const h = drop * width;
    const patchLen = 2 * Math.sqrt(Math.max(R * h - h * h, 4));
    const shape = 0.48;
    const areaM2 = (width * patchLen * shape) / 1e6;
    let bar = (loadKg * G) / areaM2 / 1e5;
    if (s.setup === "tubeless") bar *= 0.94;
    if (s.setup === "latex") bar *= 0.97;
    if (s.setup === "butyl") bar *= 1.07;
    if (s.setup === "insert") bar *= 0.86;
    if (s.disc === "dirt") bar *= 1.22;
    if (s.disc === "bmx" && s.bmxMode !== "race") bar *= 1.18;
    if (s.disc === "bmx" && s.bmxMode === "race") bar *= 1.55;
    const maxBar =
      width < 30 ? 8.5 : width < 40 ? 6.5 : width < 50 ? 4.5 : width < 60 ? 2.8 : 2.4;
    const minBar =
      width < 32 ? 3.4 : width < 45 ? 1.8 : width < 55 ? 1.25 : s.disc === "dh" ? 1.15 : 1.05;
    return clamp(bar, minBar, maxBar);
  }

  function optimalPressure(s) {
    const mTot = systemMass(s);
    const share = (DISC[s.disc] || DISC.szosa).frontShare;
    const front = pressureForLoad(mTot * share, s);
    const rear = pressureForLoad(mTot * (1 - share), s);
    return { front, rear, avg: (front + rear) / 2 };
  }

  function systemMass(s) {
    return s.mass + s.bike + s.cargo - (s.lose || 0);
  }

  function pressurePenalty(s, opt) {
    if (!s.pressure || s.pressure <= 0) return 0;
    const d = s.pressure - opt.avg;
    const roughK = { smooth: 0.85, medium: 1, rough: 1.45 }[s.rough] || 1;
    if (d > 0) return d * 9 * roughK;
    return Math.abs(d) * 1.7 * roughK;
  }

  function flatPowers(mTot, cda, vKmh, crr, vWind) {
    const v = vKmh / 3.6;
    const va = v + (vWind || 0) / 3.6;
    return {
      roll: crr * mTot * G * v,
      aero: 0.5 * RHO * cda * va * va * va,
      v,
    };
  }

  function powerAtSpeed(mTot, cda, crr, vKmh, grade, vWind) {
    const v = vKmh / 3.6;
    const va = v + (vWind || 0) / 3.6;
    const s = Math.sin(Math.atan(grade));
    const c = Math.cos(Math.atan(grade));
    return mTot * G * (crr * c + s) * v + 0.5 * RHO * cda * va * va * va;
  }

  function speedFromPower(mTot, cda, crr, pWheel, grade, vWind) {
    let lo = 0.3,
      hi = 45;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const p = powerAtSpeed(mTot, cda, crr, mid * 3.6, grade, vWind);
      if (p > pWheel) hi = mid;
      else lo = mid;
    }
    return ((lo + hi) / 2) * 3.6;
  }

  function surgePower(s, mTot, vKmh) {
    const v = vKmh / 3.6;
    const st = STYLE_DISC[s.disc] || STYLE[s.style] || STYLE.normal;
    const n = s.disc === "dirt" || s.disc === "bmx" || s.disc === "dh" ? st.n : (STYLE[s.style] || STYLE.normal).n;
    const frac = s.disc === "dirt" || s.disc === "bmx" || s.disc === "dh" ? st.frac : (STYLE[s.style] || STYLE.normal).frac;
    const v0 = v * (1 - frac);
    const mEff = mTot + rotationalMass(s);
    const E = 0.5 * mEff * (v * v - v0 * v0);
    return (E * n) / 3600;
  }

  function susPower(s, mTot, vKmh) {
    if (s.sus === "rigid") return 0;
    const kRough = { smooth: 0.15, medium: 0.7, rough: 1.6 }[s.rough] || 0.7;
    const kSus = { hardtail: 0.7, fs: 1, dh: 1.25 }[s.sus] || 0.8;
    return kRough * kSus * (mTot / 100) * (vKmh / 3.6) * 1.1;
  }

  function compute(s) {
    const disc = DISC[s.disc] ? s.disc : "szosa";
    s = { ...DISC[disc], ...s, disc };
    const mTot = systemMass(s);
    const crr = crrOf(s);
    const cda = cdaOf(s);
    const opt = optimalPressure(s);
    const kara = pressurePenalty(s, opt);
    const vW = s.windHead || 0;

    const flat = flatPowers(mTot, cda, s.v, crr, vW);
    const pSus = susPower(s, mTot, s.v);
    const pZryw = surgePower(s, mTot, s.v);
    const pKoloFlat = flat.roll + flat.aero + pSus + pZryw + kara;

    let ter = s.gpxTerrain || TERRAIN[s.terrain] || TERRAIN.flat;
    if (disc === "dh" && !s.gpxTerrain) {
      ter = { climbShare: 0.08, climbGrade: 0.08, descShare: 0.78, descGrade: -0.1 };
    }
    const climbShare = ter.climbShare;
    const descShare = ter.descShare;
    const flatShare = Math.max(0, 1 - climbShare - descShare);

    const vClimb = speedFromPower(mTot, cda, crr, pKoloFlat, ter.climbGrade, vW);
    const climb = {
      v: vClimb,
      grav: mTot * G * Math.sin(Math.atan(ter.climbGrade)) * (vClimb / 3.6),
      roll: crr * mTot * G * Math.cos(Math.atan(ter.climbGrade)) * (vClimb / 3.6),
      aero: 0.5 * RHO * cda * Math.pow(vClimb / 3.6 + vW / 3.6, 3),
    };

    const vDescWant = s.v * (disc === "dh" ? 1 : 1.15);
    const pDescNeed = powerAtSpeed(mTot, cda, crr, vDescWant, ter.descGrade, vW);
    let descBrake = 0;
    let descPedal = 0;
    let descGrav = mTot * G * Math.sin(Math.atan(ter.descGrade)) * (vDescWant / 3.6);
    let descRoll = crr * mTot * G * Math.cos(Math.atan(ter.descGrade)) * (vDescWant / 3.6);
    let descAero = 0.5 * RHO * cda * Math.pow(vDescWant / 3.6 + vW / 3.6, 3);
    if (pDescNeed < 0) {
      descBrake = -pDescNeed;
      descPedal = 0;
    } else {
      descPedal = Math.min(pDescNeed, pKoloFlat);
    }

    const roll = flat.roll * flatShare + climb.roll * climbShare + descRoll * descShare;
    const aero = flat.aero * flatShare + climb.aero * climbShare + descAero * descShare;
    const grav = climb.grav * climbShare;
    const gravGift = Math.abs(Math.min(0, descGrav)) * descShare;
    const brakeW = descBrake * descShare;
    const zrywy = pZryw + pSus + kara + (disc === "dh" ? 0 : brakeW * 0.7);
    const pKolo = Math.max(0, roll + aero + grav + zrywy);
    const eta = DISC[disc].eta;
    const drv = pKolo * (1 / eta - 1);
    const total = pKolo + drv;

    const vEq = speedFromPower(mTot, cda, crr, pKolo, 0, 0);
    const wkg = total / Math.max(s.mass, 40);

    return {
      roll,
      aero,
      grav,
      zrywy,
      drv,
      total,
      pKolo,
      crr,
      cda,
      mTot,
      opt,
      kara,
      eta,
      vEq,
      wkg,
      vClimb,
      climbShare,
      descShare,
      descBrake,
      gravGift,
      ter,
      pSus,
      rotational: rotationalMass(s),
    };
  }

  function wattsToFeel(wkg) {
    if (wkg < 1.2) return "recovery";
    if (wkg < 1.8) return "endurance";
    if (wkg < 2.5) return "tempo";
    if (wkg < 3.3) return "threshold";
    if (wkg < 4.2) return "vo2";
    return "anaerobic";
  }

  function healthyMass(heightCm) {
    const m = heightCm / 100;
    return { lo: 18.5 * m * m, hi: 24.9 * m * m };
  }

  function proMass(heightCm) {
    const m = heightCm / 100;
    return { lo: 19.2 * m * m, hi: 22.4 * m * m };
  }

  function actions(s, R) {
    const out = [];
    const disc = s.disc;
    const push = (id, w, cost, note) => {
      if (w > 0.6) out.push({ id, w, cost, note });
    };

    if (s.lose > 0.2) {
      const s2 = { ...s, lose: 0 };
      const r0 = compute(s2);
      push("lose", r0.total - R.total, 0, "lose");
    }

    if (s.pos === "tops" || s.pos === "seated" || s.pos === "stand") {
      const next = { tops: "elbows", seated: "seated_low", stand: "pump" }[s.pos];
      const r2 = compute({ ...s, pos: next, lowPct: Math.max(s.lowPct, 40) });
      push("pos", R.total - r2.total, 0, "pos");
    } else if ((s.lowPct || 0) < 40 && LOWER_POS[s.pos] !== s.pos) {
      const r2 = compute({ ...s, lowPct: 45 });
      push("low", R.total - r2.total, 0, "low");
    }

    const faster = { knobby: "allround", park: "race", allround: "race" };
    if (faster[s.tireClass] && s.tireCrr == null) {
      const r2 = compute({ ...s, tireClass: faster[s.tireClass] });
      push("tire", R.total - r2.total, s.tireClass === "allround" ? 220 : 180, "tire");
    }

    if (s.setup === "butyl") {
      const r2 = compute({ ...s, setup: "tubeless" });
      push("tl", R.total - r2.total, 80, "tl");
    }

    if ((disc === "szosa" || disc === "gravel") && s.rim !== "deep") {
      const next = { low: "aero", mid: "deep", aero: "deep" }[s.rim];
      const r2 = compute({ ...s, rim: next });
      push("rim", R.total - r2.total, 900, "rim");
    }

    if (s.wheelG > 1400) {
      const target = disc === "szosa" ? 1250 : disc === "gravel" ? 1450 : 1750;
      if (s.wheelG > target + 80) {
        const r2 = compute({ ...s, wheelG: target });
        push("wheels", R.total - r2.total, 700, "wheels");
      }
    }

    if (s.pressure > 0 && R.kara > 1) {
      push("psi", R.kara, 0, "psi");
    }

    if (s.bike > DISC[disc].bike + 1.2) {
      const r2 = compute({ ...s, bike: DISC[disc].bike });
      push("bikekg", R.total - r2.total, 2500, "bikekg");
    }

    out.sort((a, b) => b.w - a.w);
    return out;
  }

  function trainingWatts(s) {
    const g = (FORMA[s.forma] || FORMA.fun).gain;
    return g * s.mass;
  }

  root.Bieznik = {
    G,
    RHO,
    BRR_DIV,
    DISC,
    CRR_CLASS,
    SETUP_CRR,
    SURFACE_MULT,
    POS_MUL,
    LOWER_POS,
    RIM_D_CDA,
    TERRAIN,
    STYLE,
    FORMA,
    CD0,
    compute,
    crrOf,
    cdaOf,
    optimalPressure,
    speedFromPower,
    wattsToFeel,
    healthyMass,
    proMass,
    actions,
    trainingWatts,
    systemMass,
    bodyArea,
    clamp,
    dropTarget,
  };
})(typeof window !== "undefined" ? window : globalThis);
