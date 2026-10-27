import { cp, mkdir } from 'node:fs/promises';

// Keep the AIUI example self-contained: Ink loads relative ESM modules from its app bundle.
const source = new URL('../src/', import.meta.url);
const target = new URL('../examples/agent/lib/sdk/', import.meta.url);
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true, filter: (path) => !path.endsWith('.d.ts') });
console.log(
  'Prepared examples/agent/lib/sdk. Open examples/agent with Ink after configuring its backend.',
);
