import { randomBytes, timingSafeEqual } from 'node:crypto';
import { jsonCopy, matches, validCallId } from '../../src/tool-schema.js';
import { ServiceError } from './errors.js';

export function publicToolsURL(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new TypeError('VOICE_TOOLS_PUBLIC_URL must be an HTTPS URL.');
  return url.href.replace(/\/$/, '');
}

/** Session-scoped delivery only. Tool implementations never run in this server. */
export function createToolRelay({ definitions, url, callTimeout = 8000, waitTimeout = 10_000 }) {
  const token = `Bearer ${randomBytes(32).toString('base64url')}`;
  const expected = Buffer.from(token);
  const calls = new Map();
  let waiter;
  let closed = false;
  function wake() {
    waiter?.();
  }
  function pending() {
    return [...calls.values()].find((call) => !call.result);
  }

  return {
    cloudTools: definitions.map((definition) => ({
      type: 'function',
      function: definition,
      execution: { mode: 'sync' },
      server: {
        method: 'POST',
        url,
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: {
          id: '{{tool_call_id}}',
          name: definition.name,
          arguments: Object.fromEntries(
            Object.keys(definition.parameters.properties).map((key) => [key, `{{args.${key}}}`]),
          ),
        },
        timeout_ms: 10_000,
      },
    })),
    authorize(authorization) {
      const actual = Buffer.from(authorization ?? '');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        throw new ServiceError(401, 'UNAUTHORIZED');
    },
    invoke(value) {
      if (closed) throw new ServiceError(410, 'SESSION_ENDED');
      let copy;
      try {
        copy = jsonCopy(value);
      } catch {
        throw new ServiceError(400, 'INVALID_TOOL_CALL');
      }
      if (!copy || typeof copy !== 'object') throw new ServiceError(400, 'INVALID_TOOL_CALL');
      const { id, name, arguments: args } = copy;
      const definition = definitions.find((tool) => tool.name === name);
      if (!validCallId(id) || !definition || !matches(definition.parameters, args))
        throw new ServiceError(400, 'INVALID_TOOL_CALL');
      const identity = JSON.stringify([name, args]);
      const previous = calls.get(id);
      if (previous) {
        if (previous.identity !== identity) throw new ServiceError(409, 'TOOL_CALL_ID_CONFLICT');
        return previous.promise;
      }
      if (calls.size >= 128 || [...calls.values()].filter((call) => !call.result).length >= 8)
        throw new ServiceError(429, 'TOOL_CALL_LIMIT');
      let resolve;
      const promise = new Promise((done) => {
        resolve = done;
      });
      const call = {
        identity,
        promise,
        request: { id, name, arguments: args, expiresAt: Date.now() + callTimeout },
        finish(result) {
          if (call.result) return;
          clearTimeout(call.timer);
          call.result = result;
          resolve(result);
          wake();
        },
      };
      call.timer = setTimeout(() => call.finish({ ok: false, error: 'TIMEOUT' }), callTimeout);
      calls.set(id, call);
      wake();
      return promise;
    },
    next(signal) {
      if (closed) throw new ServiceError(410, 'SESSION_ENDED');
      if (waiter) throw new ServiceError(409, 'TOOL_LISTENER_EXISTS');
      const call = pending();
      if (call) return Promise.resolve({ call: call.request });
      return new Promise((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', finish);
          waiter = null;
          resolve({ call: !closed && !signal?.aborted ? (pending()?.request ?? null) : null });
        };
        const timer = setTimeout(finish, waitTimeout);
        waiter = finish;
        signal?.addEventListener('abort', finish, { once: true });
        if (signal?.aborted) finish();
      });
    },
    submit(value) {
      let copy;
      try {
        copy = jsonCopy(value);
      } catch {
        throw new ServiceError(400, 'INVALID_TOOL_RESULT');
      }
      if (!copy || typeof copy !== 'object') throw new ServiceError(400, 'INVALID_TOOL_RESULT');
      const call = calls.get(copy.id);
      if (!call || typeof copy.ok !== 'boolean') throw new ServiceError(400, 'INVALID_TOOL_RESULT');
      if (closed) throw new ServiceError(410, 'SESSION_ENDED');
      if (call.result) return { accepted: true };
      if (copy.ok && !Object.hasOwn(copy, 'result'))
        throw new ServiceError(400, 'INVALID_TOOL_RESULT');
      if (
        !copy.ok &&
        !['INVALID_ARGUMENTS', 'EXPIRED', 'TIMEOUT', 'EXECUTION_FAILED'].includes(copy.error)
      )
        throw new ServiceError(400, 'INVALID_TOOL_RESULT');
      call.finish(copy.ok ? { ok: true, result: copy.result } : { ok: false, error: copy.error });
      return { accepted: true };
    },
    close() {
      closed = true;
      for (const call of calls.values()) call.finish({ ok: false, error: 'SESSION_ENDED' });
      wake();
    },
  };
}
