import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgoraRtmTranscripts, createAgoraVoiceSession } from '../src/index.js';
import { createTranscriptReducer } from '../src/rtm-transcripts.js';
import { createRtmEnvironment } from '../src/rtm-environment.js';
import { backend, deferred, fakeRuntime, tick } from './helpers.js';

const connection = {
  appId: '1'.repeat(32),
  userId: 'client',
  agentUserId: 'agent',
  channel: 'test-channel',
  token: 'temporary-rtm-token',
};

test('RTM cancels absent presence timers without changing Ink globals', () => {
  const cancelled = [];
  const root = {
    navigator: { userAgent: 'Ink/0.20' },
    clearTimeout(id) {
      assert(id != null);
      cancelled.push(['timeout', id]);
    },
    clearInterval(id) {
      assert(id != null);
      cancelled.push(['interval', id]);
    },
  };
  const original = root.clearInterval;
  const env = createRtmEnvironment(root);
  for (const target of [env, env.scope, env.browser]) {
    target.clearTimeout(null);
    target.clearInterval(undefined);
  }
  env.clearTimeout(1);
  env.scope.clearInterval(2);
  env.browser.clearInterval(3);
  assert.deepEqual(cancelled, [
    ['timeout', 1],
    ['interval', 2],
    ['interval', 3],
  ]);
  assert.equal(root.clearInterval, original);
});

function fakeRtm(order = [], overrides = {}) {
  const clients = [];
  class RTM {
    listeners = new Map();
    constructor(appId, userId, options) {
      clients.push(this);
      assert.equal(appId, connection.appId);
      assert.equal(userId, connection.userId);
      assert.equal(options.logUpload, false);
    }
    addEventListener(name, fn) {
      this.listeners.set(name, fn);
    }
    removeEventListener(name, fn) {
      if (this.listeners.get(name) === fn) this.listeners.delete(name);
    }
    emit(name, value) {
      this.listeners.get(name)?.(value);
    }
    async login() {
      order.push('rtm.login');
      await overrides.login?.();
    }
    async subscribe() {
      order.push('rtm.subscribe');
      await overrides.subscribe?.();
    }
    async logout() {
      order.push('rtm.logout');
      await overrides.logout?.();
    }
    async renewToken(token) {
      order.push(`rtm.renew:${token}`);
    }
  }
  return { RTM, clients };
}

const assistant = (text, turn_status = 0, turn_id = 1, turn_seq_id = 1) => ({
  object: 'assistant.transcription',
  turn_id,
  turn_seq_id,
  turn_status,
  stream_id: 0,
  text,
});
const packet = (message, extra) => ({
  publisher: 'agent',
  channelName: connection.channel,
  channelType: 'MESSAGE',
  message: JSON.stringify(message),
  ...extra,
});

test('RTM cumulative updates replace partial turns and preserve final/interrupted state', () => {
  const fold = createTranscriptReducer();
  assert.equal(fold(assistant('Hello,'))[0].text, 'Hello,');
  assert.equal(fold(assistant('Hello, world.', 0, 1, 2))[0].text, 'Hello, world.');
  assert.equal(fold(assistant('Hello, world.', 1, 1, 3))[0].status, 'final');
  assert.equal(fold(assistant('Hello,', 0, 1, 1)), null);
  assert.equal(
    fold({ object: 'user.transcription', turn_id: 1, stream_id: 0, text: 'Hi', final: false })[0]
      .role,
    'user',
  );
  const text = fold({
    object: 'user.transcription',
    turn_id: 1,
    stream_id: 0,
    text: 'Hi!',
    final: true,
  });
  assert.equal(text.length, 2);
  assert.equal(text[0].status, 'final');
  const interrupted = fold({ object: 'message.interrupt', turn_id: 1 });
  assert.equal(interrupted[1].status, 'interrupted');
  assert.equal(fold(assistant('Late text', 1, 1, 4)), null);
  assert.equal(fold({ object: 'message.interrupt', turn_id: 2 }), null);
  assert.equal(fold(assistant('Interrupted before text arrived', 0, 2)), null);
  assert(Object.isFrozen(interrupted));
  assert(Object.isFrozen(interrupted[0]));
});

test('RTM retention is bounded and evicted turns cannot return through delayed packets', () => {
  const fold = createTranscriptReducer();
  let text;
  for (let turn = 1; turn <= 100; turn++) text = fold(assistant('x'.repeat(8000), 1, turn));
  assert(text.length <= 20);
  assert(text.every((entry) => entry.text.length <= 2000));
  assert(text.reduce((sum, entry) => sum + entry.text.length, 0) <= 12000);
  assert.equal(fold(assistant('Old', 1, 1, 2)), null);
  assert.equal(fold({ object: 'unknown', turn_id: 101, text: 'ignored' }), null);
});

test('RTM filters channel/publisher, rejects large frames and renews credentials on expiry', async () => {
  const order = [];
  const fake = fakeRtm(order);
  const updates = [];
  let tokens = 0;
  const controller = new AbortController();
  const handle = createAgoraRtmTranscripts({ RTM: fake.RTM }).connect({
    connection: { ...connection, token: () => String(++tokens) },
    signal: controller.signal,
    onUpdate: (snapshot) => updates.push(snapshot),
    onState: () => {},
  });
  await handle.ready;
  const client = fake.clients[0];
  client.emit('message', packet(assistant('Ignore'), { publisher: 'someone-else' }));
  client.emit('message', packet(assistant('Ignore'), { channelName: 'another-channel' }));
  client.emit('message', packet(assistant('x'.repeat(70000))));
  client.emit('message', packet(assistant('界'.repeat(22000))));
  client.emit(
    'message',
    packet({
      object: 'user.transcription',
      turn_id: 1,
      text: 'Other user',
      user_id: 'someone-else',
    }),
  );
  client.emit('message', packet(assistant('Hello,')));
  client.emit(
    'message',
    packet(assistant('Hello, world.', 1, 1, 2), {
      message: new TextEncoder().encode(JSON.stringify(assistant('Hello, world.', 1, 1, 2))),
    }),
  );
  assert.deepEqual(
    updates.map((rows) => rows[0].text),
    ['Hello,', 'Hello, world.'],
  );
  client.emit('tokenPrivilegeWillExpire');
  await tick();
  assert(order.includes('rtm.renew:2'));
  controller.abort();
  assert.equal(client.listeners.size, 0);
  await handle.close();
  assert.equal(order.filter((item) => item === 'rtm.logout').length, 1);
});

test('RTM timeout and close during login remove listeners and cancel the owned client', async () => {
  for (const cancel of [false, true]) {
    const gate = deferred();
    const order = [];
    const fake = fakeRtm(order, { login: () => gate.promise });
    const controller = new AbortController();
    const handle = createAgoraRtmTranscripts({ RTM: fake.RTM, timeout: 20 }).connect({
      connection,
      signal: controller.signal,
      onUpdate: () => assert.fail('Late update'),
      onState: () => {},
    });
    const rejected = assert.rejects(handle.ready, { code: 'TRANSCRIPTS' });
    await tick();
    if (cancel) controller.abort();
    await rejected;
    await handle.close();
    gate.resolve();
    await tick();
    assert.equal(fake.clients[0].listeners.size, 0);
    assert(!order.includes('rtm.subscribe'));
    assert.equal(order.filter((item) => item === 'rtm.logout').length, 1);
  }
});

test('pre-cancelled RTM setup never passes an absent timer to the host', async (t) => {
  const cancel = globalThis.clearTimeout;
  t.mock.method(globalThis, 'clearTimeout', (timer) => {
    assert(timer != null);
    return cancel(timer);
  });
  const order = [];
  const fake = fakeRtm(order);
  const controller = new AbortController();
  controller.abort();
  const handle = createAgoraRtmTranscripts({ RTM: fake.RTM }).connect({
    connection,
    signal: controller.signal,
    onUpdate: () => assert.fail('Late update'),
    onState: () => {},
  });
  await assert.rejects(handle.ready, { code: 'TRANSCRIPTS' });
  await handle.close();
  assert.equal(fake.clients[0].listeners.size, 0);
  assert.deepEqual(order, ['rtm.logout']);
});

test('consecutive calls with a fixed UID reuse the logged-out RTM client', async () => {
  const fake = fakeRtm();
  const source = createAgoraRtmTranscripts({ RTM: fake.RTM });
  for (let call = 0; call < 3; call++) {
    const handle = source.connect({
      connection,
      signal: new AbortController().signal,
      onUpdate: () => {},
      onState: () => {},
    });
    await handle.ready;
    assert.throws(() => source.connect({ connection }), /previous RTM subscription/);
    await handle.close();
  }
  assert.equal(fake.clients.length, 1, 'RTM forbids reconstructing the same account in one realm');
  assert.equal(fake.clients[0].listeners.size, 0);
});

test('session subscribes before AI startup, emits text without history reads and cleans RTM on stop', async (t) => {
  const runtime = fakeRuntime(t);
  const adapter = backend(runtime);
  const fake = fakeRtm(runtime.order);
  adapter.createSession = async () => ({
    id: 'reservation',
    whip: (await import('./helpers.js')).connection,
    rtm: connection,
  });
  adapter.getTranscripts = () => assert.fail('RTM must not poll history');
  const voice = createAgoraVoiceSession({
    backend: adapter,
    transcripts: createAgoraRtmTranscripts({ RTM: fake.RTM }),
  });
  t.after(() => voice.stop());
  let updates = 0;
  voice.addEventListener('transcriptchange', () => updates++);
  await voice.start();
  assert(runtime.order.indexOf('rtm.subscribe') < runtime.order.indexOf('agent.start'));
  fake.clients[0].emit('message', packet(assistant('Live text', 1)));
  assert.equal(voice.getTranscriptSnapshot()[0].text, 'Live text');
  assert.equal(updates, 1);
  fake.clients[0].emit('linkState', { currentState: 'DISCONNECTED' });
  assert.equal(voice.getTranscriptState().status, 'disconnected');
  assert.equal(voice.getState().lifecycle, 'running');
  assert.equal(voice.getState().error, null);
  const closing = voice.stop();
  assert.equal(runtime.streams[0].getTracks()[0].readyState, 'ended');
  assert.equal(fake.clients[0].listeners.size, 0);
  assert.equal((await closing).transcripts, 'complete');
  assert.equal(voice.getTranscriptState().status, 'closed');
});

test('text setup failure leaves the audio conversation usable with a redacted text error', async (t) => {
  const runtime = fakeRuntime(t);
  const fake = fakeRtm([], {
    login: () => {
      throw new Error('provider-secret');
    },
  });
  const adapter = backend(runtime);
  const reserve = adapter.createSession;
  adapter.createSession = async (options) => ({ ...(await reserve(options)), rtm: connection });
  const voice = createAgoraVoiceSession({
    backend: adapter,
    transcripts: createAgoraRtmTranscripts({ RTM: fake.RTM }),
  });
  t.after(() => voice.stop());
  await voice.start();
  assert.equal(voice.getState().lifecycle, 'running');
  assert.equal(voice.getState().error, null);
  assert.equal(voice.getTranscriptState().error.code, 'TRANSCRIPTS');
  assert(!JSON.stringify(voice.getTranscriptState()).includes('provider-secret'));
});

test('half duplex gates capture during AI turns, preserves user mute and accepts delayed ASR finals', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1000 });
  const runtime = fakeRuntime(t);
  const fake = fakeRtm();
  const adapter = backend(runtime);
  const reserve = adapter.createSession;
  adapter.createSession = async (options) => ({ ...(await reserve(options)), rtm: connection });
  const voice = createAgoraVoiceSession({
    backend: adapter,
    transcripts: createAgoraRtmTranscripts({ RTM: fake.RTM }),
    microphoneMode: 'half-duplex',
  });
  t.after(() => voice.stop());
  // Control playback energy; the gate reads the same public audio levels as the UI.
  let remote = -60;
  voice.getAudioLevels = () => ({ local: -20, remote });
  await voice.start();
  const track = runtime.streams[0].getTracks()[0];
  t.mock.timers.tick(1000);
  assert.equal(track.enabled, true);
  const client = fake.clients[0];
  const activity = (stateChanged) =>
    client.emit('presence', { publisher: 'agent', channelName: connection.channel, stateChanged });
  activity({ speaking: 'true' });
  assert.equal(voice.getState().microphoneSuppressed, true);
  assert.equal(track.enabled, false);
  client.emit(
    'message',
    packet({
      object: 'user.transcription',
      turn_id: 1,
      text: 'A completed user utterance.',
      final: true,
      user_id: 'client',
    }),
  );
  assert.equal(voice.getTranscriptSnapshot()[0].text, 'A completed user utterance.');
  voice.setMicrophoneMuted(true);
  remote = -20;
  activity({ speaking: 'false', thinking: 'false' });
  t.mock.timers.tick(1000);
  assert.equal(track.enabled, false, 'buffered playback must still block capture');
  remote = -60;
  t.mock.timers.tick(1000);
  assert.equal(voice.getState().microphoneSuppressed, false);
  assert.equal(track.enabled, false, 'automatic resume must preserve manual mute');
  voice.setMicrophoneMuted(false);
  assert.equal(track.enabled, true);
  activity({ thinking: 'true' });
  assert.equal(track.enabled, false);
  await voice.stop();
  assert.equal(client.listeners.size, 0);
});

test('RTM loader isolates Ink compatibility and leaves global wx and browser APIs untouched', async () => {
  const requests = [];
  const console = {
    log() {
      assert.equal(this, console);
    },
  };
  const wx = { connectSocket() {} };
  const root = {
    navigator: { userAgent: 'AIUI/0.20 Ink/0.20' },
    console,
    wx,
    fetch: async (url, options) => {
      requests.push(options);
      return new Response('{}');
    },
  };
  const env = createRtmEnvironment(root);
  assert.equal(env.scope.wx, undefined);
  assert.equal(root.wx, wx);
  env.scope.AgoraRTM = {};
  assert.equal(root.AgoraRTM, undefined);
  env.console.log.call(undefined);
  let called = 0;
  env.browser.addEventListener('online', () => called++);
  env.browser.dispatchEvent(new Event('online'));
  assert.equal(called, 1);
  assert.equal(root.addEventListener, undefined);
  await env.fetch('https://example.test', { referrer: 'no-referrer' });
  assert.equal(requests[0].referrer, '');
  assert.equal('setRequestHeader' in new env.XMLHttpRequest(), false);
});
