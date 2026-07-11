#!/usr/bin/env node
// Cienki serwer MCP (stdio) dla BytePlus ModelArk / Dreamina Seedance 2.0.
// Zero zaleznosci: recznie mowimy JSON-RPC po stdin/stdout (jedna wiadomosc = jedna linia).
// Klucz WYLACZNIE ze srodowiska (ARK_API_KEY) - nigdy w kodzie/logach.
//
// Narzedzia:
//   seedance_create  - tworzy zadanie generacji wideo (text/image -> video), zwraca task id
//   seedance_get     - odpytuje zadanie (status + video_url po sukcesie)
//   seedance_wait    - polling az do sukcesu/bledu (domyslnie do 10 min co 10 s)
//
// Modele (route-owned, region ap-southeast): dreamina-seedance-2-0-260128 (pelny),
// dreamina-seedance-2-0-fast-260128 (szybszy/tanszy - DOMYSLNY do iteracji).
// API: POST/GET https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks
// Docs: https://docs.byteplus.com/en/docs/ModelArk/1520757

const BASE = process.env.ARK_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3';
const KEY = process.env.ARK_API_KEY;
// DOMYSLNY = Seedance 1.5 Pro: 2M DARMOWYCH tokenow na koncie (Seedance 2.0 jest PLATNY
// bez darmowej puli - uzywac swiadomie przez parametr model, np. dreamina-seedance-2-0-260128).
const DEFAULT_MODEL = process.env.ARK_SEEDANCE_MODEL || 'seedance-1-5-pro-251215';

const TOOLS = [
  {
    name: 'seedance_create',
    description: 'Utworz zadanie generacji wideo Seedance 2.0 (BytePlus ModelArk). Zwraca task_id do odpytania przez seedance_get/seedance_wait. Prompt po angielsku dziala najlepiej. Obrazy referencyjne przez image_urls (publiczne URL-e), role: reference_image | first_frame | last_frame.',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: 'Opis sceny/ruchu kamery. EN zalecany.' },
        model: { type: 'string', description: `ID modelu (domyslnie ${DEFAULT_MODEL}; pelny: dreamina-seedance-2-0-260128)` },
        duration: { type: 'number', description: 'Dlugosc w sekundach (5-12, domyslnie 8)' },
        ratio: { type: 'string', description: '16:9 | 9:16 | 1:1 | 4:3 (domyslnie 16:9)' },
        resolution: { type: 'string', description: '480p | 720p | 1080p (domyslnie 720p)' },
        generate_audio: { type: 'boolean', description: 'Sciezka audio (domyslnie false - petle hero sa mute)' },
        watermark: { type: 'boolean', description: 'Znak wodny (domyslnie false)' },
        image_urls: {
          type: 'array',
          description: 'Opcjonalne obrazy wejsciowe: [{url, role}] role: reference_image|first_frame|last_frame',
          items: { type: 'object', required: ['url'], properties: { url: { type: 'string' }, role: { type: 'string' } } },
        },
      },
    },
  },
  {
    name: 'seedance_get',
    description: 'Pobierz stan zadania Seedance (status: queued/running/succeeded/failed; po sukcesie content.video_url - link wygasa, pobierz plik szybko).',
    inputSchema: { type: 'object', required: ['task_id'], properties: { task_id: { type: 'string' } } },
  },
  {
    name: 'seedance_wait',
    description: 'Czekaj na ukonczenie zadania Seedance (polling). Zwraca video_url albo blad. Uzyj po seedance_create.',
    inputSchema: {
      type: 'object', required: ['task_id'],
      properties: {
        task_id: { type: 'string' },
        timeout_s: { type: 'number', description: 'Maks. czekanie w s (domyslnie 600)' },
        interval_s: { type: 'number', description: 'Odstep pollingu w s (domyslnie 10)' },
      },
    },
  },
];

async function ark(method, path, body) {
  if (!KEY) throw new Error('Brak ARK_API_KEY w srodowisku. Ustaw: export ARK_API_KEY=... (klucz z console.byteplus.com/ark -> API keys).');
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`Ark API ${res.status}: ${text.slice(0, 500)}`);
  return json;
}

async function createTask(a) {
  const content = [{ type: 'text', text: a.prompt }];
  for (const img of a.image_urls || []) {
    content.push({ type: 'image_url', image_url: { url: img.url }, role: img.role || 'reference_image' });
  }
  const body = {
    model: a.model || DEFAULT_MODEL,
    content,
    duration: a.duration ?? 8,
    ratio: a.ratio || '16:9',
    resolution: a.resolution || '720p',
    generate_audio: a.generate_audio ?? false,
    watermark: a.watermark ?? false,
  };
  const r = await ark('POST', '/contents/generations/tasks', body);
  return { task_id: r.id, status: r.status, model: body.model };
}

async function getTask(a) {
  const r = await ark('GET', `/contents/generations/tasks/${encodeURIComponent(a.task_id)}`);
  return {
    task_id: r.id, status: r.status,
    video_url: r.content?.video_url || null,
    error: r.error || r.failure_reason || null,
    usage: r.usage || null,
  };
}

async function waitTask(a) {
  const timeout = (a.timeout_s ?? 600) * 1000;
  const interval = (a.interval_s ?? 10) * 1000;
  const start = Date.now();
  for (;;) {
    const s = await getTask(a);
    if (s.status === 'succeeded' || s.status === 'failed' || s.error) return s;
    if (Date.now() - start > timeout) return { ...s, timed_out: true };
    await new Promise(r => setTimeout(r, interval));
  }
}

const HANDLERS = { seedance_create: createTask, seedance_get: getTask, seedance_wait: waitTask };

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) handle(line).catch(() => {});
  }
});

async function handle(line) {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;
  const reply = (result) => id !== undefined && send({ jsonrpc: '2.0', id, result });
  const fail = (message) => id !== undefined && send({ jsonrpc: '2.0', id, error: { code: -32000, message } });

  try {
    if (method === 'initialize') {
      reply({
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'ark-seedance', version: '1.0.0' },
      });
    } else if (method === 'notifications/initialized' || method?.startsWith('notifications/')) {
      // notyfikacje - brak odpowiedzi
    } else if (method === 'ping') {
      reply({});
    } else if (method === 'tools/list') {
      reply({ tools: TOOLS });
    } else if (method === 'tools/call') {
      const fn = HANDLERS[params?.name];
      if (!fn) return fail(`Nieznane narzedzie: ${params?.name}`);
      const out = await fn(params?.arguments || {});
      reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
    } else if (id !== undefined) {
      fail(`Nieobslugiwana metoda: ${method}`);
    }
  } catch (e) {
    fail(String(e?.message || e));
  }
}
