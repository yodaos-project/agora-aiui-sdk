import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createAgoraVoiceSession, createHttpVoiceBackend } from '../src/voice.js';
import { localTools, connectLocalTools } from '../src/local-tools.js';
import { toolDefinitions } from '../src/tool-schema.js';
import { createCallTools } from '../examples/agent/pages/call/tools.js';
import { createSessionService } from '../examples/server/sessions.js';
import { createVoiceHandler, bearerAuthorizer } from '../examples/server/http.js';
import { createToolRelay } from '../examples/server/tools.js';
import { createAgoraAgentFactory } from '../examples/server/agora.js';
import { deferred, fakeRuntime, tick } from './helpers.js';

const credentials = { appId: '1'.repeat(32), certificate: '2'.repeat(32) };
const auth = 'test-business-authorization-only';
const definitions = toolDefinitions(createCallTools(() => {}));
const newCall = (id = 'call-1') => ({
  id,
  name: 'setOrbColor',
  arguments: { color: 'purple' },
  expiresAt: Date.now() + 8000,
});

async function listen(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

test('local tools serialize descriptors only and reject unsupported schemas and names', () => {
  const original = createCallTools(() => {});
  const registry = localTools(original);
  assert(!JSON.stringify(registry.definitions).includes('execute'));
  assert(!JSON.stringify(registry.definitions).includes('server'));
  original[0].parameters.properties.color.enum.push('invalid');
  assert(!registry.definitions[0].parameters.properties.color.enum.includes('invalid'));
  for (const name of ['set_color', 'mcpColor', '1color'])
    assert.throws(() => localTools([{ ...original[0], name }]));
  assert.throws(() => localTools([original[0], { ...original[0], name: 'SETORBCOLOR' }]));
  assert.throws(() => localTools([{ ...original[0], execute: null }]));
  assert.throws(() =>
    toolDefinitions([{ ...original[0], parameters: { ...original[0].parameters, required: [] } }]),
  );
  assert.throws(() =>
    toolDefinitions([
      { ...original[0], parameters: { ...original[0].parameters, additionalProperties: true } },
    ]),
  );
  assert.throws(() =>
    toolDefinitions([
      { ...original[0], parameters: { ...original[0].parameters, $ref: 'https://schema.test' } },
    ]),
  );
});

test('HTTP relay executes actual example actions locally and hangup releases capture', async (t) => {
  const runtime = fakeRuntime(t);
  const spawned = [];
  const store = createSessionService({
    ...credentials,
    baseURL: 'https://whip.example.test',
    toolsPublicURL: 'https://business.example.test',
    createAgent(options) {
      spawned.push(options);
      return { async start() {}, async stop() {} };
    },
  });
  t.after(() => store.close());
  const baseURL = await listen(
    t,
    createVoiceHandler({ service: store, authorize: bearerAuthorizer(auth) }),
  );
  let color;
  let executions = 0;
  const voice = createAgoraVoiceSession({
    backend: createHttpVoiceBackend({ baseURL, authorization: `Bearer ${auth}` }),
    tools: createCallTools((value) => {
      color = value;
      executions++;
    }),
  });
  t.after(() => voice.stop());
  await voice.start();
  const tool = spawned[0].tools[0];
  assert.deepEqual(tool.function, definitions[0]);
  assert.deepEqual(tool.server.body.arguments, { color: '{{args.color}}' });
  assert.equal(tool.server.body.id, '{{tool_call_id}}');
  const route = `${baseURL}${new URL(tool.server.url).pathname}`;
  const invoke = (body, authorization = tool.server.headers.Authorization) =>
    fetch(route, {
      method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await invoke(newCall(), `Bearer ${auth}`)).status,
    401,
    'business auth is not a tool callback capability',
  );
  const response = await invoke(newCall());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, result: { color: 'purple' } });
  assert.equal(color, 'purple');
  assert.equal(voice.getToolState(), 'connected');
  assert.deepEqual(await (await invoke(newCall())).json(), {
    ok: true,
    result: { color: 'purple' },
  });
  assert.equal(executions, 1);
  assert.equal((await invoke({ ...newCall(), arguments: { color: 'blue' } })).status, 409);
  assert.equal(
    (await invoke({ ...newCall('bad-args'), arguments: { color: 'javascript:alert(1)' } })).status,
    400,
  );
  assert.equal((await invoke({ ...newCall('unknown'), name: 'runScript' })).status, 400);
  assert.throws(() => store.nextToolCall(spawned[0].sessionId, 'other-user'), { status: 404 });
  const stopped = once(voice, 'statechange').catch(() => {});
  const ended = await invoke({ id: 'hangup-1', name: 'endConversation', arguments: {} });
  assert.deepEqual(await ended.json(), { ok: true, result: { ending: true } });
  await stopped;
  const cleanup = await voice.stop();
  assert.equal(cleanup.backend, 'complete');
  assert.equal(cleanup.tools, 'complete');
  assert.equal(runtime.streams[0].getTracks()[0].readyState, 'ended');
  assert.equal(voice.getToolState(), 'closed');
  assert.equal((await invoke(newCall('after-close'))).status, 410);
});

test('a lost tool result response replays the result without repeating UI changes', async () => {
  const controller = new AbortController();
  let executions = 0;
  let submissions = 0;
  const call = newCall();
  const source = connectLocalTools({
    registry: localTools(createCallTools(() => executions++)),
    sessionId: 'test',
    signal: controller.signal,
    onState() {},
    endConversation() {},
    backend: {
      async nextToolCall() {
        return { call };
      },
      async submitToolResult(reply) {
        assert.equal(reply.ok, true);
        if (++submissions === 1) throw new Error('Lost response');
        controller.abort();
      },
    },
  });
  await source.close();
  assert.equal(executions, 1);
  assert.equal(submissions, 2);
});

test('tool deadlines cancel slow handlers and block delayed UI effects', async () => {
  const controller = new AbortController();
  const release = deferred();
  let executionSignal;
  let changed = false;
  let result;
  const tools = createCallTools(() => {});
  tools[0].execute = async (_, { signal }) => {
    executionSignal = signal;
    await release.promise;
    signal.throwIfAborted();
    changed = true;
  };
  const source = connectLocalTools({
    registry: localTools(tools),
    sessionId: 'test',
    signal: controller.signal,
    onState() {},
    endConversation() {},
    backend: {
      async nextToolCall() {
        return { call: { ...newCall(), expiresAt: Date.now() + 20 } };
      },
      async submitToolResult(reply) {
        result = reply;
        controller.abort();
      },
    },
  });
  await source.close();
  assert.equal(result.error, 'TIMEOUT');
  assert.equal(executionSignal.aborted, true);
  release.resolve();
  await tick();
  assert.equal(changed, false);
});

test('stop aborts an active handler and a pending receiver without leaking local closures', async () => {
  const controller = new AbortController();
  const entered = deferred();
  const registry = localTools([
    {
      ...createCallTools(() => {})[0],
      execute: async (_, { signal }) => {
        entered.resolve(signal);
        await new Promise(() => {});
      },
    },
  ]);
  const source = connectLocalTools({
    registry,
    sessionId: 'test',
    signal: controller.signal,
    onState() {},
    endConversation() {},
    backend: {
      async nextToolCall() {
        return { call: newCall() };
      },
      async submitToolResult() {
        assert.fail('No result after stop');
      },
    },
  });
  const executionSignal = await entered.promise;
  controller.abort();
  await source.close();
  assert.equal(executionSignal.aborted, true);
  assert.equal(registry.handlers.size, 0);
});

test('session-scoped relays bound pending calls, cancel waiters, and reject late results', async () => {
  const relay = createToolRelay({
    definitions,
    url: 'https://business.example.test/tools',
    callTimeout: 20,
  });
  const other = createToolRelay({ definitions, url: 'https://business.example.test/tools' });
  assert.throws(() => other.authorize(relay.cloudTools[0].server.headers.Authorization), {
    status: 401,
  });
  const controller = new AbortController();
  const waiting = relay.next(controller.signal);
  assert.throws(() => relay.next(), { status: 409 });
  controller.abort();
  assert.deepEqual(await waiting, { call: null });
  const expired = relay.invoke(newCall());
  assert.deepEqual(await expired, { ok: false, error: 'TIMEOUT' });
  assert.deepEqual(await relay.invoke(newCall()), { ok: false, error: 'TIMEOUT' });
  const pending = Array.from({ length: 8 }, (_, i) => relay.invoke(newCall(`pending-${i}`)));
  assert.throws(() => relay.invoke(newCall('overflow')), { status: 429 });
  relay.close();
  assert((await Promise.all(pending)).every((reply) => reply.error === 'SESSION_ENDED'));
  assert.throws(() => relay.submit({ id: 'pending-0', ok: true, result: null }), { status: 410 });
  other.close();
});

test('unconfigured tools are explicit errors and audio-only sessions remain available', async (t) => {
  fakeRuntime(t);
  const store = createSessionService({
    ...credentials,
    baseURL: 'https://whip.example.test',
    createAgent: () => ({ async start() {}, async stop() {} }),
  });
  t.after(() => store.close());
  assert.throws(() => store.createSession('owner', { tools: definitions }), {
    code: 'LOCAL_TOOLS_UNAVAILABLE',
  });
  assert(store.createSession('owner').id);
  assert.throws(
    () =>
      createAgoraVoiceSession({
        backend: { createSession() {}, startAgent() {}, stopSession() {} },
        tools: createCallTools(() => {}),
      }),
    /nextToolCall/,
  );
});

test('tool request bodies are bounded while receiving chunked data', async (t) => {
  const store = createSessionService({
    ...credentials,
    baseURL: 'https://whip.example.test',
    createAgent: () => ({ async start() {}, async stop() {} }),
  });
  t.after(() => store.close());
  const baseURL = await listen(
    t,
    createVoiceHandler({ service: store, authorize: bearerAuthorizer(auth) }),
  );
  const reply = await fetch(`${baseURL}/voice/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    duplex: 'half',
    body: new ReadableStream({
      start(controller) {
        for (let i = 0; i < 9; i++) controller.enqueue(new Uint8Array(8192).fill(32));
        controller.close();
      },
    }),
  });
  assert.equal(reply.status, 413);
  assert.equal((await reply.json()).error, 'BODY_TOO_LARGE');
});

test('invalid and oversized tool results are sanitized and not reported as success', async () => {
  for (const result of [
    () => {
      throw new Error('private vendor credential');
    },
    () => 'x'.repeat(8192),
  ]) {
    const controller = new AbortController();
    let reply;
    const source = connectLocalTools({
      registry: localTools([{ ...createCallTools(() => {})[0], execute: result }]),
      sessionId: 'test',
      signal: controller.signal,
      onState() {},
      endConversation() {},
      backend: {
        async nextToolCall() {
          return { call: newCall() };
        },
        async submitToolResult(value) {
          reply = value;
          controller.abort();
        },
      },
    });
    await source.close();
    assert.equal(reply.ok, false);
    assert.equal(reply.error, 'EXECUTION_FAILED');
    assert(!JSON.stringify(reply).includes('private vendor'));
  }
});

test('hangup still stops the call when result delivery fails', async () => {
  const controller = new AbortController();
  const events = [];
  const source = connectLocalTools({
    registry: localTools(createCallTools(() => {})),
    sessionId: 'test',
    signal: controller.signal,
    onState() {},
    endConversation() {
      events.push('end');
      controller.abort();
    },
    backend: {
      async nextToolCall() {
        return { call: { ...newCall(), name: 'endConversation', arguments: {} } };
      },
      async submitToolResult() {
        events.push('result');
        throw new Error('offline');
      },
    },
  });
  await source.close();
  assert.deepEqual(events, ['result', 'end']);
});

test('requesting tools without a backend acknowledgement cleans up the voice reservation', async (t) => {
  const runtime = fakeRuntime(t);
  let stopped = false;
  const voice = createAgoraVoiceSession({
    tools: createCallTools(() => {}),
    backend: {
      async createSession() {
        return {
          id: 'test',
          whip: {
            baseURL: 'https://whip.example.test',
            channel: 'test',
            uid: 'user',
            token: 'test-token',
          },
        };
      },
      async startAgent() {
        assert.fail('Must not start a tool-less cloud agent');
      },
      async stopSession() {
        stopped = true;
      },
      async nextToolCall() {
        assert.fail('Must not receive before acknowledgement');
      },
      async submitToolResult() {},
    },
  });
  await assert.rejects(voice.start(), { code: 'TOOLS' });
  assert.equal(stopped, true);
  assert.equal(runtime.streams[0].getTracks()[0].readyState, 'ended');
});

test('both official cloud API regions receive client tool descriptors and merged feature flags', async (t) => {
  const requests = [];
  const upstream = await listen(t, async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    if (request.url.endsWith('/join')) requests.push({ path: request.url, body: JSON.parse(body) });
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ agent_id: 'test-agent' }));
  });
  const previous = process.env.AGORA_AGENTS_API_BASE_URL;
  process.env.AGORA_AGENTS_API_BASE_URL = upstream;
  t.after(() => {
    if (previous === undefined) delete process.env.AGORA_AGENTS_API_BASE_URL;
    else process.env.AGORA_AGENTS_API_BASE_URL = previous;
  });
  const relay = createToolRelay({ definitions, url: 'https://business.example.test/tools' });
  for (const area of ['AP', 'CN']) {
    const factory = createAgoraAgentFactory({
      ...credentials,
      area,
      pipelineId: 'pipeline',
      enableRtm: true,
    });
    const agent = factory({
      sessionId: area,
      channel: area,
      uid: 'user',
      botUid: 'agent',
      maxDurationSeconds: 60,
      tools: relay.cloudTools,
    });
    await agent.start();
    await agent.stop();
  }
  assert.equal(requests.length, 2);
  assert.match(requests[1].path, /^\/cn\//);
  for (const { body } of requests) {
    assert.deepEqual(body.properties.advanced_features, { enable_rtm: true, enable_tools: true });
    assert.deepEqual(body.properties.llm.tools, relay.cloudTools);
    assert.equal(body.pipeline_id, 'pipeline');
  }
  relay.close();
});
