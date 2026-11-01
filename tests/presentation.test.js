import assert from 'node:assert/strict';
import test from 'node:test';
import { getCallCopy } from '../examples/agent/pages/call/copy.js';
import {
  audioFeedback,
  changedFields,
  presentCall,
  readConversation,
} from '../examples/agent/pages/call/presentation.js';

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
  assert.equal(presentCall(running).phase, 'listening');
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

test('thinking and confirmed interruption respect transport and playback state', () => {
  assert.equal(presentCall(running, false, { thinking: true }).phase, 'thinking');
  assert.equal(presentCall(running, true, { thinking: true }).phase, 'speaking');
  assert.equal(presentCall(running, true, { interrupted: true }).phase, 'interrupted');
  assert.equal(
    presentCall({ ...running, audio: 'suspended' }, true, { interrupted: true }).phase,
    'paused',
  );
  assert.equal(
    presentCall({ ...running, media: 'disconnected' }, true, { interrupted: true }).phase,
    'recovering',
  );
  assert.equal(
    presentCall({ ...running, microphoneMuted: true }, false, { thinking: true }).phase,
    'muted',
  );
});

test('one-line ASR replaces cumulative partials, follows the latest turn, and excludes AI text', () => {
  const first = { id: 'user:1:0', role: 'user', text: '今天' };
  const assistant = { id: 'assistant:1:0', role: 'assistant', text: 'This must not appear.' };
  assert.equal(readConversation([assistant]).userLine, '');
  assert.equal(readConversation([first, assistant]).userLine, '今天');
  assert.equal(
    readConversation([{ ...first, text: '今天天气不错' }, assistant]).userLine,
    '今天天气不错',
  );
  assert.equal(
    readConversation([first, assistant, { id: 'user:2:0', role: 'user', text: '换个话题' }])
      .userLine,
    '换个话题',
  );
  const long = readConversation([{ ...first, text: '一二三四五六七八九十\n新的问题👋' }], 8);
  assert.equal(long.userLine, '…十 新的问题👋');
  assert.equal(Array.from(long.userLine).length, 8);
  const interrupted = readConversation([first, { ...assistant, interrupted: true }]);
  assert.equal(interrupted.userLine, '今天');
  assert.equal(interrupted.interruptedKey, assistant.id);
  assert.equal(
    readConversation([first, { ...assistant, interrupted: true }]).interruptedKey,
    interrupted.interruptedKey,
  );
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
  assert.match(failed.hint, /microphone/);
});

test('unchanged conversation feedback does not trigger another page binding update', () => {
  const current = { ...presentCall(running), clock: '00:15', orbScale: 1 };
  assert.deepEqual(changedFields(current, current), {});
  assert.deepEqual(changedFields(current, { ...current, clock: '00:16', orbScale: 1.08 }), {
    clock: '00:16',
    orbScale: 1.08,
  });
});

test('provider selects complete UI copy without changing call state', () => {
  const en = getCallCopy('agora');
  const zh = getCallCopy('shengwang');
  assert.equal(getCallCopy(), en);
  assert.equal(getCallCopy('unknown'), en);
  assert.deepEqual(Object.keys(en), Object.keys(zh));
  assert.deepEqual(Object.keys(en.phases), Object.keys(zh.phases));
  assert.deepEqual(Object.keys(en.errors), Object.keys(zh.errors));
  for (const [provider, copy] of [
    ['agora', en],
    ['shengwang', zh],
  ]) {
    for (const [state, speaking, feedback] of [
      [{}, false, {}],
      [running, false, {}],
      [running, true, {}],
      [running, false, { thinking: true }],
      [running, true, { interrupted: true }],
      [{ ...running, media: 'disconnected' }, true, {}],
      [{ ...running, audio: 'suspended' }, true, {}],
      [{ lifecycle: 'stopped' }, false, {}],
      [{ ...running, error: { code: 'MICROPHONE' } }, false, {}],
    ]) {
      const view = presentCall(state, speaking, feedback, provider);
      const baseline = presentCall(state, speaking, feedback);
      assert.equal(view.cloud, copy.cloud);
      assert.equal(view.title, copy.phases[view.phase].title);
      assert.equal(view.hint, state.error ? copy.errors.MICROPHONE : copy.phases[view.phase].hint);
      for (const key of ['phase', 'active', 'busy', 'connected', 'canControl', 'canResume'])
        assert.equal(view[key], baseline[key]);
    }
  }
  assert.equal(en.cloud, 'Agora Cloud');
  assert.equal(zh.cloud, '声网 Cloud');
  assert.equal(en.start, 'Let’s talk');
  assert.equal(zh.start, '开始聊天');
  assert.equal(en.transcriptFailed.includes('实时'), false);
  assert.equal(zh.transcriptFailed.includes('实时'), true);
});

test('orb actions follow actual call controls and do not fake a cloud interruption', () => {
  assert.equal(presentCall().orbAction, 'start');
  assert.equal(presentCall({ lifecycle: 'failed' }).orbAction, 'start');
  assert.equal(presentCall({ lifecycle: 'starting' }).orbAction, '');
  assert.equal(presentCall({ ...running, media: 'disconnected' }).orbAction, '');
  assert.equal(presentCall({ ...running, lifecycle: 'stopping' }).orbAction, '');
  assert.equal(presentCall({ ...running, audio: 'suspended' }).orbAction, 'resume');
  assert.equal(presentCall({ ...running, microphoneMuted: true }).orbAction, 'unmute');
  assert.equal(presentCall({ ...running, speakerMuted: true }).orbAction, 'soundOn');
  assert.equal(presentCall({ ...running, microphoneSuppressed: true }).orbAction, '');
  const speaking = presentCall(running, true);
  assert.equal(speaking.orbAction, 'mute');
  assert.equal(speaking.phase, 'speaking');
  assert.equal(speaking.orbLabel, 'Mute');
  assert.equal(presentCall(running, true, {}, 'shengwang').orbLabel, '静音');
});

test('audio feedback reacts to both directions and ignores disabled capture and playback', () => {
  const loud = { local: -24, remote: -24 };
  const both = audioFeedback(running, loud);
  assert.ok(both.input > 0 && both.input < 1);
  assert.equal(both.input, both.output);
  for (const change of [{ microphoneMuted: true }, { microphoneSuppressed: true }]) {
    const levels = audioFeedback({ ...running, ...change }, loud);
    assert.equal(levels.input, 0);
    assert.ok(levels.output > 0);
  }
  const quiet = audioFeedback({ ...running, speakerMuted: true }, loud);
  assert.equal(quiet.output, 0);
  assert.ok(quiet.input > 0);
  for (const change of [
    { lifecycle: 'stopped' },
    { audio: 'suspended' },
    { media: 'disconnected' },
  ])
    assert.deepEqual(audioFeedback({ ...running, ...change }, loud), { input: 0, output: 0 });
  assert.deepEqual(audioFeedback(running, { local: NaN, remote: Infinity }), {
    input: 0,
    output: 0,
  });
});

test('audio feedback depends on elapsed time, not RTM refresh frequency, and releases smoothly', () => {
  const loud = { local: -24, remote: -24 };
  const once = audioFeedback(running, loud, undefined, 160);
  let repeated;
  for (let i = 0; i < 10; i++) repeated = audioFeedback(running, loud, repeated, 16);
  assert.ok(Math.abs(once.input - repeated.input) < 1e-12);
  assert.deepEqual(audioFeedback(running, loud, once, 0), once);
  const release = audioFeedback(running, { local: -60, remote: -60 }, once, 160);
  assert.ok(release.input > 0 && release.input < once.input);
});
