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
  { id: 'wymiana-czesci',       name: 'Wymiana części (klocki, linki, dętka...)',  price: 'od 35 zł + część' },
  { id: 'kolo-centrowanie',     name: 'Centrowanie koła',                          price: 'od 120 zł' },
  { id: 'kolo-naprawa',         name: 'Naprawa koła',                              price: 'od 35 zł' },
  { id: 'kolo-zaplatanie',      name: 'Zaplatanie koła',                           price: 'od 180 zł' },
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === 'skocznarower.pl') {
      url.hostname = 'www.skocznarower.pl';
      return Response.redirect(url.toString(), 301);
    }

    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env, url);
      if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
        return await handleAdmin(request, env, url);
      }
    } catch (e) {
      console.error('Worker error', e);
      return json({ error: 'Server error' }, 500);
    }

    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try { await sendDailyReminders(env); }
      catch (e) { console.error('reminders error', e); }
      try { await sendFollowUps(env); }
      catch (e) { console.error('followups error', e); }
      try { await sendSeasonalReminders(env); }
      catch (e) { console.error('seasonal reminders error', e); }
      try { await fetchGoogleReviews(env); }
      catch (e) { console.error('google reviews error', e); }
    })());
  },
};

// ─── API ────────────────────────────────────────────────────────────────────

async function handleApi(request, env, url) {
  if (url.pathname === '/api/availability' && request.method === 'GET') {
    return await apiAvailability(env, url.searchParams.get('date'));
  }
  if (url.pathname === '/api/bookings' && request.method === 'POST') {
    return await apiCreateBooking(request, env);
  }
  if (url.pathname === '/api/reminders' && request.method === 'POST') {
    return await apiSeasonalReminder(request, env);
  }
  if (url.pathname === '/api/reviews' && request.method === 'GET') {
    return await apiReviews(env);
  }
  return json({ error: 'Not found' }, 404);
}

async function apiReviews(env) {
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

  return new Response(JSON.stringify({
    profile: profileRow ? {
      rating: profileRow.rating,
      review_count: profileRow.review_count,
      fetched_at: profileRow.fetched_at,
    } : null,
    review_link: reviewLink,
    reviews: (reviewsRes.results || []).map(r => ({
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

async function apiSeasonalReminder(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Bad JSON' }, 400); }

  const email = String(body?.email || '').trim().toLowerCase();
  if (!email || email.length > 120 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'Nieprawidłowy email' }, 400);
  }
  if (body?.consent !== true) {
    return json({ error: 'Potrzebna zgoda na kontakt' }, 400);
  }

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO seasonal_reminders (id, email, signed_up_at) VALUES (?1, ?2, ?3)`
    ).bind(id, email, Date.now()).run();
  } catch (e) {
    if (String(e?.message || '').toLowerCase().includes('unique')) {
      return json({ ok: true, message: 'Już jesteś na liście, do zobaczenia wiosną.' });
    }
    console.error('seasonal insert error', e);
    return json({ error: 'Błąd zapisu' }, 500);
  }
  return json({ ok: true, message: 'Zapisany, przypomnę mailem przed sezonem.' });
}

async function apiAvailability(env, dateStr) {
  if (!isValidDate(dateStr)) return json({ error: 'Bad date' }, 400);

  const today = todayInWarsaw();
  if (dateStr < today) return json({ slots: [] });

  const dow = dayOfWeek(dateStr);
  const allSlots = SCHEDULE[dow] || [];
  if (allSlots.length === 0) return json({ slots: [] });

  const [bookedRes, blockedRes] = await Promise.all([
    env.DB.prepare(
      "SELECT time_slot FROM bookings WHERE date = ?1 AND status != 'cancelled'"
    ).bind(dateStr).all(),
    env.DB.prepare(
      'SELECT time_slot FROM blocked_slots WHERE date = ?1'
    ).bind(dateStr).all(),
  ]);

  const taken = new Set((bookedRes.results || []).map(r => r.time_slot));
  const blocked = new Set((blockedRes.results || []).map(r => r.time_slot));
  if (blocked.has('all')) return json({ slots: [] });

  const slots = allSlots.map(s => ({
    time: s,
    available: !taken.has(s) && !blocked.has(s),
  }));
  return json({ slots });
}

async function apiCreateBooking(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Bad JSON' }, 400); }

  const errors = validateBooking(body);
  if (errors.length) return json({ error: errors[0] }, 400);

  const dow = dayOfWeek(body.date);
  if (!SCHEDULE[dow]?.includes(body.time_slot)) {
    return json({ error: 'Nieprawidłowy slot' }, 400);
  }
  if (body.date < todayInWarsaw()) {
    return json({ error: 'Nie można umówić wstecz' }, 400);
  }

  // Konflikt slotu
  const conflict = await env.DB.prepare(
    "SELECT id FROM bookings WHERE date = ?1 AND time_slot = ?2 AND status != 'cancelled' LIMIT 1"
  ).bind(body.date, body.time_slot).first();
  if (conflict) return json({ error: 'Slot zajęty, wybierz inny' }, 409);

  const blocked = await env.DB.prepare(
    "SELECT 1 FROM blocked_slots WHERE date = ?1 AND (time_slot = ?2 OR time_slot = 'all') LIMIT 1"
  ).bind(body.date, body.time_slot).first();
  if (blocked) return json({ error: 'Termin niedostępny' }, 409);

  const id = crypto.randomUUID();
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO bookings (id, created_at, date, time_slot, service_type, bike_type,
       customer_name, customer_phone, customer_email, notes, status)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'pending')`
  ).bind(
    id, now, body.date, body.time_slot,
    body.service_type, body.bike_type,
    body.customer_name.trim(), normalizePhone(body.customer_phone),
    body.customer_email?.trim() || null,
    body.notes?.trim() || null,
  ).run();

  // Notyfikacja email, best-effort, błąd nie zatrzymuje rezerwacji
  sendNotifications(env, { id, ...body }).catch(e => console.error('Mail error', e));

  return json({
    ok: true,
    id,
    message: 'Rezerwacja przyjęta. Skontaktuję się z Tobą, żeby potwierdzić.',
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
  if (!b?.customer_phone || !/[0-9]{9}/.test(normalizePhone(b.customer_phone))) e.push('Wpisz telefon');
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
  if (!env.RESEND_API_KEY) return;

  const service = SERVICES.find(s => s.id === b.service_type)?.name || b.service_type;
  const from = env.FROM_EMAIL || 'rezerwacje@skocznarower.pl';

  // do właściciela
  if (env.NOTIFY_EMAIL) {
    await resendSend(env.RESEND_API_KEY, {
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
    });
  }

  // do klienta, tylko jeśli podał email
  if (b.customer_email) {
    await resendSend(env.RESEND_API_KEY, {
      from,
      to: b.customer_email,
      subject: 'Potwierdzenie rezerwacji, skocznarower.pl',
      text:
`Cześć ${b.customer_name},

Dziękuję za zgłoszenie. Skontaktuję się z Tobą, żeby potwierdzić termin.

Data:    ${b.date}, godz. ${b.time_slot}
Usługa:  ${service}
Rower:   ${b.bike_type}

Jeśli coś się zmieni, zadzwoń: 600 370 810.

Mateusz / skocznarower.pl
Jesionowa 18, Grodzisk Mazowiecki
`,
    });
  }
}

async function resendSend(apiKey, payload) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Resend ${r.status}: ${t}`);
  }
}

// ─── ADMIN ──────────────────────────────────────────────────────────────────

async function handleAdmin(request, env, url) {
  const path = url.pathname;

  if (path === '/admin/login' && request.method === 'POST') {
    return await adminLogin(request, env);
  }
  if (path === '/admin/logout') {
    return new Response('', {
      status: 302,
      headers: {
        'Location': '/admin',
        'Set-Cookie': 'admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      },
    });
  }

  const authed = await isAdmin(request, env);

  if (!authed) {
    if (path === '/admin' || path === '/admin/') return loginPage();
    return new Response('', { status: 302, headers: { 'Location': '/admin' } });
  }

  if (path === '/admin' || path === '/admin/') return await adminDashboard(env, url);
  if (path === '/admin/booking' && request.method === 'POST') {
    return await adminUpdateBooking(request, env);
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
  return new Response('Not found', { status: 404 });
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
    return loginPage('Złe hasło.');
  }
  const cookie = await makeSessionCookie(env);
  return new Response('', {
    status: 302,
    headers: {
      'Location': '/admin',
      'Set-Cookie': `admin=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 3600}`,
    },
  });
}

async function adminUpdateBooking(request, env) {
  const form = await request.formData();
  const id = String(form.get('id') || '');
  const action = String(form.get('action') || '');
  if (!id) return new Response('Bad', { status: 400 });

  if (action === 'confirm') {
    await env.DB.prepare("UPDATE bookings SET status='confirmed' WHERE id=?1").bind(id).run();
  } else if (action === 'done') {
    await env.DB.prepare("UPDATE bookings SET status='done' WHERE id=?1").bind(id).run();
  } else if (action === 'cancel') {
    await env.DB.prepare("UPDATE bookings SET status='cancelled' WHERE id=?1").bind(id).run();
  } else if (action === 'delete') {
    await env.DB.prepare('DELETE FROM bookings WHERE id=?1').bind(id).run();
  } else if (action === 'price') {
    const raw = String(form.get('final_price') || '').replace(',', '.').trim();
    const price = raw === '' ? null : Math.round(parseFloat(raw));
    if (price !== null && (isNaN(price) || price < 0 || price > 100000)) {
      return new Response('Bad price', { status: 400 });
    }
    await env.DB.prepare('UPDATE bookings SET final_price=?1 WHERE id=?2').bind(price, id).run();
  } else {
    return new Response('Bad action', { status: 400 });
  }
  let back = String(form.get('back') || '/admin');
  if (!back.startsWith('/') || back.startsWith('//')) back = '/admin';
  return new Response('', { status: 302, headers: { 'Location': back } });
}

async function adminBlockSlot(request, env) {
  const form = await request.formData();
  const date = String(form.get('date') || '');
  const time = String(form.get('time_slot') || 'all');
  const reason = String(form.get('reason') || '').slice(0, 200);
  if (!isValidDate(date)) return new Response('Bad date', { status: 400 });

  if (form.get('_method') === 'delete') {
    await env.DB.prepare('DELETE FROM blocked_slots WHERE date=?1 AND time_slot=?2')
      .bind(date, time).run();
  } else {
    await env.DB.prepare(
      'INSERT OR REPLACE INTO blocked_slots (date, time_slot, reason, created_at) VALUES (?1, ?2, ?3, ?4)'
    ).bind(date, time, reason || null, Date.now()).run();
  }
  return new Response('', { status: 302, headers: { 'Location': '/admin' } });
}

async function adminDashboard(env, url) {
  const filter = url.searchParams.get('filter') || 'upcoming';
  const today = todayInWarsaw();

  let where = '';
  let params = [];
  if (filter === 'upcoming') {
    where = "WHERE date >= ?1 AND status IN ('pending','confirmed')";
    params = [today];
  } else if (filter === 'past') {
    where = 'WHERE date < ?1';
    params = [today];
  } else if (filter === 'cancelled') {
    where = "WHERE status='cancelled'";
  } else if (filter === 'all') {
    where = '';
  }

  const q = env.DB.prepare(
    `SELECT * FROM bookings ${where} ORDER BY date ASC, time_slot ASC LIMIT 500`
  );
  const bookings = (await (params.length ? q.bind(...params) : q).all()).results || [];

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

  return html(renderDashboard({
    bookings, blocked, filter, today,
    reviewsProfile, reviewsCount, reviewsStatus,
    outreach,
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
    <input type="password" name="password" placeholder="Hasło" autofocus required>
    <button type="submit">Zaloguj</button>
  </form>
</body></html>`);
}

function renderDashboard({ bookings, blocked, filter, today, reviewsProfile, reviewsCount, reviewsStatus, outreach }) {
  const pendingCount = bookings.filter(b => b.status === 'pending').length;

  const back = `/admin?filter=${encodeURIComponent(filter)}`;
  const backEsc = escapeHtml(back);
  const row = b => {
    const svc = SERVICES.find(s => s.id === b.service_type);
    const service = svc?.name || b.service_type;
    const estPrice = svc?.price || '-';
    const finalVal = b.final_price != null ? b.final_price : '';
    return `
    <tr class="status-${b.status}">
      <td class="when">
        <div class="date">${b.date}</div>
        <div class="time">${b.time_slot}</div>
      </td>
      <td>
        <div class="name">${escapeHtml(b.customer_name)}</div>
        <div class="muted">${escapeHtml(b.bike_type)}</div>
      </td>
      <td>
        <a href="tel:${b.customer_phone}">${escapeHtml(b.customer_phone)}</a>
        ${b.customer_email ? `<div class="muted"><a href="mailto:${escapeHtml(b.customer_email)}">${escapeHtml(b.customer_email)}</a></div>` : ''}
      </td>
      <td>
        <div>${escapeHtml(service)}</div>
        ${b.notes ? `<div class="muted notes">${escapeHtml(b.notes)}</div>` : ''}
      </td>
      <td class="price-est"><span class="muted">${escapeHtml(estPrice)}</span></td>
      <td class="price-final">
        <form method="post" action="/admin/booking" class="price-form">
          <input type="hidden" name="id" value="${b.id}">
          <input type="hidden" name="action" value="price">
          <input type="hidden" name="back" value="${backEsc}">
          <input type="number" name="final_price" value="${finalVal}" min="0" max="100000" step="1" placeholder="zł" class="price-input">
          <button type="submit" class="btn-save" title="Zapisz">✓</button>
        </form>
      </td>
      <td><span class="badge badge-${b.status}">${statusLabel(b.status)}</span></td>
      <td class="actions">
        <form method="post" action="/admin/booking" style="display:inline">
          <input type="hidden" name="id" value="${b.id}">
          <input type="hidden" name="back" value="${backEsc}">
          ${b.status === 'pending' ? '<button name="action" value="confirm" class="btn-ok">Potwierdź</button>' : ''}
          ${b.status !== 'done' ? '<button name="action" value="done" class="btn-ok">Zrobione</button>' : ''}
          ${b.status !== 'cancelled' ? '<button name="action" value="cancel" class="btn-warn">Anuluj</button>' : ''}
          <button name="action" value="delete" class="btn-del" onclick="return confirm(\'Usunąć rezerwację?\')">Usuń</button>
        </form>
      </td>
    </tr>`;
  };

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
    <a href="#outreach" class="logout">Współpraca</a>
    <a href="/admin/logout" class="logout">Wyloguj</a>
  </div>
</header>

<nav class="tabs">
  <a href="?filter=upcoming" class="${filter === 'upcoming' ? 'active' : ''}">Nadchodzące${pendingCount ? ` <span class="dot">${pendingCount}</span>` : ''}</a>
  <a href="?filter=past" class="${filter === 'past' ? 'active' : ''}">Przeszłe</a>
  <a href="?filter=cancelled" class="${filter === 'cancelled' ? 'active' : ''}">Anulowane</a>
  <a href="?filter=all" class="${filter === 'all' ? 'active' : ''}">Wszystkie</a>
</nav>

<section class="card">
  <h2>Lista (${bookings.length})${revenue > 0 ? ` · <span class="revenue">${revenue} zł</span><span class="muted revenue-note"> z ukończonych</span>` : ''}</h2>
  ${bookings.length === 0 ? '<p class="muted">Brak rezerwacji.</p>' : `
  <table>
    <thead><tr><th>Kiedy</th><th>Klient</th><th>Kontakt</th><th>Usługa</th><th>Wycena</th><th>Faktycznie</th><th>Status</th><th></th></tr></thead>
    <tbody>${bookings.map(row).join('')}</tbody>
  </table>`}
</section>

<section class="card">
  <h2>Zablokuj termin</h2>
  <p class="muted">Urlop, święto, prywatne plany. Wybierz datę i opcjonalnie godzinę (puste = cały dzień).</p>
  <form method="post" action="/admin/block" class="block-form">
    <input type="date" name="date" required min="${today}">
    <input type="text" name="time_slot" placeholder="np. 14:00 (puste = cały dzień)" pattern="[0-9]{2}:[0-9]{2}|all">
    <input type="text" name="reason" placeholder="Powód (opcjonalnie)" maxlength="200">
    <button type="submit">Zablokuj</button>
  </form>

  ${blocked.length === 0 ? '<p class="muted">Brak zablokowanych terminów.</p>' : `
  <table class="blocked-table">
    <thead><tr><th>Data</th><th>Godzina</th><th>Powód</th><th></th></tr></thead>
    <tbody>
      ${blocked.map(b => `
      <tr>
        <td>${b.date}</td>
        <td>${b.time_slot === 'all' ? 'cały dzień' : b.time_slot}</td>
        <td>${escapeHtml(b.reason || '')}</td>
        <td>
          <form method="post" action="/admin/block" style="display:inline">
            <input type="hidden" name="date" value="${b.date}">
            <input type="hidden" name="time_slot" value="${b.time_slot}">
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
  ${reviewsStatus.startsWith('ok-') ? `<p class="muted" style="color:#9fe22e;">Pobrano i zapisano ${reviewsStatus.slice(3)} opinii.</p>` : ''}
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
      <td><strong>${escapeHtml(o.brand_name)}</strong></td>
      <td><span class="muted">${channelLabel(o.channel)}</span></td>
      <td class="muted" style="max-width:280px; word-break:break-all">${escapeHtml(o.contact_method || '')}</td>
      <td>
        <span class="badge" style="background:${statusColor(o.status)}22; color:${statusColor(o.status)}; border:1px solid ${statusColor(o.status)}66;">${statusLabel(o.status)}</span>
        ${o.sent_at ? `<div class="muted" style="font-size:11px; margin-top:4px;">${new Date(o.sent_at).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}</div>` : ''}
      </td>
      <td class="muted" style="font-size:12px; max-width:260px;">
        ${o.notes ? `<div>${escapeHtml(o.notes)}</div>` : ''}
        ${o.response ? `<div style="color:#9fe22e; margin-top:4px;"><strong>Odp.:</strong> ${escapeHtml(o.response)}</div>` : ''}
      </td>
      <td class="actions" style="white-space:nowrap;">
        ${o.status === 'planned' ? `
          <form method="post" action="/admin/outreach" style="display:inline">
            <input type="hidden" name="id" value="${o.id}">
            <button name="action" value="sent" class="btn-ok">Wysłałem</button>
          </form>` : ''}
        ${o.status === 'sent' ? `
          <form method="post" action="/admin/outreach" style="display:inline; margin-right:4px;" onsubmit="this.querySelector('input[name=response]').value = prompt('Co odpisali? (skrót)') || ''; if(!this.querySelector('input[name=response]').value) return false;">
            <input type="hidden" name="id" value="${o.id}">
            <input type="hidden" name="response" value="">
            <button name="action" value="responded" class="btn-ok">Odpisali</button>
          </form>
          <form method="post" action="/admin/outreach" style="display:inline">
            <input type="hidden" name="id" value="${o.id}">
            <button name="action" value="closed" class="btn-warn">Brak odp.</button>
          </form>` : ''}
        ${o.status === 'responded' ? `
          <form method="post" action="/admin/outreach" style="display:inline">
            <input type="hidden" name="id" value="${o.id}">
            <button name="action" value="closed" class="btn-warn">Zamknij</button>
          </form>` : ''}
        ${o.status === 'closed' ? `
          <form method="post" action="/admin/outreach" style="display:inline">
            <input type="hidden" name="id" value="${o.id}">
            <button name="action" value="reopen" class="btn-ok">Odśwież</button>
          </form>` : ''}
        <form method="post" action="/admin/outreach" style="display:inline" onsubmit="return confirm('Usunąć kontakt?')">
          <input type="hidden" name="id" value="${o.id}">
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

  <form method="post" action="/admin/outreach" style="display:grid; grid-template-columns: 2fr 1fr 2fr 2fr auto; gap:8px; margin-bottom:18px;">
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
  <table>
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
.badge-done { background: #1a1a1a; color: #888; }
.badge-cancelled { background: #2a1414; color: #d66; }

.actions form { display: flex; flex-wrap: wrap; gap: 4px; }
.actions button { font-size: 11px; padding: 4px 8px; border: 1px solid #333; background: transparent; color: #ccc; border-radius: 3px; cursor: pointer; }
.actions button:hover { border-color: #555; color: #fff; }

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
.blocked-table { margin-top: 12px; }

body.login { display: flex; align-items: center; justify-content: center; }
.login-box { background: #161616; border: 1px solid #222; border-radius: 8px; padding: 32px; width: 100%; max-width: 360px; }
.login-box h1 { margin-bottom: 20px; }
.login-box input { width: 100%; background: #0e0e0e; border: 1px solid #333; color: #fff; padding: 12px 14px; border-radius: 4px; font-size: 15px; margin-bottom: 12px; }
.login-box button { width: 100%; background: #9fe22e; color: #000; border: none; padding: 12px; border-radius: 4px; font-weight: 700; cursor: pointer; font-size: 15px; }
.err { color: #d66; margin-bottom: 12px; font-size: 14px; }

@media (max-width: 720px) {
  body { padding: 12px; }
  table { font-size: 13px; }
  th, td { padding: 6px 4px; }
  .notes { max-width: 200px; }
}
</style>`;

function statusLabel(s) {
  return { pending: 'oczekuje', confirmed: 'potwierdzone', done: 'zrobione', cancelled: 'anulowane' }[s] || s;
}

// ─── AUTH ───────────────────────────────────────────────────────────────────

async function isAdmin(request, env) {
  const cookie = parseCookie(request.headers.get('Cookie'))['admin'];
  if (!cookie) return false;
  return await verifySessionCookie(cookie, env);
}

async function makeSessionCookie(env) {
  const exp = Date.now() + 7 * 24 * 3600 * 1000;
  const payload = b64url(JSON.stringify({ exp }));
  const sig = await hmac(env.SESSION_SECRET || env.ADMIN_PASSWORD || 'dev-secret', payload);
  return `${payload}.${sig}`;
}

async function verifySessionCookie(cookie, env) {
  const [payload, sig] = cookie.split('.');
  if (!payload || !sig) return false;
  const expected = await hmac(env.SESSION_SECRET || env.ADMIN_PASSWORD || 'dev-secret', payload);
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
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function html(body) {
  return new Response(body, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

function dayOfWeek(dateStr) {
  return new Date(dateStr + 'T12:00:00+02:00').getUTCDay();
}

function todayInWarsaw() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });
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
    const text = `Cześć ${b.customer_name.split(' ')[0]}! Przypomnienie: jutro o ${b.time_slot} wizyta w skocznarower.pl, Jesionowa 18 Grodzisk Maz. Jakby coś: 600 370 810.`;
    const ok = await sendSms(env, b.customer_phone, text);
    if (ok) {
      await env.DB.prepare('UPDATE bookings SET reminder_sent_at = ?1 WHERE id = ?2')
        .bind(Date.now(), b.id).run();
    }
  }
}

async function sendFollowUps(env) {
  const threeDaysAgo = addDaysWarsaw(-3);
  const rows = await env.DB.prepare(
    `SELECT id, customer_name, customer_phone
     FROM bookings
     WHERE date <= ?1 AND status = 'done' AND feedback_sent_at IS NULL`
  ).bind(threeDaysAgo).all();

  const reviewLink = env.REVIEW_LINK || 'https://www.skocznarower.pl/';
  for (const b of rows.results || []) {
    const firstName = b.customer_name.split(' ')[0];
    const text = `Dzięki za zaufanie, ${firstName}! Jeśli wszystko gra, zostaw opinię na Google: ${reviewLink} . To 30 sekund, a mi pomaga zdobywać klientów. Pozdrawiam, Mateusz / skocznarower.pl`;
    const ok = await sendSms(env, b.customer_phone, text);
    if (ok) {
      await env.DB.prepare('UPDATE bookings SET feedback_sent_at = ?1 WHERE id = ?2')
        .bind(Date.now(), b.id).run();
    }
  }
}

async function sendSeasonalReminders(env) {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });
  const [year, month, day] = today.split('-');
  if (month !== '03' || day !== '15') return;

  const rows = await env.DB.prepare(
    `SELECT id, email FROM seasonal_reminders WHERE sent_at IS NULL`
  ).all();

  if (!env.RESEND_API_KEY) {
    console.log('seasonal reminders: no RESEND_API_KEY, skipping send for', (rows.results || []).length);
    return;
  }
  const from = env.FROM_EMAIL || 'rezerwacje@skocznarower.pl';

  for (const r of rows.results || []) {
    try {
      await resendSend(env.RESEND_API_KEY, {
        from,
        to: r.email,
        subject: 'Czas na przegląd przed sezonem, skocznarower.pl',
        text:
`Cześć,

Wiosna pełną parą. To dobry moment, żeby rower wrócił do formy: przegląd, bleeding, centrowanie kół, sprawdzenie napędu.

Wybierasz termin tutaj: https://www.skocznarower.pl/umow

Pakiet wiosenny PRO (przegląd kompleksowy + bleeding 1 obwodu + centrowanie 2 kół) jest dostępny taniej niż usługi osobno.

Do zobaczenia w warsztacie,
Mateusz / skocznarower.pl
Jesionowa 18, Grodzisk Mazowiecki
Tel. 600 370 810
`,
      });
      await env.DB.prepare('UPDATE seasonal_reminders SET sent_at = ?1 WHERE id = ?2')
        .bind(Date.now(), r.id).run();
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
async function sendSms(env, phoneRaw, text) {
  const phone = normalizePhone(phoneRaw);
  const target = phone.startsWith('48') ? phone : (phone.length === 9 ? '48' + phone : phone);

  if (!env.SMSAPI_TOKEN) {
    console.log('[SMS dry-run] →', target, text);
    return true;
  }

  try {
    const body = new URLSearchParams({
      to: target,
      message: text,
      from: env.SMS_SENDER || 'Info',
      format: 'json',
      encoding: 'utf-8',
    });
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
    if (!r.ok || data?.error) {
      console.error('SMS send failed', r.status, data);
      return false;
    }
    return true;
  } catch (e) {
    console.error('SMS send exception', e);
    return false;
  }
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
