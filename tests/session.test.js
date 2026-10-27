import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgoraVoiceSession, agoraEndpoint } from '../src/index.js';
import { backend, connection, deferred, fakeRuntime, tick } from './helpers.js';

test('Agora endpoint preserves numeric Uid and encodes channel/string UID', () => {
  const url = new URL(
    agoraEndpoint({ ...connection, channel: 'a/b', stringUid: 'display & name' }),
  );
  assert.equal(url.pathname, '/pub/a%2Fb');
  assert.equal(url.searchParams.get('Uid'), '10001');
  assert.equal(url.searchParams.get('stringuid'), 'display & name');
  assert.equal(url.searchParams.get('duplex'), 'true');
  for (const uid of [0, -1, 4_294_967_295, '10001', NaN])
    assert.throws(() => agoraEndpoint({ ...connection, uid }));
  assert.throws(() =>
    agoraEndpoint({ ...connection, baseURL: 'https://user:secret@example.test' }),
  );
  assert.throws(() => agoraEndpoint({ ...connection, baseURL: 'http://example.test' }));
});

test('direct media uses the merged WHIP API and owns its capture and graph', async (t) => {
  const runtime = fakeRuntime(t);
  const voice = createAgoraVoiceSession({ connection });
  t.after(() => voice.stop());
  const pending = voice.start();
  assert.equal(runtime.audios.length, 1, 'AudioContext created synchronously in user gesture');
  assert.strictEqual(voice.start(), pending);
  await pending;
  const whip = runtime.whips[0];
  assert.equal(voice.getState().lifecycle, 'running');
  assert.equal(voice.getState().media, 'connected');
  assert.equal(voice.getState().agent, 'not-managed');
  assert.equal(whip.options.mediaMode, 'duplex');
  assert.equal(whip.options.response.acceptedStatuses, 'any-2xx');
  assert.equal(await whip.options.authorization(), 'Bearer test-only-token');
  const closing = voice.stop();
  assert.equal(
    runtime.streams[0].getTracks()[0].readyState,
    'ended',
    'capture stops before awaiting DELETE',
  );
  assert.strictEqual(voice.stop(), closing);
  await closing;
  assert(runtime.order.indexOf('track.stop') < runtime.order.indexOf('whip.close'));
  assert(runtime.nodes.every((node) => !node.connected));
  assert.equal(runtime.audios[0].state, 'closed');
  assert.equal(voice.getState().lifecycle, 'stopped');
  assert(!JSON.stringify(voice.getState()).includes(connection.token));
});

test('managed start reserves first and starts bot only after media connects', async (t) => {
  const runtime = fakeRuntime(t);
  const voice = createAgoraVoiceSession({ backend: backend(runtime) });
  t.after(() => voice.stop());
  await voice.start();
  assert(runtime.order.indexOf('backend.reserve') < runtime.order.indexOf('capture'));
  assert(runtime.order.indexOf('media.connected') < runtime.order.indexOf('agent.start'));
  assert.equal(voice.getState().agent, 'running');
  await voice.stop();
  assert(runtime.order.includes('agent.stop'));
  assert.equal(voice.getState().agent, 'stopped');
});

test('ICE disconnected overrides a stale aggregate connected state and can recover', async (t) => {
  const runtime = fakeRuntime(t);
  const voice = createAgoraVoiceSession({ connection });
  t.after(() => voice.stop());
  await voice.start();
  const pc = runtime.whips[0].peerConnection;
  pc.iceConnectionState = 'disconnected';
  pc.dispatchEvent(new Event('iceconnectionstatechange'));
  assert.equal(voice.getState().media, 'disconnected');
  pc.iceConnectionState = 'connected';
  pc.dispatchEvent(new Event('iceconnectionstatechange'));
  assert.equal(voice.getState().media, 'connected');
  pc.iceConnectionState = 'failed';
  pc.dispatchEvent(new Event('iceconnectionstatechange'));
  await voice.stop();
  assert.equal(voice.getState().lifecycle, 'failed');
  assert.equal(runtime.streams[0].getTracks()[0].readyState, 'ended');
});

test('a terminal transport failure during startup rejects with its actual failure code', async (t) => {
  fakeRuntime(t, {
    waitForConnection: (whip) => {
      whip.peerConnection.iceConnectionState = 'failed';
      whip.peerConnection.dispatchEvent(new Event('iceconnectionstatechange'));
      return new Promise(() => {});
    },
  });
  const voice = createAgoraVoiceSession({ connection });
  await assert.rejects(voice.start(), { code: 'MEDIA' });
  await voice.stop();
  assert.equal(voice.getState().lifecycle, 'failed');
});

test('mute, playback volume and remote levels do not duplicate remote audio sources', async (t) => {
  const runtime = fakeRuntime(t);
  const voice = createAgoraVoiceSession({ connection });
  t.after(() => voice.stop());
  voice.setMicrophoneMuted(true);
  voice.setSpeakerMuted(true);
  voice.setVolume(0.4);
  await voice.start();
  assert.equal(runtime.streams[0].getTracks()[0].enabled, false);
  const remote = new runtime.Stream();
  const trackEvent = () => {
    const event = new Event('track');
    event.track = remote.getTracks()[0];
    event.streams = [remote];
    return event;
  };
  const count = runtime.nodes.length;
  runtime.whips[0].peerConnection.dispatchEvent(trackEvent());
  runtime.whips[0].peerConnection.dispatchEvent(trackEvent());
  assert.equal(runtime.nodes.length, count + 1);
  const gain = runtime.nodes[4];
  assert.equal(gain.gain.value, 0);
  voice.setSpeakerMuted(false);
  assert.equal(gain.gain.value, 0.4);
  voice.setMicrophoneMuted(false);
  const levels = voice.getAudioLevels();
  assert(Math.abs(levels.local - -6.0206) < 0.001);
  assert(Math.abs(levels.remote - -6.0206) < 0.001);
  assert.throws(() => voice.setVolume(2), RangeError);
  // Force another sample without waiting; the same backing arrays must be reused.
  voice._lastLevelTime = -Infinity;
  voice.getAudioLevels();
  const sampled = runtime.nodes.filter((node) => node.samples.length);
  assert(sampled.every((node) => node.samples.length === 2 && node.samples[0] === node.samples[1]));
});

test('stop while permission prompt is pending disposes a late capture', async (t) => {
  const capture = deferred();
  const runtime = fakeRuntime(t, { getUserMedia: () => capture.promise });
  const voice = createAgoraVoiceSession({ connection });
  const started = assert.rejects(voice.start(), { code: 'ABORTED' });
  await tick();
  await voice.stop();
  const stream = new runtime.Stream();
  capture.resolve(stream);
  await started;
  await tick();
  assert.equal(stream.getTracks()[0].readyState, 'ended');
  assert(!runtime.order.includes('whip.connect'));
});

test('stop during reservation releases its late result without capturing', async (t) => {
  const reservation = deferred();
  const runtime = fakeRuntime(t);
  const voice = createAgoraVoiceSession({
    backend: backend(runtime, { createSession: () => reservation.promise }),
  });
  const started = assert.rejects(voice.start(), { code: 'ABORTED' });
  await tick();
  await voice.stop();
  reservation.resolve({ id: 'late', whip: connection });
  await started;
  await tick();
  assert(runtime.order.includes('agent.stop'));
  assert(!runtime.order.includes('capture'));
});

test('resources resolved just before stop are already adopted and cannot leak', async (t) => {
  const capture = deferred();
  const runtime = fakeRuntime(t, { getUserMedia: () => capture.promise });
  const voice = createAgoraVoiceSession({ connection });
  const started = assert.rejects(voice.start(), { code: 'ABORTED' });
  await tick();
  const stream = new runtime.Stream();
  capture.resolve(stream);
  // The acquire handler runs first, then stop, then the awaiting startup continuation.
  queueMicrotask(() => {
    void voice.stop();
  });
  await started;
  await voice.stop();
  assert.equal(stream.getTracks()[0].readyState, 'ended');
  assert(!runtime.order.includes('whip.connect'));
});

test('stop during cloud agent startup immediately releases capture and requests backend stop', async (t) => {
  const gate = deferred();
  const runtime = fakeRuntime(t);
  const voice = createAgoraVoiceSession({
    backend: backend(runtime, { startAgent: () => gate.promise }),
  });
  const started = assert.rejects(voice.start(), { code: 'ABORTED' });
  await tick();
  const stopping = voice.stop();
  assert.equal(runtime.streams[0].getTracks()[0].readyState, 'ended');
  await stopping;
  assert(runtime.order.includes('agent.stop'));
  gate.resolve();
  await started;
  await tick();
  assert.equal(voice.getState().lifecycle, 'stopped');
});

test('cloud stop timeout remains visible instead of falsely reporting the bot stopped', async (t) => {
  const runtime = fakeRuntime(t);
  const voice = createAgoraVoiceSession({
    backend: backend(runtime, {
      stopSession: () => new Promise(() => {}),
    }),
    cleanupTimeout: 10,
  });
  await voice.start();
  const report = await voice.stop();
  assert.equal(report.backend, 'timeout');
  assert.equal(voice.getState().agent, 'unknown');
  assert.equal(runtime.audios[0].state, 'closed');
});

test('reentrant statechange stop cannot recreate resources or resolve start successfully', async (t) => {
  const runtime = fakeRuntime(t);
  const voice = createAgoraVoiceSession({ connection });
  voice.addEventListener('statechange', () => {
    if (voice.getState().lifecycle === 'starting') void voice.stop();
  });
  await assert.rejects(voice.start(), { code: 'ABORTED' });
  await voice.stop();
  assert.equal(runtime.whips.length, 0);
  assert.equal(runtime.audios[0].state, 'closed');
});

test('external startup cancellation is detached after startup', async (t) => {
  const runtime = fakeRuntime(t);
  const voice = createAgoraVoiceSession({ connection });
  t.after(() => voice.stop());
  const controller = new AbortController();
  await voice.start({ signal: controller.signal });
  controller.abort();
  await tick();
  assert.equal(voice.getState().lifecycle, 'running');
  assert.equal(runtime.streams[0].getTracks()[0].readyState, 'live');
});

for (const stage of ['capture', 'connect', 'agent']) {
  test(`${stage} failure closes independent resources and redacts provider errors`, async (t) => {
    const fail = () => {
      throw new Error('provider-secret-token');
    };
    const runtime = fakeRuntime(
      t,
      stage === 'capture' ? { getUserMedia: fail } : stage === 'connect' ? { connect: fail } : {},
    );
    const voice = createAgoraVoiceSession({
      backend: backend(runtime, stage === 'agent' ? { startAgent: fail } : {}),
    });
    await assert.rejects(
      voice.start(),
      (error) => !error.message.includes('provider-secret-token'),
    );
    assert.equal(voice.getState().lifecycle, 'failed');
    assert(runtime.order.includes('agent.stop'));
    assert(runtime.order.includes('audio.close'));
    assert(!JSON.stringify(voice.getState()).includes('provider-secret-token'));
  });
}

test('hanging WHIP close does not block cloud stop or microphone release', async (t) => {
  const runtime = fakeRuntime(t, { close: () => new Promise(() => {}) });
  const voice = createAgoraVoiceSession({ backend: backend(runtime), cleanupTimeout: 20 });
  await voice.start();
  const stopping = voice.stop();
  assert.equal(runtime.streams[0].getTracks()[0].readyState, 'ended');
  await tick();
  assert(runtime.order.includes('agent.stop'));
  const report = await stopping;
  assert.equal(report.media, 'timeout');
  assert.equal(report.backend, 'complete');
});

test('startup has a deadline even if a connection provider ignores its signal', async (t) => {
  const runtime = fakeRuntime(t);
  const voice = createAgoraVoiceSession({ connection: () => new Promise(() => {}), timeout: 20 });
  await assert.rejects(voice.start(), { code: 'TIMEOUT' });
  assert.equal(runtime.audios[0].state, 'closed');
  assert.equal(voice.getState().lifecycle, 'failed');
});

test('cleanup works on hosts that reject clearTimeout(undefined)', async (t) => {
  fakeRuntime(t);
  const voice = createAgoraVoiceSession({ connection });
  await voice.start();
  const original = globalThis.clearTimeout;
  globalThis.clearTimeout = (timer) => {
    assert.notEqual(timer, undefined, 'Ink requires a defined timer ID');
    original(timer);
  };
  try {
    await voice.stop();
  } finally {
    globalThis.clearTimeout = original;
  }
  assert.equal(voice.getState().lifecycle, 'stopped');
});

test('Ink tracks without EventTarget use a bounded-rate ended watcher that is removed on stop', async (t) => {
  const capture = deferred();
  const runtime = fakeRuntime(t, { getUserMedia: () => capture.promise });
  const stream = new runtime.Stream();
  const track = stream.getAudioTracks()[0];
  track.addEventListener = undefined;
  const voice = createAgoraVoiceSession({ connection });
  const started = voice.start();
  capture.resolve(stream);
  await started;
  const watcher = voice._trackTimer;
  assert(watcher, 'fallback watcher installed');
  const original = globalThis.clearInterval;
  let cleared = false;
  globalThis.clearInterval = (id) => {
    if (id === watcher) cleared = true;
    original(id);
  };
  try {
    await voice.stop();
  } finally {
    globalThis.clearInterval = original;
  }
  assert(cleared);
  assert.equal(track.readyState, 'ended');
});

test('backend lease renews and leaves no renewal timer after stop', async (t) => {
  const runtime = fakeRuntime(t);
  let renewed = 0;
  const lease = { expiresAt: Date.now() + 1000, renewAfterMs: 10 };
  const voice = createAgoraVoiceSession({
    backend: backend(runtime, {
      async createSession() {
        return { id: 'leased', whip: connection, lease };
      },
      async renewSession() {
        renewed++;
        return { lease };
      },
    }),
  });
  await voice.start();
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert(renewed > 0);
  await voice.stop();
  const previous = renewed;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(renewed, previous);
});

test('missing Ink APIs fail with a useful stable error and mutually exclusive options are enforced', async () => {
  assert.throws(() => createAgoraVoiceSession({}));
  assert.throws(() => createAgoraVoiceSession({ connection, backend: {} }));
  const voice = createAgoraVoiceSession({ connection });
  await assert.rejects(voice.start(), { code: 'UNSUPPORTED' });
  await voice.stop();
});
