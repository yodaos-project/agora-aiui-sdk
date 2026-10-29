import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

/** Package the unmodified official UMD body without its unused RTC SDK peer. */
export async function rtmVendorSource() {
  const require = createRequire(import.meta.url);
  const entry = require.resolve('agora-rtm');
  const manifest = JSON.parse(
    await readFile(path.join(path.dirname(entry), 'package.json'), 'utf8'),
  );
  if (manifest.version !== '2.3.0')
    throw new Error('Revalidate the RTM loader before changing SDK versions.');
  const source = await readFile(entry, 'utf8');
  return `import { createRtmEnvironment } from './rtm-environment.js';
const env = createRtmEnvironment();
(function(globalThis, window, XMLHttpRequest, console, fetch, module, define) {
${source}
})(env.scope, env.browser, env.XMLHttpRequest, env.console, env.fetch, undefined, undefined);
export default env.scope.AgoraRTM;
`;
}
