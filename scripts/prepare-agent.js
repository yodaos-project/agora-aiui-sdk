import { rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

// The SDK is unpublished in this repository; install the local package exactly
// as an app dependency, including the generated RTM Worker bundle.
for (const args of [
  ['run', 'prepack'],
  ['install', '--install-links', '--prefix', 'examples/agent'],
]) {
  if (args[0] === 'install') {
    await rm(
      new URL('../examples/agent/node_modules/@yodaos-pkg/agora-aiui-sdk/', import.meta.url),
      {
        recursive: true,
        force: true,
      },
    );
  }
  const result = spawnSync('npm', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
