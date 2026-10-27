import { AgoraVoiceError, acquire, checkSignal, positiveMilliseconds } from './errors.js';

const LIMIT = 64 * 1024;

/** Read a small control response with a cap before accumulating body chunks. */
async function readJSON(response, signal) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > LIMIT) {
    await response.body?.cancel();
    throw new Error('Response too large.');
  }
  if (!response.body) throw new Error('Missing response.');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await acquire(reader.read(), signal);
      if (done) break;
      total += value.byteLength;
      if (total > LIMIT) throw new Error('Response too large.');
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Connect to the reference business backend, or implement the same adapter methods yourself. */
export function createHttpVoiceBackend({
  baseURL,
  authorization,
  timeout,
  fetch: fetcher = globalThis.fetch,
} = {}) {
  const url = new URL(baseURL);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  ) {
    throw new TypeError(
      'Backend URL must use HTTPS (HTTP is allowed on loopback for development).',
    );
  }
  if (typeof fetcher !== 'function') throw new TypeError('fetch is required.');
  if (typeof authorization !== 'string' && typeof authorization !== 'function') {
    throw new TypeError('Provide the business backend authorization value or callback.');
  }
  const deadline = positiveMilliseconds(timeout, 15_000, 'timeout');
  const root = url.href.replace(/\/$/, '');

  async function request(path, { signal } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, deadline);
    try {
      checkSignal(controller.signal);
      const auth = await acquire(
        typeof authorization === 'function' ? authorization() : authorization,
        controller.signal,
      );
      checkSignal(controller.signal);
      if (typeof auth !== 'string' || !auth.trim() || /[\r\n]/.test(auth))
        throw new Error('Invalid authorization.');
      const response = await acquire(
        fetcher(`${root}/voice/sessions${path}`, {
          method: 'POST',
          headers: { Authorization: auth, Accept: 'application/json' },
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
          signal: controller.signal,
        }),
        controller.signal,
        undefined,
        (late) => late.body?.cancel(),
      );
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new Error('Backend rejected the request.');
      }
      return await readJSON(response, controller.signal);
    } catch {
      throw new AgoraVoiceError(
        signal?.aborted ? 'ABORTED' : 'BACKEND',
        signal?.aborted ? 'The voice session was cancelled.' : 'The voice backend request failed.',
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      controller.abort();
    }
  }

  function path(id, operation) {
    if (typeof id !== 'string' || !id || id.length > 256)
      throw new TypeError('Invalid session ID.');
    return `/${encodeURIComponent(id)}/${operation}`;
  }

  return Object.freeze({
    async createSession(options) {
      const reservation = await request('', options);
      if (
        typeof reservation?.id !== 'string' ||
        !reservation.id ||
        !reservation.whip ||
        typeof reservation.whip.token !== 'string' ||
        !Number.isFinite(reservation.whip.tokenExpiresAt)
      ) {
        throw new AgoraVoiceError('BACKEND', 'The backend returned an invalid voice session.');
      }
      const { id, whip } = reservation;
      let token = whip.token;
      let expiresAt = whip.tokenExpiresAt;
      let refreshing;
      return {
        id,
        lease: reservation.lease,
        whip: {
          ...whip,
          token: async () => {
            if (Date.now() < expiresAt - 10_000) return token;
            if (!refreshing) {
              refreshing = request(path(id, 'token'))
                .then((next) => {
                  if (typeof next.token !== 'string' || !Number.isFinite(next.tokenExpiresAt)) {
                    throw new AgoraVoiceError(
                      'BACKEND',
                      'The backend returned an invalid voice token.',
                    );
                  }
                  token = next.token;
                  expiresAt = next.tokenExpiresAt;
                  return token;
                })
                .finally(() => {
                  refreshing = null;
                });
            }
            return refreshing;
          },
        },
      };
    },
    async startAgent({ sessionId, signal }) {
      const result = await request(path(sessionId, 'start'), { signal });
      if (result?.agent !== 'running')
        throw new AgoraVoiceError('BACKEND', 'The backend did not acknowledge agent startup.');
      return result;
    },
    async stopSession({ sessionId, signal }) {
      const result = await request(path(sessionId, 'stop'), { signal });
      if (result?.stopped !== true)
        throw new AgoraVoiceError('BACKEND', 'The backend did not acknowledge agent cleanup.');
      return result;
    },
    renewSession({ sessionId, signal }) {
      return request(path(sessionId, 'renew'), { signal });
    },
  });
}
