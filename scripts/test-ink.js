// Optional runtime check: INK_WEB_DIST=/absolute/path/to/ink-web/dist npm run test:ink
// Uses an isolated headless browser and a virtual microphone. No Agora/cloud requests are sent.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const ink = process.env.INK_WEB_DIST;
const binary =
  process.env.CHROME_BIN ||
  [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find(existsSync);
if (!ink || !existsSync(path.join(ink, 'index.js')))
  throw new Error('Set INK_WEB_DIST to a built Ink Web SDK containing WHIP support.');
if (!binary) throw new Error('Set CHROME_BIN to Chrome/Chromium.');
const files = {};
async function collect(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'lib') continue;
    const key = `${prefix}${entry.name}`;
    if (entry.isDirectory()) await collect(path.join(directory, entry.name), `${key}/`);
    else files[key] = await readFile(path.join(directory, entry.name), 'utf8');
  }
}
await collect(path.join(root, 'examples/agent'));
for (const name of await readdir(path.join(root, 'src'))) {
  if (name.endsWith('.js'))
    files[`lib/sdk/${name}`] = await readFile(path.join(root, 'src', name), 'utf8');
}
const probe = `
import { createAgoraVoiceSession } from '../../lib/sdk/index.js';
export default {
  onLoad() { this.postMessage({ ready: true }); },
  async run() {
    try {
    const captured = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (options) => {
      const stream = await original(options); captured.push(stream); return stream;
    };
    const voice = createAgoraVoiceSession({ connection: {
      baseURL: 'https://whip.example.test', channel: 'runtime-probe', uid: 'aiui-runtime-probe',
      token: () => { throw new Error('Intentional pre-network cancellation.'); },
    }, timeout: 10000 });
    voice.addEventListener('statechange', () => this.postMessage({ progress: voice.getState() }));
    const watchdog = setTimeout(() => this.postMessage({ passed: false, error: 'Probe watchdog', state: voice.getState() }), 18000);
    try {
      let code;
      try { await voice.start(); } catch (error) { code = error.code; }
      const cleanup = await voice.stop();
      if (code !== 'MEDIA') throw new Error('Unexpected failure stage: ' + code);
      if (captured.length !== 1) throw new Error('Expected one real virtual-microphone capture.');
      if (captured[0].getTracks().some((track) => track.readyState !== 'ended')) throw new Error('Capture leaked.');
      if (cleanup.audio !== 'complete' || cleanup.media !== 'complete') throw new Error('Incomplete cleanup.');
      this.postMessage({ passed: true, runtime: 'Ink QuickJS/Wasm', captured: 1, state: voice.getState() });
    } catch (error) { this.postMessage({ passed: false, error: String(error), state: voice.getState() }); }
    finally { clearTimeout(watchdog); }
    } catch (error) { this.postMessage({ passed:false,error:String(error),stack:error.stack }); }
  },
};`;
files['pages/probe/index.ink'] =
  `<script setup>${probe}</script><page><view style="width: 200px; height: 100px;" bindtap="run"><text>Run runtime check</text></view></page>`;
const manifest = JSON.parse(files['app.json']);
manifest.pages.push('pages/probe/index');
files['app.json'] = JSON.stringify(manifest);
const html = `<!doctype html><html><meta charset="utf-8"><style>body{margin:16px;background:#111;color:white;font:14px sans-serif}canvas{display:block;margin:16px 0}pre{max-width:900px;white-space:pre-wrap}</style>
<canvas id="color" width="448" height="170"></canvas><canvas id="green" width="448" height="170"></canvas><canvas id="large" width="480" height="352"></canvas><canvas id="probe" width="200" height="100"></canvas><pre id="result">Running…</pre>
<script type="module">
import { createInkView } from '/ink/index.js';
try {
const files = await (await fetch('/bundle')).json();
const views = [];
for (const [id,width,height,themeName] of [['color',448,170,'yodaos-sprite-color'],['green',448,170,'yodaos-sprite-greenonly'],['large',480,352,'yodaos-sprite-color']]) {
  const view = await createInkView({ canvas: document.getElementById(id), width, height, themeName });
  view.startRendering(); view.openBundle({appId:'sdk-example-'+id,files}); views.push(view);
}
const probe = await createInkView({canvas:document.getElementById('probe'),width:200,height:100,permissionChecks:true,permissionRequests:true,
 hostCapabilities:{permissions:{request:({permissions})=>permissions.map(name=>({name,granted:true}))}},
 onMessage(event){(window.probeMessages ||= []).push(event.data);if(event.data.ready) window.probeReady=true;if('passed' in event.data) window.testResult=event.data;document.getElementById('result').textContent=JSON.stringify(event.data,null,2);}
});
probe.startRendering(); probe.openBundle({appId:'sdk-runtime-probe',files,initialPage:'pages/probe/index',hostOptions:{initialTarget:'_blank',initialFocus:'focus'}});
window.views=[...views,probe];
window.runProbe=()=>{probe.dispatchPointer('pointerdown',50,50,1);probe.dispatchPointer('pointerup',50,50,1);};
} catch(error) { window.testResult={passed:false,error:String(error),stack:error.stack}; }
</script></html>`;
const mime = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(html);
      return;
    }
    if (url.pathname === '/bundle') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(files));
      return;
    }
    if (!url.pathname.startsWith('/ink/')) throw new Error('Unknown resource.');
    const local = path.resolve(ink, decodeURIComponent(url.pathname.slice(5)));
    if (!local.startsWith(`${path.resolve(ink)}${path.sep}`)) throw new Error('Invalid resource.');
    response.setHeader('Content-Type', mime[path.extname(local)] || 'application/octet-stream');
    response.end(await readFile(local));
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(path.join(os.tmpdir(), 'agora-aiui-runtime-'));
const chrome = spawn(
  binary,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try {
      port = Number(
        (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0],
      );
      break;
    } catch {
      await delay(100);
    }
  }
  if (!port) throw new Error('Chrome startup failed.');
  const target = await (
    await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })
  ).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const exceptions = [];
  const logs = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const pair = pending.get(message.id);
      pending.delete(message.id);
      if (pair) {
        if (message.error) pair.reject(new Error(JSON.stringify(message.error)));
        else pair.resolve(message.result);
      }
    } else if (message.method === 'Runtime.exceptionThrown')
      exceptions.push(message.params.exceptionDetails);
    else if (message.method === 'Runtime.consoleAPICalled')
      logs.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '));
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', {
    width: 1000,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  let result;
  let activated = false;
  for (let i = 0; i < 150; i++) {
    await delay(200);
    if (!activated) {
      const activation = await call('Runtime.evaluate', {
        expression: 'window.probeReady && (window.runProbe(), true)',
        userGesture: true,
        returnByValue: true,
      });
      activated = activation.result?.value === true;
    }
    const state = await call('Runtime.evaluate', {
      expression: 'window.testResult || null',
      returnByValue: true,
    });
    result = state.result?.value;
    if (result) break;
  }
  console.log(
    JSON.stringify(
      {
        result,
        exceptions,
        messages: result?.passed
          ? []
          : (
              await call('Runtime.evaluate', {
                expression: 'window.probeMessages',
                returnByValue: true,
              })
            ).result?.value,
        logs: result?.passed ? [] : logs.slice(-25),
      },
      null,
      2,
    ),
  );
  if (process.env.INK_TEST_SCREENSHOT) {
    await delay(300);
    const screenshot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(process.env.INK_TEST_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
  }
  if (!result?.passed || exceptions.length) process.exitCode = 1;
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  server.closeAllConnections();
  server.close();
  await delay(300);
  await rm(profile, { recursive: true, force: true });
}
