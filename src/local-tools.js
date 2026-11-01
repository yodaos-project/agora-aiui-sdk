import { acquire, bounded, checkSignal } from './errors.js';
import { jsonCopy, matches, toolDefinitions, validCallId } from './tool-schema.js';

export function localTools(tools = []) {
  const definitions = toolDefinitions(tools);
  const handlers = new Map();
  for (const tool of tools) {
    if (typeof tool.execute !== 'function') throw new TypeError('Each local tool needs execute().');
    handlers.set(tool.name, tool.execute);
  }
  return { definitions, handlers };
}

/** One low-volume control stream. Awaiting a call does not poll conversation history. */
export function connectLocalTools({
  registry,
  backend,
  sessionId,
  signal,
  endConversation,
  onState,
}) {
  const completed = new Map();
  const definitions = new Map(registry.definitions.map((tool) => [tool.name, tool]));
  const pause = (delay) =>
    new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, delay);
      signal.addEventListener('abort', finish, { once: true });
      if (signal.aborted) finish();
    });

  async function execute(call) {
    if (!validCallId(call?.id)) throw new Error('Invalid tool call.');
    const identity = JSON.stringify([call.name, call.arguments]);
    const previous = completed.get(call.id);
    if (previous) {
      if (previous.identity !== identity) throw new Error('Reused tool call ID.');
      return previous;
    }
    if (completed.size >= 128) throw new Error('Tool call limit reached.');
    const record = {
      identity,
      reply: { id: call.id, ok: false, error: 'INVALID_ARGUMENTS' },
      end: false,
    };
    // Reserve the ID before user code runs, including rejected and timed-out calls.
    completed.set(call.id, record);
    const definition = definitions.get(call.name);
    try {
      if (!definition || !matches(definition.parameters, jsonCopy(call.arguments))) return record;
    } catch {
      return record;
    }
    const remaining = Math.min(5000, call.expiresAt - Date.now());
    if (!Number.isFinite(remaining) || remaining <= 0) {
      record.reply.error = 'EXPIRED';
      return record;
    }
    const status = await bounded(
      async (executionSignal) => {
        checkSignal(executionSignal);
        const result = await registry.handlers.get(call.name)(jsonCopy(call.arguments), {
          callId: call.id,
          signal: executionSignal,
          // Ending a call is deferred until its result has been submitted (or that attempt times out).
          endConversation() {
            checkSignal(executionSignal);
            record.end = true;
          },
        });
        checkSignal(executionSignal);
        record.reply = jsonCopy({ id: call.id, ok: true, result: result ?? null });
      },
      remaining,
      signal,
    );
    if (status !== 'complete')
      record.reply = {
        id: call.id,
        ok: false,
        error: status === 'timeout' ? 'TIMEOUT' : 'EXECUTION_FAILED',
      };
    return record;
  }

  const done = (async () => {
    let failures = 0;
    onState('connecting');
    while (!signal.aborted) {
      try {
        const waitingSince = Date.now();
        const { call } = await acquire(backend.nextToolCall({ sessionId, signal }), signal);
        checkSignal(signal);
        onState('connected');
        if (call) {
          const record = await execute(call);
          checkSignal(signal);
          // A lost result response can redeliver this ID. Replay its result, never its side effect.
          const status = await bounded(
            (replySignal) =>
              backend.submitToolResult({ sessionId, ...record.reply, signal: replySignal }),
            2000,
            signal,
          );
          if (record.end) {
            if (!signal.aborted) void endConversation();
            return;
          }
          if (status !== 'complete') throw new Error('Tool result was not acknowledged.');
        } else if (Date.now() - waitingSince < 250) await pause(250);
        failures = 0;
      } catch {
        if (signal.aborted) break;
        onState('disconnected');
        await pause(Math.min(5000, 500 * 2 ** Math.min(failures++, 4)));
      }
    }
  })().finally(() => {
    completed.clear();
    registry.handlers.clear();
    onState('closed');
  });
  return { close: () => done };
}
