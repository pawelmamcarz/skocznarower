// skocznarower.pl Worker
// - apex -> www 301
// - /api/availability, /api/bookings (publiczne)
// - /admin* (zalogowany)
// - reszta -> ASSETS

const SERVICES = [
  { id: 'odbior',               name: 'Odbiór i odwóz roweru (adres podaj w notatce)', price: 'od 50 zł' },
  { id: 'przeglad-podstawowy',  name: 'Przegląd podstawowy',                       price: 'od 150 zł' },
  { id: 'przeglad-kompleksowy', name: 'Przegląd kompleksowy',                      price: 'od 340 zł' },
  { id: 'regulacja',            name: 'Regulacja (hamulce / przerzutki)',          price: 'od 40 zł' },
  { id: 'bleeding',             name: 'Bleeding hamulców hydraulicznych',          price: 'od 100 zł' },
  { id: 'wymiana-czesci',       name: 'Wymiana części (klocki, linki, dętka...)',  price: 'od 35 zł + część' },
  { id: 'kolo-centrowanie',     name: 'Centrowanie koła',                          price: 'od 120 zł' },
  { id: 'kolo-naprawa',         name: 'Naprawa koła',                              price: 'od 35 zł' },
  { id: 'kolo-zaplatanie',      name: 'Zaplatanie koła',                           price: 'od 80 zł' },
  { id: 'pod-ridera',           name: 'Konfiguracja pod ridera',                   price: 'od 20 zł' },
  { id: 'skladanie',            name: 'Składanie roweru (z pudełka / z części)',   price: 'od 120 zł' },
  { id: 'budowa',               name: 'Budowa roweru na miarę',                    price: 'od 500 zł' },
  { id: 'hulajnoga',            name: 'Serwis hulajnogi',                          price: 'od 40 zł' },
  { id: 'inne',                 name: 'Inne (opisz w notatce)',                    price: 'wycena indywidualna' },
];

const BIKE_TYPES = [
  'Dirt Jump / BMX',
  'MTB',
  'Rower miejski / trekking',
  'E-bike',
  'Hulajnoga',
  'Inny',
];

// 0=Nd, 1=Pn ... 6=Sob
const SCHEDULE = {
  0: ['16:00','17:00','18:00','19:00'],
  1: ['16:00','17:00','18:00','19:00'],
  2: ['16:00','17:00','18:00','19:00'],
  3: ['16:00','17:00','18:00','19:00'],
  4: ['16:00','17:00','18:00','19:00'],
  5: ['16:00','17:00','18:00','19:00'],
  6: ['16:00','17:00','18:00','19:00'],
};

// Publiczny numer pokazywany klientom w SMS/mailach (jeden punkt edycji po stronie Workera).
// Komórka właściciela (Mateusz), ten sam numer co WhatsApp; poprzednio 501 174 195 (komórka Piotrka, serwisanta).
// To NIE jest OWNER_PHONE: SMS o nowej rezerwacji do właściciela idzie osobno (patrz sendNotifications), mimo że oba stałe dziś mają tę samą wartość domyślną.
const PUBLIC_PHONE_DISPLAY = '600 370 810';

function bookingConfirmedSms(b) {
  const firstName = (b.customer_name || '').split(' ')[0];
  return `Cześć ${firstName}! Potwierdzamy wizytę w skocznarower.pl: ${b.date} o ${b.time_slot}, Jesionowa 18 w Grodzisku Maz. Jeśli termin przestanie pasować, zadzwoń pod ${PUBLIC_PHONE_DISPLAY}.`;
}

function bookingCancelledSms(b) {
  const firstName = (b.customer_name || '').split(' ')[0];
  return `Cześć ${firstName}. Termin ${b.date} o ${b.time_slot} w skocznarower.pl został anulowany. Nowy termin wybierzesz na skocznarower.pl/umow albo telefonicznie: ${PUBLIC_PHONE_DISPLAY}.`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.hostname === 'skocznarower.pl') {
      url.hostname = 'www.skocznarower.pl';
      return Response.redirect(url.toString(), 301);
    }

    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env, url, ctx);
      if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
        return await handleAdmin(request, env, url);
      }
      if (url.pathname === '/r') return await handleQuickAction(request, env, url);
      if (url.pathname === '/warsztaty/potwierdz') {
        return await handleWorkshopTrialResponse(request, env, url);
      }
    } catch (e) {
      console.error('Worker error', e);
      return json({ error: 'Server error' }, 500);
    }

    // Strona główna: opinie Google wstrzykiwane server-side (SEO/AI widzą treść
    // bez JS); każdy błąd SSR degraduje do czystego assetu i klientowego renderu.
    const assetRes = await env.ASSETS.fetch(request);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      try {
        return await injectReviewsSSR(env, assetRes);
      } catch (e) {
        console.error('reviews SSR error', e);
        return assetRes;
      }
    }
    return assetRes;
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try { await processNotificationOutbox(env); }
      catch (e) { console.error('notification outbox error', e); }
      if (event.cron !== '0 8 * * *') return;
      try { await sendDailyReminders(env); }
      catch (e) { console.error('reminders error', e); }
      try { await sendFollowUps(env); }
      catch (e) { console.error('followups error', e); }
      try { await sendWinBack(env); }
      catch (e) { console.error('winback error', e); }
      try { await sendSeasonalReminders(env); }
      catch (e) { console.error('seasonal reminders error', e); }
      try { await fetchGoogleReviews(env); }
      catch (e) { console.error('google reviews error', e); }
      try {
        await env.DB.prepare('DELETE FROM request_rate_limits WHERE updated_at < ?1')
          .bind(Date.now() - 2 * 24 * 3600_000).run();
      } catch (e) { console.error('rate-limit cleanup error', e); }
    })());
  },
};

// ─── API ────────────────────────────────────────────────────────────────────

const MAX_PUBLIC_JSON_BYTES = 16 * 1024;
const CONSENT_VERSION = '2026-07-26';
const PUBLIC_POST_LIMITS = {
  '/api/bookings': { limit: 8, windowMs: 10 * 60_000 },
  '/api/warsztaty': { limit: 8, windowMs: 10 * 60_000 },
  '/api/reminders': { limit: 5, windowMs: 60 * 60_000 },
};

async function consumeRateLimit(request, env, endpoint, limit, windowMs) {
  const ip = request.headers.get('CF-Connecting-IP');
  const secret = env.RATE_LIMIT_SECRET || env.SESSION_SECRET || env.ADMIN_PASSWORD;
  if (!secret) {
    console.error('Rate limit unavailable: configure RATE_LIMIT_SECRET, SESSION_SECRET or ADMIN_PASSWORD');
    return false;
  }
  if (!ip) return true;
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const keyHash = await hmacHex(secret, endpoint + ':' + ip);
  const row = await env.DB.prepare(
    `INSERT INTO request_rate_limits (key_hash, endpoint, window_start, count, updated_at)
     VALUES (?1, ?2, ?3, 1, ?4)
     ON CONFLICT(key_hash, endpoint, window_start) DO UPDATE SET
       count = request_rate_limits.count + 1,
       updated_at = excluded.updated_at
     RETURNING count`
  ).bind(keyHash, endpoint, windowStart, now).first();
  return Number(row?.count || 0) <= limit;
}

async function readJsonRequest(request, maxBytes = MAX_PUBLIC_JSON_BYTES) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { error: 'Request too large', status: 413 };
  }

  const reader = request.body?.getReader();
  if (!reader) return { error: 'Bad JSON', status: 400 };
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return { error: 'Request too large', status: 413 };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { body: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { error: 'Bad JSON', status: 400 };
  }
}

function turnstileSettings(env) {
  const siteKey = String(env.TURNSTILE_SITE_KEY || '').trim();
  const secretKey = String(env.TURNSTILE_SECRET_KEY || '').trim();
  return {
    enabled: Boolean(siteKey && secretKey),
    siteKey,
    secretKey,
  };
}

async function verifyTurnstile(request, env, rawToken, expectedAction) {
  const settings = turnstileSettings(env);
  if (!settings.enabled) {
    if (settings.siteKey || settings.secretKey) {
      console.warn('Turnstile rejected: both site and secret keys are required');
      return false;
    }
    return true;
  }

  const token = String(rawToken || '').trim();
  if (!token || token.length > 2048) return false;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const remoteIp = request.headers.get('CF-Connecting-IP');
    const payload = {
      secret: settings.secretKey,
      response: token,
      idempotency_key: crypto.randomUUID(),
    };
    if (remoteIp) payload.remoteip = remoteIp;

    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn('Turnstile siteverify HTTP error', response.status);
      return false;
    }

    const result = await response.json();
    const expectedHostname = new URL(request.url).hostname.toLowerCase();
    const verified = result?.success === true
      && result.action === expectedAction
      && String(result.hostname || '').toLowerCase() === expectedHostname;
    if (!verified) {
      console.warn('Turnstile verification rejected', {
        action: result?.action || null,
        hostname: result?.hostname || null,
        errorCodes: Array.isArray(result?.['error-codes']) ? result['error-codes'] : [],
      });
    }
    return verified;
  } catch (error) {
    console.warn('Turnstile verification unavailable', error?.name || 'unknown');
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

function turnstileRejected() {
  return json({
    error: 'Nie udało się potwierdzić kontroli bezpieczeństwa. Odśwież stronę i spróbuj ponownie.',
  }, 400);
}

async function handleApi(request, env, url, ctx) {
  // Kanał głosowy (agent AI dzwoniący na numer wirtualny) woła Worker server-to-server.
  // Cała przestrzeń /api/voice/* jest za sekretem VOICE_API_SECRET (stałoczasowe porównanie).
  // Bez ustawionego sekretu trasy zwracają 401 (jak /admin: brak publicznego fallbacku).
  // json() nie wysyła nagłówków CORS, więc przeglądarka tego nie odczyta; bez preflightu.
  if (url.pathname.startsWith('/api/voice/')) {
    const provided = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
      || request.headers.get('X-Voice-Secret') || '';
    if (!env.VOICE_API_SECRET || !timingSafeEqual(provided, env.VOICE_API_SECRET)) {
      return json({ error: 'unauthorized' }, 401);
    }
    if (url.pathname === '/api/voice/availability' && request.method === 'GET') {
      return await apiVoiceAvailability(env, url.searchParams.get('date'));
    }
    if (url.pathname === '/api/voice/next-slot' && request.method === 'GET') {
      return await apiNextSlot(env);
    }
    if (url.pathname === '/api/voice/config' && request.method === 'GET') {
      return apiVoiceConfig();
    }
    if (url.pathname === '/api/voice/bookings' && request.method === 'POST') {
      return await apiVoiceCreateBooking(request, env, ctx);
    }
    return json({ error: 'Not found' }, 404);
  }

  // Kanał WhatsApp (Cloud API w trybie coexistence): webhook weryfikacyjny + odbiór wiadomości.
  // GET to handshake Meta (zwraca hub.challenge); POST to wiadomości przychodzące (podpis X-Hub-Signature-256).
  // Poza bramką VOICE_API_SECRET, bo to publiczny endpoint, który Meta woła sama.
  if (url.pathname === '/api/whatsapp/webhook') {
    if (request.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token') || '';
      const challenge = url.searchParams.get('hub.challenge') || '';
      if (mode === 'subscribe' && env.WHATSAPP_VERIFY_TOKEN && timingSafeEqual(token, env.WHATSAPP_VERIFY_TOKEN)) {
        return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
      }
      return new Response('forbidden', { status: 403 });
    }
    if (request.method === 'POST') {
      return await handleWhatsAppWebhook(request, env, ctx);
    }
    return json({ error: 'Not found' }, 404);
  }

  const publicLimit = request.method === 'POST' ? PUBLIC_POST_LIMITS[url.pathname] : null;
  if (publicLimit && !await consumeRateLimit(
    request, env, url.pathname, publicLimit.limit, publicLimit.windowMs,
  )) {
    return json({ error: 'Za dużo prób. Spróbuj ponownie później.' }, 429);
  }

  if (url.pathname === '/api/availability' && request.method === 'GET') {
    return await apiAvailability(env, url.searchParams.get('date'));
  }
  if (url.pathname === '/api/next-slot' && request.method === 'GET') {
    return await apiNextSlot(env);
  }
  if (url.pathname === '/api/security-config' && request.method === 'GET') {
    const settings = turnstileSettings(env);
    return json({ turnstile_site_key: settings.enabled ? settings.siteKey : null });
  }
  if (url.pathname === '/api/bookings' && request.method === 'POST') {
    return await apiCreateBooking(request, env, ctx);
  }
  if (url.pathname === '/api/reminders' && request.method === 'POST') {
    return await apiSeasonalReminder(request, env);
  }
  if (url.pathname === '/api/reminders/unsubscribe' && request.method === 'GET') {
    return seasonalUnsubscribePage(url.searchParams.get('t'));
  }
  if (url.pathname === '/api/reminders/unsubscribe' && request.method === 'POST') {
    return await apiSeasonalUnsubscribe(request, env);
  }
  if (url.pathname === '/api/warsztaty' && request.method === 'POST') {
    return await apiWorkshopSignup(request, env);
  }
  if (url.pathname === '/api/reviews' && request.method === 'GET') {
    return await apiReviews(env);
  }
  return json({ error: 'Not found' }, 404);
}

// ─── ZAPISY NA WARSZTATY (landing /warsztaty) ───────────────────────────────
// Zgłoszenie z formularza na /warsztaty: zapis do workshop_signups + SMS i mail
// do właściciela (oba fail-soft, jak przy nowej rezerwacji). To NIE jest
// rezerwacja slotu serwisowego: warsztaty to zajęcia cykliczne, grupę dobiera
// się ręcznie do wieku i poziomu, więc zgłoszenie nie dotyka SCHEDULE/bookings.

const WORKSHOP_LEVELS = ['start', 'progress', 'air', 'nie-wiem'];
const WORKSHOP_LOCATIONS = ['grodzisk', 'milanowek', 'obojetnie'];
const WORKSHOP_SOURCES = ['fb', 'szkola', 'serwis', 'instagram', 'google', 'znajomy', 'voucher', 'inne'];
const LANDING_LANGUAGES = ['pl', 'en', 'ua'];

function cleanAttributionText(value, maxLength) {
  const text = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeAttribution(body, source = null) {
  const path = cleanAttributionText(body?.landing_path, 200);
  const referrer = cleanAttributionText(body?.referrer_host, 253)?.toLowerCase() || null;
  return {
    source,
    landing_path: path?.startsWith('/') && !/[?#]/.test(path) ? path : null,
    landing_language: LANDING_LANGUAGES.includes(body?.landing_language) ? body.landing_language : null,
    utm_source: cleanAttributionText(body?.utm_source, 100),
    utm_medium: cleanAttributionText(body?.utm_medium, 100),
    utm_campaign: cleanAttributionText(body?.utm_campaign, 100),
    utm_content: cleanAttributionText(body?.utm_content, 100),
    utm_term: cleanAttributionText(body?.utm_term, 100),
    referrer_host: referrer && /^[a-z0-9.-]+$/i.test(referrer) ? referrer : null,
  };
}

function validateWorkshopSignup(b) {
  const e = [];
  if (!b?.parent_name || b.parent_name.trim().length < 2) e.push('Wpisz imię i nazwisko');
  if (b?.parent_name && b.parent_name.length > 80) e.push('Imię za długie');
  if (!b?.phone || !/^(\+?48)?[0-9]{9}$/.test(normalizePhone(b.phone))) e.push('Wpisz telefon');
  if (b?.email && !normalizeEmail(b.email)) e.push('Nieprawidłowy email');
  const age = Number(b?.child_age);
  if (!Number.isInteger(age) || age < 7 || age > 17) e.push('Wiek dziecka: 7-17 lat');
  if (!WORKSHOP_LEVELS.includes(b?.level)) e.push('Wybierz poziom');
  if (!WORKSHOP_LOCATIONS.includes(b?.location)) e.push('Wybierz lokalizację');
  if (b?.source && !WORKSHOP_SOURCES.includes(b.source)) e.push('Nieprawidłowe źródło');
  if (b?.notes && b.notes.length > 500) e.push('Uwagi za długie');
  if (b?.consent !== true) e.push('Potrzebna zgoda na kontakt');
  return e;
}

async function apiWorkshopSignup(request, env) {
  const parsed = await readJsonRequest(request);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);
  const body = parsed.body;

  // Honeypot: pole "website" jest ukryte w formularzu, wypełniają je tylko boty.
  // Odpowiadamy sukcesem bez zapisu, żeby bot nie uczył się na odpowiedziach.
  if (body?.website) return json({ ok: true, message: 'Zgłoszenie przyjęte.' });

  if (!await verifyTurnstile(request, env, body?.turnstile_token, 'workshop')) {
    return turnstileRejected();
  }

  const errors = validateWorkshopSignup(body);
  if (errors.length) return json({ error: errors[0] }, 400);

  const now = Date.now();
  const attribution = normalizeAttribution(
    body,
    WORKSHOP_SOURCES.includes(body.source) ? body.source : null,
  );
  const row = {
    id: crypto.randomUUID(),
    parent_name: body.parent_name.trim(),
    phone: normalizePhone(body.phone),
    email: body.email ? normalizeEmail(body.email) : null,
    child_age: Number(body.child_age),
    level: body.level,
    location: body.location,
    notes: (body.notes || '').trim() || null,
    ...attribution,
  };

  try {
    await env.DB.prepare(
      `INSERT INTO workshop_signups (
         id, parent_name, phone, email, child_age, level, location, notes, created_at,
         source, landing_path, landing_language, utm_source, utm_medium, utm_campaign,
         utm_content, utm_term, referrer_host, updated_at, consent_at, consent_version
       ) VALUES (
         ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
         ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21
       )`
    ).bind(
      row.id, row.parent_name, row.phone, row.email, row.child_age, row.level,
      row.location, row.notes, now, row.source, row.landing_path, row.landing_language,
      row.utm_source, row.utm_medium, row.utm_campaign, row.utm_content, row.utm_term,
      row.referrer_host, now, now, CONSENT_VERSION,
    ).run();
  } catch (e) {
    console.error('workshop signup insert error', e);
    return json({ error: 'Błąd zapisu, spróbuj ponownie albo napisz na WhatsApp' }, 500);
  }

  // Powiadomienia właściciela: oba fail-soft, zgłoszenie jest już zapisane w D1.
  // SMS bez polskich znaków, żeby liczyć się jako tańszy GSM-7.
  try {
    await queueSmsNotification(env, {
      entityType: 'workshop_signup',
      entityId: row.id,
      eventKey: 'owner_new_signup',
      recipient: env.OWNER_PHONE || '600370810',
      body: `Nowy zapis na warsztaty: ${row.parent_name}, tel ${row.phone}, dziecko ${row.child_age} lat, poziom ${row.level}, ${row.location}.`,
    });
  } catch (e) { console.error('SMS o zapisie na warsztaty error', e); }

  if (env.RESEND_API_KEY && env.NOTIFY_EMAIL) {
    try {
      await queueEmailNotification(env, {
        entityType: 'workshop_signup', entityId: row.id, eventKey: 'owner_new_signup',
        recipient: env.NOTIFY_EMAIL,
        body: {
          from: env.FROM_EMAIL || 'rezerwacje@skocznarower.pl',
          to: env.NOTIFY_EMAIL,
          subject: `Nowy zapis na warsztaty: ${row.parent_name}, dziecko ${row.child_age} lat`,
          text:
`Nowe zgłoszenie na warsztaty dirt/slopestyle (formularz /warsztaty)

Rodzic:      ${row.parent_name}
Telefon:     ${row.phone}
${row.email ? 'Email:       ' + row.email + '\n' : ''}Wiek dziecka: ${row.child_age} lat
Poziom:      ${row.level}
Lokalizacja: ${row.location}
Źródło:       ${row.source || row.utm_source || row.referrer_host || 'brak'}
Uwagi:       ${row.notes || 'brak'}

ID: ${row.id}
`,
        },
      });
    } catch (e) { console.error('Mail o zapisie na warsztaty error', e); }
  }

  return json({
    ok: true,
    message: 'Dziękujemy za zainteresowanie. Odezwiemy się, gdy będziemy mogli zaproponować grupę i termin zajęć próbnych.',
  });
}

// Wspólne źródło danych opinii dla /api/reviews i SSR strony głównej.
async function getReviewsData(env) {
  const [reviewsRes, profileRow] = await Promise.all([
    env.DB.prepare(
      'SELECT review_id, author_name, author_photo, rating, text, publish_time FROM google_reviews ORDER BY publish_time DESC LIMIT 6'
    ).all(),
    env.DB.prepare(
      "SELECT rating, review_count, fetched_at FROM google_profile WHERE id = 'profile'"
    ).first(),
  ]);
  const reviewLink = env.REVIEW_LINK && !env.REVIEW_LINK.includes('CHANGE_TO_')
    ? env.REVIEW_LINK : null;
  return { profileRow: profileRow || null, reviewLink, rows: reviewsRes.results || [] };
}

async function apiReviews(env) {
  const { profileRow, reviewLink, rows: reviewRows } = await getReviewsData(env);

  return new Response(JSON.stringify({
    profile: profileRow ? {
      rating: profileRow.rating,
      review_count: profileRow.review_count,
      fetched_at: profileRow.fetched_at,
    } : null,
    review_link: reviewLink,
    reviews: reviewRows.map(r => ({
      id: r.review_id,
      author: r.author_name,
      photo: r.author_photo,
      rating: r.rating,
      text: r.text,
      time: r.publish_time,
    })),
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=600, s-maxage=3600',
    },
  });
}

// SSR sekcji #opinie na stronie głównej: HTMLRewriter wstrzykuje opinie z cache D1
// do statycznego index.html (markup 1:1 z klientowym loadReviews), zdejmuje hidden
// i dokłada JSON-LD AggregateRating do <head>. Klientowy skrypt widzi data-ssr="1"
// i nie renderuje drugi raz. Pusty cache = strona wraca bez zmian (sekcja hidden,
// klientowy fallback dalej działa).
const SSR_STAR_PATH = 'M12 2.6l2.9 6.05 6.6.72-4.9 4.5 1.34 6.53L12 17.1l-5.94 3.3 1.34-6.53-4.9-4.5 6.6-.72z';

function ssrStarSvg(filled) {
  return filled
    ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + SSR_STAR_PATH + '"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="' + SSR_STAR_PATH + '"/></svg>';
}

function pluralOpinie(n) {
  const mod10 = n % 10, mod100 = n % 100;
  if (n === 1) return 'opinia';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'opinie';
  return 'opinii';
}

async function injectReviewsSSR(env, res) {
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok || !contentType.includes('text/html')) return res;

  const { profileRow, reviewLink, rows } = await getReviewsData(env);
  if (rows.length === 0) return res;

  const avg = typeof profileRow?.rating === 'number' ? profileRow.rating : null;
  const total = typeof profileRow?.review_count === 'number' ? profileRow.review_count : null;
  const countN = total && total > 0 ? total : rows.length;
  const countText = `${countN} ${pluralOpinie(countN)} Google`;

  const fmtDate = (t) => {
    if (!t) return '';
    try { return new Date(t).toLocaleDateString('pl-PL', { year: 'numeric', month: 'long' }); }
    catch { return ''; }
  };

  const gridHtml = rows.slice(0, 6).map((rv) => {
    const n = Math.max(1, Math.min(5, rv.rating || 5));
    const starsHtml = '<span class="review-stars-sm" aria-hidden="true">' + ssrStarSvg(true).repeat(n) + '</span>';
    const date = fmtDate(rv.publish_time);
    return `<figure class="review"><blockquote>${esc(rv.text)}</blockquote><figcaption><strong>${esc(rv.author_name)}</strong><span aria-label="${n} z 5">${starsHtml}${date ? ' · ' + esc(date) : ''}</span></figcaption></figure>`;
  }).join('');

  let ldScript = '';
  if (avg !== null && total !== null && total > 0) {
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      '@id': 'https://www.skocznarower.pl/#business',
      'name': 'skocznarower.pl – Serwis Rowerowy',
      'url': 'https://www.skocznarower.pl',
      'aggregateRating': {
        '@type': 'AggregateRating',
        'ratingValue': avg.toFixed(1),
        'reviewCount': total,
        'bestRating': '5',
        'worstRating': '1',
      },
      'review': rows.slice(0, 5).map(rv => ({
        '@type': 'Review',
        'author': { '@type': 'Person', 'name': rv.author_name },
        'datePublished': rv.publish_time ? new Date(rv.publish_time).toISOString().slice(0, 10) : undefined,
        'reviewRating': { '@type': 'Rating', 'ratingValue': String(rv.rating || 5), 'bestRating': '5' },
        'reviewBody': rv.text,
      })),
    };
    // Znak "<" w JSON-ie zamieniany na sekwencję unicode, żeby tekst opinii nie mógł domknąć tagu script.
    ldScript = '<script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, '\\u003c') + '</script>';
  }

  const rewriter = new HTMLRewriter()
    .on('#opinie', { element(el) { el.removeAttribute('hidden'); el.setAttribute('data-ssr', '1'); } })
    .on('#reviews-grid', { element(el) { el.setInnerContent(gridHtml, { html: true }); } })
    .on('#reviews-count', { element(el) { el.setInnerContent(countText); } });

  if (avg !== null) {
    rewriter
      .on('#reviews-score', { element(el) { el.setInnerContent(avg.toFixed(1)); } })
      .on('#reviews-stars', {
        element(el) {
          el.setAttribute('role', 'img');
          el.setAttribute('aria-label', avg.toFixed(1) + ' na 5');
          el.setInnerContent([0, 1, 2, 3, 4].map(i => ssrStarSvg(i < Math.round(avg))).join(''), { html: true });
        },
      });
  } else {
    rewriter
      .on('#reviews-score', { element(el) { el.setAttribute('hidden', ''); } })
      .on('#reviews-stars', { element(el) { el.setAttribute('hidden', ''); } });
  }
  if (reviewLink) {
    rewriter.on('#reviews-cta', { element(el) { el.setAttribute('href', reviewLink); el.removeAttribute('hidden'); } });
  }
  if (ldScript) {
    rewriter.on('head', { element(el) { el.append(ldScript, { html: true }); } });
  }

  return rewriter.transform(res);
}

// Normalizuje i waliduje adres email; zwraca oczyszczony (trim + lowercase) email
// albo null. Jedyne źródło reguły emaila dla zapisów na listę sezonową.
function normalizeEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  if (!email || email.length > 120 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return email;
}

// Dopisuje email do listy przypomnień sezonowych (idempotentnie, INSERT OR IGNORE,
// bo email jest unikalny). Zwraca true gdy dodano nowy wiersz, false gdy już był.
async function addSeasonalReminder(env, email) {
  const existing = await env.DB.prepare(
    'SELECT id FROM seasonal_reminders WHERE email = ?1'
  ).bind(email).first();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO seasonal_reminders (
       id, email, signed_up_at, consent_at, consent_version, unsubscribe_token
     ) VALUES (?1, ?2, ?3, ?3, ?4, ?5)
     ON CONFLICT(email) DO UPDATE SET
       consent_at = excluded.consent_at,
       consent_version = excluded.consent_version,
       unsubscribe_token = COALESCE(seasonal_reminders.unsubscribe_token, excluded.unsubscribe_token),
       unsubscribed_at = NULL`
  ).bind(crypto.randomUUID(), email, now, CONSENT_VERSION, crypto.randomUUID()).run();
  return !existing;
}

async function apiSeasonalReminder(request, env) {
  const parsed = await readJsonRequest(request);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);
  const body = parsed.body;

  if (!await verifyTurnstile(request, env, body?.turnstile_token, 'reminder')) {
    return turnstileRejected();
  }

  const email = normalizeEmail(body?.email);
  if (!email) return json({ error: 'Nieprawidłowy email' }, 400);
  if (body?.consent !== true) {
    return json({ error: 'Potrzebna zgoda na kontakt' }, 400);
  }

  try {
    const added = await addSeasonalReminder(env, email);
    return json({ ok: true, message: added
      ? 'Zapisany, przypomnę mailem przed sezonem.'
      : 'Już jesteś na liście, do zobaczenia wiosną.' });
  } catch (e) {
    console.error('seasonal insert error', e);
    return json({ error: 'Błąd zapisu' }, 500);
  }
}

function validUnsubscribeToken(raw) {
  const token = String(raw || '').trim();
  return /^[a-z0-9-]{20,100}$/i.test(token) ? token : null;
}

function seasonalUnsubscribePage(rawToken, result = '') {
  const token = validUnsubscribeToken(rawToken);
  const title = result === 'done' ? 'Wypisano z przypomnień' : 'Wypisz się z przypomnień';
  const content = result === 'done'
    ? '<p>Adres został wypisany. Nie wyślemy kolejnego sezonowego przypomnienia.</p>'
    : token
      ? `<p>Potwierdź rezygnację z sezonowych przypomnień e-mail.</p>
         <form method="post" action="/api/reminders/unsubscribe">
           <input type="hidden" name="token" value="${esc(token)}">
           <button type="submit">Wypisz mnie</button>
         </form>`
      : '<p>Link jest nieprawidłowy albo niekompletny.</p>';
  return new Response(`<!doctype html><html lang="pl"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
    <title>${esc(title)} · skocznarower.pl</title><style>
    body{font-family:system-ui,-apple-system,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;line-height:1.6;color:#171717}
    button{border:0;border-radius:.4rem;background:#171717;color:#fff;padding:.8rem 1.2rem;font:inherit;cursor:pointer}
    a{color:#355f00}</style></head><body><h1>${esc(title)}</h1>${content}
    <p><a href="/">Wróć na stronę główną</a></p></body></html>`, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}

async function apiSeasonalUnsubscribe(request, env) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > 2048) return new Response('Too large', { status: 413 });
  const form = await request.formData();
  const token = validUnsubscribeToken(form.get('token'));
  if (!token) return seasonalUnsubscribePage(null);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE seasonal_reminders
       SET unsubscribed_at = ?1
       WHERE unsubscribe_token = ?2 AND unsubscribed_at IS NULL`
    ).bind(now, token),
    env.DB.prepare(
      `UPDATE notification_outbox SET status='cancelled', updated_at=?1,
         last_error='Recipient unsubscribed from seasonal reminders'
       WHERE entity_type='seasonal_reminder'
         AND entity_id IN (
           SELECT id FROM seasonal_reminders WHERE unsubscribe_token=?2
         )
         AND status IN ('pending','failed')`
    ).bind(now, token),
    env.DB.prepare(
      `UPDATE notification_outbox SET status='uncertain', updated_at=?1,
         last_error='Recipient unsubscribed while delivery was in progress; provider outcome unknown'
       WHERE entity_type='seasonal_reminder'
         AND entity_id IN (
           SELECT id FROM seasonal_reminders WHERE unsubscribe_token=?2
         )
         AND status='sending'`
    ).bind(now, token),
  ]);
  // Idempotentna odpowiedź nie ujawnia, czy token istniał w bazie.
  return seasonalUnsubscribePage(token, 'done');
}

// Wczytuje zajęte i zablokowane sloty z zakresu dat do Setów (klucze "YYYY-MM-DD HH:MM").
async function loadSlotMaps(env, fromDate, toDate) {
  const [bookedRes, blockedRes] = await Promise.all([
    env.DB.prepare(
      "SELECT date, time_slot FROM bookings WHERE date >= ?1 AND date <= ?2 AND status != 'cancelled'"
    ).bind(fromDate, toDate).all(),
    env.DB.prepare(
      'SELECT date, time_slot FROM blocked_slots WHERE date >= ?1 AND date <= ?2'
    ).bind(fromDate, toDate).all(),
  ]);
  const taken = new Set((bookedRes.results || []).map(r => `${r.date} ${r.time_slot}`));
  const blocked = new Set((blockedRes.results || []).map(r => `${r.date} ${r.time_slot}`));
  const blockedDays = new Set((blockedRes.results || []).filter(r => r.time_slot === 'all').map(r => r.date));
  return { taken, blocked, blockedDays };
}

// Jedno źródło prawdy o dostępności: wolne godziny SCHEDULE dla danej daty wg Setów z loadSlotMaps.
function freeSlotsForDate(date, taken, blocked, blockedDays) {
  if (blockedDays.has(date)) return [];
  return (SCHEDULE[dayOfWeek(date)] || [])
    .filter(t => !taken.has(`${date} ${t}`) && !blocked.has(`${date} ${t}`));
}

async function apiAvailability(env, dateStr) {
  if (!isValidDate(dateStr)) return json({ error: 'Bad date' }, 400);
  if (dateStr < todayInWarsaw()) return json({ slots: [] });

  const allSlots = SCHEDULE[dayOfWeek(dateStr)] || [];
  if (allSlots.length === 0) return json({ slots: [] });

  const maps = await loadSlotMaps(env, dateStr, dateStr);
  if (maps.blockedDays.has(dateStr)) return json({ slots: [] });

  const free = new Set(freeSlotsForDate(dateStr, maps.taken, maps.blocked, maps.blockedDays));
  // Dla dzisiejszej daty sloty z miniętą godziną rozpoczęcia (czas warszawski) są niedostępne.
  const nowHM = dateStr === todayInWarsaw() ? nowTimeInWarsaw() : null;
  const slots = allSlots.map(time => ({ time, available: free.has(time) && (nowHM === null || time >= nowHM) }));
  return json({ slots });
}

// Najbliższy wolny termin dla nudge'a na stronie głównej.
// Najwcześniejszy bookowalny dzień to jutro, spójnie z min daty w formularzu /umow.
async function apiNextSlot(env) {
  const HORIZON = 21;
  const start = addDaysWarsaw(1);
  const end = addDaysWarsaw(HORIZON);
  const maps = await loadSlotMaps(env, start, end);

  for (let i = 1; i <= HORIZON; i++) {
    const date = addDaysWarsaw(i);
    const free = freeSlotsForDate(date, maps.taken, maps.blocked, maps.blockedDays);
    if (free.length) {
      const time = free[0];
      const label = date === start
        ? `jutro o ${time}`
        : `${new Date(date + 'T12:00:00Z').toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' })}, ${time}`;
      return json({ date, time, label });
    }
  }
  return json({ date: null, time: null, label: null });
}

async function apiCreateBooking(request, env, ctx) {
  const parsed = await readJsonRequest(request);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);
  const body = parsed.body;

  if (!await verifyTurnstile(request, env, body?.turnstile_token, 'booking')) {
    return turnstileRejected();
  }

  // Źródło jest nadawane po stronie serwera, więc klient nie może go podszyć.
  const res = await createBookingCore(env, ctx, { ...body, source: 'web' });
  if (!res.ok) return json({ error: res.error }, res.status);
  return json({
    ok: true,
    id: res.id,
    message: 'Rezerwacja przyjęta. Skontaktuję się z Tobą, żeby potwierdzić.',
  });
}

// Rdzeń tworzenia rezerwacji, wspólny dla formularza web (/api/bookings)
// i kanału głosowego (/api/voice/bookings). Zwraca { ok:true, id }
// albo { ok:false, status, error }. Walidacja, kontrola kolizji (z unikalnym
// indeksem idx_bookings_active_slot jako backstopem wyścigu) oraz powiadomienia
// są identyczne dla obu wejść, więc kanał głosowy nie może podwójnie zabookować slotu.
async function createBookingCore(env, ctx, body) {
  const errors = validateBooking(body);
  if (errors.length) return { ok: false, status: 400, error: errors[0] };

  const dow = dayOfWeek(body.date);
  if (!SCHEDULE[dow]?.includes(body.time_slot)) {
    return { ok: false, status: 400, error: 'Nieprawidłowy slot' };
  }
  const bookingToday = todayInWarsaw();
  if (body.date < bookingToday) {
    return { ok: false, status: 400, error: 'Nie można umówić wstecz' };
  }
  // Dzisiejszy slot jest miniony dopiero, gdy jego godzina rozpoczęcia minęła (czas warszawski).
  if (body.date === bookingToday && body.time_slot < nowTimeInWarsaw()) {
    return { ok: false, status: 400, error: 'Ta godzina już minęła, wybierz późniejszy termin' };
  }

  // Konflikt slotu
  const conflict = await env.DB.prepare(
    "SELECT id FROM bookings WHERE date = ?1 AND time_slot = ?2 AND status != 'cancelled' LIMIT 1"
  ).bind(body.date, body.time_slot).first();
  if (conflict) return { ok: false, status: 409, error: 'Slot zajęty, wybierz inny' };

  const blocked = await env.DB.prepare(
    "SELECT 1 FROM blocked_slots WHERE date = ?1 AND (time_slot = ?2 OR time_slot = 'all') LIMIT 1"
  ).bind(body.date, body.time_slot).first();
  if (blocked) return { ok: false, status: 409, error: 'Termin niedostępny' };

  const id = crypto.randomUUID();
  const now = Date.now();
  const attribution = normalizeAttribution(
    body,
    body.source === 'voice' ? 'voice' : 'web',
  );

  try {
    await env.DB.prepare(
      `INSERT INTO bookings (id, created_at, date, time_slot, service_type, bike_type,
         customer_name, customer_phone, customer_email, notes, status,
         source, landing_path, landing_language, utm_source, utm_medium, utm_campaign,
         utm_content, utm_term, referrer_host)
       VALUES (
         ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'pending',
         ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19
       )`
    ).bind(
      id, now, body.date, body.time_slot,
      body.service_type, body.bike_type,
      body.customer_name.trim(), normalizePhone(body.customer_phone),
      body.customer_email?.trim() || null,
      body.notes?.trim() || null,
      attribution.source, attribution.landing_path, attribution.landing_language,
      attribution.utm_source, attribution.utm_medium, attribution.utm_campaign,
      attribution.utm_content, attribution.utm_term, attribution.referrer_host,
    ).run();
  } catch (e) {
    // Unikalny indeks idx_bookings_active_slot łapie wyścig dwóch równoległych rezerwacji.
    // Dopasowanie zawężone do "UNIQUE constraint", żeby nie maskować NOT NULL/CHECK jako 409.
    if (/UNIQUE constraint/i.test(String(e?.message || e))) {
      return { ok: false, status: 409, error: 'Slot zajęty, wybierz inny' };
    }
    throw e;
  }

  // Notyfikacja email + SMS, best-effort, błąd nie zatrzymuje rezerwacji.
  // Wpis do kalendarza powstaje dopiero przy potwierdzeniu przez Mateusza w /admin.
  // waitUntil utrzymuje izolat przy życiu do końca wysyłki.
  const mail = sendNotifications(env, { id, ...body }).catch(e => console.error('Mail/SMS error', e));
  if (ctx?.waitUntil) ctx.waitUntil(mail);

  // Opt-in sezonowy: gdy klient zaznaczył zgodę i podał poprawny email, dopisz go do listy.
  // Best-effort, deferowane przez waitUntil jak powiadomienia powyżej, więc nie wydłuża odpowiedzi.
  if (body.consent === true && body.customer_email) {
    const email = normalizeEmail(body.customer_email);
    if (email) {
      const optin = addSeasonalReminder(env, email).catch(e => console.error('seasonal opt-in error', e));
      if (ctx?.waitUntil) ctx.waitUntil(optin); else await optin;
    }
  }

  return { ok: true, id };
}

// ─── KANAŁ GŁOSOWY (agent AI dzwoniący na numer wirtualny) ───────────────────
// Wszystkie poniższe są wołane wyłącznie zza bramki VOICE_API_SECRET w handleApi.

// Wolne godziny na dany dzień (tylko wolne, format przyjazny dla TTS).
async function apiVoiceAvailability(env, dateStr) {
  if (!isValidDate(dateStr)) return json({ error: 'Bad date' }, 400);
  if (dateStr < todayInWarsaw()) return json({ date: dateStr, free: [] });
  const maps = await loadSlotMaps(env, dateStr, dateStr);
  let free = freeSlotsForDate(dateStr, maps.taken, maps.blocked, maps.blockedDays);
  // Spójnie z apiAvailability: dzisiejsze sloty z miniętą godziną rozpoczęcia odpadają.
  if (dateStr === todayInWarsaw()) {
    const nowHM = nowTimeInWarsaw();
    free = free.filter(t => t >= nowHM);
  }
  return json({ date: dateStr, free });
}

// Stałe (usługi/ceny/typy/godziny) jako jedno źródło prawdy dla promptu agenta,
// żeby nie hardkodować cennika w drugim miejscu (spójne z inwariantem z CLAUDE.md).
function apiVoiceConfig() {
  return json({
    services: SERVICES,
    bike_types: BIKE_TYPES,
    schedule: SCHEDULE,
    address: 'Jesionowa 18, 05-825 Grodzisk Mazowiecki',
    booking_url: 'https://www.skocznarower.pl/umow',
  });
}

// Tworzy rezerwację z rozmowy telefonicznej. Ten sam rdzeń co web (createBookingCore):
// identyczna walidacja, kontrola kolizji (+ unikalny indeks) i powiadomienia (SMS + mail
// do właściciela). Rezerwacja zostaje 'pending', kalendarz dopiero po potwierdzeniu w /admin.
async function apiVoiceCreateBooking(request, env, ctx) {
  const parsed = await readJsonRequest(request);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);
  const body = parsed.body;

  // Oznacz źródło telefoniczne w notatce, żeby rezerwacje z agenta były rozpoznawalne w /admin.
  const baseNote = (body.notes && String(body.notes).trim()) || '';
  const notes = baseNote ? `[tel] ${baseNote}` : '[tel] rezerwacja telefoniczna (agent)';

  const res = await createBookingCore(env, ctx, {
    ...body,
    notes,
    source: 'voice',
    landing_language: 'pl',
  });
  if (!res.ok) return json({ error: res.error }, res.status);

  const service = SERVICES.find(s => s.id === body.service_type)?.name || body.service_type;
  return json({
    ok: true,
    id: res.id,
    confirmation: `Zarezerwowane: ${service}, ${body.date} o ${body.time_slot}. Oddzwonimy, żeby potwierdzić.`,
  });
}

function validateBooking(b) {
  const e = [];
  if (!isValidDate(b?.date)) e.push('Brak daty');
  if (!/^\d{2}:\d{2}$/.test(b?.time_slot || '')) e.push('Brak godziny');
  if (!SERVICES.some(s => s.id === b?.service_type)) e.push('Wybierz usługę');
  if (!BIKE_TYPES.includes(b?.bike_type)) e.push('Wybierz typ roweru');
  if (!b?.customer_name || b.customer_name.trim().length < 2) e.push('Wpisz imię');
  if (b?.customer_name && b.customer_name.length > 80) e.push('Imię za długie');
  if (!b?.customer_phone || !/^(\+?48)?[0-9]{9}$/.test(normalizePhone(b.customer_phone))) e.push('Wpisz telefon');
  if (b?.customer_email && b.customer_email.length > 120) e.push('Email za długi');
  if (b?.customer_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.customer_email)) e.push('Nieprawidłowy email');
  if (b?.notes && b.notes.length > 1000) e.push('Notatka za długa');
  return e;
}

function normalizePhone(p) {
  return String(p || '').replace(/[^0-9+]/g, '');
}

// ─── EMAIL (Resend) ─────────────────────────────────────────────────────────

async function sendNotifications(env, b) {
  const service = SERVICES.find(s => s.id === b.service_type)?.name || b.service_type;

  // SMS do właściciela o nowej rezerwacji, niezależnie od maila i fail-soft.
  // Numer w env.OWNER_PHONE, fallback na stały numer Mateusza.
  // Link prowadzi do strony z przyciskami Potwierdź / Odrzuć (bez logowania).
  // Treść bez polskich znaków, żeby liczyć się jako tańszy GSM-7.
  try {
    const link = await bookingActionLink(env, b.id);
    const tail = link ? `Potwierdz/odrzuc: ${link}` : 'Panel: skocznarower.pl/admin';
    await queueSmsNotification(env, {
      entityType: 'booking',
      entityId: b.id,
      eventKey: 'owner_new_booking',
      recipient: env.OWNER_PHONE || '600370810',
      body: `Nowa rezerwacja: ${b.date} ${b.time_slot}, ${b.customer_name}, tel ${b.customer_phone}. ${tail}`,
    });
  } catch (e) { console.error('SMS do właściciela error', e); }

  // Potwierdzenie do klienta przez WhatsApp (szablon utility), fail-soft.
  // Wysyłamy tylko gdy kanał skonfigurowany (po onboardingu coexistence); inaczej pomijamy bez śladu.
  if (env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID) {
    try {
      const firstName = (b.customer_name || '').split(' ')[0] || b.customer_name;
      await queueWhatsAppNotification(env, {
        entityType: 'booking',
        entityId: b.id,
        eventKey: 'customer_new_booking',
        recipient: b.customer_phone,
        body: {
        type: 'template',
        template: {
          name: env.WHATSAPP_TPL_CONFIRM || 'potwierdzenie_rezerwacji',
          language: { code: env.WHATSAPP_LANG || 'pl' },
          components: [{
            type: 'body',
            parameters: [
              { type: 'text', text: firstName },
              { type: 'text', text: b.date },
              { type: 'text', text: b.time_slot },
              { type: 'text', text: service },
            ],
          }],
        },
        },
      });
    } catch (e) { console.error('WA potwierdzenie error', e); }
  }

  if (!env.RESEND_API_KEY) return;

  const from = env.FROM_EMAIL || 'rezerwacje@skocznarower.pl';
  // REPLY_TO_EMAIL should be a direct external address (e.g. Gmail) that does not
  // rely on Cloudflare Email Routing, so that customer replies are deliverable even
  // when the @skocznarower.pl forwarding chain is broken.
  const replyTo = env.REPLY_TO_EMAIL || env.NOTIFY_EMAIL;

  // do właściciela, w osobnym try/catch żeby błąd nie zablokował maila do klienta
  if (env.NOTIFY_EMAIL) {
    try {
    await queueEmailNotification(env, {
      entityType: 'booking', entityId: b.id, eventKey: 'owner_new_booking',
      recipient: env.NOTIFY_EMAIL,
      body: {
        from,
        to: env.NOTIFY_EMAIL,
        subject: `Nowa rezerwacja: ${b.date} ${b.time_slot}, ${b.customer_name}`,
        text:
`Nowa rezerwacja w skocznarower.pl

Data:    ${b.date} ${b.time_slot}
Usługa:  ${service}
Rower:   ${b.bike_type}

Klient:  ${b.customer_name}
Telefon: ${b.customer_phone}
${b.customer_email ? 'Email:   ' + b.customer_email + '\n' : ''}
Notatka: ${b.notes || 'brak'}

Panel: https://www.skocznarower.pl/admin
ID:    ${b.id}
`,
      },
    });
    } catch (e) { console.error('Mail do właściciela error', e); }
  }

  // do klienta, tylko jeśli podał email
  if (b.customer_email) {
    try {
      const payload = {
        from,
        to: b.customer_email,
        subject: 'Rezerwacja przyjęta, czeka na potwierdzenie, skocznarower.pl',
        text:
`Cześć ${b.customer_name},

Dziękuję za zgłoszenie. Twój termin jest wstępnie zarezerwowany, potwierdzę go telefonicznie.

Data:    ${b.date}, godz. ${b.time_slot}
Usługa:  ${service}
Rower:   ${b.bike_type}

Jeśli coś się zmieni, zadzwoń: ${PUBLIC_PHONE_DISPLAY}.

Mateusz / skocznarower.pl
Jesionowa 18, Grodzisk Mazowiecki
`,
      };
      if (replyTo) payload.reply_to = replyTo;
      await queueEmailNotification(env, {
        entityType: 'booking', entityId: b.id, eventKey: 'customer_new_booking',
        recipient: b.customer_email, body: payload,
      });
    } catch (e) { console.error('Mail do klienta error', e); }
  }
}

async function resendSend(apiKey, payload, idempotencyKey = '') {
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey).slice(0, 256);
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const responseText = await r.text();
  if (!r.ok) {
    throw new Error(`Resend ${r.status}: ${responseText}`);
  }
  try { return JSON.parse(responseText)?.id || null; }
  catch { return null; }
}

// ─── GOOGLE CALENDAR ─────────────────────────────────────────────────────────
//
// Wpis do kalendarza "pyszczka" powstaje, gdy Mateusz potwierdzi rezerwację w /admin.
// Uwierzytelnianie przez konto serwisowe Google (bez domeny Workspace):
//   1. Google Cloud Console → utwórz konto serwisowe, włącz "Google Calendar API",
//      pobierz klucz JSON (pola client_email, private_key).
//   2. W Google Calendar udostępnij kalendarz "pyszczka" adresowi konta serwisowego
//      z prawem "Wprowadzanie zmian w wydarzeniach".
//   3. Ustaw sekrety/zmienne Workera:
//        GOOGLE_SA_EMAIL        = client_email z JSON
//        GOOGLE_SA_PRIVATE_KEY  = private_key z JSON (z \n; kod sam je rozwinie)
//        GOOGLE_CALENDAR_ID     = id kalendarza "pyszczka" (z ustawień kalendarza)
// Bez tych wartości funkcja loguje dry-run i zwraca null (rezerwacja działa dalej).

const CAL_TZ = 'Europe/Warsaw';
const CAL_DURATION_MIN = 60; // domyślny czas wizyty

/** Tworzy wydarzenie w kalendarzu. Zwraca id eventu albo null (dry-run/błąd miękki). */
async function addToCalendar(env, b) {
  const calId = env.GOOGLE_CALENDAR_ID;
  const service = SERVICES.find(s => s.id === b.service_type)?.name || b.service_type;
  const summary = `${service}, ${b.customer_name}`;
  const description =
    `Usluga: ${service}\n` +
    `Rower: ${b.bike_type}\n` +
    `Klient: ${b.customer_name}\n` +
    `Telefon: ${b.customer_phone}\n` +
    (b.customer_email ? `Email: ${b.customer_email}\n` : '') +
    `Notatka: ${b.notes || 'brak'}\n` +
    `Panel: https://www.skocznarower.pl/admin`;

  const start = `${b.date}T${b.time_slot}:00`;
  const end = `${b.date}T${addMinutesToTime(b.time_slot, CAL_DURATION_MIN)}:00`;

  if (!env.GOOGLE_SA_EMAIL || !env.GOOGLE_SA_PRIVATE_KEY || !calId) {
    console.log('[Kalendarz dry-run] →', summary, start, '-', end);
    return null;
  }

  const token = await getGoogleAccessToken(env, 'https://www.googleapis.com/auth/calendar');
  const r = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary,
        description,
        start: { dateTime: start, timeZone: CAL_TZ },
        end: { dateTime: end, timeZone: CAL_TZ },
      }),
    },
  );
  if (!r.ok) throw new Error(`Calendar insert ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.id || null;
}

/** Usuwa wydarzenie z kalendarza. Brak sekretów = dry-run. */
async function deleteCalendarEvent(env, eventId) {
  const calId = env.GOOGLE_CALENDAR_ID;
  if (!env.GOOGLE_SA_EMAIL || !env.GOOGLE_SA_PRIVATE_KEY || !calId) {
    console.log('[Kalendarz dry-run] usuń', eventId);
    return;
  }
  const token = await getGoogleAccessToken(env, 'https://www.googleapis.com/auth/calendar');
  const r = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } },
  );
  // 410 = już usunięte, traktujemy jako sukces.
  if (!r.ok && r.status !== 410) throw new Error(`Calendar delete ${r.status}: ${await r.text()}`);
}

/** Dodaje minuty do "HH:MM" i zwraca "HH:MM" (w obrębie doby, sloty są w godzinach pracy). */
function addMinutesToTime(hhmm, mins) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (h * 60 + m + mins) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Pobiera access token Google przez flow konta serwisowego (JWT bearer, RS256).
 * Podpis JWT robi Web Crypto z klucza PKCS8 (private_key z JSON konta serwisowego).
 */
async function getGoogleAccessToken(env, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: env.GOOGLE_SA_EMAIL,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;

  const key = await importPkcs8(env.GOOGLE_SA_PRIVATE_KEY);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${b64urlBytes(new Uint8Array(sig))}`;

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!r.ok) throw new Error(`Google token ${r.status}: ${await r.text()}`);
  const data = await r.json();
  if (!data.access_token) throw new Error('Google token: brak access_token');
  return data.access_token;
}

async function importPkcs8(pem) {
  // Sekret może mieć literalne \n zamiast nowych linii, rozwijamy oba przypadki.
  const body = String(pem)
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const der = Uint8Array.from(atob(body), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8', der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign'],
  );
}

// ─── SZYBKA AKCJA Z SMS (potwierdź / odrzuć) ────────────────────────────────
//
// SMS do Mateusza zawiera link /r?id=<id>&t=<token>. Token to HMAC(id) na sekrecie
// sesji, więc linku nie da się zgadnąć. GET tylko pokazuje stronę z dwoma
// przyciskami (skanery linków w SMS-ach nie odpalą akcji), a samo potwierdzenie
// / odrzucenie idzie POST-em.

/** Token podpisujący link akcji. Skrócony HMAC, wystarczający dla tej operacji. */
async function bookingToken(env, id) {
  const secret = sessionSecret(env);
  if (!secret) return null;
  return (await hmac(secret, `r:${id}`)).slice(0, 24);
}

/** Pełny link do potwierdzenia/odrzucenia rezerwacji. Null bez sekretu sesji. */
async function bookingActionLink(env, id) {
  const t = await bookingToken(env, id);
  if (!t) return null;
  return `https://www.skocznarower.pl/r?id=${id}&t=${t}`;
}

async function handleQuickAction(request, env, url) {
  const id = url.searchParams.get('id') || '';
  const token = url.searchParams.get('t') || '';
  const expected = await bookingToken(env, id);
  if (!id || !expected || !timingSafeEqual(token, expected)) {
    return htmlPage('Link nieprawidłowy', '<p>Ten link jest nieprawidłowy lub wygasł.</p>');
  }

  const b = await env.DB.prepare('SELECT * FROM bookings WHERE id=?1').bind(id).first();
  if (!b) return htmlPage('Nie znaleziono', '<p>Rezerwacja nie istnieje.</p>');

  const service = SERVICES.find(s => s.id === b.service_type)?.name || b.service_type;
  const summary =
    `<p><strong>${esc(b.customer_name)}</strong>, tel. ${esc(b.customer_phone)}</p>` +
    `<p>${esc(b.date)}, godz. ${esc(b.time_slot)}<br>${esc(service)}, ${esc(b.bike_type)}</p>` +
    (b.notes ? `<p>Notatka: ${esc(b.notes)}</p>` : '');

  // Komunikat dla rezerwacji, która nie jest już 'pending' (np. token z SMS-a przeżył zmianę
  // stanu w /admin). Współdzielony przez GET (pokaż stan) i POST (link w starej, nieodświeżonej
  // karcie nie może po cichu wykonać akcji na nieaktualnym stanie).
  const alreadyDecided = () => {
    if (b.status === 'confirmed') return htmlPage('Już potwierdzona', summary + '<p>Ta rezerwacja jest już potwierdzona.</p>');
    if (b.status === 'cancelled') return htmlPage('Anulowana', summary + '<p>Ta rezerwacja jest już anulowana.</p>');
    if (b.status === 'done') return htmlPage('Zrealizowana', summary + '<p>Ta rezerwacja jest oznaczona jako zrealizowana.</p>');
    if (b.status === 'in_progress') return htmlPage('W naprawie', summary + '<p>Rower jest już w naprawie. Stan zlecenia można zmienić wyłącznie w panelu.</p>');
    if (b.status !== 'pending') return htmlPage('Stan zmieniony', summary + '<p>Ten link nie jest już aktywny. Sprawdź aktualny stan w panelu.</p>');
    return null;
  };

  if (request.method === 'POST') {
    const already = alreadyDecided();
    if (already) return already;
    const form = await request.formData();
    const action = String(form.get('action') || '');
    if (action === 'confirm') {
      const res = await confirmBooking(env, id, 'pending');
      if (res.error === 'slot') {
        return htmlPage('Slot zajęty', summary + '<p>Ten termin zajęła już inna rezerwacja.</p>');
      }
      if (res.error === 'state') {
        return htmlPage('Stan zmieniony', summary + '<p>Rezerwacja została już zmieniona. Sprawdź aktualny stan w panelu.</p>');
      }
      return htmlPage('Potwierdzono ✓', summary + '<p>Rezerwacja potwierdzona, trafiła do kalendarza.</p>');
    }
    if (action === 'cancel') {
      const res = await cancelBooking(env, id, 'pending');
      if (res.error === 'state') {
        return htmlPage('Stan zmieniony', summary + '<p>Rezerwacja została już zmieniona. Sprawdź aktualny stan w panelu.</p>');
      }
      return htmlPage('Odrzucono', summary + '<p>Rezerwacja odrzucona i anulowana.</p>');
    }
    return htmlPage('Błąd', '<p>Nieznana akcja.</p>');
  }

  // GET: pokaż stan i przyciski (POST). Dla już rozstrzygniętych tylko informacja.
  const already = alreadyDecided();
  if (already) return already;

  const hidden = `<input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="t" value="${esc(token)}">`;
  const buttons =
    `<form method="POST" style="display:inline">${hidden}<button name="action" value="confirm" class="ok">Potwierdź</button></form>` +
    `<form method="POST" style="display:inline">${hidden}<button name="action" value="cancel" class="no">Odrzuć</button></form>`;
  return htmlPage('Nowa rezerwacja', summary + `<div class="btns">${buttons}</div>`);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function htmlPage(title, bodyHtml) {
  return new Response(
    `<!doctype html><html lang="pl"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex">` +
    `<title>${esc(title)}, skocznarower.pl</title><style>` +
    `body{font-family:system-ui,-apple-system,sans-serif;max-width:30rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a;line-height:1.5}` +
    `h1{font-size:1.4rem}` +
    `.btns{margin-top:1.5rem;display:flex;gap:.75rem}` +
    `button{font-size:1rem;padding:.8rem 1.4rem;border:0;border-radius:.6rem;cursor:pointer;color:#fff}` +
    `button.ok{background:#16794a}button.no{background:#b3261e}` +
    `a{color:#16794a}</style></head><body>` +
    `<h1>${esc(title)}</h1>${bodyHtml}` +
    `<p style="margin-top:2rem"><a href="https://www.skocznarower.pl/admin">Panel /admin</a></p>` +
    `</body></html>`,
    { headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    } },
  );
}

// ─── ADMIN ──────────────────────────────────────────────────────────────────

function isSafeBrowserMutation(request) {
  const origin = request.headers.get('Origin');
  if (origin) {
    try { return new URL(origin).origin === new URL(request.url).origin; }
    catch { return false; }
  }
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  return !fetchSite || fetchSite === 'same-origin' || fetchSite === 'none';
}

async function handleAdmin(request, env, url) {
  const path = url.pathname;

  if (request.method === 'POST' && !isSafeBrowserMutation(request)) {
    return new Response('Forbidden', { status: 403 });
  }

  if (path === '/admin/login' && request.method === 'POST') {
    const allowed = await consumeRateLimit(request, env, 'admin_login', 10, 15 * 60_000);
    if (!allowed) {
      const page = loginPage('Za dużo prób logowania. Spróbuj ponownie później.');
      return new Response(page.body, { status: 429, headers: page.headers });
    }
    return await adminLogin(request, env);
  }
  if (path === '/admin/logout') {
    return new Response('', {
      status: 302,
      headers: {
        'Location': '/admin',
        'Set-Cookie': '__Host-admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
      },
    });
  }

  const authed = await isAdmin(request, env);

  if (!authed) {
    if (path === '/admin' || path === '/admin/') return loginPage();
    return new Response('', { status: 302, headers: { 'Location': '/admin' } });
  }

  if (path === '/admin' || path === '/admin/') return await adminDashboard(env, url);
  if (path === '/admin/warsztaty' && request.method === 'GET') {
    return await adminWorkshopSignups(env, url);
  }
  if (path === '/admin/warsztaty' && request.method === 'POST') {
    return await adminUpdateWorkshopSignup(request, env);
  }
  if (path === '/admin/warsztaty/grupy' && request.method === 'GET') {
    return await adminWorkshopOperations(env, url);
  }
  if (path === '/admin/warsztaty/grupy' && request.method === 'POST') {
    return await adminWorkshopOperationsPost(request, env);
  }
  if (path === '/admin/booking' && request.method === 'POST') {
    return await adminUpdateBooking(request, env);
  }
  if (path === '/admin/booking-new' && request.method === 'POST') {
    return await adminCreateBooking(request, env);
  }
  if (path === '/admin/zlecenie' && request.method === 'GET') {
    return await adminBookingDetail(env, url);
  }
  if (path === '/admin/zlecenie' && request.method === 'POST') {
    return await adminZleceniePost(request, env);
  }
  if (path === '/admin/rozliczenie' && request.method === 'GET') {
    return await adminSettlement(env, url);
  }
  if (path === '/admin/rozliczenie' && request.method === 'POST') {
    return await adminSettleAction(request, env);
  }
  if (path === '/admin/block' && request.method === 'POST') {
    return await adminBlockSlot(request, env);
  }
  if (path === '/admin/reviews-refresh' && request.method === 'POST') {
    return await adminRefreshReviews(env);
  }
  if (path === '/admin/outreach' && request.method === 'POST') {
    return await adminUpdateOutreach(request, env);
  }
  if (path === '/admin/outbox-retry' && request.method === 'POST') {
    return await adminRetryOutbox(env);
  }
  if (path === '/admin/outbox-resolve' && request.method === 'POST') {
    return await adminResolveOutbox(request, env);
  }
  return new Response('Not found', { status: 404 });
}

async function adminRetryOutbox(env) {
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE notification_outbox SET status='pending', next_attempt_at=?1,
       attempt_count=0, last_error=NULL, updated_at=?1 WHERE status='failed'`
  ).bind(now).run();
  await auditEvent(env, 'notification_outbox', 'all', 'failed_requeued');
  return redirect('/admin?msg=outbox-retry');
}

async function adminResolveOutbox(request, env) {
  const form = await request.formData();
  const id = String(form.get('id') || '').trim();
  const action = String(form.get('action') || '').trim();
  if (!id || id.length > 100 || !['retry', 'mark_sent', 'cancel'].includes(action)) {
    return new Response('Bad action', { status: 400 });
  }
  const job = await env.DB.prepare(
    "SELECT * FROM notification_outbox WHERE id=?1 AND status='uncertain'"
  ).bind(id).first();
  if (!job) return redirect('/admin?err=outbox-state');

  const now = Date.now();
  let changed = 0;
  if (action === 'retry') {
    const result = await env.DB.prepare(
      `UPDATE notification_outbox SET status='pending', next_attempt_at=?2, updated_at=?2,
         last_error='Operator approved retry after uncertain outcome'
       WHERE id=?1 AND status='uncertain'`
    ).bind(id, now).run();
    changed = Number(result.meta?.changes || 0);
  } else if (action === 'mark_sent') {
    changed = await finalizeOutboxSent(env, job, {
      expectedStatus: 'uncertain',
      sentAt: now,
      attempt: Number(job.attempt_count || 0),
      lastError: 'Operator marked uncertain outcome as sent',
    });
  } else {
    const result = await env.DB.prepare(
      `UPDATE notification_outbox SET status='cancelled', updated_at=?2,
         last_error='Operator cancelled uncertain outcome'
       WHERE id=?1 AND status='uncertain'`
    ).bind(id, now).run();
    changed = Number(result.meta?.changes || 0);
  }
  if (!changed) return redirect('/admin?err=outbox-state');
  await auditEvent(env, 'notification_outbox', id, `uncertain_${action}`, {
    entity_type: job.entity_type,
    entity_id: job.entity_id,
    channel: job.channel,
  });
  return redirect('/admin?msg=outbox-resolved');
}

const WORKSHOP_CRM_STATUSES = ['new', 'contacted', 'trial_booked', 'enrolled', 'lost'];
const WORKSHOP_CRM_LABELS = {
  new: 'nowe',
  contacted: 'kontakt',
  trial_booked: 'próbne umówione',
  enrolled: 'zapisany',
  lost: 'utracony',
};

const WORKSHOP_TRIAL_RESPONSES = ['accepted', 'declined', 'contact'];

function workshopTrialResponseLabel(response) {
  return {
    accepted: 'termin pasuje',
    declined: 'termin nie pasuje',
    contact: 'prośba o kontakt',
  }[response] || response;
}

async function workshopTrialToken(env, id, trialAt) {
  const secret = sessionSecret(env);
  if (!secret || !id || !Number.isSafeInteger(Number(trialAt))) return null;
  return (await hmac(secret, `workshop-trial:${id}:${Number(trialAt)}`)).slice(0, 32);
}

async function workshopTrialResponseLink(request, env, signup) {
  const token = await workshopTrialToken(env, signup?.id, signup?.trial_at);
  if (!token) return null;
  const url = new URL('/warsztaty/potwierdz', new URL(request.url).origin);
  url.searchParams.set('id', signup.id);
  url.searchParams.set('t', String(signup.trial_at));
  url.searchParams.set('s', token);
  return url.toString();
}

function workshopTrialLocale(language) {
  return language === 'en' ? 'en' : language === 'ua' ? 'ua' : 'pl';
}

function workshopTrialCopy(language) {
  const locale = workshopTrialLocale(language);
  if (locale === 'en') return {
    htmlLang: 'en', locale: 'en-GB', title: 'Confirm the trial session', intro: 'Proposed trial session:',
    date: 'Date', group: 'Group', location: 'Location', unknown: 'to be confirmed',
    accepted: 'This time works', declined: 'This time does not work', contact: 'Please contact me',
    current: 'Your response', saved: 'Thank you. Your response has been saved.',
    invalid: 'This link is invalid or has expired.', home: 'Back to the website',
  };
  if (locale === 'ua') return {
    htmlLang: 'uk', locale: 'uk-UA', title: 'Підтвердіть пробне заняття', intro: 'Запропоноване пробне заняття:',
    date: 'Дата', group: 'Група', location: 'Місце', unknown: 'буде підтверджено',
    accepted: 'Час підходить', declined: 'Час не підходить', contact: 'Зв’яжіться зі мною',
    current: 'Ваша відповідь', saved: 'Дякуємо. Вашу відповідь збережено.',
    invalid: 'Посилання недійсне або застаріло.', home: 'Повернутися на сайт',
  };
  return {
    htmlLang: 'pl', locale: 'pl-PL', title: 'Potwierdź zajęcia próbne', intro: 'Proponowane zajęcia próbne:',
    date: 'Termin', group: 'Grupa', location: 'Miejsce', unknown: 'do potwierdzenia',
    accepted: 'Termin pasuje', declined: 'Termin nie pasuje', contact: 'Proszę o kontakt',
    current: 'Twoja odpowiedź', saved: 'Dziękujemy. Odpowiedź została zapisana.',
    invalid: 'Ten link jest nieprawidłowy albo wygasł.', home: 'Wróć na stronę',
  };
}

function workshopTrialLocation(location, copy) {
  return {
    grodzisk: 'Grodzisk Mazowiecki',
    milanowek: 'Milanówek',
  }[location] || copy.unknown;
}

function workshopTrialPage(signup, credentials = {}, result = '', status = 200) {
  const copy = workshopTrialCopy(signup?.landing_language);
  const responseLabels = {
    accepted: copy.accepted,
    declined: copy.declined,
    contact: copy.contact,
  };
  const content = signup
    ? `<p>${escapeHtml(copy.intro)}</p>
       <dl>
         <div><dt>${escapeHtml(copy.date)}</dt><dd>${escapeHtml(new Date(Number(signup.trial_at)).toLocaleString(copy.locale, {
           timeZone: 'Europe/Warsaw', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
         }))}</dd></div>
         <div><dt>${escapeHtml(copy.group)}</dt><dd>${escapeHtml(signup.group_name || copy.unknown)}</dd></div>
         <div><dt>${escapeHtml(copy.location)}</dt><dd>${escapeHtml(workshopTrialLocation(signup.location, copy))}</dd></div>
       </dl>
       ${result ? `<p class="notice">${escapeHtml(copy.saved)}</p>` : ''}
       ${signup.trial_response ? `<p><strong>${escapeHtml(copy.current)}:</strong> ${escapeHtml(responseLabels[signup.trial_response] || signup.trial_response)}</p>` : ''}
       <form method="post">
         <input type="hidden" name="id" value="${escapeHtml(credentials.id || '')}">
         <input type="hidden" name="t" value="${escapeHtml(credentials.t || '')}">
         <input type="hidden" name="s" value="${escapeHtml(credentials.s || '')}">
         <button name="action" value="accepted" class="ok">${escapeHtml(copy.accepted)}</button>
         <button name="action" value="declined" class="no">${escapeHtml(copy.declined)}</button>
         <button name="action" value="contact" class="contact">${escapeHtml(copy.contact)}</button>
       </form>`
    : `<p>${escapeHtml(copy.invalid)}</p>`;

  return new Response(`<!doctype html><html lang="${copy.htmlLang}"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
    <title>${escapeHtml(copy.title)} · skocznarower.pl</title><style>
    body{font-family:system-ui,-apple-system,sans-serif;max-width:36rem;margin:2.5rem auto;padding:0 1rem;line-height:1.55;color:#171717}
    dl{border:1px solid #ddd;border-radius:.7rem;padding:.4rem 1rem}dl div{display:grid;grid-template-columns:7rem 1fr;gap:1rem;padding:.65rem 0;border-bottom:1px solid #eee}dl div:last-child{border:0}dt{color:#555}dd{margin:0;font-weight:650}
    form{display:flex;flex-wrap:wrap;gap:.65rem;margin-top:1.4rem}button{border:0;border-radius:.55rem;padding:.8rem 1rem;color:#fff;font:inherit;font-weight:650;cursor:pointer}.ok{background:#16794a}.no{background:#b3261e}.contact{background:#4a4a4a}.notice{padding:.8rem;background:#eaf7ef;border-radius:.5rem}a{color:#355f00}
    </style></head><body><h1>${escapeHtml(copy.title)}</h1>${content}<p><a href="/">${escapeHtml(copy.home)}</a></p></body></html>`, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}

async function validWorkshopTrialSignup(env, rawId, rawTrialAt, rawSignature) {
  const id = String(rawId || '').trim();
  const trialText = String(rawTrialAt || '').trim();
  const signature = String(rawSignature || '').trim();
  if (!id || id.length > 100 || !/^\d{10,16}$/.test(trialText)
    || !/^[A-Za-z0-9_-]{32}$/.test(signature)) return null;
  const trialAt = Number(trialText);
  if (!Number.isSafeInteger(trialAt)) return null;
  if (Date.now() > trialAt + 48 * 60 * 60 * 1000) return null;
  const signup = await env.DB.prepare(
    `SELECT id, parent_name, phone, email, landing_language, trial_at, group_name,
            location, trial_response, trial_response_at
     FROM workshop_signups WHERE id=?1 AND trial_at=?2 AND status='trial_booked'`
  ).bind(id, trialAt).first();
  if (!signup) return null;
  const expected = await workshopTrialToken(env, id, trialAt);
  if (!expected || !timingSafeEqual(signature, expected)) return null;
  return signup;
}

async function handleWorkshopTrialResponse(request, env, url) {
  if (!['GET', 'POST'].includes(request.method)) {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } });
  }

  let id = url.searchParams.get('id');
  let t = url.searchParams.get('t');
  let s = url.searchParams.get('s');
  let action = '';
  if (request.method === 'POST') {
    if (!isSafeBrowserMutation(request)) return new Response('Forbidden', { status: 403 });
    const declared = Number(request.headers.get('Content-Length'));
    if (Number.isFinite(declared) && declared > 2048) return new Response('Too large', { status: 413 });
    const form = await request.formData();
    id = form.get('id') || id;
    t = form.get('t') || t;
    s = form.get('s') || s;
    action = String(form.get('action') || '').trim();
  }

  const credentials = { id: String(id || ''), t: String(t || ''), s: String(s || '') };
  const signup = await validWorkshopTrialSignup(env, credentials.id, credentials.t, credentials.s);
  if (!signup) return workshopTrialPage(null, {}, '', 400);
  if (request.method === 'GET') return workshopTrialPage(signup, credentials);
  if (!WORKSHOP_TRIAL_RESPONSES.includes(action)) return workshopTrialPage(null, {}, '', 400);

  const previous = signup.trial_response;
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE workshop_signups SET trial_response=?2,
       trial_response_at=CASE WHEN trial_response=?2 AND trial_response_at IS NOT NULL
                              THEN trial_response_at ELSE ?3 END,
       updated_at=?3 WHERE id=?1 AND trial_at=?4`
  ).bind(signup.id, action, now, Number(signup.trial_at)).run();
  if (previous !== action) {
    await auditEvent(env, 'workshop_signup', signup.id, 'trial_response_recorded', {
      response: action,
      trial_at: Number(signup.trial_at),
    });
  }

  const ownerText = `Odpowiedz na termin probny: ${signup.parent_name}, ${signup.phone}: ${workshopTrialResponseLabel(action)} (${warsawDateTime(signup.trial_at)}).`;
  try {
    await queueSmsNotification(env, {
      entityType: 'workshop_signup', entityId: signup.id,
      eventKey: `owner_trial_response_${signup.trial_at}_${action}`,
      recipient: env.OWNER_PHONE || '600370810', body: ownerText,
    });
  } catch (error) { console.error('trial response owner notification error', error); }

  return workshopTrialPage({ ...signup, trial_response: action, trial_response_at: now }, credentials, action);
}

function workshopTrialInviteContent(signup, link) {
  const copy = workshopTrialCopy(signup.landing_language);
  const when = new Date(Number(signup.trial_at)).toLocaleString(copy.locale, {
    timeZone: 'Europe/Warsaw', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  if (workshopTrialLocale(signup.landing_language) === 'en') return {
    sms: `Skocznarower.pl: proposed trial session ${when}. Confirm or ask us to contact you: ${link}`,
    subject: 'Proposed trial session, skocznarower.pl',
    email: `Proposed trial session: ${when}\nGroup: ${signup.group_name || copy.unknown}\nLocation: ${workshopTrialLocation(signup.location, copy)}\n\nConfirm or ask us to contact you: ${link}`,
  };
  if (workshopTrialLocale(signup.landing_language) === 'ua') return {
    sms: `Skocznarower.pl: пробне заняття ${when}. Підтвердьте або попросіть зв'язатися: ${link}`,
    subject: 'Запропоноване пробне заняття, skocznarower.pl',
    email: `Пробне заняття: ${when}\nГрупа: ${signup.group_name || copy.unknown}\nМісце: ${workshopTrialLocation(signup.location, copy)}\n\nПідтвердьте або попросіть зв'язатися: ${link}`,
  };
  return {
    sms: `Skocznarower.pl: proponowany termin zajec probnych ${when}. Potwierdz lub popros o kontakt: ${link}`,
    subject: 'Proponowany termin zajęć próbnych, skocznarower.pl',
    email: `Proponowane zajęcia próbne: ${when}\nGrupa: ${signup.group_name || copy.unknown}\nMiejsce: ${workshopTrialLocation(signup.location, copy)}\n\nPotwierdź termin albo poproś o kontakt: ${link}`,
  };
}

const WORKSHOP_GROUP_STATUSES = ['active', 'paused', 'completed'];
const WORKSHOP_GROUP_LEVELS = ['start', 'progress', 'air', 'mixed'];
const WORKSHOP_GROUP_LOCATIONS = ['grodzisk', 'milanowek', 'inne'];
const WORKSHOP_MEMBERSHIP_STATUSES = ['trial', 'active', 'paused', 'ended'];
const WORKSHOP_SESSION_STATUSES = ['scheduled', 'completed', 'cancelled'];
const WORKSHOP_ATTENDANCE_STATUSES = ['unmarked', 'present', 'absent', 'excused'];
const WORKSHOP_PAYMENT_METHODS = ['cash', 'transfer', 'card', 'voucher', 'other'];
const WORKSHOP_WEEKDAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];

function workshopGroupCapacityLimit(level) {
  return { start: 6, progress: 5, air: 4, mixed: 6 }[level] || 0;
}

const WARSAW_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function warsawDateTimeParts(ms) {
  const values = {};
  for (const part of WARSAW_DATE_TIME_FORMATTER.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  return values;
}

// datetime-local nie niesie strefy czasowej. Formularz panelu zawsze interpretuje je
// jako czas Warszawy, także po zmianie czasu letniego/zimowego.
function parseWarsawDateTimeInput(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [, y, mo, d, h, mi] = match;
  const numbers = [y, mo, d, h, mi].map(Number);
  const target = Date.UTC(numbers[0], numbers[1] - 1, numbers[2], numbers[3], numbers[4]);
  const check = new Date(target);
  if (check.getUTCFullYear() !== numbers[0] || check.getUTCMonth() !== numbers[1] - 1
    || check.getUTCDate() !== numbers[2] || numbers[3] > 23 || numbers[4] > 59) {
    return undefined;
  }

  let guess = target;
  for (let i = 0; i < 3; i++) {
    const parts = warsawDateTimeParts(guess);
    const represented = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute),
    );
    guess += target - represented;
  }
  const finalParts = warsawDateTimeParts(guess);
  const normalized = `${finalParts.year}-${finalParts.month}-${finalParts.day}T${finalParts.hour}:${finalParts.minute}`;
  return normalized === value ? guess : undefined;
}

function workshopDateTimeInput(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '';
  const p = warsawDateTimeParts(Number(ms));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function workshopStatusLabel(status) {
  return WORKSHOP_CRM_LABELS[status] || status;
}

function workshopSourceLabel(source) {
  return {
    fb: 'Facebook',
    szkola: 'szkoła',
    serwis: 'serwis',
    instagram: 'Instagram',
    google: 'Google',
    znajomy: 'polecenie',
    voucher: 'voucher',
    inne: 'inne',
  }[source] || source || 'brak';
}

function renderWorkshopAttribution(signup) {
  const campaign = [signup.utm_source, signup.utm_medium, signup.utm_campaign]
    .filter(Boolean).map(escapeHtml).join(' / ');
  const detail = [
    signup.utm_content ? `treść: ${escapeHtml(signup.utm_content)}` : '',
    signup.utm_term ? `fraza: ${escapeHtml(signup.utm_term)}` : '',
  ].filter(Boolean).join(' · ');
  const landing = [signup.landing_language, signup.landing_path].filter(Boolean).map(escapeHtml).join(' · ');
  return `<strong>${escapeHtml(workshopSourceLabel(signup.source))}</strong>
    ${campaign ? `<div class="muted">UTM: ${campaign}</div>` : ''}
    ${detail ? `<div class="muted">${detail}</div>` : ''}
    ${signup.referrer_host ? `<div class="muted">Referrer: ${escapeHtml(signup.referrer_host)}</div>` : ''}
    ${landing ? `<div class="muted">Landing: ${landing}</div>` : ''}`;
}

async function adminWorkshopSignups(env, url) {
  const requestedFilter = url.searchParams.get('filter') || 'all';
  const allowedFilters = ['all', 'due', ...WORKSHOP_CRM_STATUSES];
  const filter = allowedFilters.includes(requestedFilter) ? requestedFilter : 'all';
  const now = Date.now();

  let where = '';
  const params = [];
  if (WORKSHOP_CRM_STATUSES.includes(filter)) {
    where = 'WHERE status = ?1';
    params.push(filter);
  } else if (filter === 'due') {
    where = "WHERE next_action_at IS NOT NULL AND next_action_at <= ?1 AND status NOT IN ('enrolled','lost')";
    params.push(now);
  }

  const listQuery = env.DB.prepare(
    `SELECT * FROM workshop_signups ${where}
     ORDER BY CASE WHEN next_action_at IS NULL THEN 1 ELSE 0 END,
       next_action_at ASC, created_at DESC LIMIT 500`
  );
  const [listResult, countsResult, dueResult, dueCountResult] = await Promise.all([
    (params.length ? listQuery.bind(...params) : listQuery).all(),
    env.DB.prepare(
      'SELECT status, COUNT(*) AS count FROM workshop_signups GROUP BY status'
    ).all(),
    env.DB.prepare(
      `SELECT id, parent_name, phone, next_action_at FROM workshop_signups
       WHERE next_action_at IS NOT NULL AND next_action_at <= ?1
         AND status NOT IN ('enrolled','lost')
       ORDER BY next_action_at ASC LIMIT 50`
    ).bind(now).all(),
    env.DB.prepare(
      `SELECT COUNT(*) AS count FROM workshop_signups
       WHERE next_action_at IS NOT NULL AND next_action_at <= ?1
         AND status NOT IN ('enrolled','lost')`
    ).bind(now).first(),
  ]);

  const counts = Object.fromEntries(WORKSHOP_CRM_STATUSES.map(status => [status, 0]));
  for (const row of countsResult.results || []) {
    if (WORKSHOP_CRM_STATUSES.includes(row.status)) counts[row.status] = Number(row.count) || 0;
  }
  return adminShell('Warsztaty', renderWorkshopSignups({
    signups: listResult.results || [],
    due: dueResult.results || [],
    dueCount: Number(dueCountResult?.count) || 0,
    counts,
    filter,
    saved: url.searchParams.get('saved') === '1',
    invalid: url.searchParams.get('error') === 'invalid',
    membershipConflict: url.searchParams.get('error') === 'membership',
  }));
}

async function adminUpdateWorkshopSignup(request, env) {
  const form = await request.formData();
  const id = String(form.get('id') || '').trim();
  const status = String(form.get('status') || '').trim();
  const requestedFilter = String(form.get('filter') || 'all');
  const allowedFilters = ['all', 'due', ...WORKSHOP_CRM_STATUSES];
  const filter = allowedFilters.includes(requestedFilter) ? requestedFilter : 'all';
  const back = `/admin/warsztaty?filter=${encodeURIComponent(filter)}`;
  if (!id || id.length > 100 || !WORKSHOP_CRM_STATUSES.includes(status)) {
    return redirect(back + '&error=invalid');
  }

  const nextActionAt = parseWarsawDateTimeInput(form.get('next_action_at'));
  const trialAt = parseWarsawDateTimeInput(form.get('trial_at'));
  const groupName = String(form.get('group_name') || '').trim();
  const assignedTo = String(form.get('assigned_to') || '').trim();
  const ownerNotes = String(form.get('owner_notes') || '').trim();
  if (nextActionAt === undefined || trialAt === undefined
    || groupName.length > 120 || assignedTo.length > 120 || ownerNotes.length > 2000) {
    return redirect(back + '&error=invalid#signup-' + encodeURIComponent(id));
  }

  const current = await env.DB.prepare(
    `SELECT status, lost_at, enrolled_at, trial_at
     FROM workshop_signups WHERE id = ?1`
  ).bind(id).first();
  if (!current) return new Response('Nie ma takiego zgłoszenia', { status: 404 });
  if (status === 'lost') {
    const openMembership = await env.DB.prepare(
      `SELECT id FROM workshop_memberships
       WHERE signup_id=?1 AND status IN ('trial','active','paused') LIMIT 1`
    ).bind(id).first();
    if (openMembership) {
      return redirect(back + '&error=membership#signup-' + encodeURIComponent(id));
    }
  }

  const now = Date.now();
  const lostAt = status === 'lost' && current.status !== 'lost' ? now : current.lost_at;
  const enrolledAt = status === 'enrolled' && current.status !== 'enrolled' ? now : current.enrolled_at;
  const normalizedCurrentTrialAt = current.trial_at == null ? null : Number(current.trial_at);
  const trialChanged = normalizedCurrentTrialAt !== trialAt;
  const crmStatements = [env.DB.prepare(
    `UPDATE workshop_signups SET
       status = ?2, next_action_at = ?3, trial_at = ?4, group_name = ?5,
       assigned_to = ?6, owner_notes = ?7, lost_at = ?8, enrolled_at = ?9,
       updated_at = ?10,
       trial_response = CASE WHEN ?11=1 THEN NULL ELSE trial_response END,
       trial_response_at = CASE WHEN ?11=1 THEN NULL ELSE trial_response_at END
     WHERE id = ?1`
  ).bind(
    id, status, nextActionAt, trialAt, groupName || null, assignedTo || null,
    ownerNotes || null, lostAt, enrolledAt, now, trialChanged ? 1 : 0,
  )];
  if (normalizedCurrentTrialAt != null && (trialChanged || status !== 'trial_booked')) {
    crmStatements.push(env.DB.prepare(
      `UPDATE notification_outbox SET status='cancelled', updated_at=?3,
         last_error='Trial date changed or invitation withdrawn'
       WHERE entity_type='workshop_signup' AND entity_id=?1 AND event_key=?2
         AND status IN ('pending','failed')`
    ).bind(id, `trial_invite_${normalizedCurrentTrialAt}`, now));
    crmStatements.push(env.DB.prepare(
      `UPDATE notification_outbox SET status='uncertain', updated_at=?3,
         last_error='Trial date changed while delivery was in progress; provider outcome unknown'
       WHERE entity_type='workshop_signup' AND entity_id=?1 AND event_key=?2
         AND status='sending'`
    ).bind(id, `trial_invite_${normalizedCurrentTrialAt}`, now));
  }
  await env.DB.batch(crmStatements);
  await auditEvent(env, 'workshop_signup', id, 'crm_updated', {
    from_status: current.status,
    to_status: status,
    trial_changed: trialChanged,
  });

  if (status === 'trial_booked' && trialAt != null) {
    const signup = await env.DB.prepare(
      `SELECT id, parent_name, phone, email, landing_language, trial_at, group_name, location
       FROM workshop_signups WHERE id=?1`
    ).bind(id).first();
    const link = await workshopTrialResponseLink(request, env, signup);
    if (!link) {
      console.warn('Trial invite not queued: SESSION_SECRET or ADMIN_PASSWORD is missing');
    } else {
      const content = workshopTrialInviteContent(signup, link);
      try {
        await queueSmsNotification(env, {
          entityType: 'workshop_signup', entityId: id,
          eventKey: `trial_invite_${trialAt}`,
          recipient: signup.phone, body: content.sms, reactivateCancelled: true,
        });
      } catch (error) { console.error('trial invite SMS error', error); }

      if (signup.email && env.RESEND_API_KEY) {
        const emailBody = {
          from: env.FROM_EMAIL || 'rezerwacje@skocznarower.pl',
          to: signup.email,
          subject: content.subject,
          text: content.email,
        };
        if (env.REPLY_TO_EMAIL || env.NOTIFY_EMAIL) {
          emailBody.reply_to = env.REPLY_TO_EMAIL || env.NOTIFY_EMAIL;
        }
        try {
          await queueEmailNotification(env, {
            entityType: 'workshop_signup', entityId: id,
            eventKey: `trial_invite_${trialAt}`,
            recipient: signup.email, body: emailBody, reactivateCancelled: true,
          });
        } catch (error) { console.error('trial invite email error', error); }
      }
    }
  }

  return redirect(back + '&saved=1#signup-' + encodeURIComponent(id));
}

function renderWorkshopSignups({
  signups, due, dueCount, counts, filter, saved, invalid, membershipConflict,
}) {
  const statusOption = (value, current) =>
    `<option value="${value}"${value === current ? ' selected' : ''}>${escapeHtml(workshopStatusLabel(value))}</option>`;
  const filterTab = (value, label, count = null) =>
    `<a href="?filter=${value}" class="${filter === value ? 'active' : ''}">${label}${count == null ? '' : ` (${count})`}</a>`;
  const levelLabel = level => ({
    start: 'start', progress: 'jeżdżę i chcę progresu', air: 'loty / triki', 'nie-wiem': 'do ustalenia',
  }[level] || level);
  const locationLabel = location => ({
    grodzisk: 'Grodzisk Maz.', milanowek: 'Milanówek', obojetnie: 'obojętnie',
  }[location] || location);

  const row = signup => {
    const isDue = signup.next_action_at != null && Number(signup.next_action_at) <= Date.now()
      && !['enrolled', 'lost'].includes(signup.status);
    return `<tr id="signup-${escapeHtml(signup.id)}" class="status-${escapeHtml(signup.status)}${isDue ? ' workshop-due' : ''}">
      <td data-label="Zgłoszenie">
        <div class="name">${escapeHtml(signup.parent_name)}</div>
        <span class="badge badge-${escapeHtml(signup.status)}">${escapeHtml(workshopStatusLabel(signup.status))}</span>
        <a href="tel:${escapeHtml(signup.phone)}">${escapeHtml(signup.phone)}</a>
        ${signup.email ? `<div><a href="mailto:${escapeHtml(signup.email)}">${escapeHtml(signup.email)}</a></div>` : ''}
        <div class="muted">${warsawDateTime(signup.created_at)}</div>
      </td>
      <td data-label="Dziecko">
        <strong>${escapeHtml(signup.child_age)} lat</strong>
        <div class="muted">${escapeHtml(levelLabel(signup.level))}</div>
        <div class="muted">${escapeHtml(locationLabel(signup.location))}</div>
        ${signup.notes ? `<div class="notes">${escapeHtml(signup.notes)}</div>` : ''}
      </td>
      <td data-label="Pozyskanie">${renderWorkshopAttribution(signup)}</td>
      <td data-label="CRM">
        <form method="post" action="/admin/warsztaty" class="workshop-form">
          <input type="hidden" name="id" value="${escapeHtml(signup.id)}">
          <input type="hidden" name="filter" value="${escapeHtml(filter)}">
          <label>Status
            <select name="status">${WORKSHOP_CRM_STATUSES.map(value => statusOption(value, signup.status)).join('')}</select>
          </label>
          <label>Następny kontakt
            <input type="datetime-local" name="next_action_at" value="${workshopDateTimeInput(signup.next_action_at)}">
          </label>
          <label>Zajęcia próbne
            <input type="datetime-local" name="trial_at" value="${workshopDateTimeInput(signup.trial_at)}">
          </label>
          ${signup.trial_response ? `<div class="muted"><strong>Odpowiedź rodzica:</strong> ${escapeHtml(workshopTrialResponseLabel(signup.trial_response))}${signup.trial_response_at ? ` · ${escapeHtml(warsawDateTime(signup.trial_response_at))}` : ''}</div>` : ''}
          <label>Grupa
            <input type="text" name="group_name" value="${escapeHtml(signup.group_name || '')}" maxlength="120" placeholder="np. wtorek 17:00">
          </label>
          <label>Opiekun zgłoszenia
            <input type="text" name="assigned_to" value="${escapeHtml(signup.assigned_to || '')}" maxlength="120" placeholder="kto oddzwania">
          </label>
          <label class="workshop-notes">Notatka właściciela
            <textarea name="owner_notes" maxlength="2000" rows="2">${escapeHtml(signup.owner_notes || '')}</textarea>
          </label>
          <button type="submit">Zapisz</button>
        </form>
      </td>
    </tr>`;
  };

  return `${saved ? '<div class="toast toast-ok">Zgłoszenie warsztatowe zapisane.</div>' : ''}
${invalid ? '<div class="toast toast-err">Nie zapisano. Sprawdź status, terminy i długość pól.</div>' : ''}
${membershipConflict ? '<div class="toast toast-err">Nie można oznaczyć zgłoszenia jako utraconego, dopóki ma otwarte członkostwo w grupie.</div>' : ''}

<nav class="tabs workshop-tabs">
  <a href="/admin/warsztaty" class="active">Lejek zgłoszeń</a>
  <a href="/admin/warsztaty/grupy">Grupy i zajęcia</a>
</nav>

<section class="workshop-stats" aria-label="Lejek zapisów">
  ${WORKSHOP_CRM_STATUSES.map(status => `<a href="?filter=${status}" class="workshop-stat">
    <strong>${counts[status] || 0}</strong><span>${escapeHtml(workshopStatusLabel(status))}</span>
  </a>`).join('')}
</section>

<section class="card">
  <h2>Kontakty do wykonania · ${dueCount}</h2>
  ${due.length === 0 ? '<p class="muted">Brak zaległych kontaktów.</p>' : `<ul class="workshop-due-list">
    ${due.map(item => `<li>
      <a href="/admin/warsztaty?filter=all#signup-${escapeHtml(item.id)}">${escapeHtml(item.parent_name)}</a>
      <span class="muted">${warsawDateTime(item.next_action_at)}</span>
      <a href="tel:${escapeHtml(item.phone)}">${escapeHtml(item.phone)}</a>
    </li>`).join('')}
  </ul>${dueCount > due.length ? `<p class="muted">Pokazano 50 najstarszych z ${dueCount} zaległych kontaktów.</p>` : ''}`}
</section>

<nav class="tabs workshop-tabs">
  ${filterTab('all', 'Wszystkie')}
  ${filterTab('due', 'Zaległe', dueCount)}
  ${WORKSHOP_CRM_STATUSES.map(status => filterTab(status, workshopStatusLabel(status), counts[status] || 0)).join('')}
</nav>

<section class="card">
  <h2>Zgłoszenia · ${signups.length}</h2>
  ${signups.length === 0 ? '<p class="muted">Brak zgłoszeń w tym widoku.</p>' : `<table class="cards workshop-table">
    <thead><tr><th>Zgłoszenie</th><th>Dziecko</th><th>Pozyskanie</th><th>CRM</th></tr></thead>
    <tbody>${signups.map(row).join('')}</tbody>
  </table>`}
</section>`;
}

function workshopGroupStatusLabel(status) {
  return { active: 'aktywna', paused: 'wstrzymana', completed: 'zakończona' }[status] || status;
}

function workshopMembershipStatusLabel(status) {
  return { trial: 'próbne', active: 'aktywny', paused: 'wstrzymany', ended: 'zakończony' }[status] || status;
}

function workshopSessionStatusLabel(status) {
  return { scheduled: 'zaplanowane', completed: 'zrealizowane', cancelled: 'odwołane' }[status] || status;
}

function workshopAttendanceStatusLabel(status) {
  return { unmarked: 'nieoznaczona', present: 'obecny', absent: 'nieobecny', excused: 'usprawiedliwiony' }[status] || status;
}

function workshopPaymentMethodLabel(method) {
  return { cash: 'gotówka', transfer: 'przelew', card: 'karta', voucher: 'voucher', other: 'inne' }[method] || method;
}

function parseWorkshopAmountGrosze(raw) {
  const value = String(raw || '').trim().replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(value)) return undefined;
  const [whole, fraction = ''] = value.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return amount >= 1 && amount <= 10000000 ? amount : undefined;
}

function workshopAmount(amountGrosze) {
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' })
    .format((Number(amountGrosze) || 0) / 100);
}

function workshopOperationsRedirect(type, value, anchor = '') {
  return redirect(`/admin/warsztaty/grupy?${type}=${encodeURIComponent(value)}${anchor ? `#${anchor}` : ''}`);
}

async function adminWorkshopOperations(env, url) {
  const now = Date.now();
  const historyFrom = now - 120 * 24 * 60 * 60 * 1000;
  const [groupsResult, signupsResult, membershipsResult, sessionsResult, attendanceResult, paymentsResult] = await Promise.all([
    env.DB.prepare(
      `SELECT g.*,
         (SELECT COUNT(*) FROM workshop_memberships m
          WHERE m.group_id=g.id AND m.status IN ('trial','active','paused')) AS member_count,
         COALESCE((SELECT SUM(p.amount_grosze) FROM workshop_payments p
          JOIN workshop_memberships pm ON pm.id=p.membership_id
          WHERE pm.group_id=g.id), 0) AS paid_grosze
       FROM workshop_groups g
       ORDER BY CASE g.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
         g.weekday, g.start_time, g.name`
    ).all(),
    env.DB.prepare(
      `SELECT s.id, s.parent_name, s.phone, s.child_age, s.level, s.status,
         m.id AS membership_id, m.group_id AS membership_group_id, g.name AS membership_group_name
       FROM workshop_signups s
       LEFT JOIN workshop_memberships m ON m.signup_id=s.id
         AND m.status IN ('trial','active','paused')
       LEFT JOIN workshop_groups g ON g.id=m.group_id
       WHERE s.status IN ('trial_booked','enrolled')
       ORDER BY s.parent_name LIMIT 500`
    ).all(),
    env.DB.prepare(
      `SELECT m.*, s.parent_name, s.phone, s.child_age, s.level,
         g.name AS group_name,
         COALESCE((SELECT SUM(p.amount_grosze) FROM workshop_payments p
                   WHERE p.membership_id=m.id), 0) AS paid_grosze
       FROM workshop_memberships m
       JOIN workshop_signups s ON s.id=m.signup_id
       JOIN workshop_groups g ON g.id=m.group_id
       ORDER BY g.name, m.started_at, s.parent_name LIMIT 1000`
    ).all(),
    env.DB.prepare(
      `SELECT s.*, g.name AS group_name
       FROM workshop_sessions s JOIN workshop_groups g ON g.id=s.group_id
       WHERE s.starts_at>=?1 OR s.status='scheduled'
       ORDER BY CASE WHEN s.starts_at>=?2 THEN 0 ELSE 1 END,
         CASE WHEN s.starts_at>=?2 THEN s.starts_at END ASC, s.starts_at DESC
       LIMIT 100`
    ).bind(historyFrom, now).all(),
    env.DB.prepare(
      `SELECT a.* FROM workshop_attendance a
       JOIN workshop_sessions s ON s.id=a.session_id
       WHERE s.starts_at>=?1 OR s.status='scheduled'`
    ).bind(historyFrom).all(),
    env.DB.prepare(
      `SELECT p.*, s.parent_name, g.name AS group_name
       FROM workshop_payments p
       JOIN workshop_memberships m ON m.id=p.membership_id
       JOIN workshop_signups s ON s.id=m.signup_id
       JOIN workshop_groups g ON g.id=m.group_id
       ORDER BY p.paid_at DESC, p.created_at DESC LIMIT 100`
    ).all(),
  ]);
  return adminShell('Grupy warsztatowe', renderWorkshopOperations({
    groups: groupsResult.results || [],
    signups: signupsResult.results || [],
    memberships: membershipsResult.results || [],
    sessions: sessionsResult.results || [],
    attendance: attendanceResult.results || [],
    payments: paymentsResult.results || [],
    saved: url.searchParams.get('saved') || '',
    error: url.searchParams.get('error') || '',
  }));
}

function renderWorkshopOperations({ groups, signups, memberships, sessions, attendance, payments, saved, error }) {
  const option = (value, current, label) =>
    `<option value="${escapeHtml(value)}"${value === current ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  const byGroup = (rows, groupId) => rows.filter(row => row.group_id === groupId);
  const openMemberships = rows => rows.filter(row => ['trial', 'active', 'paused'].includes(row.status));
  const attendanceByPair = new Map(
    attendance.map(row => [`${row.session_id}:${row.membership_id}`, row]),
  );
  const locationLabel = value => ({
    grodzisk: 'Grodzisk Maz.', milanowek: 'Milanówek', inne: 'inne',
  }[value] || value);
  const levelLabel = value => ({
    start: 'start', progress: 'progress', air: 'loty / triki', mixed: 'mieszany',
  }[value] || value);

  const groupForm = group => `<form method="post" action="/admin/warsztaty/grupy" class="workshop-ops-form">
    <input type="hidden" name="action" value="group_save">
    ${group ? `<input type="hidden" name="id" value="${escapeHtml(group.id)}">` : ''}
    <label>Nazwa
      <input name="name" value="${escapeHtml(group?.name || '')}" maxlength="100" required placeholder="np. Wtorek start 17:00">
    </label>
    <label>Status
      <select name="status">${WORKSHOP_GROUP_STATUSES.map(value => option(value, group?.status || 'active', workshopGroupStatusLabel(value))).join('')}</select>
    </label>
    <label>Lokalizacja
      <select name="location">${WORKSHOP_GROUP_LOCATIONS.map(value => option(value, group?.location || 'grodzisk', locationLabel(value))).join('')}</select>
    </label>
    <label>Poziom
      <select name="level">${WORKSHOP_GROUP_LEVELS.map(value => option(value, group?.level || 'mixed', levelLabel(value))).join('')}</select>
    </label>
    <label>Dzień
      <select name="weekday">${WORKSHOP_WEEKDAYS.map((label, value) => option(String(value), String(group?.weekday ?? 2), label)).join('')}</select>
    </label>
    <label>Godzina
      <input type="time" name="start_time" value="${escapeHtml(group?.start_time || '17:00')}" required>
    </label>
    <label>Czas (min)
      <input type="number" name="duration_minutes" value="${escapeHtml(group?.duration_minutes || 90)}" min="30" max="300" step="5" required>
    </label>
    <label>Limit miejsc
      <input type="number" name="capacity" value="${escapeHtml(group?.capacity || 6)}" min="1" max="6" required>
      <span class="muted">START/mieszany: 6, PROGRESS: 5, AIR: 4</span>
    </label>
    <label class="ops-wide">Notatka
      <textarea name="notes" maxlength="1000" rows="2">${escapeHtml(group?.notes || '')}</textarea>
    </label>
    <button type="submit">${group ? 'Zapisz grupę' : 'Utwórz grupę'}</button>
  </form>`;

  const memberRow = member => `<tr>
    <td data-label="Uczestnik">
      <strong>${escapeHtml(member.parent_name)}</strong>
      <div class="muted">${escapeHtml(member.child_age)} lat · ${escapeHtml(levelLabel(member.level))}</div>
      <a href="tel:${escapeHtml(member.phone)}">${escapeHtml(member.phone)}</a>
    </td>
    <td data-label="Członkostwo">
      <form method="post" action="/admin/warsztaty/grupy" class="ops-inline-form">
        <input type="hidden" name="action" value="membership_status">
        <input type="hidden" name="membership_id" value="${escapeHtml(member.id)}">
        <select name="status">${WORKSHOP_MEMBERSHIP_STATUSES.map(value => option(value, member.status, workshopMembershipStatusLabel(value))).join('')}</select>
        <button type="submit">Zapisz</button>
      </form>
    </td>
    <td data-label="Wpłaty"><strong>${escapeHtml(workshopAmount(member.paid_grosze))}</strong></td>
    <td data-label="Dodaj wpłatę">
      <form method="post" action="/admin/warsztaty/grupy" class="workshop-payment-form">
        <input type="hidden" name="action" value="payment_add">
        <input type="hidden" name="payment_id" value="${crypto.randomUUID()}">
        <input type="hidden" name="membership_id" value="${escapeHtml(member.id)}">
        <label>Kwota zł<input name="amount" inputmode="decimal" maxlength="9" required placeholder="200,00"></label>
        <label>Data<input type="date" name="paid_date" value="${todayInWarsaw()}" required></label>
        <label>Metoda<select name="method">${WORKSHOP_PAYMENT_METHODS.map(value => option(value, 'transfer', workshopPaymentMethodLabel(value))).join('')}</select></label>
        <label>Za okres<input name="period_label" maxlength="80" placeholder="np. sierpień"></label>
        <label>Notatka<input name="notes" maxlength="500"></label>
        <button type="submit">Dodaj</button>
      </form>
    </td>
  </tr>`;

  const groupCard = group => {
    const groupMembers = openMemberships(byGroup(memberships, group.id));
    const assignOptions = signups.map(signup => {
      const current = signup.membership_group_name ? ` · teraz: ${signup.membership_group_name}` : '';
      return `<option value="${escapeHtml(signup.id)}">${escapeHtml(signup.parent_name)} · ${escapeHtml(signup.child_age)} lat · ${escapeHtml(workshopStatusLabel(signup.status))}${escapeHtml(current)}</option>`;
    }).join('');
    return `<section class="card workshop-group-card" id="group-${escapeHtml(group.id)}">
      <div class="ops-heading">
        <div><h2>${escapeHtml(group.name)}</h2>
          <p class="muted">${escapeHtml(WORKSHOP_WEEKDAYS[group.weekday])}, ${escapeHtml(group.start_time)} · ${escapeHtml(locationLabel(group.location))} · ${escapeHtml(levelLabel(group.level))}</p>
        </div>
        <div><span class="badge badge-${escapeHtml(group.status)}">${escapeHtml(workshopGroupStatusLabel(group.status))}</span>
          <div class="muted">${escapeHtml(group.member_count)} / ${escapeHtml(group.capacity)} osób · ${escapeHtml(workshopAmount(group.paid_grosze))}</div>
        </div>
      </div>
      <details><summary>Edytuj ustawienia grupy</summary>${groupForm(group)}</details>
      ${group.status !== 'completed' ? `<div class="ops-actions-grid">
        <form method="post" action="/admin/warsztaty/grupy" class="workshop-ops-form ops-compact">
          <input type="hidden" name="action" value="membership_assign">
          <input type="hidden" name="group_id" value="${escapeHtml(group.id)}">
          <label class="ops-wide">Przypisz zgłoszenie
            <select name="signup_id" required><option value="">Wybierz osobę</option>${assignOptions}</select>
          </label>
          <label>Rodzaj
            <select name="status">${option('trial', 'trial', 'próbne')}${option('active', 'trial', 'stały uczestnik')}</select>
          </label>
          <button type="submit"${signups.length ? '' : ' disabled'}>Przypisz</button>
        </form>
        <form method="post" action="/admin/warsztaty/grupy" class="workshop-ops-form ops-compact">
          <input type="hidden" name="action" value="session_create">
          <input type="hidden" name="group_id" value="${escapeHtml(group.id)}">
          <label>Termin
            <input type="datetime-local" name="starts_at" required>
          </label>
          <label>Czas (min)
            <input type="number" name="duration_minutes" value="${escapeHtml(group.duration_minutes)}" min="30" max="300" step="5" required>
          </label>
          <label>Lokalizacja
            <select name="location">${WORKSHOP_GROUP_LOCATIONS.map(value => option(value, group.location, locationLabel(value))).join('')}</select>
          </label>
          <label>Notatka
            <input name="notes" maxlength="1000" placeholder="opcjonalnie">
          </label>
          <button type="submit">Dodaj zajęcia</button>
        </form>
      </div>` : ''}
      <h3>Uczestnicy</h3>
      ${groupMembers.length ? `<table class="cards workshop-members-table"><thead><tr><th>Uczestnik</th><th>Członkostwo</th><th>Wpłaty</th><th>Dodaj wpłatę</th></tr></thead><tbody>${groupMembers.map(memberRow).join('')}</tbody></table>` : '<p class="muted">Brak przypisanych uczestników.</p>'}
    </section>`;
  };

  const sessionCard = session => {
    const groupMembers = byGroup(memberships, session.group_id).filter(member =>
      Number(member.started_at) <= Number(session.starts_at)
      && (member.ended_at == null || Number(member.ended_at) >= Number(session.starts_at))
    );
    const attendanceRow = member => {
      const current = attendanceByPair.get(`${session.id}:${member.id}`);
      return `<tr>
        <td data-label="Uczestnik"><strong>${escapeHtml(member.parent_name)}</strong><div class="muted">${escapeHtml(workshopMembershipStatusLabel(member.status))}</div></td>
        <td data-label="Obecność">
          <form method="post" action="/admin/warsztaty/grupy" class="workshop-attendance-form">
            <input type="hidden" name="action" value="attendance_save">
            <input type="hidden" name="session_id" value="${escapeHtml(session.id)}">
            <input type="hidden" name="membership_id" value="${escapeHtml(member.id)}">
            <select name="status">${WORKSHOP_ATTENDANCE_STATUSES.map(value => option(value, current?.status || 'unmarked', workshopAttendanceStatusLabel(value))).join('')}</select>
            <input name="notes" value="${escapeHtml(current?.notes || '')}" maxlength="500" placeholder="notatka">
            <button type="submit">Zapisz</button>
          </form>
        </td>
      </tr>`;
    };
    return `<section class="card workshop-session-card status-${escapeHtml(session.status)}" id="session-${escapeHtml(session.id)}">
      <div class="ops-heading"><div><h2>${escapeHtml(session.group_name)}</h2>
        <p>${escapeHtml(warsawDateTime(session.starts_at))} do ${escapeHtml(warsawDateTime(session.ends_at))}</p>
        <p class="muted">${escapeHtml(locationLabel(session.location))}${session.notes ? ` · ${escapeHtml(session.notes)}` : ''}</p></div>
        <form method="post" action="/admin/warsztaty/grupy" class="ops-inline-form">
          <input type="hidden" name="action" value="session_status">
          <input type="hidden" name="session_id" value="${escapeHtml(session.id)}">
          <select name="status">${WORKSHOP_SESSION_STATUSES.map(value => option(value, session.status, workshopSessionStatusLabel(value))).join('')}</select>
          <button type="submit">Zapisz</button>
        </form>
      </div>
      ${groupMembers.length ? `<table class="cards"><thead><tr><th>Uczestnik</th><th>Obecność</th></tr></thead><tbody>${groupMembers.map(attendanceRow).join('')}</tbody></table>` : '<p class="muted">Brak uczestników do oznaczenia.</p>'}
    </section>`;
  };

  const paymentRow = payment => `<tr>
    <td data-label="Data">${escapeHtml(warsawDate(payment.paid_at))}</td>
    <td data-label="Uczestnik"><strong>${escapeHtml(payment.parent_name)}</strong><div class="muted">${escapeHtml(payment.group_name)}</div></td>
    <td data-label="Kwota"><strong>${escapeHtml(workshopAmount(payment.amount_grosze))}</strong></td>
    <td data-label="Metoda">${escapeHtml(workshopPaymentMethodLabel(payment.method))}</td>
    <td data-label="Opis">${escapeHtml(payment.period_label || '')}${payment.notes ? `<div class="muted">${escapeHtml(payment.notes)}</div>` : ''}</td>
  </tr>`;

  const savedLabels = {
    group: 'Grupa została zapisana.',
    membership: 'Przypisanie uczestnika zostało zapisane.',
    session: 'Termin zajęć został zapisany.',
    attendance: 'Obecność została zapisana.',
    payment: 'Wpłata została zapisana.',
  };
  return `${savedLabels[saved] ? `<div class="toast toast-ok">${savedLabels[saved]}</div>` : ''}
${error === 'invalid' ? '<div class="toast toast-err">Nie zapisano. Sprawdź pola, daty i dozwolone wartości.</div>' : ''}
${error === 'conflict' ? '<div class="toast toast-err">Nie zapisano. Dane zmieniły się lub kolidują z innym przypisaniem.</div>' : ''}
${error === 'full' ? '<div class="toast toast-err">Nie przypisano uczestnika. Grupa ma już komplet miejsc.</div>' : ''}
${error === 'capacity' ? '<div class="toast toast-err">Nie zmniejszono limitu poniżej aktualnej liczby uczestników.</div>' : ''}
${error === 'history' ? '<div class="toast toast-err">Zakończone członkostwo jest częścią historii i nie może zostać ponownie otwarte. Utwórz przypisanie do innej grupy.</div>' : ''}

<nav class="tabs workshop-tabs">
  <a href="/admin/warsztaty">Lejek zgłoszeń</a>
  <a href="/admin/warsztaty/grupy" class="active">Grupy i zajęcia</a>
</nav>

<section class="card" id="new-group"><h2>Nowa grupa</h2>${groupForm(null)}</section>

${groups.length ? groups.map(groupCard).join('') : '<section class="card"><p class="muted">Brak grup. Utwórz pierwszą grupę powyżej.</p></section>'}

<h2 class="ops-section-title">Terminy i obecności · ${sessions.length}</h2>
${sessions.length ? sessions.map(sessionCard).join('') : '<section class="card"><p class="muted">Brak zaplanowanych lub ostatnich zajęć.</p></section>'}

<section class="card"><h2>Ostatnie wpłaty</h2>
  ${payments.length ? `<table class="cards"><thead><tr><th>Data</th><th>Uczestnik</th><th>Kwota</th><th>Metoda</th><th>Opis</th></tr></thead><tbody>${payments.map(paymentRow).join('')}</tbody></table>` : '<p class="muted">Brak zarejestrowanych wpłat.</p>'}
</section>`;
}

async function adminWorkshopOperationsPost(request, env) {
  const form = await request.formData();
  const action = String(form.get('action') || '').trim();
  try {
    if (action === 'group_save') return await adminWorkshopGroupSave(form, env);
    if (action === 'membership_assign') return await adminWorkshopMembershipAssign(form, env);
    if (action === 'membership_status') return await adminWorkshopMembershipStatus(form, env);
    if (action === 'session_create') return await adminWorkshopSessionCreate(form, env);
    if (action === 'session_status') return await adminWorkshopSessionStatus(form, env);
    if (action === 'attendance_save') return await adminWorkshopAttendanceSave(form, env);
    if (action === 'payment_add') return await adminWorkshopPaymentAdd(form, env);
  } catch (e) {
    console.error('workshop operations action error', action, e);
    const message = String(e?.message || e);
    const error = message.includes('workshop_group_full') ? 'full' : 'conflict';
    return workshopOperationsRedirect('error', error);
  }
  return workshopOperationsRedirect('error', 'invalid');
}

async function adminWorkshopGroupSave(form, env) {
  const id = String(form.get('id') || '').trim();
  const name = String(form.get('name') || '').trim();
  const status = String(form.get('status') || '').trim();
  const location = String(form.get('location') || '').trim();
  const level = String(form.get('level') || '').trim();
  const startTime = String(form.get('start_time') || '').trim();
  const notes = String(form.get('notes') || '').trim();
  const weekday = Number(form.get('weekday'));
  const durationMinutes = Number(form.get('duration_minutes'));
  const capacity = Number(form.get('capacity'));
  if ((id && id.length > 100) || !name || name.length > 100
    || !WORKSHOP_GROUP_STATUSES.includes(status)
    || !WORKSHOP_GROUP_LOCATIONS.includes(location)
    || !WORKSHOP_GROUP_LEVELS.includes(level)
    || !Number.isInteger(weekday) || weekday < 0 || weekday > 6
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)
    || !Number.isInteger(durationMinutes) || durationMinutes < 30 || durationMinutes > 300
    || !Number.isInteger(capacity) || capacity < 1
    || capacity > workshopGroupCapacityLimit(level)
    || notes.length > 1000) {
    return workshopOperationsRedirect('error', 'invalid', id ? `group-${encodeURIComponent(id)}` : 'new-group');
  }

  const now = Date.now();
  if (id) {
    const current = await env.DB.prepare(
      `SELECT g.id, g.status,
         (SELECT COUNT(*) FROM workshop_memberships m WHERE m.group_id=g.id
          AND m.status IN ('trial','active','paused')) AS member_count
       FROM workshop_groups g WHERE g.id = ?1`
    ).bind(id).first();
    if (!current) return new Response('Nie ma takiej grupy', { status: 404 });
    if (capacity < Number(current.member_count)) {
      return workshopOperationsRedirect('error', 'capacity', `group-${encodeURIComponent(id)}`);
    }
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE workshop_groups SET name=?2, status=?3, location=?4, level=?5,
           weekday=?6, start_time=?7, duration_minutes=?8, capacity=?9,
           notes=?10, updated_at=?11 WHERE id=?1`
      ).bind(
        id, name, status, location, level, weekday, startTime, durationMinutes,
        capacity, notes || null, now,
      ),
      env.DB.prepare(
        `UPDATE workshop_signups SET group_name=?2, updated_at=?3
         WHERE id IN (SELECT signup_id FROM workshop_memberships
           WHERE group_id=?1 AND status IN ('trial','active','paused'))`
      ).bind(id, name, now),
    ]);
    await auditEvent(env, 'workshop_group', id, 'updated', {
      from_status: current.status,
      to_status: status,
    });
    return workshopOperationsRedirect('saved', 'group', `group-${encodeURIComponent(id)}`);
  }

  const groupId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO workshop_groups (
       id, name, status, location, level, weekday, start_time,
       duration_minutes, capacity, notes, created_at, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)`
  ).bind(
    groupId, name, status, location, level, weekday, startTime,
    durationMinutes, capacity, notes || null, now,
  ).run();
  await auditEvent(env, 'workshop_group', groupId, 'created', { status });
  return workshopOperationsRedirect('saved', 'group', `group-${encodeURIComponent(groupId)}`);
}

async function adminWorkshopMembershipAssign(form, env) {
  const groupId = String(form.get('group_id') || '').trim();
  const signupId = String(form.get('signup_id') || '').trim();
  const status = String(form.get('status') || '').trim();
  if (!groupId || groupId.length > 100 || !signupId || signupId.length > 100
    || !['trial', 'active'].includes(status)) {
    return workshopOperationsRedirect('error', 'invalid');
  }
  const [group, signup, currentOpen, existingPair] = await Promise.all([
    env.DB.prepare(
      `SELECT g.id, g.name, g.status, g.capacity,
         (SELECT COUNT(*) FROM workshop_memberships m WHERE m.group_id=g.id
          AND m.status IN ('trial','active','paused')) AS member_count
       FROM workshop_groups g WHERE g.id=?1 AND g.status IN ('active','paused')`
    ).bind(groupId).first(),
    env.DB.prepare(
      "SELECT id, status FROM workshop_signups WHERE id=?1 AND status IN ('trial_booked','enrolled')"
    ).bind(signupId).first(),
    env.DB.prepare(
      "SELECT id, group_id, status FROM workshop_memberships WHERE signup_id=?1 AND status IN ('trial','active','paused')"
    ).bind(signupId).first(),
    env.DB.prepare(
      'SELECT id, status FROM workshop_memberships WHERE group_id=?1 AND signup_id=?2'
    ).bind(groupId, signupId).first(),
  ]);
  if (!group || !signup) return workshopOperationsRedirect('error', 'invalid');
  if (existingPair?.status === 'ended') {
    return workshopOperationsRedirect('error', 'history', `group-${encodeURIComponent(groupId)}`);
  }
  if (currentOpen?.group_id !== groupId && Number(group.member_count) >= Number(group.capacity)) {
    return workshopOperationsRedirect('error', 'full', `group-${encodeURIComponent(groupId)}`);
  }

  const now = Date.now();
  const membershipId = existingPair?.id || crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE workshop_memberships SET status='ended', ended_at=?2, updated_at=?2
       WHERE signup_id=?1 AND group_id<>?3 AND status IN ('trial','active','paused')`
    ).bind(signupId, now, groupId),
    env.DB.prepare(
      `INSERT INTO workshop_memberships (
         id, group_id, signup_id, status, started_at, ended_at, notes, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?5, ?5)
       ON CONFLICT(group_id, signup_id) DO UPDATE SET
         status=excluded.status,
         started_at=CASE WHEN workshop_memberships.status='ended' THEN excluded.started_at
                         ELSE workshop_memberships.started_at END,
         ended_at=NULL, updated_at=excluded.updated_at`
    ).bind(membershipId, groupId, signupId, status, now),
    env.DB.prepare(
      `UPDATE workshop_signups SET group_name=?2,
         status=CASE WHEN ?3='active' THEN 'enrolled' ELSE status END,
         enrolled_at=CASE WHEN ?3='active' THEN COALESCE(enrolled_at, ?4) ELSE enrolled_at END,
         updated_at=?4 WHERE id=?1`
    ).bind(signupId, group.name, status, now),
  ]);
  await auditEvent(env, 'workshop_membership', membershipId, 'assigned', {
    signup_id: signupId,
    group_id: groupId,
    status,
    from_group_id: currentOpen?.group_id || null,
  });
  return workshopOperationsRedirect('saved', 'membership', `group-${encodeURIComponent(groupId)}`);
}

async function adminWorkshopMembershipStatus(form, env) {
  const id = String(form.get('membership_id') || '').trim();
  const status = String(form.get('status') || '').trim();
  if (!id || id.length > 100 || !WORKSHOP_MEMBERSHIP_STATUSES.includes(status)) {
    return workshopOperationsRedirect('error', 'invalid');
  }
  const current = await env.DB.prepare(
    `SELECT m.id, m.group_id, m.signup_id, m.status, g.name AS group_name,
       g.status AS group_status, g.capacity,
       (SELECT COUNT(*) FROM workshop_memberships counted
        WHERE counted.group_id=m.group_id
          AND counted.status IN ('trial','active','paused')) AS member_count
     FROM workshop_memberships m JOIN workshop_groups g ON g.id=m.group_id
     WHERE m.id=?1`
  ).bind(id).first();
  if (!current) return new Response('Nie ma takiego członkostwa', { status: 404 });
  if (current.status === 'ended') {
    if (status !== 'ended') {
      return workshopOperationsRedirect('error', 'history', `group-${encodeURIComponent(current.group_id)}`);
    }
    return workshopOperationsRedirect('saved', 'membership', `group-${encodeURIComponent(current.group_id)}`);
  }
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE workshop_memberships SET status=?2,
         ended_at=CASE WHEN ?2='ended' THEN COALESCE(ended_at, ?3) ELSE NULL END,
         updated_at=?3 WHERE id=?1`
    ).bind(id, status, now),
    env.DB.prepare(
      `UPDATE workshop_signups SET
         group_name=CASE
           WHEN ?2<>'ended' THEN ?4
           WHEN NOT EXISTS (SELECT 1 FROM workshop_memberships
             WHERE signup_id=?1 AND status IN ('trial','active','paused')) THEN NULL
           ELSE group_name END,
         status=CASE WHEN ?2='active' THEN 'enrolled' ELSE status END,
         enrolled_at=CASE WHEN ?2='active' THEN COALESCE(enrolled_at, ?3) ELSE enrolled_at END,
         updated_at=?3 WHERE id=?1`
    ).bind(current.signup_id, status, now, current.group_name),
  ]);
  await auditEvent(env, 'workshop_membership', id, 'status_changed', {
    from_status: current.status,
    to_status: status,
    signup_id: current.signup_id,
  });
  return workshopOperationsRedirect('saved', 'membership', `group-${encodeURIComponent(current.group_id)}`);
}

async function adminWorkshopSessionCreate(form, env) {
  const groupId = String(form.get('group_id') || '').trim();
  const location = String(form.get('location') || '').trim();
  const notes = String(form.get('notes') || '').trim();
  const startsAt = parseWarsawDateTimeInput(form.get('starts_at'));
  const durationMinutes = Number(form.get('duration_minutes'));
  const now = Date.now();
  const oldest = now - 366 * 24 * 60 * 60 * 1000;
  const furthest = now + 2 * 366 * 24 * 60 * 60 * 1000;
  if (!groupId || groupId.length > 100 || !WORKSHOP_GROUP_LOCATIONS.includes(location)
    || startsAt == null || startsAt === undefined || startsAt < oldest || startsAt > furthest
    || !Number.isInteger(durationMinutes) || durationMinutes < 30 || durationMinutes > 300
    || notes.length > 1000) {
    return workshopOperationsRedirect('error', 'invalid', `group-${encodeURIComponent(groupId)}`);
  }
  const group = await env.DB.prepare(
    "SELECT id FROM workshop_groups WHERE id=?1 AND status IN ('active','paused')"
  ).bind(groupId).first();
  if (!group) return workshopOperationsRedirect('error', 'invalid');

  const id = crypto.randomUUID();
  const endsAt = startsAt + durationMinutes * 60 * 1000;
  const overlap = await env.DB.prepare(
    `SELECT id FROM workshop_sessions
     WHERE group_id=?1 AND status<>'cancelled' AND starts_at<?2 AND ends_at>?3
     LIMIT 1`
  ).bind(groupId, endsAt, startsAt).first();
  if (overlap) {
    return workshopOperationsRedirect('error', 'conflict', `session-${encodeURIComponent(overlap.id)}`);
  }
  await env.DB.prepare(
    `INSERT INTO workshop_sessions (
       id, group_id, starts_at, ends_at, status, location, notes, created_at, updated_at
     ) VALUES (?1, ?2, ?3, ?4, 'scheduled', ?5, ?6, ?7, ?7)`
  ).bind(id, groupId, startsAt, endsAt, location, notes || null, now).run();
  await auditEvent(env, 'workshop_session', id, 'created', { group_id: groupId, starts_at: startsAt });
  return workshopOperationsRedirect('saved', 'session', `session-${encodeURIComponent(id)}`);
}

async function adminWorkshopSessionStatus(form, env) {
  const id = String(form.get('session_id') || '').trim();
  const status = String(form.get('status') || '').trim();
  if (!id || id.length > 100 || !WORKSHOP_SESSION_STATUSES.includes(status)) {
    return workshopOperationsRedirect('error', 'invalid');
  }
  const current = await env.DB.prepare(
    'SELECT id, group_id, starts_at, ends_at, status FROM workshop_sessions WHERE id=?1'
  ).bind(id).first();
  if (!current) return new Response('Nie ma takich zajęć', { status: 404 });
  if (status !== 'cancelled' && current.status === 'cancelled') {
    const overlap = await env.DB.prepare(
      `SELECT id FROM workshop_sessions
       WHERE group_id=?1 AND id<>?2 AND status<>'cancelled'
         AND starts_at<?3 AND ends_at>?4 LIMIT 1`
    ).bind(current.group_id, id, current.ends_at, current.starts_at).first();
    if (overlap) {
      return workshopOperationsRedirect('error', 'conflict', `session-${encodeURIComponent(overlap.id)}`);
    }
  }
  await env.DB.prepare(
    'UPDATE workshop_sessions SET status=?2, updated_at=?3 WHERE id=?1'
  ).bind(id, status, Date.now()).run();
  await auditEvent(env, 'workshop_session', id, 'status_changed', {
    from_status: current.status,
    to_status: status,
  });
  return workshopOperationsRedirect('saved', 'session', `session-${encodeURIComponent(id)}`);
}

async function adminWorkshopAttendanceSave(form, env) {
  const sessionId = String(form.get('session_id') || '').trim();
  const membershipId = String(form.get('membership_id') || '').trim();
  const status = String(form.get('status') || '').trim();
  const notes = String(form.get('notes') || '').trim();
  if (!sessionId || sessionId.length > 100 || !membershipId || membershipId.length > 100
    || !WORKSHOP_ATTENDANCE_STATUSES.includes(status) || notes.length > 500) {
    return workshopOperationsRedirect('error', 'invalid');
  }
  const relation = await env.DB.prepare(
    `SELECT s.id FROM workshop_sessions s
     JOIN workshop_memberships m ON m.group_id=s.group_id
     WHERE s.id=?1 AND m.id=?2
       AND m.started_at<=s.starts_at
       AND (m.ended_at IS NULL OR m.ended_at>=s.starts_at)`
  ).bind(sessionId, membershipId).first();
  if (!relation) return workshopOperationsRedirect('error', 'invalid');

  const existing = await env.DB.prepare(
    'SELECT id FROM workshop_attendance WHERE session_id=?1 AND membership_id=?2'
  ).bind(sessionId, membershipId).first();
  const id = existing?.id || crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO workshop_attendance (
       id, session_id, membership_id, status, notes, created_at, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
     ON CONFLICT(session_id, membership_id) DO UPDATE SET
       status=excluded.status, notes=excluded.notes, updated_at=excluded.updated_at`
  ).bind(id, sessionId, membershipId, status, notes || null, now).run();
  await auditEvent(env, 'workshop_attendance', id, 'recorded', {
    session_id: sessionId,
    membership_id: membershipId,
    status,
  });
  return workshopOperationsRedirect('saved', 'attendance', `session-${encodeURIComponent(sessionId)}`);
}

async function adminWorkshopPaymentAdd(form, env) {
  const paymentId = String(form.get('payment_id') || '').trim().toLowerCase();
  const membershipId = String(form.get('membership_id') || '').trim();
  const method = String(form.get('method') || '').trim();
  const paidDate = String(form.get('paid_date') || '').trim();
  const periodLabel = String(form.get('period_label') || '').trim();
  const notes = String(form.get('notes') || '').trim();
  const amountGrosze = parseWorkshopAmountGrosze(form.get('amount'));
  const paidAt = isValidDate(paidDate) ? parseWarsawDateTimeInput(`${paidDate}T12:00`) : undefined;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(paymentId)
    || !membershipId || membershipId.length > 100 || amountGrosze === undefined
    || !WORKSHOP_PAYMENT_METHODS.includes(method) || paidAt == null || paidAt === undefined
    || paidAt < Date.parse('2020-01-01T00:00:00Z')
    || paidAt > Date.now() + 24 * 60 * 60 * 1000
    || periodLabel.length > 80 || notes.length > 500) {
    return workshopOperationsRedirect('error', 'invalid');
  }
  const membership = await env.DB.prepare(
    'SELECT id, group_id, signup_id FROM workshop_memberships WHERE id=?1'
  ).bind(membershipId).first();
  if (!membership) return workshopOperationsRedirect('error', 'invalid');

  const samePayment = existing => existing
    && existing.membership_id === membershipId
    && Number(existing.amount_grosze) === amountGrosze
    && Number(existing.paid_at) === paidAt
    && existing.method === method
    && (existing.period_label || '') === periodLabel
    && (existing.notes || '') === notes;
  const readPayment = () => env.DB.prepare(
    `SELECT membership_id, amount_grosze, paid_at, method, period_label, notes
     FROM workshop_payments WHERE id=?1`
  ).bind(paymentId).first();
  const existingBefore = await readPayment();
  if (existingBefore) {
    return workshopOperationsRedirect(
      samePayment(existingBefore) ? 'saved' : 'error',
      samePayment(existingBefore) ? 'payment' : 'conflict',
      samePayment(existingBefore) ? `group-${encodeURIComponent(membership.group_id)}` : '',
    );
  }

  const now = Date.now();
  const auditMetadata = JSON.stringify({
    membership_id: membershipId,
    signup_id: membership.signup_id,
    amount_grosze: amountGrosze,
    method,
  });
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO workshop_payments (
         id, membership_id, amount_grosze, paid_at, method, period_label, notes, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    ).bind(
      paymentId, membershipId, amountGrosze, paidAt, method,
      periodLabel || null, notes || null, now,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO audit_events (
         id, entity_type, entity_id, action, metadata_json, created_at
       )
       SELECT ?8, 'workshop_payment', ?1, 'recorded', ?9, ?10
       WHERE EXISTS (
         SELECT 1 FROM workshop_payments
         WHERE id=?1 AND membership_id=?2 AND amount_grosze=?3 AND paid_at=?4
           AND method=?5 AND COALESCE(period_label, '')=?6 AND COALESCE(notes, '')=?7
       )`
    ).bind(
      paymentId, membershipId, amountGrosze, paidAt, method,
      periodLabel, notes, `workshop-payment:${paymentId}:recorded`, auditMetadata, now,
    ),
  ]);
  const stored = await readPayment();
  if (!samePayment(stored)) return workshopOperationsRedirect('error', 'conflict');
  return workshopOperationsRedirect('saved', 'payment', `group-${encodeURIComponent(membership.group_id)}`);
}

async function adminUpdateOutreach(request, env) {
  const form = await request.formData();
  const action = String(form.get('action') || '');
  const now = Date.now();

  if (action === 'add') {
    const brand_name = String(form.get('brand_name') || '').trim();
    const channel = String(form.get('channel') || '').trim();
    const contact_method = String(form.get('contact_method') || '').trim() || null;
    const notes = String(form.get('notes') || '').trim() || null;
    if (!brand_name || !['A','B','C'].includes(channel)) {
      return new Response('Bad', { status: 400 });
    }
    await env.DB.prepare(
      'INSERT INTO outreach_contacts (brand_name, channel, contact_method, status, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)'
    ).bind(brand_name, channel, contact_method, 'planned', notes, now).run();
  } else {
    const id = String(form.get('id') || '');
    if (!id) return new Response('Bad', { status: 400 });
    if (action === 'sent') {
      await env.DB.prepare(
        "UPDATE outreach_contacts SET status='sent', sent_at=?1, updated_at=?1 WHERE id=?2"
      ).bind(now, id).run();
    } else if (action === 'responded') {
      const response = String(form.get('response') || '').trim() || null;
      await env.DB.prepare(
        "UPDATE outreach_contacts SET status='responded', response=?1, updated_at=?2 WHERE id=?3"
      ).bind(response, now, id).run();
    } else if (action === 'closed') {
      await env.DB.prepare(
        "UPDATE outreach_contacts SET status='closed', updated_at=?1 WHERE id=?2"
      ).bind(now, id).run();
    } else if (action === 'reopen') {
      await env.DB.prepare(
        "UPDATE outreach_contacts SET status='planned', sent_at=NULL, updated_at=?1 WHERE id=?2"
      ).bind(now, id).run();
    } else if (action === 'notes') {
      const notes = String(form.get('notes') || '').trim() || null;
      await env.DB.prepare(
        "UPDATE outreach_contacts SET notes=?1, updated_at=?2 WHERE id=?3"
      ).bind(notes, now, id).run();
    } else if (action === 'delete') {
      await env.DB.prepare('DELETE FROM outreach_contacts WHERE id=?1').bind(id).run();
    } else {
      return new Response('Bad action', { status: 400 });
    }
  }
  return new Response('', { status: 302, headers: { 'Location': '/admin#outreach' } });
}

async function adminRefreshReviews(env) {
  let msg = 'ok';
  try {
    const result = await fetchGoogleReviews(env);
    msg = result || 'ok';
  } catch (e) {
    console.error('manual google reviews error', e);
    msg = 'error';
  }
  return new Response('', {
    status: 302,
    headers: { 'Location': '/admin?reviews=' + encodeURIComponent(msg) },
  });
}

async function adminLogin(request, env) {
  const form = await request.formData();
  const pw = String(form.get('password') || '');
  const expected = env.ADMIN_PASSWORD || '';
  if (!expected || !timingSafeEqual(pw, expected)) {
    // Brak konfiguracji tylko do logów (endpoint publiczny, komunikat nie zdradza stanu sekretów).
    if (!expected) console.warn('ADMIN_PASSWORD nie ustawione, logowanie do /admin niemożliwe');
    return loginPage('Złe hasło.');
  }
  const cookie = await makeSessionCookie(env);
  return new Response('', {
    status: 302,
    headers: {
      'Location': '/admin',
      'Set-Cookie': `__Host-admin=${cookie}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${7 * 24 * 3600}`,
    },
  });
}

// 302 na wskazany adres (skrót dla akcji POST panelu).
function redirect(loc) {
  return new Response('', { status: 302, headers: { 'Location': loc } });
}

// Dokleja parametr do ścieżki powrotu, szanując istniejący query string i #kotwicę.
function withParam(back, key, value) {
  const [base, hash] = String(back).split('#');
  const sep = base.includes('?') ? '&' : '?';
  return base + sep + key + '=' + encodeURIComponent(value) + (hash ? '#' + hash : '');
}

// Białe listy komunikatów toastów. Kod z URL-a mapuje się na stały tekst,
// więc surowa wartość parametru msg/err nigdy nie trafia do HTML.
const ADMIN_MSGS = {
  'potwierdzono-1': 'Rezerwacja potwierdzona. SMS do klienta wysłany.',
  'potwierdzono-0': 'Rezerwacja potwierdzona. SMS czeka w kolejce ponowień.',
  'przyjeto-1': 'Przyjęto do serwisu. SMS do klienta wysłany.',
  'przyjeto-0': 'Przyjęto do serwisu. SMS czeka w kolejce ponowień.',
  'przyjeto': 'Przyjęto do serwisu (bez SMS, rezerwacja nie ma telefonu).',
  'zrobione-1': 'Oznaczono jako zrobione. SMS z podsumowaniem wysłany do klienta.',
  'zrobione-0': 'Oznaczono jako zrobione. SMS czeka w kolejce ponowień.',
  'zrobione': 'Oznaczono jako zrobione.',
  'anulowano-1': 'Rezerwacja anulowana, slot zwolniony. SMS do klienta wysłany.',
  'anulowano-0': 'Rezerwacja anulowana. SMS czeka w kolejce ponowień.',
  'usunieto': 'Rezerwacja przeniesiona do archiwum.',
  'przywrocono-z-archiwum': 'Rezerwacja przywrócona z archiwum bez zmiany statusu.',
  'cena': 'Cena zapisana.',
  'dodano': 'Rezerwacja dodana.',
  'zablokowano': 'Termin zablokowany.',
  'odblokowano': 'Blokada usunięta.',
  'outbox-retry': 'Nieudane wiadomości wróciły do kolejki ponowień.',
  'outbox-resolved': 'Niepewny wynik wiadomości został rozstrzygnięty.',
};
const ADMIN_ERRS = {
  'slot-zajety': 'Ten slot ma już aktywną rezerwację (data + godzina). Zmień godzinę.',
  'rez-anulowana': 'Ta rezerwacja jest anulowana. Najpierw przywróć ją przyciskiem Przywróć.',
  'zla-kwota': 'Nieprawidłowa kwota. Wpisz liczbę w złotych.',
  'zla-data': 'Nieprawidłowa data.',
  'zla-godzina': 'Nieprawidłowa godzina. Użyj formatu HH:MM.',
  'zakres-za-dlugi': 'Zakres blokady może objąć najwyżej 60 dni.',
  'zle-dane': 'Uzupełnij poprawnie wszystkie pola.',
  'brak-telefonu': 'Ta rezerwacja nie ma numeru telefonu.',
  'archive-status': 'Archiwizować można tylko rezerwacje zrobione albo anulowane.',
  'outbox-state': 'Ta wiadomość nie ma już statusu wymagającego ręcznego rozstrzygnięcia.',
};

// Zielony/czerwony pasek u góry strony. Tekst wyłącznie z białych list powyżej
// (plus escapowana lista pól przy 'zle-dane'), nigdy surowy parametr z URL-a.
function adminToasts(msg, err, errFields = '') {
  const okText = ADMIN_MSGS[msg] || '';
  let errText = ADMIN_ERRS[err] || '';
  if (err === 'zle-dane' && errFields) errText = 'Uzupełnij poprawnie: ' + errFields;
  return (okText ? `<div class="toast toast-ok">${escapeHtml(okText)}</div>` : '')
    + (errText ? `<div class="toast toast-err">${escapeHtml(errText)}</div>` : '');
}

// Escapuje tekst do literału JS w atrybucie HTML (onsubmit="return confirm('...')").
// Kolejność: najpierw \\ i \', potem escapeHtml (encje wracają do znaków już po sparsowaniu atrybutu).
function confirmJs(text) {
  return escapeHtml(String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' '));
}
function confirmAttr(text) {
  return `onsubmit="return confirm('${confirmJs(text)}')"`;
}

async function adminUpdateBooking(request, env) {
  const form = await request.formData();
  const id = String(form.get('id') || '');
  const action = String(form.get('action') || '');
  if (!id) return new Response('Bad', { status: 400 });
  let back = String(form.get('back') || '/admin');
  if (!back.startsWith('/') || back.startsWith('//')) back = '/admin';
  const backWith = (key, code) => redirect(withParam(back, key, code));

  if (action === 'confirm') {
    const res = await confirmBooking(env, id);
    if (res.error === 'slot') return backWith('err', 'slot-zajety');
    return backWith('msg', res.notified ? 'potwierdzono-1' : 'potwierdzono-0');
  } else if (action === 'start') {
    // Przyjęcie roweru do serwisu: status 'in_progress' + SMS do klienta.
    // 'cancelled' jest wykluczone (wskrzeszenie anulowanej mogłoby kolidować ze slotem innej
    // aktywnej rezerwacji i wysłać fałszywy SMS o przyjęciu); kolizję z idx_bookings_active_slot
    // mapujemy na czytelny błąd, tak jak przy 'confirm' i 'done'.
    const b = await env.DB.prepare('SELECT * FROM bookings WHERE id=?1').bind(id).first();
    if (b && b.status === 'cancelled') return backWith('err', 'rez-anulowana');
    if (b && b.status !== 'in_progress' && b.status !== 'done') {
      const transitionAt = Date.now();
      try {
        // accepted_at stempluje się tu (raz), ręczna korekta daty idzie przez adminSaveFinance.
        await env.DB.prepare("UPDATE bookings SET status='in_progress', accepted_at=COALESCE(accepted_at, ?2) WHERE id=?1").bind(id, transitionAt).run();
      } catch (e) {
        if (/UNIQUE constraint/i.test(String(e?.message || e))) return backWith('err', 'slot-zajety');
        throw e;
      }
      await cancelStaleOutboxJobs(env, 'booking', id);
      await auditEvent(env, 'booking', id, 'status_changed', { from: b.status, to: 'in_progress' });
      if (b.customer_phone) {
        const ok = await queueSmsNotification(env, {
          entityType: 'booking', entityId: b.id, eventKey: `accepted_${transitionAt}`,
          recipient: b.customer_phone, body: repairAcceptedSms(b),
        });
        return backWith('msg', ok ? 'przyjeto-1' : 'przyjeto-0');
      }
      return backWith('msg', 'przyjeto');
    }
  } else if (action === 'done') {
    const before = await env.DB.prepare('SELECT * FROM bookings WHERE id=?1').bind(id).first();
    // Ten sam guard co przy 'start': anulowanej nie wskrzeszamy po cichu.
    if (before && before.status === 'cancelled') return backWith('err', 'rez-anulowana');
    const summary = String(form.get('repair_summary') || '').trim().slice(0, 300) || null;
    // Formularz „Zrobione" na dashboardzie przesyła też aktualną wartość pola ceny,
    // żeby kwota wpisana przed kliknięciem nie ginęła (SMS „Koszt" czyta final_price).
    let price = null;
    let writePrice = 0;
    const transitionAt = Date.now();
    if (form.has('final_price')) {
      const raw = String(form.get('final_price') || '').replace(',', '.').trim();
      // Zapis tylko przy niepustej kwocie: pusty submit (np. z nieświeżej karty drugiego
      // użytkownika panelu) nie może wyczyścić ceny zapisanej w międzyczasie; czyszczenie
      // ceny nadal możliwe przez akcję 'price' (przycisk ✓).
      if (raw !== '') {
        if (!/^\d+(\.\d+)?$/.test(raw)) return backWith('err', 'zla-kwota');
        price = Math.round(parseFloat(raw));
        if (price < 0 || price > 100000) return backWith('err', 'zla-kwota');
        writePrice = 1;
      }
    }
    try {
      await env.DB.prepare(
        `UPDATE bookings SET status='done', done_at=COALESCE(done_at, ?3),
           repair_summary=COALESCE(?2, repair_summary),
           final_price=CASE WHEN ?4=1 THEN ?5 ELSE final_price END
         WHERE id=?1`
      ).bind(id, summary, transitionAt, writePrice, price).run();
    } catch (e) {
      if (/UNIQUE constraint/i.test(String(e?.message || e))) return backWith('err', 'slot-zajety');
      throw e;
    }
    if (before) await cancelStaleOutboxJobs(env, 'booking', id);
    if (before && before.status !== 'done') {
      await auditEvent(env, 'booking', id, 'status_changed', { from: before.status, to: 'done' });
    }
    // SMS z podsumowaniem naprawy tylko przy realnym przejściu do 'done' (nie przy ponownym kliknięciu).
    if (before && before.status !== 'done' && before.customer_phone) {
      const fresh = await env.DB.prepare('SELECT * FROM bookings WHERE id=?1').bind(id).first();
      const ok = await queueSmsNotification(env, {
        entityType: 'booking', entityId: fresh.id, eventKey: `done_${transitionAt}`,
        recipient: fresh.customer_phone, body: repairDoneSms(fresh),
      });
      return backWith('msg', ok ? 'zrobione-1' : 'zrobione-0');
    }
    return backWith('msg', 'zrobione');
  } else if (action === 'cancel') {
    const res = await cancelBooking(env, id);
    return backWith('msg', res.notified ? 'anulowano-1' : 'anulowano-0');
  } else if (action === 'delete' || action === 'archive') {
    const b = await env.DB.prepare(
      'SELECT status, archived_at FROM bookings WHERE id=?1'
    ).bind(id).first();
    if (!b) return new Response('Nie ma takiej rezerwacji', { status: 404 });
    if (!['done', 'cancelled'].includes(b.status)) return backWith('err', 'archive-status');
    if (b.archived_at == null) {
      await env.DB.prepare(
        'UPDATE bookings SET archived_at=?2 WHERE id=?1 AND archived_at IS NULL'
      ).bind(id, Date.now()).run();
      await auditEvent(env, 'booking', id, 'archived', { status: b.status });
    }
    return backWith('msg', 'usunieto');
  } else if (action === 'unarchive') {
    const b = await env.DB.prepare(
      'SELECT status, archived_at FROM bookings WHERE id=?1'
    ).bind(id).first();
    if (!b) return new Response('Nie ma takiej rezerwacji', { status: 404 });
    if (b.archived_at != null) {
      await env.DB.prepare(
        'UPDATE bookings SET archived_at=NULL WHERE id=?1 AND archived_at IS NOT NULL'
      ).bind(id).run();
      await auditEvent(env, 'booking', id, 'unarchived', { status: b.status });
    }
    return backWith('msg', 'przywrocono-z-archiwum');
  } else if (action === 'price') {
    const raw = String(form.get('final_price') || '').replace(',', '.').trim();
    let price = null;
    if (raw !== '') {
      // Ścisły format, żeby "12abc" nie przeszło jako 12 przez parseFloat.
      if (!/^\d+(\.\d+)?$/.test(raw)) return backWith('err', 'zla-kwota');
      price = Math.round(parseFloat(raw));
      if (price < 0 || price > 100000) return backWith('err', 'zla-kwota');
    }
    await env.DB.prepare('UPDATE bookings SET final_price=?1 WHERE id=?2').bind(price, id).run();
    return backWith('msg', 'cena');
  } else {
    return new Response('Bad action', { status: 400 });
  }
  return redirect(back);
}

// Wspólna logika dla panelu admina i linku z SMS-a.

async function auditEvent(env, entityType, entityId, action, metadata = null) {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_events (id, entity_type, entity_id, action, metadata_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(
      crypto.randomUUID(), entityType, entityId, action,
      metadata ? JSON.stringify(metadata).slice(0, 2000) : null, Date.now(),
    ).run();
  } catch (e) {
    console.error('audit event error', e);
  }
}

const OUTBOX_MAX_ATTEMPTS = 8;

function bookingOutboxEventKind(eventKey) {
  const key = String(eventKey || '');
  for (const kind of ['confirmed', 'cancelled', 'accepted', 'done']) {
    if (key === kind || key.startsWith(kind + '_')) return kind;
  }
  if (key.startsWith('reminder_')) return 'reminder';
  if (key.startsWith('followup_')) return 'followup';
  if (key.startsWith('winback_')) return 'winback';
  if (key === 'customer_new_booking') return 'customer_new_booking';
  return null;
}

async function isOutboxJobCurrent(env, job) {
  if (job.entity_type === 'booking') {
    const kind = bookingOutboxEventKind(job.event_key);
    if (!kind) return true;
    const booking = await env.DB.prepare(
      `SELECT id, status, date, time_slot, customer_phone, reminder_sent_at,
              feedback_sent_at, winback_sent_at
       FROM bookings WHERE id=?1`
    ).bind(job.entity_id).first();
    if (!booking) return false;
    if (kind === 'confirmed') return booking.status === 'confirmed';
    if (kind === 'cancelled') return booking.status === 'cancelled';
    if (kind === 'accepted') return booking.status === 'in_progress';
    if (kind === 'done') return booking.status === 'done';
    if (kind === 'customer_new_booking') return booking.status === 'pending';
    if (kind === 'reminder') {
      const snapshot = /^reminder_24h_(\d{4}-\d{2}-\d{2})_(\d{2}:\d{2})$/.exec(
        String(job.event_key || ''),
      );
      return booking.status === 'confirmed' && booking.reminder_sent_at == null
        && booking.date === addDaysWarsaw(1)
        && snapshot?.[1] === booking.date && snapshot?.[2] === booking.time_slot;
    }
    if (kind === 'followup') {
      const snapshot = /^followup_(\d{4}-\d{2}-\d{2})$/.exec(String(job.event_key || ''));
      return booking.status === 'done' && booking.feedback_sent_at == null
        && snapshot?.[1] === booking.date
        && booking.date <= addDaysWarsaw(-3) && booking.date >= addDaysWarsaw(-30);
    }
    if (kind === 'winback') {
      const snapshot = /^winback_(\d{4}-\d{2}-\d{2})$/.exec(String(job.event_key || ''));
      if (env.WINBACK_ENABLED !== '1' || booking.status === 'cancelled'
        || booking.winback_sent_at != null || !booking.customer_phone
        || snapshot?.[1] !== booking.date
        || booking.date > addDaysWarsaw(-180) || booking.date < addDaysWarsaw(-540)) return false;
      const latest = await env.DB.prepare(
        `SELECT id,
           EXISTS (
             SELECT 1 FROM bookings history
             WHERE history.customer_phone=?1 AND history.status='done'
           ) AS has_done
         FROM bookings
         WHERE customer_phone=?1 AND status!='cancelled'
         ORDER BY date DESC, id DESC LIMIT 1`
      ).bind(booking.customer_phone).first();
      return latest?.id === booking.id && Number(latest.has_done) === 1;
    }
  }

  if (job.entity_type === 'workshop_signup') {
    const match = /^trial_invite_(\d{10,16})$/.exec(String(job.event_key || ''));
    if (!match) return true;
    const trialAt = Number(match[1]);
    const signup = await env.DB.prepare(
      'SELECT status, trial_at FROM workshop_signups WHERE id=?1'
    ).bind(job.entity_id).first();
    return signup?.status === 'trial_booked' && Number(signup.trial_at) === trialAt
      && Date.now() <= trialAt;
  }

  if (job.entity_type === 'seasonal_reminder') {
    const match = /^seasonal_(\d{4})$/.exec(String(job.event_key || ''));
    if (!match) return false;
    const year = Number(match[1]);
    const reminder = await env.DB.prepare(
      'SELECT unsubscribed_at, last_sent_year FROM seasonal_reminders WHERE id=?1'
    ).bind(job.entity_id).first();
    return Boolean(reminder) && reminder.unsubscribed_at == null
      && Number(reminder.last_sent_year || 0) < year;
  }

  return true;
}

async function cancelStaleOutboxJobs(env, entityType, entityId) {
  const rows = await env.DB.prepare(
    `SELECT * FROM notification_outbox
     WHERE entity_type=?1 AND entity_id=?2
       AND status IN ('pending','failed','sending')`
  ).bind(entityType, entityId).all();
  const stale = [];
  for (const job of rows.results || []) {
    if (!await isOutboxJobCurrent(env, job)) stale.push(job);
  }
  if (!stale.length) return 0;
  const now = Date.now();
  await env.DB.batch(stale.map(job => job.status === 'sending'
    ? env.DB.prepare(
      `UPDATE notification_outbox SET status='uncertain', updated_at=?2,
         last_error='Entity changed while delivery was in progress; provider outcome unknown'
       WHERE id=?1 AND status='sending'`
    ).bind(job.id, now)
    : env.DB.prepare(
      `UPDATE notification_outbox SET status='cancelled', updated_at=?2,
         last_error='Notification no longer matches current entity state'
       WHERE id=?1 AND status IN ('pending','failed')`
    ).bind(job.id, now)));
  return stale.length;
}

async function stampSentNotification(env, job, sentAt) {
  if (job.entity_type === 'booking') {
    const kind = bookingOutboxEventKind(job.event_key);
    if (kind === 'reminder') {
      await env.DB.prepare(
        `UPDATE bookings SET reminder_sent_at=COALESCE(reminder_sent_at, ?1)
         WHERE id=?2 AND status='confirmed'`
      ).bind(sentAt, job.entity_id).run();
    } else if (kind === 'followup') {
      await env.DB.prepare(
        `UPDATE bookings SET feedback_sent_at=COALESCE(feedback_sent_at, ?1)
         WHERE id=?2 AND status='done'`
      ).bind(sentAt, job.entity_id).run();
    } else if (kind === 'winback') {
      await env.DB.prepare(
        `UPDATE bookings SET winback_sent_at=COALESCE(winback_sent_at, ?1)
         WHERE id=?2 AND status!='cancelled'`
      ).bind(sentAt, job.entity_id).run();
    }
  } else if (job.entity_type === 'seasonal_reminder' && job.channel === 'email') {
    const sentYear = Number(String(job.event_key).replace(/^seasonal_/, ''));
    if (Number.isInteger(sentYear)) {
      await env.DB.prepare(
        `UPDATE seasonal_reminders SET sent_at=?1,
           last_sent_year=CASE WHEN COALESCE(last_sent_year, 0) < ?2 THEN ?2 ELSE last_sent_year END
         WHERE id=?3 AND unsubscribed_at IS NULL`
      ).bind(sentAt, sentYear, job.entity_id).run();
    }
  }
}

async function finalizeOutboxSent(env, job, options = {}) {
  const sentAt = Number(options.sentAt) || Date.now();
  const expectedStatus = options.expectedStatus || 'sending';
  const attempt = Number(options.attempt ?? job.attempt_count ?? 0);
  const statements = [env.DB.prepare(
    `UPDATE notification_outbox SET status='sent', attempt_count=?2,
       sent_at=COALESCE(sent_at, ?3), provider_message_id=COALESCE(?4, provider_message_id),
       updated_at=?3, last_error=?5 WHERE id=?1 AND status=?6`
  ).bind(
    job.id, attempt, sentAt, options.providerMessageId || null,
    options.lastError || null, expectedStatus,
  )];
  const deliveredChannel = options.deliveredChannel || '';
  if (job.entity_type === 'booking' && deliveredChannel === 'sms') {
    statements.push(env.DB.prepare(
      `INSERT OR IGNORE INTO messages (id, booking_id, direction, channel, body, created_at)
       SELECT ?1, ?2, 'out', 'sms', ?3, ?4
       WHERE EXISTS (SELECT 1 FROM notification_outbox WHERE id=?5 AND status='sent')`
    ).bind(
      'outbox:' + job.id, job.entity_id, options.deliveredBody || job.body, sentAt, job.id,
    ));
  }
  const kind = job.entity_type === 'booking' ? bookingOutboxEventKind(job.event_key) : null;
  if (kind === 'reminder') {
    statements.push(env.DB.prepare(
      `UPDATE bookings SET reminder_sent_at=COALESCE(reminder_sent_at, ?1)
       WHERE id=?2 AND status='confirmed'
         AND EXISTS (SELECT 1 FROM notification_outbox WHERE id=?3 AND status='sent')`
    ).bind(sentAt, job.entity_id, job.id));
  } else if (kind === 'followup') {
    statements.push(env.DB.prepare(
      `UPDATE bookings SET feedback_sent_at=COALESCE(feedback_sent_at, ?1)
       WHERE id=?2 AND status='done'
         AND EXISTS (SELECT 1 FROM notification_outbox WHERE id=?3 AND status='sent')`
    ).bind(sentAt, job.entity_id, job.id));
  } else if (kind === 'winback') {
    statements.push(env.DB.prepare(
      `UPDATE bookings SET winback_sent_at=COALESCE(winback_sent_at, ?1)
       WHERE id=?2 AND status!='cancelled'
         AND EXISTS (SELECT 1 FROM notification_outbox WHERE id=?3 AND status='sent')`
    ).bind(sentAt, job.entity_id, job.id));
  } else if (job.entity_type === 'seasonal_reminder' && job.channel === 'email') {
    const sentYear = Number(String(job.event_key).replace(/^seasonal_/, ''));
    if (Number.isInteger(sentYear)) {
      statements.push(env.DB.prepare(
        `UPDATE seasonal_reminders SET sent_at=?1,
           last_sent_year=CASE WHEN COALESCE(last_sent_year, 0) < ?2 THEN ?2 ELSE last_sent_year END
         WHERE id=?3 AND unsubscribed_at IS NULL
           AND EXISTS (SELECT 1 FROM notification_outbox WHERE id=?4 AND status='sent')`
      ).bind(sentAt, sentYear, job.entity_id, job.id));
    }
  }
  const results = await env.DB.batch(statements);
  return Number(results[0]?.meta?.changes || 0);
}

async function deliverOutboxJob(env, job) {
  if (!job || job.status !== 'pending' || Number(job.next_attempt_at) > Date.now()) return false;
  const claimTime = Date.now();
  const claim = await env.DB.prepare(
    `UPDATE notification_outbox SET status='sending', updated_at=?2
     WHERE id=?1 AND status='pending' AND next_attempt_at <= ?2`
  ).bind(job.id, claimTime).run();
  if ((claim.meta?.changes || 0) === 0) return false;
  if (!await isOutboxJobCurrent(env, job)) {
    await env.DB.prepare(
      `UPDATE notification_outbox SET status='cancelled', updated_at=?2,
         last_error='Notification no longer matches current entity state'
       WHERE id=?1 AND status='sending'`
    ).bind(job.id, Date.now()).run();
    return false;
  }
  const attempt = Number(job.attempt_count || 0) + 1;
  let ok = false;
  let uncertain = false;
  let providerMessageId = null;
  let deliveredChannel = job.channel;
  let deliveredBody = job.body;
  try {
    if (job.channel === 'sms') {
      const result = await sendSms(env, job.recipient, job.body, {
        idempotencyKey: job.id,
        returnResult: true,
      });
      ok = result.ok;
      uncertain = result.uncertain;
      providerMessageId = result.providerMessageId;
    } else if (job.channel === 'email' && env.RESEND_API_KEY) {
      providerMessageId = await resendSend(env.RESEND_API_KEY, JSON.parse(job.body), job.id);
      ok = true;
    } else if (job.channel === 'whatsapp') {
      const result = await sendWhatsApp(env, job.recipient, JSON.parse(job.body), { returnResult: true });
      ok = result.ok;
      uncertain = result.uncertain;
      providerMessageId = result.providerMessageId;
    } else if (job.channel === 'reminder_fallback') {
      const payload = JSON.parse(job.body);
      let whatsappResult = { ok: false, uncertain: false, providerMessageId: null };
      if (env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID) {
        whatsappResult = await sendWhatsApp(env, job.recipient, payload.whatsapp, { returnResult: true });
      }
      if (whatsappResult.ok) {
        ok = true;
        deliveredChannel = 'whatsapp';
        providerMessageId = whatsappResult.providerMessageId;
      } else if (whatsappResult.uncertain) {
        uncertain = true;
      } else {
        const smsResult = await sendSms(env, job.recipient, payload.sms, {
          idempotencyKey: job.id,
          returnResult: true,
        });
        ok = smsResult.ok;
        uncertain = smsResult.uncertain;
        providerMessageId = smsResult.providerMessageId;
        deliveredChannel = 'sms';
        deliveredBody = payload.sms;
      }
    }
  } catch (e) {
    console.error('outbox delivery error', job.channel, e);
    ok = false;
  }
  const now = Date.now();
  if (uncertain) {
    await env.DB.prepare(
      `UPDATE notification_outbox SET status='uncertain', attempt_count=?2,
         last_error='Provider outcome unknown; operator decision required', updated_at=?3
       WHERE id=?1 AND status='sending'`
    ).bind(job.id, attempt, now).run();
    return false;
  }
  if (ok) {
    const finalized = await finalizeOutboxSent(env, job, {
      expectedStatus: 'sending',
      sentAt: now,
      attempt,
      providerMessageId,
      deliveredChannel,
      deliveredBody,
    });
    return finalized > 0;
  }

  const exhausted = attempt >= OUTBOX_MAX_ATTEMPTS;
  const delay = Math.min(24 * 3600_000, 5 * 60_000 * (2 ** Math.max(0, attempt - 1)));
  await env.DB.prepare(
    `UPDATE notification_outbox SET status=?2, attempt_count=?3, next_attempt_at=?4,
       last_error=?5, updated_at=?6 WHERE id=?1 AND status='sending'`
  ).bind(
    job.id, exhausted ? 'failed' : 'pending', attempt, now + delay,
    'Provider unavailable or rejected the message', now,
  ).run();
  return false;
}

async function queueNotification(env, {
  entityType, entityId, eventKey, channel, recipient, body,
  reactivateCancelled = false, deferDelivery = false,
}) {
  if (!entityType || !entityId || !eventKey || !channel || !recipient || !body) return false;
  if (!['sms', 'email', 'whatsapp', 'reminder_fallback'].includes(channel)) return false;
  const id = crypto.randomUUID();
  const now = Date.now();
  const normalizedRecipient = channel === 'email'
    ? normalizeEmail(recipient)
    : normalizePhone(recipient);
  if (!normalizedRecipient) return false;
  const storedBody = channel === 'sms' ? String(body) : JSON.stringify(body);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO notification_outbox (
       id, entity_type, entity_id, event_key, channel, recipient, body,
       status, attempt_count, next_attempt_at, created_at, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', 0, ?8, ?8, ?8)`
  ).bind(id, entityType, entityId, eventKey, channel, normalizedRecipient, storedBody, now).run();
  if (reactivateCancelled) {
    await env.DB.prepare(
      `UPDATE notification_outbox SET status='pending', recipient=?5, body=?6,
         attempt_count=0, next_attempt_at=?7, last_error=NULL, updated_at=?7
       WHERE entity_type=?1 AND entity_id=?2 AND event_key=?3 AND channel=?4
         AND status='cancelled'
         AND last_error IN (
           'Trial date changed or invitation withdrawn',
           'Notification no longer matches current entity state'
         )`
    ).bind(
      entityType, entityId, eventKey, channel, normalizedRecipient, storedBody, now,
    ).run();
  }
  const job = await env.DB.prepare(
    `SELECT * FROM notification_outbox
     WHERE entity_type=?1 AND entity_id=?2 AND event_key=?3 AND channel=?4`
  ).bind(entityType, entityId, eventKey, channel).first();
  if (job?.status === 'sent') {
    await stampSentNotification(env, job, Number(job.sent_at) || now);
    return true;
  }
  if (deferDelivery) return false;
  return await deliverOutboxJob(env, job);
}

async function queueSmsNotification(env, details) {
  return await queueNotification(env, { ...details, channel: 'sms' });
}

async function queueEmailNotification(env, details) {
  return await queueNotification(env, { ...details, channel: 'email' });
}

async function queueWhatsAppNotification(env, details) {
  return await queueNotification(env, { ...details, channel: 'whatsapp' });
}

async function queueReminderNotification(env, details) {
  return await queueNotification(env, { ...details, channel: 'reminder_fallback' });
}

async function processNotificationOutbox(env) {
  const now = Date.now();
  // Po przerwaniu izolatu wynik wywołania dostawcy jest nieznany. Automatyczne
  // ponowienie grozi duplikatem, więc operator musi świadomie uruchomić retry.
  await env.DB.prepare(
    `UPDATE notification_outbox SET status='uncertain', updated_at=?1,
       last_error='Delivery outcome unknown after interrupted attempt; operator decision required'
     WHERE status='sending' AND updated_at <= ?2`
  ).bind(now, now - 10 * 60_000).run();
  const rows = await env.DB.prepare(
    `SELECT * FROM notification_outbox
     WHERE status='pending' AND next_attempt_at <= ?1
     ORDER BY next_attempt_at ASC LIMIT 50`
  ).bind(now).all();
  for (const job of rows.results || []) await deliverOutboxJob(env, job);
}

async function sendBookingLifecycleSms(env, booking, eventKey, text) {
  if (!booking?.id || !booking.customer_phone) return false;
  return await queueSmsNotification(env, {
    entityType: 'booking', entityId: booking.id, eventKey,
    recipient: booking.customer_phone, body: text,
  });
}

/** Potwierdza rezerwację, dodaje wpis do kalendarza i informuje klienta. */
async function confirmBooking(env, id, expectedStatus = null) {
  const before = await env.DB.prepare('SELECT * FROM bookings WHERE id=?1').bind(id).first();
  if (!before) return { ok: true, notified: false };
  if (expectedStatus && before.status !== expectedStatus) return { error: 'state' };
  const transitionAt = Date.now();
  // Status aktywny (!= cancelled), więc przywrócenie anulowanej rezerwacji,
  // której slot zajęła inna, narusza idx_bookings_active_slot. Mapujemy to na 'slot'.
  try {
    const updated = expectedStatus
      ? await env.DB.prepare(
        "UPDATE bookings SET status='confirmed', archived_at=NULL WHERE id=?1 AND status=?2"
      ).bind(id, expectedStatus).run()
      : await env.DB.prepare(
        "UPDATE bookings SET status='confirmed', archived_at=NULL WHERE id=?1"
      ).bind(id).run();
    if ((updated.meta?.changes || 0) === 0) return { error: 'state' };
  } catch (e) {
    if (/UNIQUE constraint/i.test(String(e?.message || e))) return { error: 'slot' };
    throw e;
  }
  if (before.status !== 'confirmed') {
    await auditEvent(env, 'booking', id, 'status_changed', { from: before.status, to: 'confirmed' });
  }
  await cancelStaleOutboxJobs(env, 'booking', id);
  // Wpis do kalendarza, best-effort, tylko raz. Błąd kalendarza nie psuje potwierdzenia.
  const b = await env.DB.prepare('SELECT * FROM bookings WHERE id=?1').bind(id).first();
  if (b && !b.gcal_event_id) {
    try {
      const eventId = await addToCalendar(env, b);
      if (eventId) {
        await env.DB.prepare('UPDATE bookings SET gcal_event_id=?1 WHERE id=?2').bind(eventId, id).run();
      }
    } catch (e) { console.error('Kalendarz error', e); }
  }
  const notified = before.status === 'confirmed'
    ? true
    : await sendBookingLifecycleSms(env, b, `confirmed_${transitionAt}`, bookingConfirmedSms(b));
  return { ok: true, notified };
}

/** Anuluje rezerwację, usuwa wpis z kalendarza i informuje klienta. */
async function cancelBooking(env, id, expectedStatus = null) {
  const b = await env.DB.prepare('SELECT * FROM bookings WHERE id=?1').bind(id).first();
  if (!b) return { ok: true, notified: false };
  if (expectedStatus && b.status !== expectedStatus) return { error: 'state' };
  const transitionAt = Date.now();
  const updated = expectedStatus
    ? await env.DB.prepare(
      "UPDATE bookings SET status='cancelled', gcal_event_id=NULL WHERE id=?1 AND status=?2"
    ).bind(id, expectedStatus).run()
    : await env.DB.prepare(
      "UPDATE bookings SET status='cancelled', gcal_event_id=NULL WHERE id=?1"
    ).bind(id).run();
  if ((updated.meta?.changes || 0) === 0) return { error: 'state' };
  if (b.status !== 'cancelled') {
    await auditEvent(env, 'booking', id, 'status_changed', { from: b.status, to: 'cancelled' });
  }
  await cancelStaleOutboxJobs(env, 'booking', id);
  if (b?.gcal_event_id) {
    try { await deleteCalendarEvent(env, b.gcal_event_id); } catch (e) { console.error('Kalendarz delete error', e); }
  }
  const notified = b.status === 'cancelled'
    ? true
    : await sendBookingLifecycleSms(env, b, `cancelled_${transitionAt}`, bookingCancelledSms(b));
  return { ok: true, notified };
}

// SMS po przyjęciu roweru do serwisu (status -> in_progress).
function repairAcceptedSms(b) {
  const firstName = (b.customer_name || '').split(' ')[0];
  return `Cześć ${firstName}! Przyjęliśmy Twój rower do serwisu (skocznarower.pl, Jesionowa 18, Grodzisk Maz.). Skoro już u nas jest, dorzucić przegląd albo centrowanie kół? Damy znać SMS-em, gdy będzie gotowy. W razie pytań: ${PUBLIC_PHONE_DISPLAY}.`;
}

// SMS z podsumowaniem naprawy (status -> done). Zakres: repair_summary, a jak puste, nazwa usługi.
function repairDoneSms(b) {
  const firstName = (b.customer_name || '').split(' ')[0];
  const svc = SERVICES.find(s => s.id === b.service_type)?.name || b.service_type;
  const zakres = (b.repair_summary && b.repair_summary.trim()) || svc;
  const koszt = b.final_price != null ? ` Koszt: ${b.final_price} zł.` : '';
  return `Cześć ${firstName}! Rower po serwisie jest gotowy do odbioru. Zakres: ${zakres}.${koszt} Adres: Jesionowa 18, Grodzisk Maz. Następnym razem umówisz się tutaj: skocznarower.pl/umow.`;
}

// Ręczne dodanie rezerwacji z panelu (telefon, Google Places, wejście z ulicy).
// Świadomie luźniejsze niż formularz publiczny: dopuszcza daty wsteczne i godziny spoza
// SCHEDULE (logujemy realne zdarzenia), nie wysyła powiadomień przy tworzeniu
// (SMS-y idą dopiero przy przyjęciu/zakończeniu naprawy). Status od razu 'confirmed';
// wpis do kalendarza tylko dla terminów dziś lub w przyszłości.
async function adminCreateBooking(request, env) {
  const form = await request.formData();
  const name = String(form.get('customer_name') || '').trim();
  const phone = normalizePhone(String(form.get('customer_phone') || ''));
  const email = String(form.get('customer_email') || '').trim() || null;
  const service_type = String(form.get('service_type') || '').trim();
  const bike_type = String(form.get('bike_type') || '').trim();
  const bike_model = String(form.get('bike_model') || '').trim().slice(0, 120) || null;
  const date = String(form.get('date') || '').trim();
  const time_slot = String(form.get('time_slot') || '').trim();
  const source = String(form.get('source') || '').trim();
  const rawNotes = String(form.get('notes') || '').trim().slice(0, 1000);

  const errors = [];
  if (name.length < 2 || name.length > 80) errors.push('imię');
  if (!/^(\+?48)?[0-9]{9}$/.test(phone)) errors.push('telefon');
  if (!SERVICES.some(s => s.id === service_type)) errors.push('usługa');
  if (!BIKE_TYPES.includes(bike_type)) errors.push('typ roweru');
  if (!['tel', 'google', 'inne'].includes(source)) errors.push('źródło');
  if (!isValidDate(date)) errors.push('data');
  // Realna godzina (odrzuca 99:99, które psuło sortowanie i insert do kalendarza).
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time_slot)) errors.push('godzina');

  // Przy błędzie wpisane wartości wracają w query, żeby formularz nie wyczyścił się do zera.
  const prefillQs = () => new URLSearchParams({
    mf_name: name, mf_phone: phone, mf_email: email || '', mf_service: service_type,
    mf_bike: bike_type, mf_model: bike_model || '', mf_date: date, mf_time: time_slot,
    mf_source: source, mf_notes: rawNotes,
  }).toString();
  if (errors.length) {
    return redirect('/admin?err=zle-dane&fields=' + encodeURIComponent(errors.join(', ')) + '&' + prefillQs() + '#dodaj');
  }

  const prefix = { tel: '[tel]', google: '[google]', inne: '[ręczna]' }[source];
  const notes = rawNotes ? `${prefix} ${rawNotes}` : `${prefix} dodane ręcznie w panelu`;

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO bookings (id, created_at, date, time_slot, service_type, bike_type, bike_model,
         customer_name, customer_phone, customer_email, notes, status, source)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'confirmed', ?12)`
    ).bind(
      id, Date.now(), date, time_slot, service_type, bike_type, bike_model,
      name, phone, email, notes, source,
    ).run();
  } catch (e) {
    if (/UNIQUE constraint/i.test(String(e?.message || e))) {
      return redirect('/admin?err=slot-zajety&' + prefillQs() + '#dodaj');
    }
    throw e;
  }
  await auditEvent(env, 'booking', id, 'created_manually', { source });

  // Kalendarz tylko dla terminów dziś/w przyszłości; wsteczne logi go nie potrzebują.
  if (date >= todayInWarsaw()) {
    try {
      const b = await env.DB.prepare('SELECT * FROM bookings WHERE id=?1').bind(id).first();
      const eventId = await addToCalendar(env, b);
      if (eventId) await env.DB.prepare('UPDATE bookings SET gcal_event_id=?1 WHERE id=?2').bind(eventId, id).run();
    } catch (e) { console.error('Kalendarz error (ręczna rezerwacja)', e); }
  }

  return redirect('/admin?msg=dodano');
}

// ─── ROZLICZENIE MATEUSZ / PIOTR ────────────────────────────────────────────
// Zysk do podziału = narzut na częściach (cena dla klienta - koszt) + robocizna.
// Podział 75% Mateusz / 25% Piotr; gdy usługę robi Mateusz sam -> 100% dla niego.
// Koszt części to zwrot (pass-through) dla tego, kto je kupił, nie zysk.
const SPLIT_MATEUSZ = 0.75;
const PAY_LABELS = { cash: 'gotówka', blik: 'BLIK 600370810', transfer: 'przelew' };
const PERSON_LABELS = { piotr: 'Piotr', mateusz: 'Mateusz', klient: 'klient' };

// Parsuje kwotę w zł z pola formularza. '' -> null (puste), błędny format -> undefined (sygnał błędu).
function parseZl(raw) {
  const s = String(raw ?? '').replace(',', '.').replace(/\s/g, '').trim();
  if (s === '') return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Math.round(parseFloat(s));
  if (n < 0 || n > 1000000) return undefined;
  return n;
}

// Kto fizycznie odebrał kasę: jawne paid_to, inaczej z metody (gotówka -> Piotr, BLIK/przelew -> Mateusz).
function paymentHolder(b) {
  if (b.paid_to === 'piotr' || b.paid_to === 'mateusz') return b.paid_to;
  return b.payment_method === 'cash' ? 'piotr' : 'mateusz';
}

function computeSettlement(b) {
  const partsCost = b.parts_cost || 0;
  const partsCharged = b.parts_charged || 0;
  const labor = b.labor_charge || 0;
  const hasOverride = b.final_price_override != null;
  // Cena dla klienta = ręczne nadpisanie, inaczej części + robocizna. Zysk do podziału liczony
  // od efektywnej ceny (total - koszt części), więc ryczałt/rabat z nadpisania też dzieli się 75/25.
  const total = hasOverride ? b.final_price_override : (partsCharged + labor);
  const partsMarkup = partsCharged - partsCost;        // narzut na częściach (informacyjnie, bez nadpisania)
  const profit = total - partsCost;                    // zysk do podziału
  const solo = b.service_by === 'mateusz';
  const mateuszProfit = solo ? profit : Math.round(profit * SPLIT_MATEUSZ);
  const piotrProfit = solo ? 0 : profit - mateuszProfit;
  const partsBuyer = b.parts_by === 'piotr' ? 'piotr' : (b.parts_by === 'klient' ? 'klient' : 'mateusz');
  const refundMateusz = partsBuyer === 'mateusz' ? partsCost : 0;
  const refundPiotr = partsBuyer === 'piotr' ? partsCost : 0;
  const owedMateusz = mateuszProfit + refundMateusz;   // ile należy się Mateuszowi z tego zlecenia
  const owedPiotr = piotrProfit + refundPiotr;         // ile należy się Piotrowi
  const paid = b.amount_paid || 0;
  const holder = paymentHolder(b);
  const collectedMateusz = holder === 'mateusz' ? paid : 0;
  const collectedPiotr = holder === 'piotr' ? paid : 0;
  const netMateusz = collectedMateusz - owedMateusz;   // dodatnie = trzyma nadwyżkę (powinien oddać)
  const netPiotr = collectedPiotr - owedPiotr;
  return {
    partsCost, partsCharged, labor, partsMarkup, profit, solo, hasOverride,
    mateuszProfit, piotrProfit, refundMateusz, refundPiotr, owedMateusz, owedPiotr,
    paid, holder, collectedMateusz, collectedPiotr, netMateusz, netPiotr, total, partsBuyer,
    hasFinance: b.parts_cost != null || b.parts_charged != null || b.labor_charge != null || b.amount_paid != null || b.final_price_override != null,
  };
}

function zl(n) { return `${n} zł`; }

// Data YYYY-MM-DD ze znacznika epoch ms, w strefie Warszawy.
function warsawDate(ms) {
  if (ms == null) return '';
  return new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });
}
// Data + godzina ze znacznika epoch ms (do osi czasu komunikacji).
function warsawDateTime(ms) {
  if (ms == null) return '';
  return new Date(ms).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
// YYYY-MM-DD -> epoch ms w południe UTC (≈13-14 Warszawa), żeby render daty nie skakał przez DST.
function dateToMs(dateStr) {
  if (!isValidDate(dateStr)) return null;
  const ms = Date.parse(dateStr + 'T12:00:00Z');
  return Number.isNaN(ms) ? null : ms;
}
// Numer w formacie wa_phone (E.164 bez +, np. 48600370810) do dopasowania w whatsapp_messages.
// Tolerancyjne na zapis +48 / 0048 / 9 cyfr.
function waPhoneKey(phoneRaw) {
  let p = String(phoneRaw || '').replace(/[^0-9]/g, '');   // same cyfry (gubi + i spacje)
  if (p.startsWith('0048')) p = p.slice(2);                // 0048... -> 48...
  if (p.length === 9) p = '48' + p;                        // lokalny 9-cyfrowy -> 48...
  return p;
}

// Oś czasu komunikacji z klientem: odtworzone wychodzące SMS-y cyklu (ze znaczników czasu),
// ręczne SMS-y z panelu (tabela messages) oraz przychodzące/wychodzące WhatsApp (po numerze).
async function buildTimeline(env, b) {
  const ev = [];
  // Etykiety neutralne dla stempli statusu (accepted_at może być wpisane ręcznie, a lifecycle SMS
  // jest best-effort). reminder/feedback stemplują się dopiero po udanej wysyłce, więc tam mówimy „SMS".
  if (b.created_at) ev.push({ ts: b.created_at, label: 'Rezerwacja utworzona', body: null, tag: '' });
  if (b.accepted_at) ev.push({ ts: b.accepted_at, label: 'Przyjęto do serwisu', body: null, tag: 'sms' });
  if (b.done_at) ev.push({ ts: b.done_at, label: 'Oznaczono jako gotowe', body: null, tag: 'sms' });
  if (b.reminder_sent_at) ev.push({ ts: b.reminder_sent_at, label: 'SMS wysłany: przypomnienie 24h', body: null, tag: 'sms' });
  if (b.feedback_sent_at) ev.push({ ts: b.feedback_sent_at, label: 'SMS wysłany: prośba o opinię', body: null, tag: 'sms' });

  try {
    const msgs = (await env.DB.prepare('SELECT * FROM messages WHERE booking_id=?1 ORDER BY created_at DESC LIMIT 50').bind(b.id).all()).results || [];
    for (const m of msgs) ev.push({ ts: m.created_at, label: 'SMS (panel) do klienta', body: m.body, tag: 'sms' });
  } catch (e) { console.error('timeline messages error', e); }

  try {
    const wa = (await env.DB.prepare('SELECT * FROM whatsapp_messages WHERE wa_phone=?1 ORDER BY created_at DESC LIMIT 30').bind(waPhoneKey(b.customer_phone)).all()).results || [];
    for (const w of wa) ev.push({ ts: w.created_at, label: 'WhatsApp ' + (w.direction === 'in' ? 'od klienta' : 'do klienta'), body: w.body, tag: 'wa po numerze' });
  } catch (e) { console.error('timeline whatsapp error', e); }

  ev.sort((a, c) => c.ts - a.ts);
  return ev;
}

// Wspólna powłoka HTML dla podstron panelu (ciemny motyw, te same style co dashboard).
function adminShell(title, bodyHtml) {
  return html(`<!doctype html><html lang="pl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · skocznarower.pl</title>
<meta name="robots" content="noindex,nofollow">
${ADMIN_STYLES}
</head><body>
<header class="topbar">
  <h1>${escapeHtml(title)}</h1>
  <div class="topbar-right">
    <a href="/admin" class="logout">← Rezerwacje</a>
    <a href="/admin/warsztaty" class="logout">Zgłoszenia</a>
    <a href="/admin/warsztaty/grupy" class="logout">Grupy</a>
    <!-- <a href="/admin/rozliczenie" class="logout">Rozliczenie</a> tymczasowo ukryte -->
    <a href="/admin/logout" class="logout">Wyloguj</a>
  </div>
</header>
${bodyHtml}
</body></html>`);
}

// Strona szczegółów jednego zlecenia: pełen widok naprawy (terminy, notatki, ceny, komunikacja).
async function adminBookingDetail(env, url) {
  const id = url.searchParams.get('id') || '';
  const b = await env.DB.prepare('SELECT * FROM bookings WHERE id=?1').bind(id).first();
  if (!b) return new Response('Nie ma takiego zlecenia', { status: 404 });
  const saved = url.searchParams.get('saved') === '1';
  const sent = url.searchParams.get('sent');
  const msg = url.searchParams.get('msg') || '';
  const err = url.searchParams.get('err') || '';
  const svc = SERVICES.find(s => s.id === b.service_type)?.name || b.service_type;
  const s = computeSettlement(b);
  const opt = (val, cur, label) => `<option value="${val}"${cur === val ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  const num = v => (v == null ? '' : v);
  const autoTotal = (b.parts_charged || 0) + (b.labor_charge || 0);
  const timeline = await buildTimeline(env, b);
  const back = '/admin/zlecenie?id=' + encodeURIComponent(id);

  const splitBox = s.hasFinance ? `
    <div class="calc">
      ${s.hasOverride
        ? `<div class="calc-row"><span>Cena końcowa (nadpisana)</span><b>${zl(s.total)}</b></div>
      <div class="calc-row"><span>minus koszt części</span><b>${zl(s.partsCost)}</b></div>`
        : `<div class="calc-row"><span>Narzut na częściach</span><b>${zl(s.partsMarkup)}</b></div>
      <div class="calc-row"><span>Robocizna</span><b>${zl(s.labor)}</b></div>`}
      <div class="calc-row total"><span>Zysk do podziału</span><b>${zl(s.profit)}</b></div>
      <div class="calc-row"><span>Mateusz${s.solo ? ' (usługa solo, 100%)' : ' (75%)'}</span><b>${zl(s.mateuszProfit)}</b></div>
      <div class="calc-row"><span>Piotr${s.solo ? ' (0%)' : ' (25%)'}</span><b>${zl(s.piotrProfit)}</b></div>
      <div class="calc-row"><span>Wycena dla klienta</span><b>${zl(s.total)}</b></div>
      <div class="calc-row"><span>Zapłacono (${PAY_LABELS[b.payment_method] || 'brak metody'}, odbiera ${PERSON_LABELS[s.holder]})</span><b>${zl(s.paid)}</b></div>
      ${b.amount_paid != null && s.paid !== s.total ? `<div class="calc-row warn"><span>Uwaga: zapłacono ≠ wycena</span><b>${zl(s.paid - s.total)}</b></div>` : ''}
    </div>` : '<p class="muted">Uzupełnij kwoty, żeby zobaczyć podział.</p>';

  const timelineHtml = timeline.length ? timeline.map(e => `
    <div class="tl-item${e.tag.startsWith('wa') ? ' tl-wa' : (e.tag === 'sms' ? ' tl-sms' : '')}">
      <div class="tl-when">${warsawDateTime(e.ts)}</div>
      <div class="tl-body"><b>${escapeHtml(e.label)}</b>${e.tag === 'wa po numerze' ? ' <span class="muted">(po numerze)</span>' : ''}${e.body ? `<div class="muted">${escapeHtml(e.body)}</div>` : ''}</div>
    </div>`).join('') : '<p class="muted">Brak zarejestrowanej komunikacji.</p>';

  const body = `
<section class="card">
  <h2>${escapeHtml(b.customer_name)} · ${escapeHtml(b.date)} ${escapeHtml(b.time_slot)} <span class="badge badge-${b.status}">${statusLabel(b.status)}</span></h2>
  ${adminToasts(msg, err)}
  ${saved ? '<p class="ok-msg">Zapisano.</p>' : ''}
  ${sent === '1' ? '<p class="ok-msg">SMS wysłany.</p>' : ''}
  ${sent === '0' ? '<p class="err-msg">Nie udało się wysłać SMS (sprawdź logi).</p>' : ''}
  <p class="muted">
    <b>${escapeHtml(svc)}</b> · ${escapeHtml(b.bike_type)}${b.bike_model ? ' · ' + escapeHtml(b.bike_model) : ''}<br>
    <a href="tel:${escapeHtml(b.customer_phone)}">${escapeHtml(b.customer_phone)}</a>${b.customer_email ? ' · <a href="mailto:' + escapeHtml(b.customer_email) + '">' + escapeHtml(b.customer_email) + '</a>' : ''}
  </p>

  <form method="post" action="/admin/zlecenie" class="finance-form">
    <input type="hidden" name="action" value="finance">
    <input type="hidden" name="id" value="${escapeHtml(b.id)}">

    <h4 class="sec-h">Terminy</h4>
    <div class="f2">
      <label>Termin przyjęcia<input type="date" name="accepted_date" value="${warsawDate(b.accepted_at)}"><span class="hint">auto przy „Przyjęto", możesz nadpisać</span></label>
      <label>Oczekiwany odbiór<input type="date" name="expected_ready_date" value="${escapeHtml(b.expected_ready_date || '')}" min="${b.date}"></label>
    </div>

    <h4 class="sec-h">Naprawa i notatki</h4>
    ${b.notes ? `<div class="ro-note"><span class="hint">Notatka klienta (z rezerwacji)</span>${escapeHtml(b.notes)}</div>` : ''}
    <label>Notatki warsztatu / info o naprawie<textarea name="repair_info" rows="3" maxlength="2000" placeholder="diagnoza, użyte części, uwagi wewnętrzne">${escapeHtml(b.repair_info || '')}</textarea></label>
    <label>Co zrobiono, krótko do SMS dla klienta<input type="text" name="repair_summary" value="${escapeHtml(b.repair_summary || '')}" maxlength="300" placeholder="np. odpowietrzone hamulce, wymiana klocków"></label>
    <label>Model roweru<input type="text" name="bike_model" value="${escapeHtml(b.bike_model || '')}" maxlength="120" placeholder="np. Woom 3, Trek Marlin 5"></label>

    <h4 class="sec-h">Ceny i płatność</h4>
    <div class="f2">
      <label>Koszt części (wydane)<input type="text" name="parts_cost" value="${num(b.parts_cost)}" inputmode="decimal" placeholder="zł"></label>
      <label>Cena części dla klienta<input type="text" name="parts_charged" value="${num(b.parts_charged)}" inputmode="decimal" placeholder="zł (z narzutem)"></label>
      <label>Robocizna (cena usługi)<input type="text" name="labor_charge" value="${num(b.labor_charge)}" inputmode="decimal" placeholder="zł"></label>
      <label>Cena końcowa dla klienta<input type="text" name="final_price_override" value="${num(b.final_price_override)}" inputmode="decimal" placeholder="auto: ${autoTotal} zł"><span class="hint">puste = auto (części + robocizna)</span></label>
      <label>Ile klient zapłacił<input type="text" name="amount_paid" value="${num(b.amount_paid)}" inputmode="decimal" placeholder="zł"></label>
      <label>Metoda płatności
        <select name="payment_method">${opt('', b.payment_method || '', '(brak)')}${opt('cash', b.payment_method, 'gotówka')}${opt('blik', b.payment_method, 'BLIK 600370810')}${opt('transfer', b.payment_method, 'przelew')}</select>
      </label>
      <label>Kto wykonał usługę
        <select name="service_by">${opt('piotr', b.service_by || 'piotr', 'Piotr')}${opt('mateusz', b.service_by, 'Mateusz (solo, 100%)')}</select>
      </label>
      <label>Kto kupił części
        <select name="parts_by">${opt('mateusz', b.parts_by || 'mateusz', 'Mateusz')}${opt('piotr', b.parts_by, 'Piotr')}${opt('klient', b.parts_by, 'Klient sam')}</select>
      </label>
      <label>Kasę odebrał (puste = z metody)
        <select name="paid_to">${opt('', b.paid_to || '', 'auto z metody')}${opt('piotr', b.paid_to, 'Piotr')}${opt('mateusz', b.paid_to, 'Mateusz')}</select>
      </label>
    </div>
    <button type="submit">Zapisz zlecenie</button>
    <span class="hint">Zapisuje wszystkie sekcje: Terminy, Naprawa i notatki, Ceny i płatność.</span>
  </form>

  <details class="split-details">
    <summary>Podział Mateusz / Piotr</summary>
    ${splitBox}
  </details>

  <form method="post" action="/admin/booking" class="actions" style="margin-top:16px">
    <input type="hidden" name="id" value="${escapeHtml(b.id)}">
    <input type="hidden" name="back" value="${escapeHtml(back)}">
    ${b.status === 'pending' ? '<button name="action" value="confirm" class="btn-ok">Potwierdź</button>' : ''}
    ${b.status !== 'in_progress' && b.status !== 'done' && b.status !== 'cancelled' ? `<button name="action" value="start" class="btn-ok" onclick="return confirm('Przyjąć rower do serwisu? Klient dostanie SMS o przyjęciu.')">Przyjęto</button>` : ''}
    ${b.status !== 'done' && b.status !== 'cancelled' ? `<button name="action" value="done" class="btn-ok" onclick="return confirm('Oznaczyć jako zrobione? Klient dostanie SMS z podsumowaniem i kosztem.')">Zrobione</button>` : ''}
    ${b.status !== 'cancelled' ? `<button name="action" value="cancel" class="btn-warn" onclick="return confirm('Anulować rezerwację? Slot zostanie zwolniony.')">Anuluj</button>` : ''}
  </form>
</section>

<section class="card">
  <h2>Komunikacja z klientem</h2>
  <form method="post" action="/admin/zlecenie" class="sms-form">
    <input type="hidden" name="action" value="send_sms">
    <input type="hidden" name="id" value="${escapeHtml(b.id)}">
    <textarea name="body" rows="2" maxlength="480" placeholder="Treść SMS do klienta (${escapeHtml(b.customer_phone)})" required></textarea>
    <button type="submit" onclick="return confirm('Wysłać SMS do klienta?')">Wyślij SMS</button>
  </form>
  <div class="timeline">${timelineHtml}</div>
  <p class="muted" style="margin-top:8px">Historia odtworzona z wysłanych SMS-ów i przychodzących WhatsApp; nie potwierdza doręczenia.</p>
</section>

<script>
(function () {
  // Ostrzeżenie przed utratą niezapisanych pól zlecenia przy akcjach statusu
  // (Przyjęto/Zrobione/Anuluj wysyłają osobny formularz i nie zapisują finance-form).
  var f = document.querySelector('.finance-form');
  var a = document.querySelector('form.actions');
  if (!f || !a) return;
  var snap = new URLSearchParams(new FormData(f)).toString();
  a.addEventListener('submit', function (e) {
    var now = new URLSearchParams(new FormData(f)).toString();
    if (now !== snap && !confirm('Masz niezapisane zmiany w polach zlecenia. Kontynuować bez ich zapisu?')) {
      e.preventDefault();
    }
  });
})();
</script>`;
  return adminShell('Zlecenie', body);
}

// Dispatcher POST /admin/zlecenie: zapis pól zlecenia albo wysyłka SMS do klienta.
async function adminZleceniePost(request, env) {
  const form = await request.formData();
  const action = String(form.get('action') || '');
  if (action === 'send_sms') return adminSendSms(env, form);
  return adminSaveFinance(env, form);
}

// Zapis pól zlecenia (terminy, notatki, ceny). final_price = ręczne nadpisanie albo
// auto (części + robocizna), żeby SMS „Koszt" i przychód były spójne.
async function adminSaveFinance(env, form) {
  const id = String(form.get('id') || '');
  if (!id) return new Response('Bad', { status: 400 });
  const cur = await env.DB.prepare('SELECT accepted_at, final_price_override, final_price FROM bookings WHERE id=?1').bind(id).first();
  if (!cur) return new Response('Nie ma takiego zlecenia', { status: 404 });
  const backTo = '/admin/zlecenie?id=' + encodeURIComponent(id);

  const partsCost = parseZl(form.get('parts_cost'));
  const partsCharged = parseZl(form.get('parts_charged'));
  const labor = parseZl(form.get('labor_charge'));
  const paid = parseZl(form.get('amount_paid'));
  const override = parseZl(form.get('final_price_override'));
  if ([partsCost, partsCharged, labor, paid, override].some(v => v === undefined)) {
    return redirect(withParam(backTo, 'err', 'zla-kwota'));
  }
  const bikeModel = String(form.get('bike_model') || '').trim().slice(0, 120) || null;
  const summary = String(form.get('repair_summary') || '').trim().slice(0, 300) || null;
  const repairInfo = String(form.get('repair_info') || '').trim().slice(0, 2000) || null;
  const method = ['cash', 'blik', 'transfer'].includes(String(form.get('payment_method'))) ? String(form.get('payment_method')) : null;
  const serviceBy = ['piotr', 'mateusz'].includes(String(form.get('service_by'))) ? String(form.get('service_by')) : 'piotr';
  const partsBy = ['mateusz', 'piotr', 'klient'].includes(String(form.get('parts_by'))) ? String(form.get('parts_by')) : 'mateusz';
  const paidTo = ['piotr', 'mateusz'].includes(String(form.get('paid_to'))) ? String(form.get('paid_to')) : null;

  const expectedRaw = String(form.get('expected_ready_date') || '').trim();
  if (expectedRaw && !isValidDate(expectedRaw)) return redirect(withParam(backTo, 'err', 'zla-data'));
  const expectedReady = expectedRaw || null;

  // Termin przyjęcia: puste pole NIE kasuje istniejącego stempla (z akcji „Przyjęto"); zachowaj
  // dokładny ms, jeśli data się nie zmieniła; inaczej z pola (południe UTC).
  const acceptedRaw = String(form.get('accepted_date') || '').trim();
  let acceptedAt;
  if (!acceptedRaw) acceptedAt = cur.accepted_at;
  else if (cur.accepted_at != null && warsawDate(cur.accepted_at) === acceptedRaw) acceptedAt = cur.accepted_at;
  else { acceptedAt = dateToMs(acceptedRaw); if (acceptedAt == null) return redirect(withParam(backTo, 'err', 'zla-data')); }

  // final_price = ręczne nadpisanie, inaczej auto (części + robocizna). Zapisujemy też, gdy
  // czyścimy poprzednie źródło (cur.final_price_override lub cur.final_price już ustawione),
  // żeby final_price nie został stary po wyczyszczeniu obu pól bez użycia override.
  const autoTotal = (partsCharged != null || labor != null) ? (partsCharged || 0) + (labor || 0) : null;
  const finalPrice = override != null ? override : autoTotal;
  const writeFinal = (override != null || autoTotal != null
    || cur.final_price_override != null || cur.final_price != null) ? 1 : 0;

  await env.DB.prepare(
    `UPDATE bookings SET
       bike_model=?2, parts_cost=?3, parts_charged=?4, labor_charge=?5, amount_paid=?6,
       payment_method=?7, service_by=?8, parts_by=?9, paid_to=?10, repair_summary=?11,
       repair_info=?12, expected_ready_date=?13, accepted_at=?14, final_price_override=?15,
       final_price=CASE WHEN ?17=1 THEN ?16 ELSE final_price END
     WHERE id=?1`
  ).bind(id, bikeModel, partsCost, partsCharged, labor, paid, method, serviceBy, partsBy, paidTo,
    summary, repairInfo, expectedReady, acceptedAt, override, finalPrice, writeFinal).run();

  return new Response('', { status: 302, headers: { 'Location': '/admin/zlecenie?id=' + encodeURIComponent(id) + '&saved=1' } });
}

// Wysyłka ręcznego SMS do klienta z panelu; zapis w tabeli messages (na oś czasu).
async function adminSendSms(env, form) {
  const id = String(form.get('id') || '');
  const text = String(form.get('body') || '').trim().slice(0, 480);
  if (!id || !text) return new Response('Bad', { status: 400 });
  const b = await env.DB.prepare('SELECT customer_phone FROM bookings WHERE id=?1').bind(id).first();
  if (!b) return new Response('Nie ma takiego zlecenia', { status: 404 });
  if (!b.customer_phone) {
    return redirect(withParam('/admin/zlecenie?id=' + encodeURIComponent(id), 'err', 'brak-telefonu'));
  }

  const ok = await sendSms(env, b.customer_phone, text).catch(e => { console.error('SMS panel error', e); return false; });
  if (ok) {
    await env.DB.prepare('INSERT INTO messages (id, booking_id, direction, channel, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(crypto.randomUUID(), id, 'out', 'sms', text, Date.now()).run();
  }
  return new Response('', { status: 302, headers: { 'Location': '/admin/zlecenie?id=' + encodeURIComponent(id) + '&sent=' + (ok ? '1' : '0') } });
}

// Strona rozliczeń: zlecenia 'done' z wyliczonym podziałem + zbiorcze saldo Mateusz/Piotr.
async function adminSettlement(env, url) {
  const showAll = url.searchParams.get('show') === 'all';
  const where = showAll ? "WHERE status='done'" : "WHERE status='done' AND settled_at IS NULL";
  const rows = (await env.DB.prepare(
    `SELECT * FROM bookings ${where} ORDER BY date DESC, time_slot DESC LIMIT 500`
  ).all()).results || [];

  let sumPiotr = 0, sumMateusz = 0, netPiotr = 0, netMateusz = 0, missing = 0;
  const lines = rows.map(b => {
    const s = computeSettlement(b);
    if (!s.hasFinance) { missing++; }
    else {
      sumPiotr += s.piotrProfit; sumMateusz += s.mateuszProfit;
      netPiotr += s.netPiotr; netMateusz += s.netMateusz;
    }
    const det = '/admin/zlecenie?id=' + encodeURIComponent(b.id);
    return `<tr class="${b.settled_at ? 'settled' : ''}">
      <td data-label="Zlecenie"><div class="date">${escapeHtml(b.date)}</div><div class="muted">${escapeHtml(b.customer_name)}</div></td>
      <td data-label="Wycena">${s.hasFinance ? zl(s.total) : '<span class="muted">brak danych</span>'}</td>
      <td data-label="Zysk">${s.hasFinance ? zl(s.profit) : '–'}</td>
      <td data-label="Mateusz">${s.hasFinance ? zl(s.mateuszProfit) : '–'}</td>
      <td data-label="Piotr">${s.hasFinance ? zl(s.piotrProfit) : '–'}</td>
      <td data-label="Płatność">${s.hasFinance ? `${PAY_LABELS[b.payment_method] || '?'} → ${PERSON_LABELS[s.holder]}` : '–'}</td>
      <td class="actions">
        <a href="${escapeHtml(det)}" class="btn-ok">Otwórz</a>
        ${b.settled_at
          ? `<form method="post" action="/admin/rozliczenie" style="display:inline"><input type="hidden" name="id" value="${escapeHtml(b.id)}"><button name="action" value="unsettle" class="btn-warn">Cofnij</button></form>`
          : `<form method="post" action="/admin/rozliczenie" style="display:inline"><input type="hidden" name="id" value="${escapeHtml(b.id)}"><button name="action" value="settle" class="btn-ok">Rozliczone</button></form>`}
      </td>
    </tr>`;
  }).join('');

  // Saldo: dodatnie net = osoba trzyma nadwyżkę i powinna oddać drugiej.
  // Przelew ograniczony do mniejszej z (nadwyżka, niedobór), żeby przy nad/niedopłacie klienta
  // nie kazać oddać więcej gotówki niż się fizycznie trzyma (resztę absorbuje nad/niedopłata).
  const transfer = Math.min(Math.abs(netPiotr), Math.abs(netMateusz));
  let saldoMsg;
  if (netPiotr > 0 && netMateusz < 0 && transfer > 0) saldoMsg = `Piotr trzyma nadwyżkę i przekazuje Mateuszowi <b>${zl(transfer)}</b>.`;
  else if (netMateusz > 0 && netPiotr < 0 && transfer > 0) saldoMsg = `Mateusz przekazuje Piotrowi <b>${zl(transfer)}</b>.`;
  else if (netPiotr === 0 && netMateusz === 0) saldoMsg = 'Rozliczone do zera.';
  else saldoMsg = `Saldo Piotr: ${zl(netPiotr)}, Mateusz: ${zl(netMateusz)}.`;

  const body = `
<section class="card">
  <h2>Rozliczenie ${showAll ? '(wszystkie zrobione)' : '(nierozliczone)'}</h2>
  <nav class="tabs" style="margin-bottom:12px">
    <a href="/admin/rozliczenie" class="${!showAll ? 'active' : ''}">Nierozliczone</a>
    <a href="/admin/rozliczenie?show=all" class="${showAll ? 'active' : ''}">Wszystkie</a>
  </nav>
  <div class="calc" style="max-width:420px;margin-bottom:18px">
    <div class="calc-row"><span>Zysk Piotra (25% z jego zleceń)</span><b>${zl(sumPiotr)}</b></div>
    <div class="calc-row"><span>Zysk Mateusza</span><b>${zl(sumMateusz)}</b></div>
    <div class="calc-row total"><span>Do wyrównania</span></div>
    <div class="calc-row"><span>${saldoMsg}</span></div>
    ${missing ? `<div class="calc-row warn"><span>Zleceń bez danych finansowych</span><b>${missing}</b></div>` : ''}
  </div>
  ${rows.length === 0 ? '<p class="muted">Brak zleceń.</p>' : `
  <table class="cards">
    <thead><tr><th>Zlecenie</th><th>Wycena</th><th>Zysk</th><th>Mateusz</th><th>Piotr</th><th>Płatność</th><th></th></tr></thead>
    <tbody>${lines}</tbody>
  </table>`}
  <p class="muted" style="margin-top:10px">„Rozliczone" chowa zlecenie z listy nierozliczonych po przekazaniu kasy. Kwoty edytujesz wchodząc w zlecenie (Otwórz).</p>
</section>`;
  return adminShell('Rozliczenie', body);
}

async function adminSettleAction(request, env) {
  const form = await request.formData();
  const id = String(form.get('id') || '');
  const action = String(form.get('action') || '');
  if (!id) return new Response('Bad', { status: 400 });
  if (action === 'settle') {
    await env.DB.prepare('UPDATE bookings SET settled_at=?1 WHERE id=?2').bind(Date.now(), id).run();
  } else if (action === 'unsettle') {
    await env.DB.prepare('UPDATE bookings SET settled_at=NULL WHERE id=?1').bind(id).run();
  } else {
    return new Response('Bad action', { status: 400 });
  }
  return new Response('', { status: 302, headers: { 'Location': '/admin/rozliczenie' } });
}

async function adminBlockSlot(request, env) {
  const form = await request.formData();
  const date = String(form.get('date') || '');
  const dateTo = String(form.get('date_to') || '').trim();
  const time = String(form.get('time_slot') || '').trim() || 'all';
  const reason = String(form.get('reason') || '').slice(0, 200);
  if (!isValidDate(date)) return redirect('/admin?err=zla-data');

  if (form.get('_method') === 'delete') {
    // Odblokowanie: pojedynczy wpis albo cały sklejony zakres dni całodniowych.
    // Gałąź delete celowo bez walidacji formatu time, żeby dało się usunąć też
    // historyczny wadliwy wpis (wartość idzie parametrycznie, jest bezpieczna).
    if (isValidDate(dateTo) && dateTo > date) {
      await env.DB.prepare("DELETE FROM blocked_slots WHERE date >= ?1 AND date <= ?2 AND time_slot = 'all'")
        .bind(date, dateTo).run();
    } else {
      await env.DB.prepare('DELETE FROM blocked_slots WHERE date=?1 AND time_slot=?2')
        .bind(date, time).run();
    }
    return redirect('/admin?msg=odblokowano');
  }

  // Zakres dat (urlop): blokuje całe dni od "date" do "date_to" włącznie. Limit 60 dni,
  // żeby literówka w roku nie wygenerowała tysięcy wierszy.
  if (dateTo) {
    if (!isValidDate(dateTo) || dateTo < date) return redirect('/admin?err=zla-data');
    const span = Math.round((Date.parse(dateTo + 'T12:00:00Z') - Date.parse(date + 'T12:00:00Z')) / 86400000) + 1;
    if (span > 60) return redirect('/admin?err=zakres-za-dlugi');
    const stmt = env.DB.prepare(
      "INSERT OR IGNORE INTO blocked_slots (date, time_slot, reason, created_at) VALUES (?1, 'all', ?2, ?3)"
    );
    const now = Date.now();
    const batch = [];
    for (let i = 0; i < span; i++) batch.push(stmt.bind(addDaysToDateStr(date, i), reason || null, now));
    await env.DB.batch(batch);
    return redirect('/admin?msg=zablokowano');
  }

  // Walidacja godziny po stronie serwera (atrybuty inputu są tylko klienckie).
  if (time !== 'all' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return redirect('/admin?err=zla-godzina');
  }
  await env.DB.prepare(
    'INSERT OR REPLACE INTO blocked_slots (date, time_slot, reason, created_at) VALUES (?1, ?2, ?3, ?4)'
  ).bind(date, time, reason || null, Date.now()).run();
  return redirect('/admin?msg=zablokowano');
}

async function adminDashboard(env, url) {
  const filter = url.searchParams.get('filter') || 'upcoming';
  const today = todayInWarsaw();

  let where = 'WHERE archived_at IS NULL';
  let params = [];
  if (filter === 'upcoming') {
    // Aktywne zlecenie nie może zniknąć tylko dlatego, że minęła data przyjęcia.
    // Najstarsze zaległe pozycje lądują na górze i wymagają rozstrzygnięcia.
    where = "WHERE archived_at IS NULL AND status IN ('pending','confirmed','in_progress')";
  } else if (filter === 'past') {
    where = 'WHERE archived_at IS NULL AND date < ?1';
    params = [today];
  } else if (filter === 'cancelled') {
    where = "WHERE archived_at IS NULL AND status='cancelled'";
  } else if (filter === 'archived') {
    where = 'WHERE archived_at IS NOT NULL';
  } else if (filter === 'all') {
    where = 'WHERE archived_at IS NULL';
  }

  // Przeszłe i Wszystkie od najnowszych (przy >500 wierszach LIMIT ucina najstarsze, nie najświeższe);
  // Nadchodzące zostają rosnąco (najbliższa wizyta na górze).
  const orderBy = (filter === 'past' || filter === 'all' || filter === 'archived')
    ? 'ORDER BY date DESC, time_slot DESC'
    : 'ORDER BY date ASC, time_slot ASC';
  const q = env.DB.prepare(
    `SELECT * FROM bookings ${where} ${orderBy} LIMIT 500`
  );
  const bookings = (await (params.length ? q.bind(...params) : q).all()).results || [];

  // Widok dnia: wszystkie dzisiejsze wizyty niezależnie od statusu (w tym done, które
  // znika z Nadchodzących w chwili kliknięcia „Zrobione").
  const todayRows = (await env.DB.prepare(
    'SELECT * FROM bookings WHERE date = ?1 AND archived_at IS NULL ORDER BY time_slot ASC'
  ).bind(today).all()).results || [];

  // Kropka pending liczona globalnie, również dla zaległych rezerwacji.
  const pendingCount = (await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM bookings WHERE status = 'pending' AND archived_at IS NULL"
  ).first())?.n || 0;

  const blocked = (await env.DB.prepare(
    'SELECT * FROM blocked_slots WHERE date >= ?1 ORDER BY date ASC, time_slot ASC'
  ).bind(today).all()).results || [];

  const reviewsProfile = await env.DB.prepare(
    "SELECT rating, review_count, fetched_at FROM google_profile WHERE id = 'profile'"
  ).first();
  const reviewsCount = (await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM google_reviews'
  ).first())?.n || 0;
  const reviewsStatus = url.searchParams.get('reviews') || '';

  const outreach = (await env.DB.prepare(
    "SELECT * FROM outreach_contacts ORDER BY CASE status WHEN 'planned' THEN 0 WHEN 'sent' THEN 1 WHEN 'responded' THEN 2 WHEN 'closed' THEN 3 ELSE 4 END, channel ASC, id ASC"
  ).all()).results || [];

  const outboxCounts = Object.fromEntries(((await env.DB.prepare(
    `SELECT status, COUNT(*) AS count FROM notification_outbox
     WHERE status IN ('pending','failed','uncertain') GROUP BY status`
  ).all()).results || []).map(row => [row.status, Number(row.count) || 0]));
  const uncertainJobs = (await env.DB.prepare(
    `SELECT id, entity_type, entity_id, event_key, channel, recipient,
            attempt_count, last_error, updated_at
     FROM notification_outbox WHERE status='uncertain'
     ORDER BY updated_at ASC LIMIT 50`
  ).all()).results || [];

  // Toasty (kody mapowane na białe listy w adminToasts) + prefill formularza ręcznej
  // rezerwacji po błędzie walidacji (wartości wracają w query, patrz adminCreateBooking).
  const msg = url.searchParams.get('msg') || '';
  const err = url.searchParams.get('err') || '';
  const errFields = url.searchParams.get('fields') || '';
  const prefill = {
    name: url.searchParams.get('mf_name') || '',
    phone: url.searchParams.get('mf_phone') || '',
    email: url.searchParams.get('mf_email') || '',
    service: url.searchParams.get('mf_service') || '',
    bike: url.searchParams.get('mf_bike') || '',
    model: url.searchParams.get('mf_model') || '',
    date: url.searchParams.get('mf_date') || '',
    time: url.searchParams.get('mf_time') || '',
    source: url.searchParams.get('mf_source') || '',
    notes: url.searchParams.get('mf_notes') || '',
  };

  return html(renderDashboard({
    bookings, todayRows, pendingCount, blocked, filter, today,
    reviewsProfile, reviewsCount, reviewsStatus,
    outreach, outboxCounts, uncertainJobs, msg, err, errFields, prefill,
  }));
}

// ─── HTML PAGES ─────────────────────────────────────────────────────────────

function loginPage(error = '') {
  return html(`<!doctype html><html lang="pl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Panel · skocznarower.pl</title>
<meta name="robots" content="noindex,nofollow">
${ADMIN_STYLES}
</head><body class="login">
  <form method="post" action="/admin/login" class="login-box">
    <h1>Panel rezerwacji</h1>
    ${error ? `<p class="err">${escapeHtml(error)}</p>` : ''}
    <label for="admin-password">Hasło</label>
    <input type="password" id="admin-password" name="password" autocomplete="current-password" autofocus required>
    <button type="submit">Zaloguj</button>
  </form>
</body></html>`);
}

function renderDashboard({
  bookings, todayRows, pendingCount, blocked, filter, today, reviewsProfile,
  reviewsCount, reviewsStatus, outreach, outboxCounts, uncertainJobs,
  msg, err, errFields, prefill,
}) {
  const back = `/admin?filter=${encodeURIComponent(filter)}`;
  const backEsc = escapeHtml(back);
  const pf = prefill || {};
  // Osobny formularz na każdą akcję: Enter w polu tekstowym nie odpala już pierwszego
  // przycisku formularza (implicit submission), a akcje SMS-owe i destrukcyjne mają confirm().
  const row = b => {
    const svc = SERVICES.find(s => s.id === b.service_type);
    const service = svc?.name || b.service_type;
    const estPrice = svc?.price || '-';
    const finalVal = b.final_price != null ? b.final_price : '';
    const who = `${b.customer_name} (${b.date} ${b.time_slot})`;
    const hidden = `<input type="hidden" name="id" value="${escapeHtml(b.id)}"><input type="hidden" name="back" value="${backEsc}">`;
    return `
    <tr class="status-${b.status}">
      <td class="when" data-label="Kiedy">
        <div class="date">${escapeHtml(b.date)}</div>
        <div class="time">${escapeHtml(b.time_slot)}</div>
      </td>
      <td data-label="Klient">
        <div class="name"><a href="/admin/zlecenie?id=${escapeHtml(b.id)}" class="name-link">${escapeHtml(b.customer_name)}</a></div>
        <div class="muted">${escapeHtml(b.bike_type)}${b.bike_model ? ` · ${escapeHtml(b.bike_model)}` : ''}</div>
      </td>
      <td data-label="Kontakt">
        <a href="tel:${escapeHtml(b.customer_phone)}">${escapeHtml(b.customer_phone)}</a>
        ${b.customer_email ? `<div class="muted"><a href="mailto:${escapeHtml(b.customer_email)}">${escapeHtml(b.customer_email)}</a></div>` : ''}
      </td>
      <td data-label="Usługa">
        <div>${escapeHtml(service)}</div>
        ${b.notes ? `<div class="muted notes">${escapeHtml(b.notes)}</div>` : ''}
      </td>
      <td class="price-est" data-label="Wycena"><span class="muted">${escapeHtml(estPrice)}</span></td>
      <td class="price-final" data-label="Faktycznie">
        <form method="post" action="/admin/booking" class="price-form">
          ${hidden}
          <input type="hidden" name="action" value="price">
          <input type="number" name="final_price" value="${finalVal}" min="0" max="100000" step="1" placeholder="zł" class="price-input">
          <button type="submit" class="btn-save" title="Zapisz cenę">✓</button>
        </form>
      </td>
      <td data-label="Status"><span class="badge badge-${b.status}">${statusLabel(b.status)}</span></td>
      <td class="actions">
        <a href="/admin/zlecenie?id=${escapeHtml(b.id)}" class="btn-ok" title="Szczegóły, kwoty, rozliczenie">Otwórz</a>
        ${b.archived_at == null && b.status === 'pending' ? `<form method="post" action="/admin/booking">${hidden}<button name="action" value="confirm" class="btn-ok">Potwierdź</button></form>` : ''}
        ${b.archived_at == null && (b.status === 'pending' || b.status === 'confirmed') ? `<form method="post" action="/admin/booking" ${confirmAttr(`Przyjąć rower do serwisu? ${who}. Klient dostanie SMS o przyjęciu.`)}>${hidden}<button name="action" value="start" class="btn-ok" title="Przyjęto rower do serwisu, wyśle SMS do klienta">Przyjęto</button></form>` : ''}
        ${b.archived_at == null && b.status !== 'done' && b.status !== 'cancelled' ? `<form method="post" action="/admin/booking" class="done-form" onsubmit="var p=this.closest('tr').querySelector('.price-input'); if (p) this.final_price.value = p.value; return confirm('${confirmJs(`Oznaczyć jako zrobione? ${who}. Klient dostanie SMS z podsumowaniem i kosztem.`)}')">${hidden}<input type="hidden" name="final_price" value="${finalVal}"><input type="text" name="repair_summary" value="${escapeHtml(b.repair_summary || '')}" placeholder="co zrobiono (do SMS)" maxlength="300" class="summary-input" onkeydown="if(event.key==='Enter'){event.preventDefault()}"><button name="action" value="done" class="btn-ok" title="Naprawa gotowa, wyśle SMS z podsumowaniem">Zrobione</button></form>` : ''}
        ${b.archived_at == null && b.status === 'cancelled' ? `<form method="post" action="/admin/booking" ${confirmAttr(`Przywrócić rezerwację? ${who}. Wróci jako potwierdzona.`)}>${hidden}<button name="action" value="confirm" class="btn-ok">Przywróć</button></form>` : ''}
        ${b.archived_at == null && b.status !== 'cancelled' ? `<form method="post" action="/admin/booking" ${confirmAttr(`Anulować rezerwację? ${who}. Slot zostanie zwolniony.`)}>${hidden}<button name="action" value="cancel" class="btn-warn">Anuluj</button></form>` : ''}
        ${b.archived_at == null && ['done', 'cancelled'].includes(b.status) ? `<form method="post" action="/admin/booking" ${confirmAttr(`Przenieść rezerwację do archiwum? ${who}. Status pozostanie bez zmian.`)}>${hidden}<button name="action" value="archive" class="btn-del">Archiwizuj</button></form>` : ''}
        ${b.archived_at != null ? `<form method="post" action="/admin/booking" ${confirmAttr(`Przywrócić rezerwację z archiwum? ${who}. Status pozostanie bez zmian.`)}>${hidden}<button name="action" value="unarchive" class="btn-ok">Przywróć z archiwum</button></form>` : ''}
      </td>
    </tr>`;
  };

  const todayItem = t => {
    const svc = SERVICES.find(s => s.id === t.service_type)?.name || t.service_type;
    return `<li class="today-item status-${t.status}">
      <span class="today-time">${escapeHtml(t.time_slot)}</span>
      <a href="/admin/zlecenie?id=${escapeHtml(t.id)}" class="name-link">${escapeHtml(t.customer_name)}</a>
      <span class="muted">${escapeHtml(svc)}</span>
      <span class="badge badge-${t.status}">${statusLabel(t.status)}</span>
      <a href="tel:${escapeHtml(t.customer_phone)}" class="muted">${escapeHtml(t.customer_phone)}</a>
    </li>`;
  };

  // Ciągłe dni całodniowe (ten sam powód) sklejone w jeden wiersz z jednym Odblokuj.
  const blockedRows = [];
  for (const b of blocked) {
    const prev = blockedRows[blockedRows.length - 1];
    if (b.time_slot === 'all' && prev && prev.time_slot === 'all'
      && (prev.reason || '') === (b.reason || '') && addDaysToDateStr(prev.dateTo, 1) === b.date) {
      prev.dateTo = b.date;
    } else {
      blockedRows.push({ date: b.date, dateTo: b.date, time_slot: b.time_slot, reason: b.reason });
    }
  }

  const revenue = bookings
    .filter(b => b.status === 'done' && b.final_price != null)
    .reduce((sum, b) => sum + b.final_price, 0);

  return `<!doctype html><html lang="pl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Panel · skocznarower.pl</title>
<meta name="robots" content="noindex,nofollow">
${ADMIN_STYLES}
</head><body>

<header class="topbar">
  <h1>Rezerwacje</h1>
  <div class="topbar-right">
    <span class="muted">Dziś: ${today}</span>
    <!-- <a href="/admin/rozliczenie" class="logout">Rozliczenie</a> tymczasowo ukryte -->
    <a href="/admin/warsztaty" class="logout">Warsztaty</a>
    <a href="/admin/warsztaty/grupy" class="logout">Grupy</a>
    <a href="#outreach" class="logout">Współpraca</a>
    <a href="/admin/logout" class="logout">Wyloguj</a>
  </div>
</header>

${adminToasts(msg, err, errFields)}

${(outboxCounts?.pending || outboxCounts?.failed || outboxCounts?.uncertain) ? `<section class="card">
  <h2>Kolejka wiadomości</h2>
  <p class="muted">Oczekujące: ${outboxCounts.pending || 0} · nieudane: ${outboxCounts.failed || 0} · wynik niepewny: ${outboxCounts.uncertain || 0}</p>
  ${outboxCounts.failed ? `<form method="post" action="/admin/outbox-retry"><button type="submit">Ponów nieudane</button></form>` : ''}
  ${uncertainJobs.length ? `<table class="cards outbox-uncertain"><thead><tr><th>Zadanie</th><th>Wynik</th><th>Rozstrzygnięcie</th></tr></thead><tbody>
    ${uncertainJobs.map(job => `<tr>
      <td data-label="Zadanie"><strong>${escapeHtml(job.channel)}</strong> · ${escapeHtml(job.event_key)}
        <div class="muted">${escapeHtml(job.entity_type)}: ${escapeHtml(job.entity_id)}</div>
        <div class="muted">${escapeHtml(job.recipient)} · próba ${escapeHtml(job.attempt_count)} · ${escapeHtml(warsawDateTime(job.updated_at))}</div>
      </td>
      <td data-label="Wynik">${escapeHtml(job.last_error || 'Wynik dostarczenia jest nieznany.')}</td>
      <td data-label="Rozstrzygnięcie" class="actions">
        <form method="post" action="/admin/outbox-resolve" ${confirmAttr('Wynik wysyłki jest nieznany. Ponowienie może dostarczyć duplikat. Czy świadomie ponowić?')}>
          <input type="hidden" name="id" value="${escapeHtml(job.id)}"><button name="action" value="retry" class="btn-warn">Ponów z ryzykiem</button>
        </form>
        <form method="post" action="/admin/outbox-resolve" ${confirmAttr('Oznacz jako wysłane tylko po sprawdzeniu u dostawcy. Kontynuować?')}>
          <input type="hidden" name="id" value="${escapeHtml(job.id)}"><button name="action" value="mark_sent" class="btn-ok">Oznacz wysłane</button>
        </form>
        <form method="post" action="/admin/outbox-resolve" ${confirmAttr('Anulowanie nie cofnie wiadomości, jeśli dostawca już ją przyjął. Kontynuować?')}>
          <input type="hidden" name="id" value="${escapeHtml(job.id)}"><button name="action" value="cancel" class="btn-del">Anuluj job</button>
        </form>
      </td>
    </tr>`).join('')}
  </tbody></table>` : ''}
</section>` : ''}

<section class="card today-card">
  <h2>Dziś · ${today}${todayRows.length ? ` · wizyt: ${todayRows.length}` : ''}</h2>
  ${todayRows.length === 0 ? '<p class="muted">Brak wizyt na dziś.</p>' : `<ul class="today-list">
    ${todayRows.map(todayItem).join('')}
  </ul>`}
</section>

<nav class="tabs">
  <a href="?filter=upcoming" class="${filter === 'upcoming' ? 'active' : ''}">Nadchodzące${pendingCount ? ` <span class="dot">${pendingCount}</span>` : ''}</a>
  <a href="?filter=past" class="${filter === 'past' ? 'active' : ''}">Przeszłe</a>
  <a href="?filter=cancelled" class="${filter === 'cancelled' ? 'active' : ''}">Anulowane</a>
  <a href="?filter=all" class="${filter === 'all' ? 'active' : ''}">Wszystkie</a>
  <a href="?filter=archived" class="${filter === 'archived' ? 'active' : ''}">Archiwum</a>
</nav>

<section class="card">
  <h2>Lista (${bookings.length})${revenue > 0 ? ` · <span class="revenue">${revenue} zł</span><span class="muted revenue-note"> z ukończonych</span>` : ''}</h2>
  ${bookings.length === 0 ? '<p class="muted">Brak rezerwacji.</p>' : `
  <table class="cards">
    <thead><tr><th>Kiedy</th><th>Klient</th><th>Kontakt</th><th>Usługa</th><th>Wycena</th><th>Faktycznie</th><th>Status</th><th></th></tr></thead>
    <tbody>${bookings.map(row).join('')}</tbody>
  </table>`}
</section>

<section class="card" id="dodaj">
  <h2>Dodaj rezerwację ręcznie</h2>
  <p class="muted">Dla osób z telefonu albo z Google. Status od razu „potwierdzone", bez SMS-a przy dodaniu (SMS idzie przy „Przyjęto" i „Zrobione"). Można wpisać datę wsteczną.</p>
  <form method="post" action="/admin/booking-new" class="block-form manual-form">
    <input type="text" name="customer_name" placeholder="Imię i nazwisko" required minlength="2" maxlength="80" value="${escapeHtml(pf.name)}">
    <input type="tel" name="customer_phone" placeholder="Telefon" required value="${escapeHtml(pf.phone)}">
    <input type="email" name="customer_email" placeholder="E-mail (opcjonalnie)" value="${escapeHtml(pf.email)}">
    <select name="service_type" required>
      <option value="" disabled${pf.service ? '' : ' selected'}>Usługa…</option>
      ${SERVICES.map(s => `<option value="${escapeHtml(s.id)}"${pf.service === s.id ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
    </select>
    <select name="bike_type" required>
      <option value="" disabled${pf.bike ? '' : ' selected'}>Typ roweru…</option>
      ${BIKE_TYPES.map(t => `<option value="${escapeHtml(t)}"${pf.bike === t ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}
    </select>
    <input type="text" name="bike_model" placeholder="Model roweru (opcjonalnie)" maxlength="120" value="${escapeHtml(pf.model)}">
    <label class="bl">Data<input type="date" name="date" required value="${escapeHtml(pf.date || today)}"></label>
    <label class="bl">Godzina<input type="time" name="time_slot" step="3600" required value="${escapeHtml(pf.time)}"></label>
    <select name="source">
      <option value="tel"${!pf.source || pf.source === 'tel' ? ' selected' : ''}>Z telefonu</option>
      <option value="google"${pf.source === 'google' ? ' selected' : ''}>Z Google</option>
      <option value="inne"${pf.source === 'inne' ? ' selected' : ''}>Inne</option>
    </select>
    <input type="text" name="notes" placeholder="Notatka (opcjonalnie)" maxlength="300" value="${escapeHtml(pf.notes)}">
    <button type="submit">Dodaj</button>
  </form>
</section>

<section class="card">
  <h2>Zablokuj termin</h2>
  <p class="muted">Urlop, święto, prywatne plany. Jeden dzień albo zakres od-do (zakres blokuje całe dni). Godzina pusta = cały dzień.</p>
  <form method="post" action="/admin/block" class="block-form">
    <label class="bl">Od<input type="date" name="date" required min="${today}"></label>
    <label class="bl">Do (opcjonalnie)<input type="date" name="date_to" min="${today}"></label>
    <label class="bl">Godzina (puste = cały dzień)<input type="time" name="time_slot" step="3600"></label>
    <label class="bl">Powód<input type="text" name="reason" placeholder="np. urlop (opcjonalnie)" maxlength="200"></label>
    <button type="submit">Zablokuj</button>
  </form>

  ${blockedRows.length === 0 ? '<p class="muted">Brak zablokowanych terminów.</p>' : `
  <table class="blocked-table cards">
    <thead><tr><th>Data</th><th>Godzina</th><th>Powód</th><th></th></tr></thead>
    <tbody>
      ${blockedRows.map(b => `
      <tr>
        <td data-label="Data">${escapeHtml(b.date)}${b.dateTo !== b.date ? ` do ${escapeHtml(b.dateTo)}` : ''}</td>
        <td data-label="Godzina">${b.time_slot === 'all' ? 'cały dzień' : escapeHtml(b.time_slot)}</td>
        <td data-label="Powód">${escapeHtml(b.reason || '')}</td>
        <td class="actions">
          <form method="post" action="/admin/block" style="display:inline">
            <input type="hidden" name="date" value="${escapeHtml(b.date)}">
            ${b.dateTo !== b.date ? `<input type="hidden" name="date_to" value="${escapeHtml(b.dateTo)}">` : ''}
            <input type="hidden" name="time_slot" value="${escapeHtml(b.time_slot)}">
            <input type="hidden" name="_method" value="delete">
            <button class="btn-del">Odblokuj</button>
          </form>
        </td>
      </tr>`).join('')}
    </tbody>
  </table>`}
</section>

<section class="card">
  <h2>Opinie Google</h2>
  <p class="muted">Pobierane z Google Places API. Cron odświeża raz dziennie, możesz wymusić ręcznie.</p>
  <div style="display:flex; flex-wrap:wrap; gap:24px; align-items:center; margin:14px 0;">
    <div>
      <div style="font-size:24px; font-weight:700; color:#9fe22e;">
        ${reviewsProfile?.rating ? reviewsProfile.rating.toFixed(1) : '–'}
        <span style="font-size:14px; color:#888; font-weight:400;">średnia</span>
      </div>
      <div class="muted" style="margin-top:4px;">
        ${reviewsProfile?.review_count ?? 0} opinii w Google · ${reviewsCount} w cache
      </div>
      <div class="muted" style="margin-top:2px;">
        ${reviewsProfile?.fetched_at ? 'Ostatnie pobranie: ' + new Date(reviewsProfile.fetched_at).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' }) : 'Jeszcze nie pobrane.'}
      </div>
    </div>
    <form method="post" action="/admin/reviews-refresh">
      <button type="submit" style="background:#9fe22e; color:#000; border:none; padding:10px 18px; border-radius:4px; font-weight:600; cursor:pointer;">Odśwież teraz</button>
    </form>
  </div>
  ${reviewsStatus === 'no-keys' ? '<p class="muted" style="color:#f4c542;">Brak GOOGLE_PLACES_API_KEY albo GOOGLE_PLACE_ID. Dodaj sekrety, żeby pobrać opinie.</p>' : ''}
  ${reviewsStatus === 'error' ? '<p class="muted" style="color:#d66;">Błąd pobierania, zobacz logi Workera w Cloudflare.</p>' : ''}
  ${reviewsStatus.startsWith('ok-') ? `<p class="muted" style="color:#9fe22e;">Pobrano i zapisano ${Number.parseInt(reviewsStatus.slice(3), 10) || 0} opinii.</p>` : ''}
</section>

${renderOutreachSection(outreach || [])}

</body></html>`;
}

function renderOutreachSection(outreach) {
  const channelLabel = c => c === 'A' ? 'A · brand' : c === 'B' ? 'B · dystro' : 'C · sklep bez warsztatu';
  const statusLabel = s => ({
    planned: 'do wysłania', sent: 'wysłany', responded: 'odpisali', closed: 'zamknięty',
  }[s] || s);
  const statusColor = s => ({
    planned: '#aaa', sent: '#f4c542', responded: '#9fe22e', closed: '#666',
  }[s] || '#aaa');

  const stats = outreach.reduce((acc, o) => {
    acc[o.status] = (acc[o.status] || 0) + 1;
    return acc;
  }, {});

  const row = o => `
    <tr style="opacity:${o.status === 'closed' ? .55 : 1}">
      <td data-label="Marka / sklep"><strong>${escapeHtml(o.brand_name)}</strong></td>
      <td data-label="Kanał"><span class="muted">${channelLabel(o.channel)}</span></td>
      <td class="muted" data-label="Kontakt" style="max-width:280px; word-break:break-all">${escapeHtml(o.contact_method || '')}</td>
      <td data-label="Status">
        <span class="badge" style="background:${statusColor(o.status)}22; color:${statusColor(o.status)}; border:1px solid ${statusColor(o.status)}66;">${escapeHtml(statusLabel(o.status))}</span>
        ${o.sent_at ? `<div class="muted" style="font-size:11px; margin-top:4px;">${new Date(o.sent_at).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}</div>` : ''}
      </td>
      <td class="muted" data-label="Notatki / odpowiedź" style="font-size:12px; max-width:260px;">
        ${o.notes ? `<div>${escapeHtml(o.notes)}</div>` : ''}
        ${o.response ? `<div style="color:#9fe22e; margin-top:4px;"><strong>Odp.:</strong> ${escapeHtml(o.response)}</div>` : ''}
      </td>
      <td class="actions" style="white-space:nowrap;">
        ${o.status === 'planned' ? `
          <form method="post" action="/admin/outreach" style="display:inline">
            <input type="hidden" name="id" value="${escapeHtml(o.id)}">
            <button name="action" value="sent" class="btn-ok">Wysłałem</button>
          </form>` : ''}
        ${o.status === 'sent' ? `
          <form method="post" action="/admin/outreach" style="display:inline; margin-right:4px;" onsubmit="this.querySelector('input[name=response]').value = prompt('Co odpisali? (skrót)') || ''; if(!this.querySelector('input[name=response]').value) return false;">
            <input type="hidden" name="id" value="${escapeHtml(o.id)}">
            <input type="hidden" name="response" value="">
            <button name="action" value="responded" class="btn-ok">Odpisali</button>
          </form>
          <form method="post" action="/admin/outreach" style="display:inline">
            <input type="hidden" name="id" value="${escapeHtml(o.id)}">
            <button name="action" value="closed" class="btn-warn">Brak odp.</button>
          </form>` : ''}
        ${o.status === 'responded' ? `
          <form method="post" action="/admin/outreach" style="display:inline">
            <input type="hidden" name="id" value="${escapeHtml(o.id)}">
            <button name="action" value="closed" class="btn-warn">Zamknij</button>
          </form>` : ''}
        ${o.status === 'closed' ? `
          <form method="post" action="/admin/outreach" style="display:inline">
            <input type="hidden" name="id" value="${escapeHtml(o.id)}">
            <button name="action" value="reopen" class="btn-ok">Odśwież</button>
          </form>` : ''}
        <form method="post" action="/admin/outreach" style="display:inline" onsubmit="return confirm('Usunąć kontakt?')">
          <input type="hidden" name="id" value="${escapeHtml(o.id)}">
          <button name="action" value="delete" class="btn-del">×</button>
        </form>
      </td>
    </tr>`;

  return `
<section class="card" id="outreach">
  <h2>Współpraca · outreach
    <span class="muted" style="font-weight:400; font-size:14px; margin-left:12px;">
      ${stats.planned || 0} do wysłania · ${stats.sent || 0} czeka · ${stats.responded || 0} odpisało · ${stats.closed || 0} zamknięte
    </span>
  </h2>
  <p class="muted" style="margin-bottom:12px;">Plan w OUTREACH_PLAN.md (root repo). A = brand / dealer, B = dystrybutor / program serwisowy, C = sklep bez warsztatu (recommended-local / pickup-hub / warranty).</p>

  <form method="post" action="/admin/outreach" class="outreach-add">
    <input type="hidden" name="action" value="add">
    <input type="text" name="brand_name" placeholder="Nazwa marki / sklepu" required maxlength="120">
    <select name="channel" required>
      <option value="">Kanał</option>
      <option value="A">A · brand</option>
      <option value="B">B · dystro / program</option>
      <option value="C">C · sklep bez warsztatu</option>
    </select>
    <input type="text" name="contact_method" placeholder="Email / formularz / IG" maxlength="200">
    <input type="text" name="notes" placeholder="Notatka (opcjonalnie)" maxlength="500">
    <button type="submit">Dodaj</button>
  </form>

  ${outreach.length === 0 ? '<p class="muted">Brak kontaktów. Dodaj pierwszy z formularza powyżej.</p>' : `
  <table class="cards">
    <thead><tr><th>Marka / sklep</th><th>Kanał</th><th>Kontakt</th><th>Status</th><th>Notatki / odpowiedź</th><th></th></tr></thead>
    <tbody>${outreach.map(row).join('')}</tbody>
  </table>`}
</section>`;
}

const ADMIN_STYLES = `<style>
*,*::before,*::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  background: #0e0e0e; color: #f0f0f0; line-height: 1.5; padding: 24px; min-height: 100vh; }
a { color: #9fe22e; text-decoration: none; }
a:hover { text-decoration: underline; }
.muted { color: #888; font-size: 13px; }
h1 { font-size: 22px; }
h2 { font-size: 18px; margin-bottom: 16px; }

.topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.topbar-right { display: flex; gap: 16px; align-items: center; }
.logout { padding: 6px 12px; border: 1px solid #333; border-radius: 4px; color: #ccc; }

.tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid #222; }
.tabs a { padding: 10px 14px; color: #aaa; border-bottom: 2px solid transparent; font-size: 14px; }
.tabs a:hover { text-decoration: none; color: #fff; }
.tabs a.active { color: #9fe22e; border-bottom-color: #9fe22e; }
.dot { background: #9fe22e; color: #000; padding: 1px 7px; border-radius: 10px; font-size: 11px; font-weight: 700; margin-left: 4px; }

.card { background: #161616; border: 1px solid #222; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th { text-align: left; padding: 8px; color: #888; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; border-bottom: 1px solid #222; }
td { padding: 12px 8px; border-bottom: 1px solid #1c1c1c; vertical-align: top; }
tr.status-cancelled td { opacity: .45; }
tr.status-done td { opacity: .65; }
.when .date { font-weight: 600; }
.when .time { color: #9fe22e; font-size: 13px; }
.name { font-weight: 600; }
.notes { font-style: italic; max-width: 320px; }

.badge { font-size: 11px; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; font-weight: 600; letter-spacing: .05em; }
.badge-pending { background: #2a2410; color: #f4c542; }
.badge-confirmed { background: #122a14; color: #9fe22e; }
.badge-in_progress { background: #10202a; color: #4fb3e2; }
.badge-done { background: #1a1a1a; color: #888; }
.badge-cancelled { background: #2a1414; color: #d66; }

.actions form { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 2px 4px 2px 0; vertical-align: middle; }
.actions button, .actions a.btn-ok { font-size: 11px; padding: 4px 8px; border: 1px solid #333; background: transparent; color: #ccc; border-radius: 3px; cursor: pointer; display: inline-flex; align-items: center; text-decoration: none; }
.actions button:hover { border-color: #555; color: #fff; }
.actions a.btn-ok { margin-right: 4px; }

.toast { padding: 10px 14px; border-radius: 6px; margin-bottom: 14px; font-size: 14px; border: 1px solid; }
.toast-ok { background: #122a14; color: #9fe22e; border-color: #2f5a1e; }
.toast-err { background: #2a1414; color: #e08a8a; border-color: #5a2424; }

.today-list { list-style: none; display: flex; flex-direction: column; gap: 6px; }
.today-item { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 8px 10px; border: 1px solid #222; border-radius: 6px; background: #101010; }
.today-item .today-time { color: #9fe22e; font-weight: 700; min-width: 48px; }
.today-item.status-cancelled { opacity: .45; }
.today-item.status-done { opacity: .65; }

.bl { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: .04em; }

.outreach-add { display: grid; grid-template-columns: 2fr 1fr 2fr 2fr auto; gap: 8px; margin-bottom: 18px; }
.outreach-add input, .outreach-add select { background: #0e0e0e; border: 1px solid #333; color: #fff; padding: 8px 12px; border-radius: 4px; font-size: 14px; }
.outreach-add button { background: #9fe22e; color: #000; border: none; padding: 8px 16px; border-radius: 4px; font-weight: 600; cursor: pointer; }

.price-form { display: flex; gap: 4px; align-items: center; }
.price-input {
  width: 70px; background: #0e0e0e; border: 1px solid #333; color: #fff;
  padding: 5px 7px; border-radius: 3px; font-size: 13px; font-family: inherit;
  -moz-appearance: textfield;
}
.price-input::-webkit-outer-spin-button,
.price-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.price-input:focus { outline: 1px solid var(--accent, #9fe22e); border-color: #9fe22e; }
.btn-save {
  background: transparent; color: #9fe22e; border: 1px solid #333;
  width: 26px; height: 26px; border-radius: 3px; cursor: pointer; font-size: 14px;
  display: inline-flex; align-items: center; justify-content: center;
}
.btn-save:hover { border-color: #9fe22e; background: rgba(159,226,46,.1); }
.price-est { white-space: nowrap; }
.price-final { white-space: nowrap; }
.revenue { font-weight: 400; color: #9fe22e; }
.revenue-note { font-weight: 400; font-size: 13px; }
.btn-ok:hover { border-color: #9fe22e; color: #9fe22e; }
.btn-warn:hover { border-color: #f4c542; color: #f4c542; }
.btn-del:hover { border-color: #d66; color: #d66; }

.block-form { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.block-form input { background: #0e0e0e; border: 1px solid #333; color: #fff; padding: 8px 12px; border-radius: 4px; font-size: 14px; }
.block-form button { background: #9fe22e; color: #000; border: none; padding: 8px 16px; border-radius: 4px; font-weight: 600; cursor: pointer; }
.block-form select { background: #0e0e0e; border: 1px solid #333; color: #fff; padding: 8px 12px; border-radius: 4px; font-size: 14px; }
.summary-input { background: #0e0e0e; border: 1px solid #333; color: #fff; padding: 5px 8px; border-radius: 4px; font-size: 12px; width: 150px; margin-right: 4px; }
.blocked-table { margin-top: 12px; }
.name-link { color: #fff; text-decoration: none; border-bottom: 1px dotted #555; }
.name-link:hover { color: #9fe22e; border-color: #9fe22e; }

.finance-form { display: flex; flex-direction: column; gap: 10px; }
.finance-form label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: .04em; }
.finance-form input, .finance-form select, .finance-form textarea { background: #0e0e0e; border: 1px solid #333; color: #fff; padding: 9px 12px; border-radius: 4px; font-size: 14px; text-transform: none; letter-spacing: normal; font-family: inherit; }
.finance-form textarea { resize: vertical; }
.finance-form button { align-self: flex-start; background: #9fe22e; color: #000; border: none; padding: 10px 22px; border-radius: 4px; font-weight: 700; cursor: pointer; margin-top: 4px; }
.sec-h { font-size: 12px; color: #9fe22e; text-transform: uppercase; letter-spacing: .06em; margin: 14px 0 2px; border-bottom: 1px solid #222; padding-bottom: 6px; }
.f2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
@media (max-width: 620px) { .f2 { grid-template-columns: 1fr; } }
.hint { font-size: 11px; color: #666; text-transform: none; letter-spacing: normal; }
.ro-note { background: #0e0e0e; border: 1px solid #222; border-radius: 6px; padding: 8px 12px; font-size: 14px; color: #ccc; display: flex; flex-direction: column; gap: 3px; }
.ok-msg { color: #9fe22e; }
.err-msg { color: #d66; }
.split-details { margin-top: 16px; border: 1px solid #222; border-radius: 6px; padding: 8px 12px; }
.split-details summary { cursor: pointer; font-size: 13px; color: #888; text-transform: uppercase; letter-spacing: .05em; }
.split-details .calc { margin-top: 10px; }
.sms-form { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.sms-form textarea { background: #0e0e0e; border: 1px solid #333; color: #fff; padding: 9px 12px; border-radius: 4px; font-size: 14px; font-family: inherit; resize: vertical; }
.sms-form button { align-self: flex-start; background: #9fe22e; color: #000; border: none; padding: 9px 18px; border-radius: 4px; font-weight: 700; cursor: pointer; }
.timeline { display: flex; flex-direction: column; gap: 2px; }
.tl-item { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px solid #1a1a1a; }
.tl-item:last-child { border-bottom: 0; }
.tl-when { font-size: 12px; color: #777; white-space: nowrap; min-width: 120px; }
.tl-body { font-size: 14px; }
.tl-sms { border-left: 2px solid #9fe22e; padding-left: 10px; }
.tl-wa { border-left: 2px solid #4fb3e2; padding-left: 10px; }
.calc { background: #0e0e0e; border: 1px solid #222; border-radius: 6px; padding: 12px 14px; }
.calc-row { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; font-size: 14px; border-bottom: 1px solid #1a1a1a; }
.calc-row:last-child { border-bottom: 0; }
.calc-row.total { border-top: 1px solid #333; border-bottom: 1px solid #333; font-weight: 700; color: #9fe22e; margin-top: 4px; }
.calc-row.warn { color: #f4c542; }
.calc-row b { color: #fff; white-space: nowrap; }
.calc-row.total b { color: #9fe22e; }
tr.settled td { opacity: .5; }

.workshop-stats { display: grid; grid-template-columns: repeat(5, minmax(120px, 1fr)); gap: 10px; margin-bottom: 20px; }
.workshop-stat { display: flex; flex-direction: column; background: #161616; border: 1px solid #222; border-radius: 8px; padding: 14px 16px; color: #aaa; }
.workshop-stat:hover { border-color: #9fe22e; text-decoration: none; }
.workshop-stat strong { color: #9fe22e; font-size: 24px; line-height: 1.1; }
.workshop-stat span { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
.workshop-due-list { list-style: none; display: flex; flex-direction: column; gap: 6px; }
.workshop-due-list li { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 8px 10px; background: #101010; border: 1px solid #3d3212; border-radius: 6px; }
.workshop-tabs { flex-wrap: wrap; }
.workshop-table tr { scroll-margin-top: 16px; }
.workshop-table tr.workshop-due td:first-child { border-left: 3px solid #f4c542; padding-left: 10px; }
.workshop-table tr.status-lost td { opacity: .55; }
.workshop-table td:nth-child(1) { min-width: 180px; }
.workshop-table td:nth-child(2), .workshop-table td:nth-child(3) { min-width: 160px; }
.workshop-form { display: grid; grid-template-columns: repeat(2, minmax(150px, 1fr)); gap: 8px; min-width: 390px; }
.workshop-form label { display: flex; flex-direction: column; gap: 3px; color: #888; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.workshop-form input, .workshop-form select, .workshop-form textarea { width: 100%; background: #0e0e0e; border: 1px solid #333; color: #fff; padding: 7px 9px; border-radius: 4px; font: inherit; font-size: 13px; text-transform: none; letter-spacing: normal; }
.workshop-form textarea { resize: vertical; }
.workshop-form .workshop-notes { grid-column: 1 / -1; }
.workshop-form button { justify-self: start; background: #9fe22e; color: #000; border: 0; border-radius: 4px; padding: 8px 16px; font-weight: 700; cursor: pointer; }
.workshop-ops-form { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 10px; margin-top: 12px; }
.workshop-ops-form label, .workshop-payment-form label { display: flex; flex-direction: column; gap: 3px; color: #888; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.workshop-ops-form input, .workshop-ops-form select, .workshop-ops-form textarea,
.workshop-payment-form input, .workshop-payment-form select,
.workshop-attendance-form input, .workshop-attendance-form select, .ops-inline-form select {
  width: 100%; background: #0e0e0e; border: 1px solid #333; color: #fff;
  padding: 7px 9px; border-radius: 4px; font: inherit; font-size: 13px;
}
.workshop-ops-form textarea { resize: vertical; }
.workshop-ops-form .ops-wide { grid-column: span 2; }
.workshop-ops-form button, .workshop-payment-form button, .workshop-attendance-form button, .ops-inline-form button {
  align-self: end; justify-self: start; background: #9fe22e; color: #000; border: 0;
  border-radius: 4px; padding: 8px 14px; font-weight: 700; cursor: pointer;
}
.workshop-ops-form button:disabled { cursor: not-allowed; opacity: .4; }
.workshop-group-card, .workshop-session-card { scroll-margin-top: 12px; }
.workshop-group-card details { margin: 12px 0; border-top: 1px solid #222; border-bottom: 1px solid #222; padding: 10px 0; }
.workshop-group-card summary { color: #aaa; cursor: pointer; }
.workshop-group-card h3 { font-size: 15px; margin: 18px 0 8px; }
.ops-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.ops-heading > :last-child { text-align: right; }
.ops-actions-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 14px 0 18px; }
.ops-compact { grid-template-columns: repeat(2, minmax(120px, 1fr)); background: #101010; border: 1px solid #222; border-radius: 6px; padding: 12px; margin: 0; }
.ops-inline-form { display: flex; align-items: center; gap: 6px; }
.workshop-payment-form { display: grid; grid-template-columns: repeat(3, minmax(90px, 1fr)); gap: 6px; min-width: 360px; }
.workshop-payment-form button { align-self: end; }
.workshop-attendance-form { display: grid; grid-template-columns: minmax(150px, 1fr) 2fr auto; gap: 6px; }
.workshop-members-table td:last-child { min-width: 380px; }
.ops-section-title { margin: 28px 0 12px; }
.workshop-session-card.status-cancelled { opacity: .55; }
.badge-active, .badge-completed { background: #122a14; color: #9fe22e; }
.badge-paused { background: #2a2410; color: #f4c542; }
.badge-new { background: #2a2410; color: #f4c542; }
.badge-contacted { background: #10202a; color: #4fb3e2; }
.badge-trial_booked { background: #21162a; color: #c58be2; }
.badge-enrolled { background: #122a14; color: #9fe22e; }
.badge-lost { background: #2a1414; color: #d66; }

body.login { display: flex; align-items: center; justify-content: center; }
.login-box { background: #161616; border: 1px solid #222; border-radius: 8px; padding: 32px; width: 100%; max-width: 360px; }
.login-box h1 { margin-bottom: 20px; }
.login-box label { display: block; font-size: 12px; color: #888; margin-bottom: 6px; text-transform: uppercase; letter-spacing: .05em; }
.login-box input { width: 100%; background: #0e0e0e; border: 1px solid #333; color: #fff; padding: 12px 14px; border-radius: 4px; font-size: 15px; margin-bottom: 12px; }
.login-box button { width: 100%; background: #9fe22e; color: #000; border: none; padding: 12px; border-radius: 4px; font-weight: 700; cursor: pointer; font-size: 15px; }
.err { color: #d66; margin-bottom: 12px; font-size: 14px; }

@media (max-width: 720px) {
  body { padding: 12px; }
  .topbar { align-items: flex-start; flex-direction: column; }
  .topbar-right { flex-wrap: wrap; gap: 8px; }
  table { font-size: 13px; }
  th, td { padding: 6px 4px; }
  .notes { max-width: 200px; }

  /* Dotyk w warsztacie: minimum 44px wysokości dla akcji i pól. */
  .actions button, .actions a.btn-ok { min-height: 44px; padding: 10px 14px; font-size: 14px; }
  .actions form { gap: 8px; margin: 3px 6px 3px 0; }
  .btn-save { width: 44px; height: 44px; }
  .price-input, .summary-input { min-height: 44px; font-size: 16px; }
  .summary-input { width: 100%; margin: 0 0 6px; }
  .block-form input, .block-form select, .block-form button { min-height: 44px; }
  .outreach-add input, .outreach-add select, .outreach-add button { min-height: 44px; }
  .outreach-add { grid-template-columns: 1fr; }
  .logout { min-height: 44px; display: inline-flex; align-items: center; }
  .finance-form button, .sms-form button { min-height: 44px; }
  .workshop-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .workshop-form { grid-template-columns: 1fr; min-width: 0; }
  .workshop-form .workshop-notes { grid-column: auto; }
  .workshop-form input, .workshop-form select, .workshop-form textarea, .workshop-form button { min-height: 44px; font-size: 16px; }
  .workshop-ops-form, .ops-compact, .ops-actions-grid { grid-template-columns: 1fr; }
  .workshop-ops-form .ops-wide { grid-column: auto; }
  .ops-heading { flex-direction: column; }
  .ops-heading > :last-child { text-align: left; }
  .workshop-payment-form, .workshop-attendance-form { grid-template-columns: 1fr; min-width: 0; }
  .workshop-members-table td:last-child { min-width: 0; }
  .workshop-ops-form input, .workshop-ops-form select, .workshop-ops-form textarea,
  .workshop-ops-form button, .workshop-payment-form input, .workshop-payment-form select,
  .workshop-payment-form button, .workshop-attendance-form input,
  .workshop-attendance-form select, .workshop-attendance-form button,
  .ops-inline-form select, .ops-inline-form button { min-height: 44px; font-size: 16px; }

  /* Tabele jako karty: wiersz = karta, komórki z etykietami data-label (bez overflow-x). */
  table.cards, table.cards tbody, table.cards tr, table.cards td { display: block; width: 100%; }
  table.cards thead { display: none; }
  table.cards tr { border: 1px solid #262626; border-radius: 8px; margin-bottom: 12px; padding: 10px 12px; background: #131313; }
  table.cards td { border-bottom: 0; padding: 6px 0; }
  table.cards td[data-label]::before { content: attr(data-label); display: block; font-size: 10px; color: #777; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 2px; }
  table.cards .actions { display: flex; flex-wrap: wrap; gap: 8px; }
}
</style>`;

function statusLabel(s) {
  return { pending: 'oczekuje', confirmed: 'potwierdzone', in_progress: 'w naprawie', done: 'zrobione', cancelled: 'anulowane' }[s] || s;
}

// ─── AUTH ───────────────────────────────────────────────────────────────────

async function isAdmin(request, env) {
  const cookie = parseCookie(request.headers.get('Cookie'))['__Host-admin'];
  if (!cookie) return false;
  return await verifySessionCookie(cookie, env);
}

// Sekret do podpisu sesji. Bez SESSION_SECRET ani ADMIN_PASSWORD nie ma autoryzacji
// (login i tak wymaga ADMIN_PASSWORD), więc nie używamy publicznego fallbacku.
function sessionSecret(env) {
  return env.SESSION_SECRET || env.ADMIN_PASSWORD || null;
}

async function makeSessionCookie(env) {
  const exp = Date.now() + 7 * 24 * 3600 * 1000;
  const payload = b64url(JSON.stringify({ exp }));
  const sig = await hmac(sessionSecret(env), payload);
  return `${payload}.${sig}`;
}

async function verifySessionCookie(cookie, env) {
  const secret = sessionSecret(env);
  if (!secret) return false;
  const [payload, sig] = cookie.split('.');
  if (!payload || !sig) return false;
  const expected = await hmac(secret, payload);
  if (!timingSafeEqual(sig, expected)) return false;
  try {
    const { exp } = JSON.parse(b64urlDecode(payload));
    return Date.now() < exp;
  } catch { return false; }
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return b64urlBytes(new Uint8Array(sig));
}

// HMAC-SHA256 w hex, do weryfikacji podpisu webhooka WhatsApp (X-Hub-Signature-256: sha256=<hex>).
async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function parseCookie(header) {
  const out = {};
  if (!header) return out;
  header.split(/;\s*/).forEach(c => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i)] = decodeURIComponent(c.slice(i + 1));
  });
  return out;
}

// ─── UTILS ──────────────────────────────────────────────────────────────────

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function html(body) {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    },
  });
}

function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

function dayOfWeek(dateStr) {
  // Data kalendarzowa bez pory dnia, więc UTC jest deterministyczne (bez DST).
  return new Date(dateStr + 'T00:00:00Z').getUTCDay();
}

function todayInWarsaw() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });
}

// Bieżąca godzina "HH:MM" w strefie Warszawy (do odsiewania minionych slotów dzisiejszego dnia).
function nowTimeInWarsaw() {
  return new Date().toLocaleTimeString('sv-SE', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });
}

// Przesuwa datę YYYY-MM-DD o n dni (czysta arytmetyka kalendarzowa, bez strefy czasowej).
function addDaysToDateStr(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function b64url(s) {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlBytes(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return decodeURIComponent(escape(atob(s)));
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

// ─── SCHEDULED: SMS reminders + follow-ups ─────────────────────────────────

async function sendDailyReminders(env) {
  const tomorrow = addDaysWarsaw(1);
  const rows = await env.DB.prepare(
    `SELECT id, customer_name, customer_phone, date, time_slot
     FROM bookings
     WHERE date = ?1 AND status = 'confirmed' AND reminder_sent_at IS NULL`
  ).bind(tomorrow).all();

  for (const b of rows.results || []) {
    const firstName = (b.customer_name || '').split(' ')[0];
    const sms = `Cześć ${firstName}! Przypomnienie: jutro o ${b.time_slot} wizyta w skocznarower.pl, Jesionowa 18 Grodzisk Maz. Jakby coś: ${PUBLIC_PHONE_DISPLAY}.`;
    await queueReminderNotification(env, {
      entityType: 'booking',
      entityId: b.id,
      eventKey: `reminder_24h_${b.date}_${b.time_slot}`,
      recipient: b.customer_phone,
      deferDelivery: true,
      body: {
        // Outbox próbuje WhatsApp jako pierwszy. Po jednoznacznym odrzuceniu
        // automatycznie używa SMS; nie robi fallbacku przy nieznanym wyniku Meta.
        whatsapp: {
          type: 'template',
          template: {
            name: env.WHATSAPP_TPL_REMINDER || 'przypomnienie_wizyty',
            language: { code: env.WHATSAPP_LANG || 'pl' },
            components: [{
              type: 'body',
              parameters: [
                { type: 'text', text: firstName },
                { type: 'text', text: b.time_slot },
              ],
            }],
          },
        },
        sms,
      },
    });
  }
}

async function sendFollowUps(env) {
  const threeDaysAgo = addDaysWarsaw(-3);
  const thirtyDaysAgo = addDaysWarsaw(-30);
  // Dolne okno daty, żeby pierwszy cron po wdrożeniu nie wysłał prośby o opinię
  // do wszystkich historycznych wizyt naraz.
  const rows = await env.DB.prepare(
    `SELECT id, customer_name, customer_phone, date
     FROM bookings
     WHERE date <= ?1 AND date >= ?2 AND status = 'done' AND feedback_sent_at IS NULL`
  ).bind(threeDaysAgo, thirtyDaysAgo).all();

  // Placeholder CHANGE_TO_ nigdy nie idzie do klienta (ta sama reguła co w apiReviews).
  const reviewLink = (env.REVIEW_LINK && !env.REVIEW_LINK.includes('CHANGE_TO_'))
    ? env.REVIEW_LINK : 'https://www.skocznarower.pl/';
  for (const b of rows.results || []) {
    const firstName = (b.customer_name || '').split(' ')[0];
    const text = `Dzięki za zaufanie, ${firstName}! Jeśli wszystko gra, zostaw opinię na Google: ${reviewLink} . To 30 sekund, a mi pomaga zdobywać klientów.`;
    await queueSmsNotification(env, {
      entityType: 'booking', entityId: b.id, eventKey: `followup_${b.date}`,
      recipient: b.customer_phone, body: text, deferDelivery: true,
    });
  }
}

// Win-back: SMS reaktywacyjny do klientów, których ostatnia wizyta była dawno (6 do 18 mies.) i nie wrócili.
// WYŁĄCZONY domyślnie: rusza tylko gdy WINBACK_ENABLED === '1'. Limit 25 na dobę, żeby pierwszy przebieg
// nie zrobił blastu do całej historii; cron toczy to dzień po dniu, ORDER BY dla deterministycznego przydziału.
// Kwalifikacja liczy się względem NAJNOWSZEJ rezerwacji danego telefonu (nie całej historii), a stempel
// idzie tylko na ten jeden wiersz, więc klient dostaje win-back raz na cykl: nowa wizyta (nowy wiersz,
// winback_sent_at puste) naturalnie odnawia kwalifikację po kolejnym zaniku. Klient z przyszłą rezerwacją
// ma najnowszy date > cutoff i wypada.
async function sendWinBack(env) {
  if (env.WINBACK_ENABLED !== '1') return;
  const cutoff = addDaysWarsaw(-180);
  const floor = addDaysWarsaw(-540);
  // CTE z ROW_NUMBER wybiera dokładnie jeden (najnowszy) aktywny wiersz na numer telefonu,
  // rozstrzygając remisy tej samej daty po id, żeby nigdy nie wysłać dwóch SMS-ów jednej osobie
  // w tym samym przebiegu crona.
  const rows = await env.DB.prepare(
    `WITH latest AS (
       SELECT id, customer_phone, customer_name, date, winback_sent_at,
              ROW_NUMBER() OVER (PARTITION BY customer_phone ORDER BY date DESC, id DESC) AS rn
       FROM bookings
       WHERE status != 'cancelled' AND customer_phone IS NOT NULL AND customer_phone != ''
     )
     SELECT l.id, l.customer_phone, l.customer_name, l.date
     FROM latest l
     WHERE l.rn = 1
       AND l.winback_sent_at IS NULL
       AND l.date <= ?1 AND l.date >= ?2
       AND EXISTS (SELECT 1 FROM bookings b3 WHERE b3.customer_phone = l.customer_phone AND b3.status = 'done')
     ORDER BY l.date ASC
     LIMIT 25`
  ).bind(cutoff, floor).all();

  for (const b of rows.results || []) {
    const firstName = (b.customer_name || '').split(' ')[0];
    const text = `Cześć ${firstName}! Minęło trochę od ostatniego serwisu Twojego roweru. Przed sezonem warto sprawdzić hamulce i łańcuch, po zimie zwykle najbardziej cierpią. Umówisz się tutaj: skocznarower.pl/umow`;
    await queueSmsNotification(env, {
      entityType: 'booking', entityId: b.id, eventKey: `winback_${b.date}`,
      recipient: b.customer_phone, body: text, deferDelivery: true,
    });
  }
}

async function sendSeasonalReminders(env) {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });
  const [year, month, day] = today.split('-');
  if (month !== '03' || day !== '15') return;

  const rows = await env.DB.prepare(
    `SELECT id, email, unsubscribe_token FROM seasonal_reminders
     WHERE unsubscribed_at IS NULL
       AND (last_sent_year IS NULL OR last_sent_year < ?1)`
  ).bind(Number(year)).all();

  if (!env.RESEND_API_KEY) {
    console.log('seasonal reminders: no RESEND_API_KEY, skipping send for', (rows.results || []).length);
    return;
  }
  const from = env.FROM_EMAIL || 'rezerwacje@skocznarower.pl';
  const replyTo = env.REPLY_TO_EMAIL || env.NOTIFY_EMAIL;

  for (const r of rows.results || []) {
    try {
      const unsubscribeToken = r.unsubscribe_token || crypto.randomUUID();
      if (!r.unsubscribe_token) {
        await env.DB.prepare(
          'UPDATE seasonal_reminders SET unsubscribe_token = ?1 WHERE id = ?2'
        ).bind(unsubscribeToken, r.id).run();
      }
      const unsubscribeUrl = 'https://www.skocznarower.pl/api/reminders/unsubscribe?t=' + encodeURIComponent(unsubscribeToken);
      const payload = {
        from,
        to: r.email,
        subject: 'Czas na przegląd przed sezonem, skocznarower.pl',
        text:
`Cześć,

Wiosna pełną parą. To dobry moment, żeby rower wrócił do formy: przegląd, bleeding, centrowanie kół, sprawdzenie napędu.

Wybierasz termin tutaj: https://www.skocznarower.pl/umow

Do zobaczenia w warsztacie,
Mateusz / skocznarower.pl
Jesionowa 18, Grodzisk Mazowiecki
Tel. ${PUBLIC_PHONE_DISPLAY}

Rezygnacja z przypomnień: ${unsubscribeUrl}
`,
      };
      if (replyTo) payload.reply_to = replyTo;
      await queueEmailNotification(env, {
        entityType: 'seasonal_reminder',
        entityId: r.id,
        eventKey: 'seasonal_' + year,
        recipient: r.email,
        body: payload,
      });
    } catch (e) {
      console.error('seasonal mail error for', r.email, e);
    }
  }
}

/**
 * Wysyła SMS przez SMSAPI (smsapi.pl). Wymaga env.SMSAPI_TOKEN (OAuth token z panelu).
 * Bez tokena loguje treść do console (dry-run dla developmentu).
 *
 * Pole nadawcy: env.SMS_SENDER, fallback 'Info' (darmowy nadawca SMSAPI dostępny od razu).
 * Własna nazwa alfanumeryczna wymaga zatwierdzenia w panelu SMSAPI (1-3 dni).
 */
async function sendSms(env, phoneRaw, text, options = {}) {
  const phone = normalizePhone(phoneRaw);
  const target = phone.startsWith('48') ? phone : (phone.length === 9 ? '48' + phone : phone);
  const outcome = (ok, providerMessageId = null, uncertain = false) => options.returnResult
    ? { ok, providerMessageId, uncertain }
    : ok;

  if (!env.SMSAPI_TOKEN) {
    console.log(JSON.stringify({ event: 'sms_dry_run', message_length: String(text || '').length }));
    // Brak providera nie jest doręczeniem. Callery nie mogą stemplować rekordu jako wysłany.
    return outcome(false);
  }

  try {
    const body = new URLSearchParams({
      to: target,
      message: text,
      from: env.SMS_SENDER || 'Info',
      format: 'json',
      encoding: 'utf-8',
    });
    const idx = String(options.idempotencyKey || '').toLowerCase()
      .replace(/[^a-z0-9]/g, '').slice(0, 255);
    if (idx) {
      body.set('idx', idx);
      body.set('check_idx', '1');
    }
    const r = await fetch('https://api.smsapi.pl/sms.do', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SMSAPI_TOKEN}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body,
    });
    const data = await r.json().catch(() => ({}));
    if (idx && Number(data?.error) === 53) {
      return outcome(true);
    }
    if (!r.ok || data?.error) {
      console.error('SMS send failed', r.status, data);
      return outcome(false);
    }
    return outcome(true, data?.list?.[0]?.id || data?.id || null);
  } catch (e) {
    console.error('SMS send exception', e);
    // Stabilny SMSAPI idx chroni retry tego samego joba przed duplikatem przez 24h.
    return outcome(false);
  }
}

// ─── WHATSAPP (Cloud API, tryb coexistence) ────────────────────────────────

/**
 * Wysyła wiadomość WhatsApp przez Cloud API (Meta Graph; 360dialog jest zgodny z tym kształtem).
 * Wymaga env.WHATSAPP_TOKEN i env.WHATSAPP_PHONE_NUMBER_ID. Bez nich loguje bez danych
 * odbiorcy i zwraca false, bo dry-run nie jest doręczeniem.
 * `message` to obiekt Graph bez messaging_product/to, np.:
 *   { type:'text', text:{ body:'...' } }                                  // free-form (tylko w oknie 24h)
 *   { type:'template', template:{ name, language:{code}, components:[...] } }  // szablon (poza oknem 24h)
 * env.WHATSAPP_API_BASE domyślnie 'graph.facebook.com', env.WHATSAPP_API_VERSION domyślnie 'v21.0'
 * (BSP typu 360dialog ma inny host/nagłówek auth, wtedy dostroić tutaj). Fail-soft jak sendSms.
 */
async function sendWhatsApp(env, phoneRaw, message, options = {}) {
  const phone = normalizePhone(phoneRaw);
  const to = phone.startsWith('48') ? phone : (phone.length === 9 ? '48' + phone : phone);
  const outcome = (ok, providerMessageId = null, uncertain = false) => options.returnResult
    ? { ok, providerMessageId, uncertain }
    : ok;

  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    console.log(JSON.stringify({ event: 'whatsapp_dry_run', message_type: message?.type || 'unknown' }));
    return outcome(false);
  }

  try {
    const base = env.WHATSAPP_API_BASE || 'graph.facebook.com';
    const ver = env.WHATSAPP_API_VERSION || 'v21.0';
    const r = await fetch(`https://${base}/${ver}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, ...message }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data?.error) {
      console.error('WA send failed', r.status, data?.error || data);
      // Meta nie udostępnia klucza idempotencji. Timeout lub błąd serwera może
      // nadejść już po przyjęciu wiadomości, więc bezpieczniej wymagać decyzji
      // operatora niż automatycznie ponowić WA albo uruchomić SMS fallback.
      const uncertain = r.status === 408 || r.status >= 500;
      return outcome(false, null, uncertain);
    }
    return outcome(true, data?.messages?.[0]?.id || null);
  } catch (e) {
    console.error('WA send exception', e);
    // Meta nie zapewnia klucza idempotencji: po błędzie sieci wynik może być nieznany.
    return outcome(false, null, true);
  }
}

/**
 * Odbiera webhook WhatsApp Cloud API (wiadomości przychodzące + statusy doręczeń).
 * Weryfikuje podpis X-Hub-Signature-256 (HMAC-SHA256 po WHATSAPP_APP_SECRET); fail-closed
 * (403) gdy sekret nieustawiony, tak jak VOICE_API_SECRET i WHATSAPP_VERIFY_TOKEN.
 * Zawsze odpowiada 200 po przejściu weryfikacji (Meta ponawia przy innym kodzie), reszta
 * logiki fail-soft.
 * W trybie coexistence rozmowy widzi też właściciel w aplikacji; tu logujemy, opcjonalnie zapisujemy do D1
 * i (jeśli WHATSAPP_AUTO_ACK=1) odsyłamy jedną wiadomość naprowadzającą na formularz.
 */
async function handleWhatsAppWebhook(request, env, ctx) {
  const raw = await request.text();

  if (!env.WHATSAPP_APP_SECRET) {
    console.error('WA webhook: WHATSAPP_APP_SECRET nieustawiony, odrzucam');
    return new Response('forbidden', { status: 403 });
  }
  const provided = request.headers.get('X-Hub-Signature-256') || '';
  const expected = 'sha256=' + await hmacHex(env.WHATSAPP_APP_SECRET, raw);
  if (!timingSafeEqual(provided, expected)) {
    console.error('WA webhook: zły podpis');
    return new Response('forbidden', { status: 403 });
  }

  let body;
  try { body = JSON.parse(raw); } catch { return json({ ok: true }); }

  try {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        for (const m of value.messages || []) {
          const from = m.from;
          const text = m.text?.body || `[${m.type}]`;
          console.log('[WA inbound]', from, text);

          // Zapis do D1 (tabela z migracji 0009); fail-soft, gdy migracja nie wgrana.
          try {
            await env.DB.prepare(
              `INSERT OR IGNORE INTO whatsapp_messages (wa_message_id, direction, wa_phone, body, created_at)
               VALUES (?1, 'in', ?2, ?3, ?4)`
            ).bind(m.id || crypto.randomUUID(), from, text, Date.now()).run();
          } catch (e) { console.error('WA store error', e); }

          // Auto-ack: domyślnie wyłączony, bo w coexistence właściciel zwykle odpisuje ręcznie z aplikacji.
          if (env.WHATSAPP_AUTO_ACK === '1' && m.type === 'text') {
            const p = sendWhatsApp(env, from, {
              type: 'text',
              text: { body: 'Cześć! Najszybciej umówisz wizytę tutaj: skocznarower.pl/umow. Napisz, w czym pomóc, odpiszemy najszybciej jak się da.' },
            }).catch(e => console.error('WA auto-ack error', e));
            if (ctx?.waitUntil) ctx.waitUntil(p);
          }
        }
      }
    }
  } catch (e) { console.error('WA webhook parse error', e); }

  return json({ ok: true });
}

// ─── GOOGLE REVIEWS (Places API New) ───────────────────────────────────────

/**
 * Pobiera opinie z Google Places API (New) i zapisuje w D1.
 * Cron uruchamia raz dziennie, admin może odpalić ręcznie z /admin.
 *
 * Bez env.GOOGLE_PLACES_API_KEY i env.GOOGLE_PLACE_ID funkcja wypisuje
 * informację do konsoli i wraca bez zmian w bazie.
 *
 * Places API (New) zwraca do 5 najnowszych opinii. Limit po stronie Google.
 *
 * Zwraca krótki komunikat statusu dla panelu admina.
 */
async function fetchGoogleReviews(env) {
  if (!env.GOOGLE_PLACES_API_KEY || !env.GOOGLE_PLACE_ID) {
    console.log('google reviews: brak GOOGLE_PLACES_API_KEY/GOOGLE_PLACE_ID, pomijam');
    return 'no-keys';
  }

  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(env.GOOGLE_PLACE_ID)}?languageCode=pl`;
  const r = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': 'id,displayName,rating,userRatingCount,reviews',
    },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Places API ${r.status}: ${t.slice(0, 300)}`);
  }
  const data = await r.json();
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO google_profile (id, rating, review_count, fetched_at)
     VALUES ('profile', ?1, ?2, ?3)
     ON CONFLICT(id) DO UPDATE SET
       rating = excluded.rating,
       review_count = excluded.review_count,
       fetched_at = excluded.fetched_at`
  ).bind(
    typeof data.rating === 'number' ? data.rating : null,
    typeof data.userRatingCount === 'number' ? data.userRatingCount : null,
    now,
  ).run();

  const reviews = Array.isArray(data.reviews) ? data.reviews : [];
  let written = 0;
  for (const rv of reviews) {
    const id = rv.name || `${env.GOOGLE_PLACE_ID}/${rv.publishTime || crypto.randomUUID()}`;
    const author = rv.authorAttribution?.displayName || 'Klient Google';
    const photo = rv.authorAttribution?.photoUri || null;
    const rating = Number.isFinite(rv.rating) ? rv.rating : 5;
    const text = String(rv.text?.text || rv.originalText?.text || '').trim();
    if (!text) continue;
    const publishTime = rv.publishTime ? Date.parse(rv.publishTime) : now;
    const lang = rv.text?.languageCode || rv.originalText?.languageCode || null;
    await env.DB.prepare(
      `INSERT INTO google_reviews (review_id, author_name, author_photo, rating, text, publish_time, language, fetched_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(review_id) DO UPDATE SET
         author_name = excluded.author_name,
         author_photo = excluded.author_photo,
         rating = excluded.rating,
         text = excluded.text,
         publish_time = excluded.publish_time,
         language = excluded.language,
         fetched_at = excluded.fetched_at`
    ).bind(id, author, photo, rating, text, publishTime, lang, now).run();
    written += 1;
  }

  return `ok-${written}`;
}

function addDaysWarsaw(days) {
  const tz = 'Europe/Warsaw';
  const now = new Date();
  const todayStr = now.toLocaleDateString('sv-SE', { timeZone: tz });
  const d = new Date(todayStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toLocaleDateString('sv-SE', { timeZone: tz });
}
