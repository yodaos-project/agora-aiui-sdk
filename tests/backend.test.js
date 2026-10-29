import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import accessToken from 'agora-token/src/AccessToken2.js';
import { createSessionService, participantUids } from '../examples/server/sessions.js';
import { createVoiceHandler, bearerAuthorizer } from '../examples/server/http.js';
import { createAgoraAgentFactory } from '../examples/server/agora.js';
import { createWhipToken } from '../examples/server/token.js';
import { createHttpVoiceBackend, createAgoraVoiceSession } from '../src/index.js';
import { deferred, fakeRuntime, tick } from './helpers.js';

const credentials = { appId: '1'.repeat(32), certificate: '2'.repeat(32) };
const demoToken = 'test-business-api-token-not-a-real-secret';
const defaults = { ...credentials, baseURL: 'https://whip.example.test' };

test('managed participant accounts are distinct and respect the UTF-8 byte limit', () => {
  for (const seed of ['example', 'a'.repeat(249)]) {
    const { uid, botUid } = participantUids(seed);
    assert.equal(uid, `aiui-${seed}`);
    assert.equal(botUid, `agent-${seed}`);
    assert.notEqual(uid, botUid);
  }
  for (const seed of [0, '', 'a'.repeat(250), '界'.repeat(84), NaN])
    assert.throws(() => participantUids(seed), RangeError);
});

test('string-account WHIP JWT authorizes the channel without a numeric uid claim', () => {
  const { token } = createWhipToken({ ...credentials, channel: 'example', uid: 'aiui-test' });
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  assert.equal(claims.streamID, 'example');
  assert.equal(claims.enableSubAuth, true);
  assert.equal('uid' in claims, false);
  assert.throws(() => createWhipToken({ ...credentials, channel: 'example', uid: '' }));
});

function service(options = {}) {
  const events = [];
  return {
    events,
    store: createSessionService({
      ...defaults,
      createAgent: () => ({
        async start() {
          events.push('start');
        },
        async stop() {
          events.push('stop');
        },
      }),
      ...options,
    }),
  };
}

async function listen(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

test('WHIP JWT uses certificate text, numeric UID and duplex claims with seconds exp', () => {
  const result = createWhipToken({
    ...credentials,
    channel: 'example',
    uid: 123,
    now: 1_700_000_000_000,
  });
  const [header, payload, signature] = result.token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'HS256', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), {
    version: '1.0',
    appID: credentials.appId,
    streamID: 'example',
    uid: '123',
    exp: 1_700_000_600,
    action: 'pub',
    enableSubAuth: true,
  });
  assert.equal(result.tokenExpiresAt, 1_700_000_600_000);
  assert.equal(
    signature,
    createHmac('sha256', credentials.certificate)
      .update(`${header}.${payload}`)
      .digest('base64url'),
  );
  assert.throws(() => createWhipToken({ ...credentials, channel: 'a', uid: 0 }));
});

test('reservation creates string participants and starts once, stop is idempotent', async () => {
  const { store, events } = service();
  const reservation = store.createSession('alice');
  assert.equal(events.length, 0);
  assert.equal(typeof reservation.whip.uid, 'string');
  assert.equal(reservation.whip.channel.length, 41);
  await Promise.all([
    store.startAgent(reservation.id, 'alice'),
    store.startAgent(reservation.id, 'alice'),
  ]);
  assert.deepEqual(events, ['start']);
  await Promise.all([
    store.stopSession(reservation.id, 'alice'),
    store.stopSession(reservation.id, 'alice'),
  ]);
  assert.deepEqual(events, ['start', 'stop']);
  await assert.rejects(store.startAgent(reservation.id, 'alice'), { status: 410 });
  assert.throws(() => store.refreshToken(reservation.id, 'bob'), { status: 404 });
});

test('stop during delayed cloud start waits and closes the eventual cloud agent', async () => {
  const gate = deferred();
  let stops = 0;
  const { store } = service({
    createAgent: () => ({
      start: () => gate.promise,
      async stop() {
        stops++;
      },
    }),
  });
  const { id } = store.createSession('alice');
  const starting = assert.rejects(store.startAgent(id, 'alice'), { status: 410 });
  await tick();
  const stopping = store.stopSession(id, 'alice');
  assert.equal(stops, 0);
  gate.resolve();
  await Promise.all([starting, stopping]);
  assert.equal(stops, 1);
});

test('lease renewal, abandoned reservations and absolute duration are enforced', async () => {
  let clock = 0;
  const { store, events } = service({ now: () => clock, leaseMs: 100, maxDurationMs: 250 });
  const { id } = store.createSession('alice');
  await store.startAgent(id, 'alice');
  clock = 80;
  assert.equal(store.renewSession(id, 'alice').lease.expiresAt, 180);
  clock = 160;
  assert.equal(store.renewSession(id, 'alice').lease.expiresAt, 250);
  clock = 251;
  await store.sweep();
  assert.deepEqual(events, ['start', 'stop']);
  assert.throws(() => store.renewSession(id, 'alice'), { status: 410 });
  const abandoned = store.createSession('alice');
  clock = 400;
  await store.sweep();
  await assert.rejects(store.startAgent(abandoned.id, 'alice'), { status: 410 });
  await store.close();
  assert.throws(() => store.createSession('alice'), { status: 503 });
});

test('failed cloud cleanup stays unconfirmed and is retried by the sweeper', async () => {
  let stops = 0;
  const { store } = service({
    createAgent: () => ({
      async start() {},
      async stop() {
        if (++stops === 1) throw new Error('upstream credentials');
      },
    }),
  });
  const { id } = store.createSession('alice');
  await store.startAgent(id, 'alice');
  await assert.rejects(store.stopSession(id, 'alice'), { code: 'AGENT_STOP_UNCONFIRMED' });
  await store.sweep();
  assert.equal(stops, 2);
  assert.deepEqual(await store.stopSession(id, 'alice'), { stopped: true });
});

test('actual HTTP adapter and handler perform a managed SDK call without exposing secrets', async (t) => {
  const runtime = fakeRuntime(t);
  const { store, events } = service();
  const baseURL = await listen(
    t,
    createVoiceHandler({ service: store, authorize: bearerAuthorizer(demoToken) }),
  );
  const backend = createHttpVoiceBackend({
    baseURL,
    authorization: async () => `Bearer ${demoToken}`,
  });
  const voice = createAgoraVoiceSession({ backend });
  t.after(() => voice.stop());
  await voice.start();
  assert.deepEqual(events, ['start']);
  const authorization = await runtime.whips[0].options.authorization();
  const jwt = JSON.parse(Buffer.from(authorization.split('.')[1], 'base64url'));
  const endpoint = new URL(runtime.whips[0].endpoint);
  assert.equal('uid' in jwt, false);
  assert.equal(endpoint.searchParams.has('Uid'), false);
  assert.match(endpoint.searchParams.get('stringuid'), /^aiui-/);
  assert.equal(jwt.streamID, decodeURIComponent(endpoint.pathname.slice('/pub/'.length)));
  await voice.stop();
  assert.deepEqual(events, ['start', 'stop']);
  assert(!JSON.stringify(voice.getState()).includes(credentials.certificate));
});

test('business API requires authentication, checks CORS and rejects payloads', async (t) => {
  const { store } = service();
  const baseURL = await listen(
    t,
    createVoiceHandler({
      service: store,
      authorize: bearerAuthorizer(demoToken),
      allowedOrigins: ['https://agent.example.test'],
    }),
  );
  const route = `${baseURL}/voice/sessions`;
  assert.equal((await fetch(route, { method: 'POST' })).status, 401);
  const headers = { Authorization: `Bearer ${demoToken}`, Origin: 'https://evil.example.test' };
  assert.equal((await fetch(route, { method: 'POST', headers })).status, 403);
  headers.Origin = 'https://agent.example.test';
  const response = await fetch(route, { method: 'POST', headers });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('access-control-allow-origin'), headers.Origin);
  assert(!JSON.stringify(await response.json()).includes(credentials.certificate));
  assert.equal((await fetch(route, { method: 'POST', headers, body: '{}' })).status, 413);
  assert.equal(
    (await fetch(route, { method: 'OPTIONS', headers: { Origin: headers.Origin } })).status,
    204,
  );
});

test('HTTP responses are capped while reading chunks and cancelled on overflow', async () => {
  let cancelled = false;
  const backend = createHttpVoiceBackend({
    baseURL: 'https://backend.example.test',
    authorization: 'Bearer demo',
    fetch: async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(40_000));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  });
  await assert.rejects(backend.createSession(), { code: 'BACKEND' });
  assert(cancelled);
});

test('hanging authorization is bounded and backend errors are redacted', async () => {
  const backend = createHttpVoiceBackend({
    baseURL: 'https://backend.example.test',
    authorization: () => new Promise(() => {}),
    timeout: 10,
  });
  await assert.rejects(backend.createSession(), { code: 'BACKEND' });
  const denied = createHttpVoiceBackend({
    baseURL: 'https://backend.example.test',
    authorization: 'Bearer demo',
    fetch: async () => new Response('provider-secret', { status: 500 }),
  });
  await assert.rejects(
    denied.createSession(),
    (error) => !error.message.includes('provider-secret'),
  );
});

test('HTTP success without an explicit agent acknowledgement is not treated as cloud success', async () => {
  const backend = createHttpVoiceBackend({
    baseURL: 'https://backend.example.test',
    authorization: 'Bearer demo',
    fetch: async () => Response.json({}),
  });
  await assert.rejects(backend.startAgent({ sessionId: 'test' }), { code: 'BACKEND' });
  await assert.rejects(backend.stopSession({ sessionId: 'test' }), { code: 'BACKEND' });
});

test('official Agora server SDK preserves string accounts in join, auth and RTC tokens', async (t) => {
  const requests = [];
  let stopAttempts = 0;
  const upstream = await listen(t, async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({
      method: request.method,
      path: request.url,
      authorization: request.headers.authorization,
      body: body ? JSON.parse(body) : null,
    });
    response.setHeader('Content-Type', 'application/json');
    if (request.url.endsWith('/leave') && ++stopAttempts === 1) {
      response.writeHead(500);
      response.end(JSON.stringify({ message: 'Retry this stop.' }));
      return;
    }
    response.end(
      JSON.stringify(
        request.method === 'POST' && request.url.endsWith('/join')
          ? { agent_id: 'test-cloud-agent' }
          : {},
      ),
    );
  });
  const previous = process.env.AGORA_AGENTS_API_BASE_URL;
  process.env.AGORA_AGENTS_API_BASE_URL = upstream;
  t.after(() => {
    if (previous === undefined) delete process.env.AGORA_AGENTS_API_BASE_URL;
    else process.env.AGORA_AGENTS_API_BASE_URL = previous;
  });
  const factory = createAgoraAgentFactory({
    ...credentials,
    pipelineId: 'test-pipeline',
    area: 'AP',
  });
  const bot = factory({
    sessionId: 'test',
    channel: 'test-channel',
    uid: 'aiui-test',
    botUid: 'agent-test',
    maxDurationSeconds: 600,
  });
  await bot.start();
  await assert.rejects(bot.stop(), { statusCode: 500 });
  await bot.stop();
  assert.equal(requests.length, 3);
  assert.match(requests[0].path, /\/projects\/[\da-f]+\/join$/);
  assert.match(requests[0].authorization, /^agora token=/);
  const payload = requests[0].body;
  assert.equal(payload.pipeline_id, 'test-pipeline');
  assert.equal(payload.properties.channel, 'test-channel');
  assert.equal(payload.properties.agent_rtc_uid, 'agent-test');
  assert.deepEqual(payload.properties.remote_rtc_uids, ['aiui-test']);
  assert.equal(payload.properties.enable_string_uid, true);
  for (const encoded of [
    payload.properties.token,
    requests[0].authorization.slice('agora token='.length),
    ...requests.slice(1).map((request) => request.authorization.slice('agora token='.length)),
  ]) {
    const parsed = new accessToken.AccessToken2();
    assert.equal(parsed.from_string(encoded), true);
    assert.equal(parsed.appId.toString(), credentials.appId);
    assert.equal(parsed.getServices(1)[0].__channel_name.toString(), 'test-channel');
    assert.equal(parsed.getServices(1)[0].__uid.toString(), 'agent-test');
    assert.equal(parsed.getServices(2)[0].__user_id.toString(), 'agent-test');
  }
  assert.match(requests[1].path, /\/agents\/test-cloud-agent\/leave$/);
  assert.equal(requests[2].path, requests[1].path);
});
