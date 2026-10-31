import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('the packed SDK installs as a self-contained Ink package', async (t) => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agora-sdk-package-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--silent', '--json', '--pack-destination', dir], {
      cwd: root,
      encoding: 'utf8',
    }),
  )[0];
  assert(packed.files.some((entry) => entry.path === 'src/rtm-vendor.js'));
  await writeFile(path.join(dir, 'package.json'), '{"private":true,"type":"module"}');
  execFileSync(
    'npm',
    ['install', '--ignore-scripts', '--offline', path.join(dir, packed.filename)],
    {
      cwd: dir,
      stdio: 'pipe',
    },
  );
  // Resolve the same bare package specifiers used by an AIUI Agent.
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const voice = await import('@yodaos-pkg/agora-aiui-sdk/voice');
       if (typeof voice.createWorkerTranscripts !== 'function') process.exit(1);
       import.meta.resolve('@yodaos-pkg/agora-aiui-sdk/worker');`,
    ],
    { cwd: dir, stdio: 'pipe' },
  );
  const installed = path.join(dir, 'node_modules/@yodaos-pkg/agora-aiui-sdk');
  const manifest = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
  assert.equal(manifest.exports['./voice'], './src/voice.js');
  assert.equal(manifest.exports['./worker'], './src/worker.js');
  const voice = await import(pathToFileURL(path.join(installed, 'src/voice.js')));
  assert.equal(typeof voice.createAgoraVoiceSession, 'function');
  assert.equal(typeof voice.createWorkerTranscripts, 'function');
  const worker = await readFile(path.join(installed, 'src/worker.js'), 'utf8');
  assert.match(worker, /\.\/rtm-vendor\.js/);
  assert((await readFile(path.join(installed, 'src/rtm-vendor.js'), 'utf8')).includes('AgoraRTM'));
});
