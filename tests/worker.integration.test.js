import { env, exports as workerExports } from 'cloudflare:workers';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';

const BASE_URL = 'https://www.skocznarower.pl';

function postJson(path, body, headers = {}) {
  return workerExports.default.fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function postForm(path, fields, cookie = '', extraHeaders = {}) {
  return workerExports.default.fetch(new Request(`${BASE_URL}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(cookie ? { Cookie: cookie } : {}),
      ...extraHeaders,
    },
    body: new URLSearchParams(fields),
  }));
}

function testEnv(overrides = {}) {
  return { ...env, ...overrides };
}

async function directFetch(path, init = {}, overrides = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`${BASE_URL}${path}`, init),
    testEnv(overrides),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

function directPostJson(path, body, overrides = {}, headers = {}) {
  return directFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }, overrides);
}

async function runScheduled(cron, overrides = {}) {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({
    cron,
    scheduledTime: Date.now(),
  }), testEnv(overrides), ctx);
  await waitOnExecutionContext(ctx);
}

async function adminCookie() {
  const response = await postForm('/admin/login', {
    password: 'test-admin-password',
  });
  expect(response.status).toBe(302);
  const setCookie = response.headers.get('Set-Cookie');
  expect(setCookie).toContain('admin=');
  return setCookie.split(';', 1)[0];
}

function validBooking(overrides = {}) {
  return {
    date: '2099-08-15',
    time_slot: '16:00',
    service_type: 'regulacja',
    bike_type: 'MTB',
    customer_name: 'Jan Kowalski',
    customer_phone: '500 600 700',
    notes: 'Test integracyjny',
    source: 'voice',
    landing_path: ' \u0000/en/umow.html ',
    landing_language: 'en',
    utm_source: ' Google Ads\u0000 ',
    utm_medium: '  cpc  ',
    referrer_host: ' Search.Example.COM\u0007 ',
    ...overrides,
  };
}

function validWorkshopSignup(overrides = {}) {
  return {
    parent_name: 'Anna Kowalska',
    phone: '501 602 703',
    email: 'ANNA@example.com',
    child_age: 12,
    level: 'start',
    location: 'grodzisk',
    source: 'instagram',
    landing_path: ' /ua/warsztaty.html ',
    landing_language: 'ua',
    utm_source: ' Instagram\u0000 ',
    utm_medium: ' social ',
    utm_campaign: ' wakacje-2099 ',
    notes: 'Pierwsze zajęcia',
    consent: true,
    website: '',
    ...overrides,
  };
}

function warsawDate(daysFromNow = 0) {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000)
    .toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });
}

async function seedReminderFallback(jobId) {
  const now = Date.now();
  const bookingId = `booking-${jobId}`;
  const date = warsawDate(1);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO bookings (
         id, created_at, date, time_slot, service_type, bike_type,
         customer_name, customer_phone, status
       ) VALUES (?1, ?2, ?3, '09:00', 'regulacja', 'MTB',
         'Meta Reminder', '577777777', 'confirmed')`
    ).bind(bookingId, now, date),
    env.DB.prepare(
      `INSERT INTO notification_outbox (
         id, entity_type, entity_id, event_key, channel, recipient, body,
         status, attempt_count, next_attempt_at, created_at, updated_at
       ) VALUES (?1, 'booking', ?2, ?3, 'reminder_fallback', '577777777',
         ?4, 'pending', 0, ?5, ?5, ?5)`
    ).bind(jobId, bookingId, `reminder_24h_${date}_09:00`, JSON.stringify({
      whatsapp: {
        type: 'template',
        template: { name: 'reminder_test', language: { code: 'pl' } },
      },
      sms: 'SMS fallback test',
    }), now - 1),
  ]);
  return { bookingId, jobId };
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM workshop_attendance'),
    env.DB.prepare('DELETE FROM workshop_payments'),
    env.DB.prepare('DELETE FROM workshop_sessions'),
    env.DB.prepare('DELETE FROM workshop_memberships'),
    env.DB.prepare('DELETE FROM workshop_groups'),
    env.DB.prepare('DELETE FROM bookings'),
    env.DB.prepare('DELETE FROM blocked_slots'),
    env.DB.prepare('DELETE FROM seasonal_reminders'),
    env.DB.prepare('DELETE FROM workshop_signups'),
    env.DB.prepare('DELETE FROM messages'),
    env.DB.prepare('DELETE FROM notification_outbox'),
    env.DB.prepare('DELETE FROM audit_events'),
    env.DB.prepare('DELETE FROM request_rate_limits'),
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('test isolation', () => {
  it('overrides local production-capable secrets with inert test bindings', () => {
    expect(env.ADMIN_PASSWORD).toBe('test-admin-password');
    expect(env.SMSAPI_TOKEN).toBe('');
    expect(env.RESEND_API_KEY).toBe('');
    expect(env.WHATSAPP_TOKEN).toBe('');
    expect(env.GOOGLE_SA_PRIVATE_KEY).toBe('');
  });
});

describe('GET /api/security-config', () => {
  it('does not expose a Turnstile key when protection is disabled', async () => {
    const response = await workerExports.default.fetch(`${BASE_URL}/api/security-config`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ turnstile_site_key: null });
  });
});

describe('Turnstile verification', () => {
  const activeBindings = {
    TURNSTILE_SITE_KEY: 'test-site-key',
    TURNSTILE_SECRET_KEY: 'test-secret-key',
  };

  it.each([
    [{ TURNSTILE_SITE_KEY: 'site-only', TURNSTILE_SECRET_KEY: '' }],
    [{ TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: 'secret-only' }],
  ])('fails closed when only one Turnstile binding is configured', async partialBindings => {
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);

    const config = await directFetch('/api/security-config', {}, partialBindings);
    await expect(config.json()).resolves.toEqual({ turnstile_site_key: null });
    const response = await directPostJson('/api/reminders', {
      email: 'turnstile@example.com',
      consent: true,
    }, partialBindings);

    expect(response.status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
    await expect(env.DB.prepare(
      'SELECT COUNT(*) AS total FROM seasonal_reminders'
    ).first()).resolves.toEqual({ total: 0 });
  });

  it('accepts a valid token with the expected action and hostname', async () => {
    const provider = vi.fn(async (url, init) => {
      expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
      expect(init.method).toBe('POST');
      const payload = JSON.parse(init.body);
      expect(payload).toMatchObject({
        secret: 'test-secret-key',
        response: 'valid-token',
        remoteip: '203.0.113.70',
        idempotency_key: expect.any(String),
      });
      return new Response(JSON.stringify({
        success: true,
        action: 'reminder',
        hostname: 'www.skocznarower.pl',
      }), { headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', provider);

    const config = await directFetch('/api/security-config', {}, activeBindings);
    await expect(config.json()).resolves.toEqual({ turnstile_site_key: 'test-site-key' });
    const response = await directPostJson('/api/reminders', {
      email: 'turnstile@example.com',
      consent: true,
      turnstile_token: 'valid-token',
    }, activeBindings, { 'CF-Connecting-IP': '203.0.113.70' });

    expect(response.status).toBe(200);
    expect(provider).toHaveBeenCalledTimes(1);
    expect((await env.DB.prepare(
      'SELECT email FROM seasonal_reminders'
    ).first()).email).toBe('turnstile@example.com');
  });

  it.each([
    ['wrong action', { success: true, action: 'booking', hostname: 'www.skocznarower.pl' }],
    ['wrong hostname', { success: true, action: 'reminder', hostname: 'attacker.example' }],
  ])('rejects a provider success with %s', async (_label, providerResult) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(providerResult), {
      headers: { 'Content-Type': 'application/json' },
    })));

    const response = await directPostJson('/api/reminders', {
      email: 'turnstile@example.com',
      consent: true,
      turnstile_token: 'mismatched-token',
    }, activeBindings);

    expect(response.status).toBe(400);
    await expect(env.DB.prepare(
      'SELECT COUNT(*) AS total FROM seasonal_reminders'
    ).first()).resolves.toEqual({ total: 0 });
  });

  it('rejects a Turnstile provider HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })));

    const response = await directPostJson('/api/reminders', {
      email: 'turnstile@example.com',
      consent: true,
      turnstile_token: 'provider-failure-token',
    }, activeBindings);

    expect(response.status).toBe(400);
  });

  it('aborts a timed-out Turnstile request without waiting five real seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let aborted = false;
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('aborted', 'AbortError'));
      }, { once: true });
    })));

    const responsePromise = directPostJson('/api/reminders', {
      email: 'turnstile@example.com',
      consent: true,
      turnstile_token: 'timeout-token',
    }, activeBindings);
    await vi.advanceTimersByTimeAsync(5_001);
    const response = await responsePromise;

    expect(aborted).toBe(true);
    expect(response.status).toBe(400);
  });
});

describe('POST /api/bookings', () => {
  it('rate-limits repeated public writes using a non-reversible IP key', async () => {
    const headers = { 'CF-Connecting-IP': '203.0.113.25' };
    for (let i = 0; i < 8; i++) {
      const response = await postJson('/api/bookings', {}, headers);
      expect(response.status).toBe(400);
    }
    const limited = await postJson('/api/bookings', {}, headers);
    expect(limited.status).toBe(429);
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM request_rate_limits WHERE endpoint='/api/bookings'"
    ).first()).toEqual({ total: 1 });
  });

  it('uses ADMIN_PASSWORD as the rate-limit secret when dedicated secrets are absent', async () => {
    const bindings = {
      RATE_LIMIT_SECRET: '',
      SESSION_SECRET: '',
      ADMIN_PASSWORD: 'rate-limit-fallback-password',
    };
    const headers = { 'CF-Connecting-IP': '203.0.113.71' };
    for (let i = 0; i < 8; i++) {
      const response = await directPostJson('/api/bookings', {}, bindings, headers);
      expect(response.status).toBe(400);
    }
    const limited = await directPostJson('/api/bookings', {}, bindings, headers);
    expect(limited.status).toBe(429);

    await expect(env.DB.prepare(
      "SELECT COUNT(*) AS total FROM request_rate_limits WHERE endpoint='/api/bookings'"
    ).first()).resolves.toEqual({ total: 1 });
  });

  it('rejects oversized JSON before validation or a D1 write', async () => {
    const response = await postJson('/api/bookings', validBooking({
      notes: 'x'.repeat(17_000),
    }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: 'Request too large' });
    const row = await env.DB.prepare('SELECT COUNT(*) AS total FROM bookings').first();
    expect(row.total).toBe(0);
  });

  it('rejects invalid booking data without writing to D1', async () => {
    const response = await postJson('/api/bookings', validBooking({
      service_type: 'nieistniejaca-usluga',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Wybierz usługę' });

    const row = await env.DB.prepare('SELECT COUNT(*) AS total FROM bookings').first();
    expect(row.total).toBe(0);
  });

  it('persists the first booking and rejects a conflicting active slot', async () => {
    const first = await postJson('/api/bookings', validBooking());
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ ok: true });

    const conflict = await postJson('/api/bookings', validBooking({
      customer_name: 'Piotr Nowak',
      customer_phone: '505 606 707',
    }));
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({
      error: 'Slot zajęty, wybierz inny',
    });

    const booking = await env.DB.prepare(
      `SELECT customer_name, customer_phone, status, source, landing_path,
              landing_language, utm_source, utm_medium, referrer_host
       FROM bookings`
    ).first();
    expect(booking).toEqual({
      customer_name: 'Jan Kowalski',
      customer_phone: '500600700',
      status: 'pending',
      source: 'web',
      landing_path: '/en/umow.html',
      landing_language: 'en',
      utm_source: 'Google Ads',
      utm_medium: 'cpc',
      referrer_host: 'search.example.com',
    });
  });
});

describe('POST /api/warsztaty', () => {
  it('rejects an age outside the supported range', async () => {
    const response = await postJson('/api/warsztaty', validWorkshopSignup({
      child_age: 6,
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Wiek dziecka: 7-17 lat',
    });
  });

  it('rejects an invalid acquisition source without writing to D1', async () => {
    const response = await postJson('/api/warsztaty', validWorkshopSignup({
      source: 'newsletter',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Nieprawidłowe źródło',
    });

    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM workshop_signups'
    ).first();
    expect(row.total).toBe(0);
  });

  it('accepts a honeypot submission without persisting it', async () => {
    const response = await postJson('/api/warsztaty', {
      website: 'https://spam.example',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });

    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM workshop_signups'
    ).first();
    expect(row.total).toBe(0);
  });

  it('normalizes and persists a valid signup', async () => {
    const response = await postJson('/api/warsztaty', validWorkshopSignup());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });

    const signup = await env.DB.prepare(
      `SELECT parent_name, phone, email, child_age, level, location, status,
              source, landing_path, landing_language, utm_source, utm_medium,
              utm_campaign, consent_at, consent_version
       FROM workshop_signups`
    ).first();
    expect(signup).toEqual({
      parent_name: 'Anna Kowalska',
      phone: '501602703',
      email: 'anna@example.com',
      child_age: 12,
      level: 'start',
      location: 'grodzisk',
      status: 'new',
      source: 'instagram',
      landing_path: '/ua/warsztaty.html',
      landing_language: 'ua',
      utm_source: 'Instagram',
      utm_medium: 'social',
      utm_campaign: 'wakacje-2099',
      consent_at: expect.any(Number),
      consent_version: '2026-07-26',
    });
  });
});

describe('seasonal reminder consent', () => {
  it('stores consent and supports a confirmed, idempotent unsubscribe', async () => {
    const subscribed = await postJson('/api/reminders', {
      email: 'ROWERZYSTA@example.com',
      consent: true,
    });
    expect(subscribed.status).toBe(200);

    const row = await env.DB.prepare(
      `SELECT id, email, consent_at, consent_version, unsubscribe_token, unsubscribed_at
       FROM seasonal_reminders`
    ).first();
    expect(row.email).toBe('rowerzysta@example.com');
    expect(row.consent_at).toBeTypeOf('number');
    expect(row.consent_version).toBe('2026-07-26');
    expect(row.unsubscribe_token).toBeTruthy();
    expect(row.unsubscribed_at).toBeNull();

    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO notification_outbox (
           id, entity_type, entity_id, event_key, channel, recipient, body,
           status, attempt_count, next_attempt_at, last_error, created_at, updated_at
         ) VALUES ('seasonal-pending', 'seasonal_reminder', ?1, 'seasonal_2026',
           'email', ?2, '{}', 'pending', 0, ?3, NULL, ?3, ?3)`
      ).bind(row.id, row.email, now),
      env.DB.prepare(
        `INSERT INTO notification_outbox (
           id, entity_type, entity_id, event_key, channel, recipient, body,
           status, attempt_count, next_attempt_at, last_error, created_at, updated_at
         ) VALUES ('seasonal-sending', 'seasonal_reminder', ?1, 'seasonal_2027',
           'email', ?2, '{}', 'sending', 1, ?3, NULL, ?3, ?3)`
      ).bind(row.id, row.email, now),
      env.DB.prepare(
        `INSERT INTO notification_outbox (
           id, entity_type, entity_id, event_key, channel, recipient, body,
           status, attempt_count, next_attempt_at, last_error, created_at, updated_at
         ) VALUES ('seasonal-uncertain', 'seasonal_reminder', ?1, 'seasonal_2028',
           'email', ?2, '{}', 'uncertain', 1, ?3, 'already uncertain', ?3, ?3)`
      ).bind(row.id, row.email, now),
    ]);

    const confirmation = await workerExports.default.fetch(
      `${BASE_URL}/api/reminders/unsubscribe?t=${encodeURIComponent(row.unsubscribe_token)}`
    );
    expect(confirmation.status).toBe(200);
    expect((await env.DB.prepare(
      'SELECT unsubscribed_at FROM seasonal_reminders WHERE id=?1'
    ).bind(row.id).first()).unsubscribed_at).toBeNull();

    const unsubscribed = await postForm('/api/reminders/unsubscribe', {
      token: row.unsubscribe_token,
    });
    expect(unsubscribed.status).toBe(200);
    expect((await env.DB.prepare(
      'SELECT unsubscribed_at FROM seasonal_reminders WHERE id=?1'
    ).bind(row.id).first()).unsubscribed_at).toBeTypeOf('number');
    const jobsAfterUnsubscribe = (await env.DB.prepare(
      `SELECT id, status, last_error FROM notification_outbox
       WHERE entity_id=?1 ORDER BY id`
    ).bind(row.id).all()).results;
    expect(jobsAfterUnsubscribe).toEqual([
      {
        id: 'seasonal-pending',
        status: 'cancelled',
        last_error: 'Recipient unsubscribed from seasonal reminders',
      },
      {
        id: 'seasonal-sending',
        status: 'uncertain',
        last_error: 'Recipient unsubscribed while delivery was in progress; provider outcome unknown',
      },
      { id: 'seasonal-uncertain', status: 'uncertain', last_error: 'already uncertain' },
    ]);

    const resubscribed = await postJson('/api/reminders', {
      email: 'rowerzysta@example.com',
      consent: true,
    });
    expect(resubscribed.status).toBe(200);
    expect((await env.DB.prepare(
      'SELECT unsubscribed_at FROM seasonal_reminders WHERE id=?1'
    ).bind(row.id).first()).unsubscribed_at).toBeNull();
  });
});

describe('notification outbox cron', () => {
  it('processes due jobs on the five-minute trigger', async () => {
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO notification_outbox (
         id, entity_type, entity_id, event_key, channel, recipient, body,
         status, attempt_count, next_attempt_at, created_at, updated_at
       ) VALUES ('cron-job', 'booking', 'missing-booking', 'test', 'sms',
         '500600700', 'Test', 'pending', 0, ?1, ?1, ?1)`
    ).bind(now - 1000).run();
    const ctx = createExecutionContext();

    await worker.scheduled(createScheduledController({
      cron: '*/5 * * * *',
      scheduledTime: now,
    }), env, ctx);
    await waitOnExecutionContext(ctx);

    const row = await env.DB.prepare(
      `SELECT status, attempt_count, next_attempt_at
       FROM notification_outbox WHERE id='cron-job'`
    ).first();
    expect(row.status).toBe('pending');
    expect(row.attempt_count).toBe(1);
    expect(row.next_attempt_at).toBeGreaterThan(now);
  });

  it('marks an interrupted delivery uncertain for an explicit operator decision', async () => {
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO notification_outbox (
         id, entity_type, entity_id, event_key, channel, recipient, body,
         status, attempt_count, next_attempt_at, created_at, updated_at
       ) VALUES ('unknown-job', 'booking', 'missing-booking', 'test', 'sms',
         '500600700', 'Test', 'sending', 1, ?1, ?1, ?2)`
    ).bind(now - 60_000, now - 11 * 60_000).run();
    const ctx = createExecutionContext();

    await worker.scheduled(createScheduledController({
      cron: '*/5 * * * *',
      scheduledTime: now,
    }), env, ctx);
    await waitOnExecutionContext(ctx);

    const row = await env.DB.prepare(
      `SELECT status, attempt_count, last_error
       FROM notification_outbox WHERE id='unknown-job'`
    ).first();
    expect(row.status).toBe('uncertain');
    expect(row.attempt_count).toBe(1);
    expect(row.last_error).toContain('operator decision required');
  });
});

describe('scheduled notification workflows', () => {
  it('queues reminder, follow-up, and win-back work and stamps only delivered jobs', async () => {
    const now = Date.now();
    const reminderDate = warsawDate(1);
    const followupDate = warsawDate(-4);
    const winbackDate = warsawDate(-200);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO bookings (
           id, created_at, date, time_slot, service_type, bike_type,
           customer_name, customer_phone, status
         ) VALUES ('cron-reminder', ?1, ?2, '09:00', 'regulacja', 'MTB',
           'Roman Reminder', '511111111', 'confirmed')`
      ).bind(now, reminderDate),
      env.DB.prepare(
        `INSERT INTO bookings (
           id, created_at, date, time_slot, service_type, bike_type,
           customer_name, customer_phone, status
         ) VALUES ('cron-followup', ?1, ?2, '10:00', 'regulacja', 'MTB',
           'Feliks Followup', '522222222', 'done')`
      ).bind(now, followupDate),
      env.DB.prepare(
        `INSERT INTO bookings (
           id, created_at, date, time_slot, service_type, bike_type,
           customer_name, customer_phone, status
         ) VALUES ('cron-winback', ?1, ?2, '11:00', 'regulacja', 'MTB',
           'Wiktor Winback', '533333333', 'done')`
      ).bind(now, winbackDate),
    ]);

    await runScheduled('0 8 * * *', { WINBACK_ENABLED: '1' });

    const queued = (await env.DB.prepare(
      `SELECT entity_id, event_key, channel, status, attempt_count
       FROM notification_outbox WHERE entity_id LIKE 'cron-%' ORDER BY entity_id`
    ).all()).results;
    expect(queued).toEqual([
      {
        entity_id: 'cron-followup',
        event_key: `followup_${followupDate}`,
        channel: 'sms',
        status: 'pending',
        attempt_count: 0,
      },
      {
        entity_id: 'cron-reminder',
        event_key: `reminder_24h_${reminderDate}_09:00`,
        channel: 'reminder_fallback',
        status: 'pending',
        attempt_count: 0,
      },
      {
        entity_id: 'cron-winback',
        event_key: `winback_${winbackDate}`,
        channel: 'sms',
        status: 'pending',
        attempt_count: 0,
      },
    ]);
    const unstamped = await env.DB.prepare(
      `SELECT SUM(reminder_sent_at IS NOT NULL) AS reminders,
              SUM(feedback_sent_at IS NOT NULL) AS followups,
              SUM(winback_sent_at IS NOT NULL) AS winbacks
       FROM bookings WHERE id LIKE 'cron-%'`
    ).first();
    expect(unstamped).toEqual({ reminders: 0, followups: 0, winbacks: 0 });

    await env.DB.prepare(
      "UPDATE notification_outbox SET next_attempt_at=?1 WHERE entity_id LIKE 'cron-%'"
    ).bind(Date.now() - 1).run();
    let providerSequence = 0;
    const provider = vi.fn(async () => new Response(JSON.stringify({
      list: [{ id: `sms-provider-${++providerSequence}` }],
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', provider);

    await runScheduled('*/5 * * * *', {
      WINBACK_ENABLED: '1',
      SMSAPI_TOKEN: 'smsapi-test-token',
    });

    expect(provider).toHaveBeenCalledTimes(3);
    const delivered = (await env.DB.prepare(
      `SELECT status, attempt_count, provider_message_id
       FROM notification_outbox WHERE entity_id LIKE 'cron-%' ORDER BY entity_id`
    ).all()).results;
    expect(delivered).toHaveLength(3);
    for (const job of delivered) {
      expect(job.status).toBe('sent');
      expect(job.attempt_count).toBe(1);
      expect(job.provider_message_id).toMatch(/^sms-provider-/);
    }
    const stamped = await env.DB.prepare(
      `SELECT
         (SELECT reminder_sent_at FROM bookings WHERE id='cron-reminder') AS reminder,
         (SELECT feedback_sent_at FROM bookings WHERE id='cron-followup') AS followup,
         (SELECT winback_sent_at FROM bookings WHERE id='cron-winback') AS winback`
    ).first();
    expect(stamped).toEqual({
      reminder: expect.any(Number),
      followup: expect.any(Number),
      winback: expect.any(Number),
    });
  });

  it('uses the stable outbox id as Resend Idempotency-Key', async () => {
    const now = Date.now();
    const year = Number(warsawDate().slice(0, 4));
    const jobId = '44bb44bb-44bb-44bb-84bb-44bb44bb44bb';
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO seasonal_reminders (
           id, email, signed_up_at, consent_at, consent_version, unsubscribe_token
         ) VALUES ('resend-recipient', 'resend@example.com', ?1, ?1, 'test', 'resend-unsubscribe-token')`
      ).bind(now),
      env.DB.prepare(
        `INSERT INTO notification_outbox (
           id, entity_type, entity_id, event_key, channel, recipient, body,
           status, attempt_count, next_attempt_at, created_at, updated_at
         ) VALUES (?1, 'seasonal_reminder', 'resend-recipient', ?2, 'email',
           'resend@example.com', ?3, 'pending', 0, ?4, ?4, ?4)`
      ).bind(jobId, `seasonal_${year}`, JSON.stringify({
        from: 'test@example.com',
        to: 'resend@example.com',
        subject: 'Test',
        text: 'Test idempotency',
      }), now - 1),
    ]);
    const provider = vi.fn(async (url, init) => {
      expect(url).toBe('https://api.resend.com/emails');
      expect(new Headers(init.headers).get('Idempotency-Key')).toBe(jobId);
      return new Response(JSON.stringify({ id: 'resend-provider-message' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', provider);

    await runScheduled('*/5 * * * *', { RESEND_API_KEY: 'resend-test-key' });

    expect(provider).toHaveBeenCalledTimes(1);
    await expect(env.DB.prepare(
      'SELECT status, provider_message_id FROM notification_outbox WHERE id=?1'
    ).bind(jobId).first()).resolves.toEqual({
      status: 'sent',
      provider_message_id: 'resend-provider-message',
    });
    expect((await env.DB.prepare(
      "SELECT last_sent_year FROM seasonal_reminders WHERE id='resend-recipient'"
    ).first()).last_sent_year).toBe(year);
  });

  it('reuses SMSAPI idx and treats duplicate error 53 as a successful retry', async () => {
    const now = Date.now();
    const jobId = '55cc55cc-55cc-45cc-85cc-55cc55cc55cc';
    await env.DB.prepare(
      `INSERT INTO notification_outbox (
         id, entity_type, entity_id, event_key, channel, recipient, body,
         status, attempt_count, next_attempt_at, created_at, updated_at
       ) VALUES (?1, 'system', 'sms-idempotency', 'retry', 'sms', '544444444',
         'Test retry', 'pending', 0, ?2, ?2, ?2)`
    ).bind(jobId, now - 1).run();
    const submittedBodies = [];
    const provider = vi.fn(async (_url, init) => {
      submittedBodies.push(new URLSearchParams(init.body));
      if (submittedBodies.length === 1) {
        return new Response(JSON.stringify({ error: 500 }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 53 }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', provider);
    const bindings = { SMSAPI_TOKEN: 'smsapi-test-token' };

    await runScheduled('*/5 * * * *', bindings);
    expect((await env.DB.prepare(
      'SELECT status, attempt_count FROM notification_outbox WHERE id=?1'
    ).bind(jobId).first())).toEqual({ status: 'pending', attempt_count: 1 });
    await env.DB.prepare(
      'UPDATE notification_outbox SET next_attempt_at=?2 WHERE id=?1'
    ).bind(jobId, Date.now() - 1).run();
    await runScheduled('*/5 * * * *', bindings);

    expect(provider).toHaveBeenCalledTimes(2);
    const expectedIdx = jobId.replaceAll('-', '');
    for (const body of submittedBodies) {
      expect(body.get('idx')).toBe(expectedIdx);
      expect(body.get('check_idx')).toBe('1');
    }
    await expect(env.DB.prepare(
      'SELECT status, attempt_count FROM notification_outbox WHERE id=?1'
    ).bind(jobId).first()).resolves.toEqual({ status: 'sent', attempt_count: 2 });
  });

  it.each([503, 408])(
    'marks reminder fallback uncertain after Meta HTTP %i without calling SMSAPI',
    async status => {
      const jobId = `meta-uncertain-${status}`;
      await seedReminderFallback(jobId);
      const provider = vi.fn(async url => {
        expect(String(url)).toContain('graph.facebook.com');
        return new Response(JSON.stringify({ error: { message: 'temporary failure' } }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      });
      vi.stubGlobal('fetch', provider);

      await runScheduled('*/5 * * * *', {
        WHATSAPP_TOKEN: 'meta-test-token',
        WHATSAPP_PHONE_NUMBER_ID: 'test-phone-id',
        WHATSAPP_API_BASE: 'graph.facebook.com',
        WHATSAPP_API_VERSION: 'v21.0',
        SMSAPI_TOKEN: 'smsapi-test-token',
      });

      expect(provider).toHaveBeenCalledTimes(1);
      await expect(env.DB.prepare(
        'SELECT status, attempt_count, last_error FROM notification_outbox WHERE id=?1'
      ).bind(jobId).first()).resolves.toEqual({
        status: 'uncertain',
        attempt_count: 1,
        last_error: 'Provider outcome unknown; operator decision required',
      });
    },
  );

  it('uses SMS fallback after an unambiguous Meta 4xx rejection', async () => {
    const jobId = 'meta-rejected-400';
    await seedReminderFallback(jobId);
    const requestedUrls = [];
    const provider = vi.fn(async url => {
      requestedUrls.push(String(url));
      if (String(url).includes('graph.facebook.com')) {
        return new Response(JSON.stringify({ error: { message: 'bad template' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ list: [{ id: 'sms-fallback-delivered' }] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', provider);

    await runScheduled('*/5 * * * *', {
      WHATSAPP_TOKEN: 'meta-test-token',
      WHATSAPP_PHONE_NUMBER_ID: 'test-phone-id',
      WHATSAPP_API_BASE: 'graph.facebook.com',
      WHATSAPP_API_VERSION: 'v21.0',
      SMSAPI_TOKEN: 'smsapi-test-token',
    });

    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls[0]).toContain('graph.facebook.com');
    expect(requestedUrls[1]).toBe('https://api.smsapi.pl/sms.do');
    await expect(env.DB.prepare(
      'SELECT status, provider_message_id FROM notification_outbox WHERE id=?1'
    ).bind(jobId).first()).resolves.toEqual({
      status: 'sent',
      provider_message_id: 'sms-fallback-delivered',
    });
  });
});

describe('admin booking lifecycle', () => {
  it('requires authentication for the workshop CRM', async () => {
    const response = await workerExports.default.fetch(new Request(
      `${BASE_URL}/admin/warsztaty`,
      { redirect: 'manual' },
    ));
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/admin');
  });

  it('rejects browser mutations sent from a foreign origin', async () => {
    const response = await workerExports.default.fetch(new Request(`${BASE_URL}/admin/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://attacker.example',
        'Sec-Fetch-Site': 'cross-site',
      },
      body: new URLSearchParams({ password: 'test-admin-password' }),
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get('Set-Cookie')).toBeNull();
  });

  it('rate-limits repeated login attempts', async () => {
    const headers = { 'CF-Connecting-IP': '203.0.113.26' };
    for (let i = 0; i < 10; i++) {
      const response = await postForm('/admin/login', { password: 'wrong' }, '', headers);
      expect(response.status).toBe(200);
    }
    const limited = await postForm('/admin/login', { password: 'wrong' }, '', headers);
    expect(limited.status).toBe(429);
  });

  it('does not let a stale quick link confirm or cancel an in-progress booking', async () => {
    const created = await postJson('/api/bookings', validBooking());
    expect(created.status).toBe(200);
    const { id } = await created.json();
    const ownerJob = await env.DB.prepare(
      `SELECT body FROM notification_outbox
       WHERE entity_type='booking' AND entity_id=?1
         AND event_key='owner_new_booking' AND channel='sms'`
    ).bind(id).first();
    const link = ownerJob.body.match(/https:\/\/[^\s]+/)?.[0];
    expect(link).toBeTruthy();
    const quickUrl = new URL(link);
    await env.DB.prepare(
      "UPDATE bookings SET status='in_progress' WHERE id=?1"
    ).bind(id).run();

    for (const action of ['confirm', 'cancel']) {
      const response = await postForm(
        `${quickUrl.pathname}${quickUrl.search}`,
        { action },
      );
      expect(response.status).toBe(200);
      expect((await env.DB.prepare(
        'SELECT status FROM bookings WHERE id=?1'
      ).bind(id).first()).status).toBe('in_progress');
    }
  });

  it('confirms and cancels a booking while keeping repeated actions idempotent', async () => {
    const created = await postJson('/api/bookings', validBooking());
    const { id } = await created.json();
    const cookie = await adminCookie();

    const confirmed = await postForm('/admin/booking', {
      id,
      action: 'confirm',
      back: '/admin',
    }, cookie);
    expect(confirmed.status).toBe(302);
    expect(confirmed.headers.get('Location')).toContain('potwierdzono-0');

    const confirmedAgain = await postForm('/admin/booking', {
      id,
      action: 'confirm',
      back: '/admin',
    }, cookie);
    expect(confirmedAgain.status).toBe(302);

    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO notification_outbox (
         id, entity_type, entity_id, event_key, channel, recipient, body,
         status, attempt_count, next_attempt_at, created_at, updated_at
       ) VALUES ('lifecycle-interrupted', 'booking', ?1, 'accepted_interrupted',
         'sms', '500600700', 'Niepewna wiadomość', 'sending', 1, ?2, ?2, ?2)`
    ).bind(id, now).run();

    const cancelled = await postForm('/admin/booking', {
      id,
      action: 'cancel',
      back: '/admin',
    }, cookie);
    expect(cancelled.status).toBe(302);
    expect(cancelled.headers.get('Location')).toContain('anulowano-0');

    const booking = await env.DB.prepare(
      'SELECT status FROM bookings WHERE id = ?1'
    ).bind(id).first();
    expect(booking.status).toBe('cancelled');

    const messages = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM messages WHERE booking_id = ?1'
    ).bind(id).first();
    expect(messages.total).toBe(0);

    const outbox = await env.DB.prepare(
      `SELECT id, event_key, status, attempt_count FROM notification_outbox
       WHERE entity_id=?1 AND recipient=?2 ORDER BY event_key`
    ).bind(id, '500600700').all();
    expect(outbox.results).toHaveLength(3);
    const confirmedJob = outbox.results.find(job => job.event_key.startsWith('confirmed_'));
    const cancelledJob = outbox.results.find(job => job.event_key.startsWith('cancelled_'));
    const interruptedJob = outbox.results.find(job => job.id === 'lifecycle-interrupted');
    expect(confirmedJob).toMatchObject({ status: 'cancelled', attempt_count: 1 });
    expect(cancelledJob).toMatchObject({ status: 'pending', attempt_count: 1 });
    expect(interruptedJob).toMatchObject({ status: 'uncertain', attempt_count: 1 });
    expect(outbox.results.filter(job => job.status === 'pending')).toEqual([cancelledJob]);

    await env.DB.prepare(
      'UPDATE notification_outbox SET next_attempt_at=?2 WHERE id=?1'
    ).bind(cancelledJob.id, Date.now() - 1).run();
    const provider = vi.fn(async () => new Response(JSON.stringify({
      list: [{ id: 'cancelled-sms' }],
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', provider);
    await runScheduled('*/5 * * * *', { SMSAPI_TOKEN: 'smsapi-test-token' });

    expect(provider).toHaveBeenCalledTimes(1);
    expect((await env.DB.prepare(
      'SELECT status FROM notification_outbox WHERE id=?1'
    ).bind(cancelledJob.id).first()).status).toBe('sent');
    expect((await env.DB.prepare(
      'SELECT status FROM notification_outbox WHERE id=?1'
    ).bind(confirmedJob.id).first()).status).toBe('cancelled');
  });

  it('stores a manual source and archives only terminal bookings without changing status', async () => {
    const cookie = await adminCookie();
    const response = await postForm('/admin/booking-new', {
      customer_name: 'Maria Nowak',
      customer_phone: '511 222 333',
      customer_email: 'maria@example.com',
      service_type: 'bleeding',
      bike_type: 'MTB',
      bike_model: 'Test Bike',
      date: '2099-08-16',
      time_slot: '17:00',
      source: 'google',
      notes: 'Kontakt z map',
    }, cookie);

    expect(response.status).toBe(302);
    const booking = await env.DB.prepare(
      'SELECT id, status, source, notes FROM bookings WHERE customer_phone = ?1'
    ).bind('511222333').first();
    expect(booking).toMatchObject({
      status: 'confirmed',
      source: 'google',
      notes: '[google] Kontakt z map',
    });

    const activeArchive = await postForm('/admin/booking', {
      id: booking.id,
      action: 'archive',
      back: '/admin',
    }, cookie);
    expect(activeArchive.status).toBe(302);
    expect(activeArchive.headers.get('Location')).toContain('err=archive-status');
    await expect(env.DB.prepare(
      'SELECT status, archived_at FROM bookings WHERE id=?1'
    ).bind(booking.id).first()).resolves.toEqual({
      status: 'confirmed',
      archived_at: null,
    });

    const completed = await postForm('/admin/booking', {
      id: booking.id,
      action: 'done',
      repair_summary: 'Przegląd zakończony',
      final_price: '200',
      back: '/admin',
    }, cookie);
    expect(completed.status).toBe(302);

    const archived = await postForm('/admin/booking', {
      id: booking.id,
      action: 'archive',
      back: '/admin',
    }, cookie);
    expect(archived.status).toBe(302);
    const kept = await env.DB.prepare(
      'SELECT status, archived_at FROM bookings WHERE id=?1'
    ).bind(booking.id).first();
    expect(kept.status).toBe('done');
    expect(kept.archived_at).toBeTypeOf('number');

    const restored = await postForm('/admin/booking', {
      id: booking.id,
      action: 'unarchive',
      back: '/admin?filter=archived',
    }, cookie);
    expect(restored.status).toBe(302);
    await expect(env.DB.prepare(
      'SELECT status, archived_at FROM bookings WHERE id=?1'
    ).bind(booking.id).first()).resolves.toEqual({
      status: 'done',
      archived_at: null,
    });
  });

  it('resets exhausted outbox jobs before an explicit retry', async () => {
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO notification_outbox (
         id, entity_type, entity_id, event_key, channel, recipient, body,
         status, attempt_count, next_attempt_at, last_error, created_at, updated_at
       ) VALUES ('failed-job', 'booking', 'missing-booking', 'test', 'sms',
         '500600700', 'Test', 'failed', 8, ?1, 'provider failed', ?1, ?1)`
    ).bind(now - 60_000).run();
    const cookie = await adminCookie();

    const retried = await postForm('/admin/outbox-retry', {}, cookie);
    expect(retried.status).toBe(302);
    expect(retried.headers.get('Location')).toContain('outbox-retry');
    const row = await env.DB.prepare(
      `SELECT status, attempt_count, next_attempt_at, last_error
       FROM notification_outbox WHERE id='failed-job'`
    ).first();
    expect(row).toMatchObject({
      status: 'pending',
      attempt_count: 0,
      last_error: null,
    });
    expect(row.next_attempt_at).toBeGreaterThanOrEqual(now);
  });

  it('keeps uncertain jobs out of bulk retry and resolves each operator decision explicitly', async () => {
    const now = Date.now();
    const makeJob = (id, status) => env.DB.prepare(
      `INSERT INTO notification_outbox (
         id, entity_type, entity_id, event_key, channel, recipient, body,
         status, attempt_count, next_attempt_at, last_error, created_at, updated_at
       ) VALUES (?1, 'system', ?1, 'operator-test', 'sms', '566666666', 'Test',
         ?2, 2, ?3, 'initial error', ?3, ?3)`
    ).bind(id, status, now - 60_000);
    await env.DB.batch([
      makeJob('bulk-failed', 'failed'),
      makeJob('uncertain-retry', 'uncertain'),
      makeJob('uncertain-mark-sent', 'uncertain'),
      makeJob('uncertain-cancel', 'uncertain'),
    ]);
    const cookie = await adminCookie();

    const bulk = await postForm('/admin/outbox-retry', {}, cookie);
    expect(bulk.status).toBe(302);
    expect((await env.DB.prepare(
      "SELECT status FROM notification_outbox WHERE id='bulk-failed'"
    ).first()).status).toBe('pending');
    const uncertainAfterBulk = (await env.DB.prepare(
      "SELECT status FROM notification_outbox WHERE id LIKE 'uncertain-%'"
    ).all()).results;
    expect(uncertainAfterBulk).toEqual([
      { status: 'uncertain' },
      { status: 'uncertain' },
      { status: 'uncertain' },
    ]);

    for (const [id, action] of [
      ['uncertain-retry', 'retry'],
      ['uncertain-mark-sent', 'mark_sent'],
      ['uncertain-cancel', 'cancel'],
    ]) {
      const response = await postForm('/admin/outbox-resolve', { id, action }, cookie);
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toContain('outbox-resolved');
    }

    const resolved = (await env.DB.prepare(
      `SELECT id, status, attempt_count, sent_at, last_error
       FROM notification_outbox WHERE id LIKE 'uncertain-%' ORDER BY id`
    ).all()).results;
    expect(resolved).toEqual([
      {
        id: 'uncertain-cancel',
        status: 'cancelled',
        attempt_count: 2,
        sent_at: null,
        last_error: 'Operator cancelled uncertain outcome',
      },
      {
        id: 'uncertain-mark-sent',
        status: 'sent',
        attempt_count: 2,
        sent_at: expect.any(Number),
        last_error: 'Operator marked uncertain outcome as sent',
      },
      {
        id: 'uncertain-retry',
        status: 'pending',
        attempt_count: 2,
        sent_at: null,
        last_error: 'Operator approved retry after uncertain outcome',
      },
    ]);
    await expect(env.DB.prepare(
      `SELECT COUNT(*) AS total FROM audit_events
       WHERE entity_type='notification_outbox' AND entity_id LIKE 'uncertain-%'
         AND action LIKE 'uncertain_%'`
    ).first()).resolves.toEqual({ total: 3 });
  });
});

describe('workshop CRM', () => {
  it('updates a signup and exposes overdue follow-up work', async () => {
    const created = await postJson('/api/warsztaty', validWorkshopSignup());
    expect(created.status).toBe(200);
    const signup = await env.DB.prepare('SELECT id FROM workshop_signups').first();
    const cookie = await adminCookie();

    const updated = await postForm('/admin/warsztaty', {
      id: signup.id,
      filter: 'all',
      status: 'contacted',
      next_action_at: '2000-01-01T12:00',
      trial_at: '2099-09-01T17:00',
      group_name: 'Wtorek 17:00',
      assigned_to: 'Mateusz',
      owner_notes: 'Rodzic prosi o SMS.',
    }, cookie);
    expect(updated.status).toBe(302);
    expect(updated.headers.get('Location')).toContain('saved=1');

    const row = await env.DB.prepare(
      `SELECT status, next_action_at, trial_at, group_name, assigned_to,
              owner_notes, updated_at
       FROM workshop_signups WHERE id = ?1`
    ).bind(signup.id).first();
    expect(row.status).toBe('contacted');
    expect(row.next_action_at).toBeTypeOf('number');
    expect(row.trial_at).toBeTypeOf('number');
    expect(row.group_name).toBe('Wtorek 17:00');
    expect(row.assigned_to).toBe('Mateusz');
    expect(row.owner_notes).toBe('Rodzic prosi o SMS.');
    expect(row.updated_at).toBeTypeOf('number');

    const duePage = await workerExports.default.fetch(`${BASE_URL}/admin/warsztaty?filter=due`, {
      headers: { Cookie: cookie },
    });
    expect(duePage.status).toBe(200);
    await expect(duePage.text()).resolves.toContain('Anna Kowalska');
  });

  it('rejects an unknown CRM status without changing the signup', async () => {
    await postJson('/api/warsztaty', validWorkshopSignup());
    const signup = await env.DB.prepare('SELECT id FROM workshop_signups').first();
    const cookie = await adminCookie();

    const response = await postForm('/admin/warsztaty', {
      id: signup.id,
      filter: 'all',
      status: 'deleted',
    }, cookie);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toContain('error=invalid');

    const row = await env.DB.prepare(
      'SELECT status FROM workshop_signups WHERE id = ?1'
    ).bind(signup.id).first();
    expect(row.status).toBe('new');
  });
});

describe('workshop trial self-service', () => {
  it('uses a signed, GET-safe link and records an idempotent response', async () => {
    const created = await postJson('/api/warsztaty', validWorkshopSignup());
    expect(created.status).toBe(200);
    const signup = await env.DB.prepare(
      'SELECT id, parent_name, phone, email FROM workshop_signups'
    ).first();
    const cookie = await adminCookie();

    const scheduled = await postForm('/admin/warsztaty', {
      id: signup.id,
      filter: 'all',
      status: 'trial_booked',
      next_action_at: '',
      trial_at: '2099-09-01T17:00',
      group_name: 'Wtorek 17:00',
      assigned_to: 'Mateusz',
      owner_notes: '',
    }, cookie);
    expect(scheduled.status).toBe(302);

    const invitation = await env.DB.prepare(
      `SELECT body, event_key FROM notification_outbox
       WHERE entity_id=?1 AND channel='sms' AND recipient=?2
         AND event_key LIKE 'trial_invite_%'`
    ).bind(signup.id, '501602703').first();
    expect(invitation.event_key).toMatch(/^trial_invite_\d+$/);
    const linkMatch = invitation.body.match(/https:\/\/[^\s]+/);
    expect(linkMatch).not.toBeNull();
    const responseUrl = new URL(linkMatch[0]);
    expect(responseUrl.pathname).toBe('/warsztaty/potwierdz');

    const opened = await workerExports.default.fetch(responseUrl.toString());
    expect(opened.status).toBe(200);
    expect(opened.headers.get('Cache-Control')).toBe('no-store');
    expect(opened.headers.get('Referrer-Policy')).toBe('no-referrer');
    const openedHtml = await opened.text();
    expect(openedHtml).toContain('Wtorek 17:00');
    expect(openedHtml).not.toContain(signup.parent_name);
    expect(openedHtml).not.toContain(signup.phone);
    expect(openedHtml).not.toContain(signup.email);
    await expect(env.DB.prepare(
      'SELECT trial_response, trial_response_at FROM workshop_signups WHERE id=?1'
    ).bind(signup.id).first()).resolves.toEqual({
      trial_response: null,
      trial_response_at: null,
    });

    const credentials = {
      id: responseUrl.searchParams.get('id'),
      t: responseUrl.searchParams.get('t'),
      s: responseUrl.searchParams.get('s'),
      action: 'accepted',
    };
    const crossOrigin = await postForm(
      '/warsztaty/potwierdz',
      credentials,
      '',
      { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' },
    );
    expect(crossOrigin.status).toBe(403);

    const accepted = await postForm('/warsztaty/potwierdz', credentials);
    expect(accepted.status).toBe(200);
    const acceptedHtml = await accepted.text();
    expect(acceptedHtml).toContain('Вашу відповідь збережено');
    const firstResponse = await env.DB.prepare(
      'SELECT trial_response, trial_response_at FROM workshop_signups WHERE id=?1'
    ).bind(signup.id).first();
    expect(firstResponse).toEqual({
      trial_response: 'accepted',
      trial_response_at: expect.any(Number),
    });

    const acceptedAgain = await postForm('/warsztaty/potwierdz', credentials);
    expect(acceptedAgain.status).toBe(200);
    await expect(env.DB.prepare(
      'SELECT trial_response, trial_response_at FROM workshop_signups WHERE id=?1'
    ).bind(signup.id).first()).resolves.toEqual(firstResponse);
    await expect(env.DB.prepare(
      `SELECT COUNT(*) AS total FROM audit_events
       WHERE entity_id=?1 AND action='trial_response_recorded'`
    ).bind(signup.id).first()).resolves.toEqual({ total: 1 });
    await expect(env.DB.prepare(
      `SELECT COUNT(*) AS total FROM notification_outbox
       WHERE entity_id=?1 AND event_key LIKE 'owner_trial_response_%_accepted'`
    ).bind(signup.id).first()).resolves.toEqual({ total: 1 });

    const rescheduled = await postForm('/admin/warsztaty', {
      id: signup.id,
      filter: 'all',
      status: 'trial_booked',
      next_action_at: '',
      trial_at: '2099-09-08T17:00',
      group_name: 'Wtorek 17:00',
      assigned_to: 'Mateusz',
      owner_notes: '',
    }, cookie);
    expect(rescheduled.status).toBe(302);
    await expect(env.DB.prepare(
      'SELECT trial_response, trial_response_at FROM workshop_signups WHERE id=?1'
    ).bind(signup.id).first()).resolves.toEqual({
      trial_response: null,
      trial_response_at: null,
    });
    await expect(env.DB.prepare(
      `SELECT status FROM notification_outbox
       WHERE entity_id=?1 AND event_key=?2 AND channel='sms'`
    ).bind(signup.id, invitation.event_key).first()).resolves.toEqual({ status: 'cancelled' });
    const expired = await workerExports.default.fetch(responseUrl.toString());
    expect(expired.status).toBe(400);
    await expect(expired.text()).resolves.toContain('link jest nieprawidłowy');

    const returnedToOriginalDate = await postForm('/admin/warsztaty', {
      id: signup.id,
      filter: 'all',
      status: 'trial_booked',
      next_action_at: '',
      trial_at: '2099-09-01T17:00',
      group_name: 'Wtorek 17:00',
      assigned_to: 'Mateusz',
      owner_notes: '',
    }, cookie);
    expect(returnedToOriginalDate.status).toBe(302);
    const reactivatedInvitation = await env.DB.prepare(
      `SELECT status, attempt_count, last_error FROM notification_outbox
       WHERE entity_id=?1 AND event_key=?2 AND channel='sms'`
    ).bind(signup.id, invitation.event_key).first();
    expect(reactivatedInvitation.status).toBe('pending');
    expect(reactivatedInvitation.attempt_count).toBe(1);
    expect(reactivatedInvitation.last_error).toContain('Provider unavailable');

    await env.DB.prepare(
      `UPDATE notification_outbox SET status='uncertain',
         last_error='Provider outcome unknown', updated_at=?2
       WHERE entity_id=?1 AND event_key=?3 AND channel='sms'`
    ).bind(signup.id, Date.now(), invitation.event_key).run();
    const manuallyCancelled = await postForm('/admin/outbox-resolve', {
      id: (await env.DB.prepare(
        `SELECT id FROM notification_outbox
         WHERE entity_id=?1 AND event_key=?2 AND channel='sms'`
      ).bind(signup.id, invitation.event_key).first()).id,
      action: 'cancel',
    }, cookie);
    expect(manuallyCancelled.headers.get('Location')).toContain('outbox-resolved');

    for (const trialAt of ['2099-09-08T17:00', '2099-09-01T17:00']) {
      const changedAgain = await postForm('/admin/warsztaty', {
        id: signup.id,
        filter: 'all',
        status: 'trial_booked',
        next_action_at: '',
        trial_at: trialAt,
        group_name: 'Wtorek 17:00',
        assigned_to: 'Mateusz',
        owner_notes: '',
      }, cookie);
      expect(changedAgain.status).toBe(302);
    }
    const keptCancelled = await env.DB.prepare(
      `SELECT status, last_error FROM notification_outbox
       WHERE entity_id=?1 AND event_key=?2 AND channel='sms'`
    ).bind(signup.id, invitation.event_key).first();
    expect(keptCancelled).toEqual({
      status: 'cancelled',
      last_error: 'Operator cancelled uncertain outcome',
    });
  });
});

describe('workshop operations', () => {
  it('creates a group and records its member, session, attendance, and payment', async () => {
    const created = await postJson('/api/warsztaty', validWorkshopSignup());
    expect(created.status).toBe(200);
    const signup = await env.DB.prepare('SELECT id FROM workshop_signups').first();
    await env.DB.prepare(
      "UPDATE workshop_signups SET status='trial_booked' WHERE id=?1"
    ).bind(signup.id).run();
    const cookie = await adminCookie();

    const groupSaved = await postForm('/admin/warsztaty/grupy', {
      action: 'group_save',
      name: 'Wtorek start 17:00',
      status: 'active',
      location: 'grodzisk',
      level: 'start',
      weekday: '2',
      start_time: '17:00',
      duration_minutes: '90',
      capacity: '6',
      notes: 'Grupa testowa',
    }, cookie);
    expect(groupSaved.status).toBe(302);
    expect(groupSaved.headers.get('Location')).toContain('saved=group');

    const group = await env.DB.prepare(
      `SELECT id, name, status, location, level, weekday, start_time,
              duration_minutes, capacity, notes
       FROM workshop_groups`
    ).first();
    expect(group).toEqual({
      id: expect.any(String),
      name: 'Wtorek start 17:00',
      status: 'active',
      location: 'grodzisk',
      level: 'start',
      weekday: 2,
      start_time: '17:00',
      duration_minutes: 90,
      capacity: 6,
      notes: 'Grupa testowa',
    });

    const assigned = await postForm('/admin/warsztaty/grupy', {
      action: 'membership_assign',
      group_id: group.id,
      signup_id: signup.id,
      status: 'trial',
    }, cookie);
    expect(assigned.status).toBe(302);
    expect(assigned.headers.get('Location')).toContain('saved=membership');

    const membership = await env.DB.prepare(
      `SELECT id, group_id, signup_id, status, started_at, ended_at
       FROM workshop_memberships`
    ).first();
    expect(membership).toEqual({
      id: expect.any(String),
      group_id: group.id,
      signup_id: signup.id,
      status: 'trial',
      started_at: expect.any(Number),
      ended_at: null,
    });
    await expect(env.DB.prepare(
      'SELECT status, group_name, enrolled_at FROM workshop_signups WHERE id=?1'
    ).bind(signup.id).first()).resolves.toEqual({
      status: 'trial_booked',
      group_name: 'Wtorek start 17:00',
      enrolled_at: null,
    });

    const activated = await postForm('/admin/warsztaty/grupy', {
      action: 'membership_status',
      membership_id: membership.id,
      status: 'active',
    }, cookie);
    expect(activated.headers.get('Location')).toContain('saved=membership');
    expect((await env.DB.prepare(
      'SELECT status FROM workshop_memberships WHERE id=?1'
    ).bind(membership.id).first()).status).toBe('active');
    await expect(env.DB.prepare(
      'SELECT status, group_name, enrolled_at FROM workshop_signups WHERE id=?1'
    ).bind(signup.id).first()).resolves.toEqual({
      status: 'enrolled',
      group_name: 'Wtorek start 17:00',
      enrolled_at: expect.any(Number),
    });

    const lost = await postForm('/admin/warsztaty', {
      id: signup.id,
      filter: 'all',
      status: 'lost',
      next_action_at: '',
      trial_at: '',
      group_name: 'Wtorek start 17:00',
      assigned_to: 'Mateusz',
      owner_notes: 'Nie wolno zamknąć aktywnego uczestnika.',
    }, cookie);
    expect(lost.headers.get('Location')).toContain('error=membership');
    expect((await env.DB.prepare(
      'SELECT status FROM workshop_signups WHERE id=?1'
    ).bind(signup.id).first()).status).toBe('enrolled');

    const startsAtInput = `${warsawDate(7)}T17:00`;
    const sessionCreated = await postForm('/admin/warsztaty/grupy', {
      action: 'session_create',
      group_id: group.id,
      starts_at: startsAtInput,
      duration_minutes: '90',
      location: 'grodzisk',
      notes: 'Pumptrack główny',
    }, cookie);
    expect(sessionCreated.status).toBe(302);
    expect(sessionCreated.headers.get('Location')).toContain('saved=session');

    const session = await env.DB.prepare(
      `SELECT id, group_id, starts_at, ends_at, status, location, notes
       FROM workshop_sessions`
    ).first();
    expect(session).toMatchObject({
      id: expect.any(String),
      group_id: group.id,
      starts_at: expect.any(Number),
      ends_at: expect.any(Number),
      status: 'scheduled',
      location: 'grodzisk',
      notes: 'Pumptrack główny',
    });
    expect(session.ends_at - session.starts_at).toBe(90 * 60 * 1000);

    const attendanceSaved = await postForm('/admin/warsztaty/grupy', {
      action: 'attendance_save',
      session_id: session.id,
      membership_id: membership.id,
      status: 'present',
      notes: 'Pełny udział',
    }, cookie);
    expect(attendanceSaved.status).toBe(302);
    expect(attendanceSaved.headers.get('Location')).toContain('saved=attendance');
    await expect(env.DB.prepare(
      `SELECT session_id, membership_id, status, notes
       FROM workshop_attendance`
    ).first()).resolves.toEqual({
      session_id: session.id,
      membership_id: membership.id,
      status: 'present',
      notes: 'Pełny udział',
    });

    const paymentId = crypto.randomUUID();
    const paymentFields = {
      action: 'payment_add',
      payment_id: paymentId,
      membership_id: membership.id,
      amount: '249,50',
      paid_date: warsawDate(),
      method: 'transfer',
      period_label: 'sierpień 2026',
      notes: 'Przelew testowy',
    };
    const paymentAdded = await postForm('/admin/warsztaty/grupy', paymentFields, cookie);
    expect(paymentAdded.status).toBe(302);
    expect(paymentAdded.headers.get('Location')).toContain('saved=payment');
    const paymentRepeated = await postForm('/admin/warsztaty/grupy', paymentFields, cookie);
    expect(paymentRepeated.headers.get('Location')).toContain('saved=payment');
    const payment = await env.DB.prepare(
      `SELECT id, membership_id, amount_grosze, paid_at, method, period_label, notes
       FROM workshop_payments`
    ).first();
    expect(payment).toEqual({
      id: paymentId,
      membership_id: membership.id,
      amount_grosze: 24950,
      paid_at: expect.any(Number),
      method: 'transfer',
      period_label: 'sierpień 2026',
      notes: 'Przelew testowy',
    });
    await expect(env.DB.prepare(
      'SELECT COUNT(*) AS total FROM workshop_payments'
    ).first()).resolves.toEqual({ total: 1 });
    await expect(env.DB.prepare(
      `SELECT COUNT(*) AS total FROM audit_events
       WHERE entity_type='workshop_payment' AND entity_id=?1 AND action='recorded'`
    ).bind(paymentId).first()).resolves.toEqual({ total: 1 });

    const page = await workerExports.default.fetch(`${BASE_URL}/admin/warsztaty/grupy`, {
      headers: { Cookie: cookie },
    });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Wtorek start 17:00');
    expect(html).toContain('Anna Kowalska');
    expect(html).toContain('sierpień 2026');

    const ended = await postForm('/admin/warsztaty/grupy', {
      action: 'membership_status',
      membership_id: membership.id,
      status: 'ended',
    }, cookie);
    expect(ended.headers.get('Location')).toContain('saved=membership');
    const endedRow = await env.DB.prepare(
      'SELECT status, started_at, ended_at FROM workshop_memberships WHERE id=?1'
    ).bind(membership.id).first();
    expect(endedRow.status).toBe('ended');
    expect(endedRow.started_at).toBe(membership.started_at);
    expect(endedRow.ended_at).toBeTypeOf('number');

    const reopened = await postForm('/admin/warsztaty/grupy', {
      action: 'membership_status',
      membership_id: membership.id,
      status: 'active',
    }, cookie);
    expect(reopened.headers.get('Location')).toContain('error=history');
    const reassigned = await postForm('/admin/warsztaty/grupy', {
      action: 'membership_assign',
      group_id: group.id,
      signup_id: signup.id,
      status: 'active',
    }, cookie);
    expect(reassigned.headers.get('Location')).toContain('error=history');
    await expect(env.DB.prepare(
      'SELECT COUNT(*) AS total FROM workshop_memberships WHERE signup_id=?1'
    ).bind(signup.id).first()).resolves.toEqual({ total: 1 });
    await expect(env.DB.prepare(
      'SELECT status, started_at, ended_at FROM workshop_memberships WHERE id=?1'
    ).bind(membership.id).first()).resolves.toEqual(endedRow);
  });

  it('enforces level capacity and prevents overlapping active sessions', async () => {
    const cookie = await adminCookie();
    const invalidAir = await postForm('/admin/warsztaty/grupy', {
      action: 'group_save',
      name: 'AIR za duża',
      status: 'active',
      location: 'grodzisk',
      level: 'air',
      weekday: '3',
      start_time: '18:00',
      duration_minutes: '90',
      capacity: '5',
      notes: '',
    }, cookie);
    expect(invalidAir.status).toBe(302);
    expect(invalidAir.headers.get('Location')).toContain('error=invalid');

    const groupSaved = await postForm('/admin/warsztaty/grupy', {
      action: 'group_save',
      name: 'Progress środa',
      status: 'active',
      location: 'grodzisk',
      level: 'progress',
      weekday: '3',
      start_time: '17:00',
      duration_minutes: '90',
      capacity: '2',
      notes: '',
    }, cookie);
    expect(groupSaved.headers.get('Location')).toContain('saved=group');
    const group = await env.DB.prepare('SELECT id FROM workshop_groups').first();

    for (const [name, phone, email] of [
      ['Anna Pierwsza', '501111111', 'anna1@example.com'],
      ['Beata Druga', '502222222', 'beata2@example.com'],
      ['Celina Trzecia', '503333333', 'celina3@example.com'],
    ]) {
      const response = await postJson('/api/warsztaty', validWorkshopSignup({
        parent_name: name,
        phone,
        email,
      }));
      expect(response.status).toBe(200);
    }
    await env.DB.prepare("UPDATE workshop_signups SET status='trial_booked'").run();
    const signups = (await env.DB.prepare(
      'SELECT id FROM workshop_signups ORDER BY parent_name'
    ).all()).results;

    for (const signup of signups.slice(0, 2)) {
      const assigned = await postForm('/admin/warsztaty/grupy', {
        action: 'membership_assign',
        group_id: group.id,
        signup_id: signup.id,
        status: 'trial',
      }, cookie);
      expect(assigned.headers.get('Location')).toContain('saved=membership');
    }

    const reduced = await postForm('/admin/warsztaty/grupy', {
      action: 'group_save',
      id: group.id,
      name: 'Progress środa',
      status: 'active',
      location: 'grodzisk',
      level: 'progress',
      weekday: '3',
      start_time: '17:00',
      duration_minutes: '90',
      capacity: '1',
      notes: '',
    }, cookie);
    expect(reduced.headers.get('Location')).toContain('error=capacity');
    expect((await env.DB.prepare(
      'SELECT capacity FROM workshop_groups WHERE id=?1'
    ).bind(group.id).first()).capacity).toBe(2);

    const overCapacity = await postForm('/admin/warsztaty/grupy', {
      action: 'membership_assign',
      group_id: group.id,
      signup_id: signups[2].id,
      status: 'trial',
    }, cookie);
    expect(overCapacity.headers.get('Location')).toContain('error=full');
    expect((await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM workshop_memberships WHERE group_id=?1'
    ).bind(group.id).first()).total).toBe(2);

    const date = warsawDate(14);
    const firstSession = await postForm('/admin/warsztaty/grupy', {
      action: 'session_create',
      group_id: group.id,
      starts_at: `${date}T17:00`,
      duration_minutes: '90',
      location: 'grodzisk',
      notes: '',
    }, cookie);
    expect(firstSession.headers.get('Location')).toContain('saved=session');
    const first = await env.DB.prepare('SELECT id FROM workshop_sessions').first();

    const overlapping = await postForm('/admin/warsztaty/grupy', {
      action: 'session_create',
      group_id: group.id,
      starts_at: `${date}T18:00`,
      duration_minutes: '90',
      location: 'grodzisk',
      notes: '',
    }, cookie);
    expect(overlapping.headers.get('Location')).toContain('error=conflict');

    const cancelled = await postForm('/admin/warsztaty/grupy', {
      action: 'session_status',
      session_id: first.id,
      status: 'cancelled',
    }, cookie);
    expect(cancelled.headers.get('Location')).toContain('saved=session');
    const replacement = await postForm('/admin/warsztaty/grupy', {
      action: 'session_create',
      group_id: group.id,
      starts_at: `${date}T18:00`,
      duration_minutes: '90',
      location: 'grodzisk',
      notes: '',
    }, cookie);
    expect(replacement.headers.get('Location')).toContain('saved=session');

    const reactivated = await postForm('/admin/warsztaty/grupy', {
      action: 'session_status',
      session_id: first.id,
      status: 'scheduled',
    }, cookie);
    expect(reactivated.headers.get('Location')).toContain('error=conflict');
    expect((await env.DB.prepare(
      'SELECT status FROM workshop_sessions WHERE id=?1'
    ).bind(first.id).first()).status).toBe('cancelled');
  });

  it('enforces capacity and session overlap in D1 during concurrent writes', async () => {
    for (const [name, phone, email] of [
      ['Daria Pierwsza', '504444444', 'daria@example.com'],
      ['Ewa Druga', '505555555', 'ewa@example.com'],
      ['Filip Trzeci', '506666666', 'filip@example.com'],
    ]) {
      const response = await postJson('/api/warsztaty', validWorkshopSignup({
        parent_name: name,
        phone,
        email,
      }));
      expect(response.status).toBe(200);
    }
    const signups = (await env.DB.prepare(
      'SELECT id FROM workshop_signups ORDER BY parent_name'
    ).all()).results;
    const now = Date.now();
    const groupId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO workshop_groups (
         id, name, status, location, level, weekday, start_time,
         duration_minutes, capacity, notes, created_at, updated_at
       ) VALUES (?1, 'Limit D1', 'active', 'grodzisk', 'start', 4, '17:00',
         90, 2, NULL, ?2, ?2)`
    ).bind(groupId, now).run();

    const membershipWrites = await Promise.allSettled(signups.map(signup =>
      env.DB.prepare(
        `INSERT INTO workshop_memberships (
           id, group_id, signup_id, status, started_at, ended_at, notes,
           created_at, updated_at
         ) VALUES (?1, ?2, ?3, 'trial', ?4, NULL, NULL, ?4, ?4)`
      ).bind(crypto.randomUUID(), groupId, signup.id, now).run()
    ));
    expect(membershipWrites.filter(result => result.status === 'fulfilled')).toHaveLength(2);
    const rejectedMembership = membershipWrites.find(result => result.status === 'rejected');
    expect(rejectedMembership?.reason?.message || String(rejectedMembership?.reason))
      .toContain('workshop_group_full');
    await expect(env.DB.prepare(
      'SELECT COUNT(*) AS total FROM workshop_memberships WHERE group_id=?1'
    ).bind(groupId).first()).resolves.toEqual({ total: 2 });
    await expect(env.DB.prepare(
      'UPDATE workshop_groups SET capacity=1 WHERE id=?1'
    ).bind(groupId).run()).rejects.toThrow('workshop_group_full');

    const startsAt = now + 14 * 24 * 60 * 60 * 1000;
    const endsAt = startsAt + 90 * 60 * 1000;
    const sessionWrites = await Promise.allSettled([0, 1].map(index =>
      env.DB.prepare(
        `INSERT INTO workshop_sessions (
           id, group_id, starts_at, ends_at, status, location, notes,
           created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, 'scheduled', 'grodzisk', ?5, ?6, ?6)`
      ).bind(
        crypto.randomUUID(), groupId, startsAt + index * 30 * 60 * 1000,
        endsAt + index * 30 * 60 * 1000, `równoległa ${index + 1}`, now,
      ).run()
    ));
    expect(sessionWrites.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejectedSession = sessionWrites.find(result => result.status === 'rejected');
    expect(rejectedSession?.reason?.message || String(rejectedSession?.reason))
      .toContain('workshop_session_overlap');
    await expect(env.DB.prepare(
      'SELECT COUNT(*) AS total FROM workshop_sessions WHERE group_id=?1'
    ).bind(groupId).first()).resolves.toEqual({ total: 1 });
  });
});

describe('static asset fallback', () => {
  it('passes non-application routes to the ASSETS binding', async () => {
    const response = await workerExports.default.fetch(`${BASE_URL}/robots.txt`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/plain');
    await expect(response.text()).resolves.toContain('User-agent:');
  });

  it('publishes a unique 27-URL sitemap with the new multilingual clusters', async () => {
    const response = await workerExports.default.fetch(`${BASE_URL}/sitemap.xml`);
    expect(response.status).toBe(200);
    const xml = await response.text();
    const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
    expect(locations).toHaveLength(27);
    expect(new Set(locations).size).toBe(27);
    for (const slug of [
      'pumptrack-grodzisk-mazowiecki',
      'centrowanie-i-zaplatanie-kol',
      'serwis-rowerow-elektrycznych',
    ]) {
      expect(locations).toContain(`${BASE_URL}/${slug}`);
      expect(locations).toContain(`${BASE_URL}/en/${slug}`);
      expect(locations).toContain(`${BASE_URL}/ua/${slug}`);
    }
  });

  it('ships Turnstile preparation on all nine public forms', async () => {
    for (const path of [
      '/', '/umow', '/warsztaty',
      '/en/', '/en/umow', '/en/warsztaty',
      '/ua/', '/ua/umow', '/ua/warsztaty',
    ]) {
      const response = await workerExports.default.fetch(`${BASE_URL}${path}`);
      expect(response.status, path).toBe(200);
      const html = await response.text();
      expect(html, path).toContain('src="/turnstile.js"');
      expect(html, path).toContain('turnstile_token');
    }
  });

  it('publishes Mateusz training photographs with localized, non-location captions', async () => {
    for (const asset of [
      '/uploads/mateusz-trening-rowerowy-1.webp',
      '/uploads/mateusz-trening-rowerowy-2.webp',
    ]) {
      const response = await workerExports.default.fetch(`${BASE_URL}${asset}`);
      expect(response.status, asset).toBe(200);
      expect(response.headers.get('Content-Type'), asset).toContain('image/webp');
    }
    for (const path of [
      '/pumptrack-grodzisk-mazowiecki',
      '/en/pumptrack-grodzisk-mazowiecki',
      '/ua/pumptrack-grodzisk-mazowiecki',
    ]) {
      const response = await workerExports.default.fetch(`${BASE_URL}${path}`);
      expect(response.status, path).toBe(200);
      const html = await response.text();
      expect(html, path).toContain('mateusz-trening-rowerowy-1.webp');
      expect(html, path).toContain('mateusz-trening-rowerowy-2.webp');
      expect(html, path).toContain('<figure class="ride-photo">');
    }
  });
});
