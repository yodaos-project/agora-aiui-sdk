import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgoraVoiceSession } from '../src/index.js';
import { historySnapshot, transcriptSnapshot } from '../src/transcripts.js';
import { backend, connection, deferred, fakeRuntime, tick } from './helpers.js';

test('history preserves ASR and assistant roles while stripping provider metadata', () => {
  const snapshot = historySnapshot([
    { role: 'system', content: 'Do not expose system instructions.' },
    { role: 'user', turn_id: 3, content: 'Hello.', metadata: { private: 'provider details' } },
    { role: 'assistant', turn_id: 3, content: 'Hi.', metadata: { interrupted: true } },
  ]);
  assert.deepEqual(snapshot, [
    { id: 'user:3', role: 'user', text: 'Hello.', interrupted: false },
    { id: 'assistant:3', role: 'assistant', text: 'Hi.', interrupted: true },
  ]);
  assert(Object.isFrozen(snapshot));
  assert(Object.isFrozen(snapshot[0]));
  assert(!JSON.stringify(snapshot).includes('provider details'));
});

test('history text has bounded retention and newer duplicate versions replace older ones', () => {
  const input = Array.from({ length: 100 }, (_, index) => ({
    id: String(index),
    role: 'assistant',
    text: 'x'.repeat(4000),
  }));
  const snapshot = transcriptSnapshot(input);
  assert(snapshot.length <= 20);
  assert(snapshot.every((entry) => entry.text.length <= 2000));
  assert(snapshot.reduce((sum, entry) => sum + entry.text.length, 0) <= 12000);
  assert.equal(snapshot[snapshot.length - 1].id, '99');
  assert.deepEqual(
    transcriptSnapshot([
      { id: 'one', role: 'user', text: 'partial' },
      { id: 'one', role: 'user', text: 'complete' },
    ]),
    [{ id: 'one', role: 'user', text: 'complete', interrupted: false }],
  );
  for (const invalid of [null, {}, [{ id: 'a', role: 'system', text: 'secret' }]]) {
    assert.throws(() => transcriptSnapshot(invalid));
  }
});

test('managed transcript reads use the owned reservation without changing audio state', async (t) => {
  const runtime = fakeRuntime(t);
  const adapter = backend(runtime);
  let observed;
  adapter.getTranscripts = async (options) => {
    observed = options;
    return [{ id: 'user:1', role: 'user', text: 'Hello.' }];
  };
  const voice = createAgoraVoiceSession({ backend: adapter });
  t.after(() => voice.stop());
  await voice.start();
  const before = voice.getState();
  const text = await voice.getTranscripts();
  assert.equal(observed.sessionId, 'reservation-1');
  assert.equal(typeof observed.signal.aborted, 'boolean');
  assert.equal(text[0].text, 'Hello.');
  assert.deepEqual(voice.getState(), before);
});

test('stop cancels a transcript adapter that ignores cancellation and rejects its late result', async (t) => {
  const runtime = fakeRuntime(t);
  const gate = deferred();
  let signal;
  const voice = createAgoraVoiceSession({
    backend: {
      ...backend(runtime),
      getTranscripts(options) {
        signal = options.signal;
        return gate.promise;
      },
    },
  });
  t.after(() => voice.stop());
  await voice.start();
  const pending = voice.getTranscripts();
  const rejected = assert.rejects(pending, { code: 'ABORTED' });
  const closing = voice.stop();
  assert(signal.aborted);
  assert.equal(runtime.streams[0].getTracks()[0].readyState, 'ended');
  await rejected;
  gate.resolve([{ id: 'old', role: 'assistant', text: 'Late result.' }]);
  await closing;
  await tick();
  assert.equal(voice.getState().lifecycle, 'stopped');
});

test('transcript errors, timeouts and external cancellation do not interrupt an audio call', async (t) => {
  const runtime = fakeRuntime(t);
  let read = async () => {
    throw new Error('provider-secret');
  };
  const voice = createAgoraVoiceSession({
    timeout: 30,
    backend: {
      ...backend(runtime),
      getTranscripts: (options) => read(options),
    },
  });
  t.after(() => voice.stop());
  await voice.start();
  await assert.rejects(
    voice.getTranscripts(),
    (error) => error.code === 'TRANSCRIPTS' && !error.message.includes('provider-secret'),
  );
  read = () => new Promise(() => {});
  await assert.rejects(voice.getTranscripts(), { code: 'TRANSCRIPTS' });
  const controller = new AbortController();
  const pending = voice.getTranscripts({ signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: 'ABORTED' });
  assert.equal(voice.getState().lifecycle, 'running');
  assert.equal(voice.getState().error, null);
  assert.equal(runtime.streams[0].getTracks()[0].readyState, 'live');
});

test('audio-only direct sessions remain usable when transcript support is absent', async (t) => {
  fakeRuntime(t);
  assert.throws(
    () => createAgoraVoiceSession({ connection, transcripts: { connect() {} } }),
    /managed backend/,
  );
  const voice = createAgoraVoiceSession({ connection });
  t.after(() => voice.stop());
  await voice.start();
  await assert.rejects(voice.getTranscripts(), { code: 'UNSUPPORTED' });
  assert.equal(voice.getState().lifecycle, 'running');
});
