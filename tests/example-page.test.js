import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getCallCopy } from '../examples/agent/pages/call/copy.js';
import * as presentation from '../examples/agent/pages/call/presentation.js';

// Exercise the actual page handler with Ink's stricter native timer arguments.
const source = (
  await readFile(new URL('../examples/agent/pages/call/index.ink', import.meta.url), 'utf8')
)
  .match(/<script setup>([\s\S]*?)<\/script>/)[1]
  .replace(/^\s*import[\s\S]*?;\n/gm, '')
  .replace('export default', 'return');

test('orb taps dispatch real controls and dispose press feedback on unload', () => {
  let id = 0;
  const timers = new Map();
  const dependencies = {
    ...presentation,
    getCallCopy,
    configuration: { provider: 'shengwang' },
    setTimeout(callback) {
      timers.set(++id, callback);
      return id;
    },
    clearTimeout(timer) {
      assert.equal(typeof timer, 'number');
      timers.delete(timer);
    },
  };
  const page = new Function(...Object.keys(dependencies), source)(...Object.values(dependencies));
  page.setData = (patch) => Object.assign(page.data, patch);
  let starts = 0;
  page.connect = () => {
    starts++;
  };
  page.activateOrb();
  assert.equal(starts, 1);
  assert.equal(page.data.pressed, 'orb');
  assert.equal(timers.size, 1);
  const choices = [];
  page.voice = {
    setMicrophoneMuted(value) {
      choices.push(value);
    },
    stop() {},
  };
  Object.assign(page.data, { orbAction: 'mute', canControl: true, micMuted: false });
  page.activateOrb();
  assert.deepEqual(choices, [true]);
  assert.equal(timers.size, 1);
  const pending = [...timers.values()][0];
  page.onUnload();
  assert.equal(timers.size, 0);
  page.setData = () => assert.fail('An unloaded page must not receive press feedback');
  pending();
  page.activateOrb();
  assert.equal(starts, 1);
});
