/* GPX + uproszczony FIT. Plik zostaje w przeglądarce.
   Do wiatru idą tylko start (lat,lon) i data — Open-Meteo. */
(function (root) {
  function hav(a, b) {
    const R = 6371000;
    const p = Math.PI / 180;
    const dLat = (b.lat - a.lat) * p;
    const dLon = (b.lon - a.lon) * p;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function summarize(pts) {
    if (!pts || pts.length < 8) return null;
    let dist = 0,
      gain = 0,
      loss = 0;
    const grades = [];
    for (let i = 1; i < pts.length; i++) {
      const d = hav(pts[i - 1], pts[i]);
      if (!isFinite(d) || d > 400) continue;
      dist += d;
      const e0 = pts[i - 1].ele,
        e1 = pts[i].ele;
      if (e0 != null && e1 != null && d > 2) {
        const de = e1 - e0;
        if (de > 0.3) gain += de;
        if (de < -0.3) loss += -de;
        grades.push({ d, g: de / d });
      }
    }
    if (dist < 200) return null;
    let climbD = 0,
      descD = 0,
      climbG = 0,
      descG = 0;
    for (const x of grades) {
      if (x.g > 0.015) {
        climbD += x.d;
        climbG += x.g * x.d;
      } else if (x.g < -0.015) {
        descD += x.d;
        descG += x.g * x.d;
      }
    }
    const climbShare = climbD / dist;
    const descShare = descD / dist;
    return {
      km: dist / 1000,
      gain,
      loss,
      n: pts.length,
      start: { lat: pts[0].lat, lon: pts[0].lon },
      t0: pts[0].t || null,
      terrain: {
        climbShare: Math.min(0.55, climbShare),
        climbGrade: climbD ? climbG / climbD : 0.04,
        descShare: Math.min(0.55, descShare),
        descGrade: descD ? descG / descD : -0.04,
      },
    };
  }

  function parseGpx(text) {
    const doc = new DOMParser().parseFromString(text, "text/xml");
    const nodes = [...doc.getElementsByTagName("trkpt"), ...doc.getElementsByTagName("rtept")];
    const pts = [];
    for (const n of nodes) {
      const lat = parseFloat(n.getAttribute("lat"));
      const lon = parseFloat(n.getAttribute("lon"));
      if (!isFinite(lat) || !isFinite(lon)) continue;
      const eleEl = n.getElementsByTagName("ele")[0];
      const timeEl = n.getElementsByTagName("time")[0];
      pts.push({
        lat,
        lon,
        ele: eleEl ? parseFloat(eleEl.textContent) : null,
        t: timeEl ? timeEl.textContent : null,
      });
    }
    return summarize(pts);
  }

  function u16(dv, i, le) {
    return dv.getUint16(i, le);
  }
  function u32(dv, i, le) {
    return dv.getUint32(i, le);
  }
  function i32(dv, i, le) {
    return dv.getInt32(i, le);
  }
  function u8(dv, i) {
    return dv.getUint8(i);
  }

  function parseFit(buf) {
    const dv = new DataView(buf);
    if (dv.byteLength < 14) throw new Error("FIT za krótki");
    const hSize = u8(dv, 0);
    const dataSize = u32(dv, 4, true);
    const tag = String.fromCharCode(u8(dv, 8), u8(dv, 9), u8(dv, 10), u8(dv, 11));
    if (tag !== ".FIT") throw new Error("to nie jest FIT");
    const defs = {};
    const pts = [];
    let i = hSize;
    const end = Math.min(dv.byteLength - 2, hSize + dataSize);
    const SEMI = 180 / 2147483648;

    while (i < end) {
      const hdr = u8(dv, i);
      i += 1;
      if (hdr & 0x40) {
        const local = hdr & 0x0f;
        i += 1;
        const localMsg = u16(dv, i, true);
        i += 2;
        i += 1;
        const nFields = u8(dv, i);
        i += 1;
        const fields = [];
        for (let f = 0; f < nFields; f++) {
          fields.push({ num: u8(dv, i), size: u8(dv, i + 1), base: u8(dv, i + 2) });
          i += 3;
        }
        if (hdr & 0x20) {
          const nDev = u8(dv, i);
          i += 1;
          i += nDev * 3;
        }
        defs[local] = { global: localMsg, fields };
      } else {
        const local = hdr & 0x0f;
        const def = defs[local];
        if (!def) break;
        let lat = null,
          lon = null,
          ele = null,
          t = null;
        for (const f of def.fields) {
          if (i + f.size > end) {
            i = end;
            break;
          }
          if (def.global === 20) {
            if (f.num === 0 && f.size === 4) lat = i32(dv, i, true) * SEMI;
            if (f.num === 1 && f.size === 4) lon = i32(dv, i, true) * SEMI;
            if (f.num === 2 && f.size === 2) {
              const raw = u16(dv, i, true);
              if (raw !== 0xffff) ele = raw / 5 - 500;
            }
            if (f.num === 253 && f.size === 4) {
              const ts = u32(dv, i, true);
              t = new Date((ts + 631065600) * 1000).toISOString();
            }
          }
          i += f.size;
        }
        if (lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
          pts.push({ lat, lon, ele, t });
        }
      }
    }
    return summarize(pts);
  }

  async function windAt(lat, lon, iso) {
    const day = (iso ? iso.slice(0, 10) : new Date().toISOString().slice(0, 10));
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}` +
      `&longitude=${lon.toFixed(4)}&hourly=wind_speed_10m,wind_direction_10m` +
      `&wind_speed_unit=kmh&timezone=auto&start_date=${day}&end_date=${day}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error("pogoda " + r.status);
    const j = await r.json();
    const sp = j.hourly && j.hourly.wind_speed_10m;
    const dir = j.hourly && j.hourly.wind_direction_10m;
    if (!sp || !sp.length) return null;
    const hour = iso && iso.length >= 13 ? parseInt(iso.slice(11, 13), 10) : 12;
    const idx = Math.min(sp.length - 1, isFinite(hour) ? hour : 12);
    const v10 = sp[idx];
    const vRider = v10 * Math.pow(1.5 / 10, 0.14);
    return { v10, vRider, dir: dir[idx], day };
  }

  function headingMean(pts) {
    if (!pts || pts.length < 4) return 0;
    let x = 0,
      y = 0,
      n = 0;
    for (let i = 1; i < pts.length; i += Math.ceil(pts.length / 40)) {
      const a = pts[i - 1],
        b = pts[i];
      const dLon = ((b.lon - a.lon) * Math.PI) / 180;
      const la1 = (a.lat * Math.PI) / 180,
        la2 = (b.lat * Math.PI) / 180;
      const br = Math.atan2(
        Math.sin(dLon) * Math.cos(la2),
        Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon)
      );
      x += Math.cos(br);
      y += Math.sin(br);
      n++;
    }
    if (!n) return 0;
    let deg = (Math.atan2(y, x) * 180) / Math.PI;
    return (deg + 360) % 360;
  }

  root.BieznikParse = { parseGpx, parseFit, windAt, hav, headingMean, summarize };
})(typeof window !== "undefined" ? window : globalThis);
