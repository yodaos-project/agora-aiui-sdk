import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createWorkerTranscripts,
  serveWorkerTranscripts,
} from '../examples/agent/lib/transcript-channel.js';
import { createAgoraVoiceSession } from '../src/index.js';
import { backend, deferred, fakeRuntime, tick } from './helpers.js';

const credentials = { appId: 'app', userId: 'user', agentUserId: 'bot', channel: 'room' };
const partial = (text, status = 'in-progress') => [{ id: 'user:1', role: 'user', text, status }];

function channel() {
  const packets = [];
  let closed = false;
  const ports = [{}, {}];
  ports.forEach((port, index) => {
    Object.defineProperty(port, 'closed', { get: () => closed });
    port.postMessage = (value) => {
      if (closed) throw new DOMException('Closed', 'InvalidStateError');
      const data = structuredClone(value);
      packets.push(data);
      queueMicrotask(() => {
        if (!closed) ports[1 - index].onmessage?.({ data });
      });
    };
    port.close = () => {
      if (closed) return;
      closed = true;
      for (const endpoint of ports) queueMicrotask(() => endpoint.onclose?.({}));
    };
  });
  return { page: ports[0], worker: ports[1], packets };
}

function fixture(options = {}) {
  const wire = channel();
  let callbacks;
  let stopped = 0;
  const source = {
    connect(next) {
      callbacks = next;
      const ready = next.connection.token().then((token) => {
        assert.equal(token, 'short-lived');
        if (!next.signal.aborted) next.onState({ status: 'connected' });
      });
      return {
        ready,
        close: async () => {
          stopped++;
          await options.logout?.();
        },
      };
    },
  };
  serveWorkerTranscripts(wire.worker, source, options);
  const proxy = createWorkerTranscripts(async () => wire.page, options);
  const updates = [];
  const states = [];
  const activities = [];
  const controller = new AbortController();
  const handle = proxy.connect({
    connection: { ...credentials, token: options.token ?? (() => 'short-lived') },
    signal: controller.signal,
    onUpdate: (snapshot) => updates.push(snapshot),
    onState: (state) => states.push(state.status),
    onActivity: (activity) => activities.push(activity),
  });
  return {
    wire,
    handle,
    updates,
    states,
    activities,
    controller,
    get callbacks() {
      return callbacks;
    },
    get stopped() {
      return stopped;
    },
  };
}

test('Worker credentials are correlated without cloning callbacks; partials coalesce and finals flush', async () => {
  const setup = fixture({ interval: 20 });
  await setup.handle.ready;
  assert.deepEqual(setup.states, ['connected']);
  assert.deepEqual(setup.wire.packets[0], { type: 'connect', connection: credentials });
  setup.callbacks.onUpdate(partial('你'));
  setup.callbacks.onUpdate(partial('你好'));
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(
    setup.updates.map((rows) => rows[0].text),
    ['你好'],
  );
  setup.callbacks.onUpdate(partial('下一段'));
  setup.callbacks.onUpdate(partial('下一段结束', 'final'));
  await tick();
  assert.equal(setup.updates.at(-1)[0].status, 'final');
  setup.callbacks.onUpdate([
    { id: 'bot:1', role: 'assistant', text: '回答', status: 'interrupted', interrupted: true },
  ]);
  setup.callbacks.onActivity({ thinking: true });
  await tick();
  assert.equal(setup.updates.at(-1)[0].interrupted, true);
  assert.deepEqual(setup.activities, [{ thinking: true }]);
  assert.equal(await setup.callbacks.connection.token(), 'short-lived');
  await setup.handle.close();
  assert.equal(setup.stopped, 1);
  assert(setup.wire.page.closed);
});

test('abort cancels token providers and suppresses late snapshots and replies', async () => {
  const waiting = deferred();
  let signal;
  const setup = fixture({
    token: (options) => {
      signal = options.signal;
      return waiting.promise;
    },
  });
  const failed = assert.rejects(setup.handle.ready, /unavailable/);
  await tick();
  setup.controller.abort();
  await setup.handle.close();
  await failed;
  assert(signal.aborted);
  assert(setup.callbacks.signal.aborted);
  const count = setup.wire.packets.length;
  waiting.resolve('private-late-token');
  setup.callbacks.onUpdate(partial('late', 'final'));
  await tick();
  assert.equal(setup.wire.packets.length, count);
  assert.equal(setup.stopped, 1);
  assert.deepEqual(setup.updates, []);
});

test('a late port is closed after cancellation without starting a Worker subscription', async () => {
  const waiting = deferred();
  const wire = channel();
  const controller = new AbortController();
  const source = createWorkerTranscripts(() => waiting.promise);
  const handle = source.connect({
    signal: controller.signal,
    connection: credentials,
    onUpdate: () => assert.fail(),
    onState: () => {},
  });
  const failed = assert.rejects(handle.ready);
  await tick();
  controller.abort();
  await handle.close();
  await failed;
  waiting.resolve(wire.page);
  await tick();
  assert(wire.page.closed);
  assert.deepEqual(wire.packets, []);
});

test('a stalled credential request times out and closes both sides', async () => {
  let signal;
  const setup = fixture({
    timeout: 20,
    token: (options) => {
      signal = options.signal;
      return new Promise(() => {});
    },
  });
  await assert.rejects(setup.handle.ready, /unavailable/);
  await setup.handle.close();
  assert(signal.aborted);
  assert(setup.wire.page.closed);
  assert.equal(setup.stopped, 1);
});

test('cleanup after a flushed update never passes an absent timer to Ink', async (t) => {
  const cancel = globalThis.clearTimeout;
  t.mock.method(globalThis, 'clearTimeout', (timer) => {
    assert(timer != null, 'Ink requires a timer handle.');
    return cancel(timer);
  });
  const setup = fixture();
  await setup.handle.ready;
  setup.callbacks.onUpdate(partial('结束', 'final'));
  await tick();
  await setup.handle.close();
  assert.equal(setup.stopped, 1);
  assert(setup.wire.page.closed);
});

test('cleanup failure or a missing acknowledgement is not reported as success', async () => {
  for (const stalled of [false, true]) {
    const gate = deferred();
    const setup = fixture({
      cleanupTimeout: 20,
      logout: () => {
        if (stalled) return gate.promise;
        throw new Error('provider-private-details');
      },
    });
    await setup.handle.ready;
    await assert.rejects(setup.handle.close(), /unavailable/);
    assert(setup.wire.page.closed);
    gate.resolve();
    await tick();
  }
});

test('closing one private channel leaves another call receiving updates', async () => {
  const first = fixture();
  const second = fixture();
  await Promise.all([first.handle.ready, second.handle.ready]);
  await first.handle.close();
  second.callbacks.onUpdate(partial('仍在连接', 'final'));
  await tick();
  assert.equal(second.updates[0][0].text, '仍在连接');
  assert.equal(second.stopped, 0);
  assert(!second.wire.page.closed);
  await second.handle.close();
});

test('channel backpressure closes text capture instead of accumulating unbounded messages', async () => {
  const setup = fixture();
  await setup.handle.ready;
  setup.wire.worker.postMessage = () => {
    throw new DOMException('Full', 'QuotaExceededError');
  };
  setup.callbacks.onUpdate(partial('终态', 'final'));
  await tick();
  assert(setup.wire.page.closed);
  assert.equal(setup.stopped, 1);
  assert(setup.states.includes('failed'));
  await setup.handle.close();
});

test('Worker failure keeps an established voice call usable and releases its text source', async (t) => {
  const runtime = fakeRuntime(t);
  const adapter = backend(runtime);
  const reserve = adapter.createSession;
  adapter.createSession = async (options) => ({
    ...(await reserve(options)),
    rtm: { ...credentials, token: 'short-lived' },
  });
  const wire = channel();
  let stopped = 0;
  serveWorkerTranscripts(wire.worker, {
    connect({ connection, onState }) {
      return {
        ready: connection.token().then(() => onState({ status: 'connected' })),
        close: async () => {
          stopped++;
        },
      };
    },
  });
  const voice = createAgoraVoiceSession({
    backend: adapter,
    transcripts: createWorkerTranscripts(async () => wire.page),
  });
  t.after(() => voice.stop());
  await voice.start();
  assert.equal(voice.getTranscriptState().status, 'connected');
  wire.worker.close();
  await tick();
  assert.equal(voice.getTranscriptState().status, 'failed');
  assert.equal(voice.getState().lifecycle, 'running');
  assert.equal(voice.getState().error, null);
  assert.equal(stopped, 1);
});

test('the Page has no eager RTM vendor import and the manifest declares the Worker', async () => {
  const root = new URL('../examples/agent/', import.meta.url);
  const page = await readFile(new URL('pages/call/index.ink', root), 'utf8');
  const worker = await readFile(new URL('workers/transcripts.js', root), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('app.json', root), 'utf8'));
  assert(!/rtm-vendor|AgoraRTM|createAgoraRtmTranscripts/.test(page));
  assert(!page.includes('/sdk/index.js'), 'The eager SDK barrel also imports the RTM reducer.');
  assert.match(worker, /rtm-vendor/);
  assert.equal(manifest.agentWorkers[0].name, 'transcripts');
  assert.equal(manifest.agentWorkers[0].lifetime, 'foreground');
});
