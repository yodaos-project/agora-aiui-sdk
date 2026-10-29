import assert from 'node:assert/strict';
import test from 'node:test';
import { changedFields, presentCall } from '../examples/agent/pages/call/presentation.js';

const running = {
  lifecycle: 'running',
  media: 'connected',
  audio: 'running',
  agent: 'running',
  microphoneMuted: false,
  speakerMuted: false,
  error: null,
};

test('call UI distinguishes interrupted media from paused playback and received speech', () => {
  assert.equal(presentCall(running).phase, 'ready');
  assert.equal(presentCall(running, true).phase, 'speaking');
  const disconnected = presentCall({ ...running, media: 'disconnected' }, true);
  assert.equal(disconnected.phase, 'recovering');
  assert.equal(disconnected.connected, false);
  assert.equal(disconnected.canControl, false);
  assert.equal(disconnected.canResume, false);
  const paused = presentCall({ ...running, audio: 'suspended' }, true);
  assert.equal(paused.phase, 'paused');
  assert.equal(paused.connected, true);
  assert.equal(paused.canResume, true);
});

test('mute states do not hide incoming speech or suggest muted audio is audible', () => {
  assert.equal(presentCall({ ...running, microphoneMuted: true }).phase, 'muted');
  assert.equal(presentCall({ ...running, microphoneMuted: true }, true).phase, 'speaking');
  assert.equal(presentCall({ ...running, speakerMuted: true }, true).phase, 'quiet');
});

test('idle, startup, cleanup and failures retain honest connection and action states', () => {
  assert.equal(presentCall().active, false);
  const starting = presentCall({ ...running, lifecycle: 'starting' }, true);
  assert.equal(starting.phase, 'connecting');
  assert.equal(starting.busy, true);
  assert.equal(starting.canControl, false);
  const stopping = presentCall({ ...running, lifecycle: 'stopping' }, true);
  assert.equal(stopping.phase, 'stopping');
  assert.equal(stopping.active, true);
  assert.equal(stopping.connected, false);
  assert.equal(stopping.canControl, false);
  assert.equal(presentCall({ lifecycle: 'stopped', media: 'closed' }).active, false);
  const failed = presentCall({
    ...running,
    error: { code: 'MICROPHONE', message: 'Do not display an unrelated provider payload.' },
  });
  assert.equal(failed.phase, 'failed');
  assert.equal(failed.connected, false);
  assert.equal(failed.canControl, false);
  assert.match(failed.hint, /麦克风/);
});

test('unchanged conversation feedback does not trigger another page binding update', () => {
  const current = { ...presentCall(running), clock: '00:15', bar1: 3 };
  assert.deepEqual(changedFields(current, current), {});
  assert.deepEqual(changedFields(current, { ...current, clock: '00:16', bar1: 7 }), {
    clock: '00:16',
    bar1: 7,
  });
});
