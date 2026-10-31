// One private Page–Worker channel per call. Functions and AbortSignals stay in
// their owning realm; only temporary credentials and bounded snapshots cross it.
const unavailable = () => new Error('Live conversation text is unavailable.');
const statuses = new Set(['connecting', 'connected', 'disconnected', 'failed', 'closed']);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function createWorkerTranscripts(
  connectPort,
  { timeout = 15000, cleanupTimeout = 2000 } = {},
) {
  return {
    connect({ connection, signal, onUpdate, onState, onActivity }) {
      const ready = deferred();
      const acknowledged = deferred();
      const controller = new AbortController();
      const tokens = new Map();
      let port;
      let closed = false;
      let closing;
      const timer = setTimeout(fail, timeout);
      const abort = () => void close().catch(() => {});
      signal.addEventListener('abort', abort, { once: true });

      function fail() {
        if (closed) return;
        onState({ status: 'failed', error: unavailable() });
        void close().catch(() => {});
      }

      function send(message) {
        try {
          port.postMessage(message);
        } catch {
          fail();
        }
      }

      async function provideToken(requestId) {
        if (tokens.size >= 2 || tokens.has(requestId)) return fail();
        const request = new AbortController();
        tokens.set(requestId, request);
        const deadline = setTimeout(() => request.abort(), timeout);
        const aborted = new Promise((_, reject) => {
          request.signal.addEventListener('abort', () => reject(unavailable()), { once: true });
        });
        try {
          const token = await Promise.race([
            Promise.resolve().then(() =>
              typeof connection?.token === 'function'
                ? connection.token({ signal: request.signal })
                : connection?.token,
            ),
            aborted,
          ]);
          if (!closed && !request.signal.aborted)
            send({ type: 'token', requestId, token: typeof token === 'string' ? token : null });
        } catch {
          if (!closed) send({ type: 'token', requestId, token: null });
        } finally {
          clearTimeout(deadline);
          tokens.delete(requestId);
        }
      }

      function close() {
        if (closing) return closing;
        closed = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        for (const token of tokens.values()) token.abort();
        tokens.clear();
        ready.reject(unavailable());
        closing = (async () => {
          let completed = true;
          if (port && !port.closed) {
            let deadline;
            try {
              port.postMessage({ type: 'stop' });
              completed = await Promise.race([
                acknowledged.promise,
                new Promise((resolve) => {
                  deadline = setTimeout(() => resolve(false), cleanupTimeout);
                }),
              ]);
            } catch {
              // A terminated Worker has already revoked this call's resources.
              completed = port.closed;
            } finally {
              if (deadline != null) clearTimeout(deadline);
            }
          }
          controller.abort();
          if (port) {
            port.onmessage = port.onmessageerror = port.onclose = null;
            port.close();
          }
          if (!completed) throw unavailable();
        })();
        return closing;
      }

      Promise.resolve().then(async () => {
        if (signal.aborted || closed) return abort();
        try {
          const endpoint = await connectPort({ signal: controller.signal, timeout });
          if (closed) {
            endpoint.close();
            return;
          }
          port = endpoint;
          port.onclose = () => {
            acknowledged.resolve();
            fail();
          };
          port.onmessageerror = fail;
          port.onmessage = ({ data }) => {
            if (data?.type === 'closed') {
              acknowledged.resolve(data.ok !== false);
              return;
            }
            if (closed) return;
            if (data?.type === 'ready') {
              clearTimeout(timer);
              ready.resolve();
            } else if (data?.type === 'tokenRequest') void provideToken(data.requestId);
            else if (data?.type === 'snapshot' && Array.isArray(data.messages))
              onUpdate(data.messages);
            else if (data?.type === 'activity') onActivity?.(data.activity);
            else if (data?.type === 'state' && statuses.has(data.status))
              onState({
                status: data.status,
                error: data.status === 'failed' ? unavailable() : null,
              });
            else if (data?.type === 'failed') fail();
          };
          const { appId, userId, agentUserId, channel } = connection ?? {};
          send({ type: 'connect', connection: { appId, userId, agentUserId, channel } });
        } catch {
          fail();
        }
      });
      return { ready: ready.promise, close };
    },
  };
}

export function serveWorkerTranscripts(port, source, { timeout = 15000, interval = 80 } = {}) {
  const controller = new AbortController();
  const tokens = new Map();
  let nextRequest = 0;
  let handle;
  let closed = false;
  let closing;
  let pending;
  let timer;
  let previous = new Map();

  function send(message) {
    if (closed) return;
    try {
      port.postMessage(message);
    } catch {
      void close();
      port.close();
    }
  }

  function close() {
    if (closing) return closing;
    closed = true;
    if (timer != null) clearTimeout(timer);
    pending = null;
    previous.clear();
    controller.abort();
    for (const request of tokens.values()) {
      clearTimeout(request.timer);
      request.reject(unavailable());
    }
    tokens.clear();
    closing = Promise.resolve()
      .then(() => handle?.close())
      .then(
        () => true,
        () => false,
      )
      .then((ok) => {
        try {
          port.postMessage({ type: 'closed', ok });
        } catch {
          /* Page has gone away. */
        }
      });
    return closing;
  }

  function getToken() {
    if (closed || tokens.size) return Promise.reject(unavailable());
    const requestId = ++nextRequest;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        tokens.delete(requestId);
        reject(unavailable());
      }, timeout);
      tokens.set(requestId, { resolve, reject, timer });
      send({ type: 'tokenRequest', requestId });
    });
  }

  function flush() {
    if (timer != null) clearTimeout(timer);
    timer = null;
    const messages = pending;
    pending = null;
    if (messages) send({ type: 'snapshot', messages });
  }

  port.onclose = () => void close();
  port.onmessageerror = () => {
    void close();
    port.close();
  };
  port.onmessage = ({ data }) => {
    if (closed) return;
    if (data?.type === 'stop') {
      void close();
      return;
    }
    if (data?.type === 'token') {
      const request = tokens.get(data.requestId);
      if (!request) return;
      clearTimeout(request.timer);
      tokens.delete(data.requestId);
      if (typeof data.token === 'string' && data.token) request.resolve(data.token);
      else request.reject(unavailable());
      return;
    }
    if (data?.type !== 'connect' || handle) return;
    try {
      handle = source.connect({
        connection: { ...data.connection, token: getToken },
        signal: controller.signal,
        onState: ({ status }) => send({ type: 'state', status }),
        onActivity: (activity) => send({ type: 'activity', activity }),
        onUpdate: (messages) => {
          if (closed) return;
          // Only replaceable partials wait for the next batch. New final or
          // interrupted turns are flushed immediately, including the latest partial.
          const terminal = messages.some(
            (entry) =>
              entry.status !== 'in-progress' &&
              (previous.get(entry.id)?.status !== entry.status ||
                previous.get(entry.id)?.text !== entry.text),
          );
          previous = new Map(messages.map((entry) => [entry.id, entry]));
          pending = messages;
          if (terminal) flush();
          else if (timer == null) timer = setTimeout(flush, interval);
        },
      });
      Promise.resolve(handle.ready).then(
        () => send({ type: 'ready' }),
        () => {
          send({ type: 'failed' });
          void close();
        },
      );
    } catch {
      send({ type: 'failed' });
      void close();
    }
  };
}
