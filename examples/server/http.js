import { timingSafeEqual } from 'node:crypto';
import { ServiceError } from './sessions.js';

/** Bound request bodies before buffering, including requests using chunked transfer. */
function readBody(request) {
  if (Number(request.headers['content-length'] ?? 0) > 64 * 1024)
    return Promise.reject(new ServiceError(413, 'BODY_TOO_LARGE'));
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? ''))
    return Promise.reject(new ServiceError(415, 'JSON_REQUIRED'));
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const timer = setTimeout(() => finish(new ServiceError(408, 'BODY_TIMEOUT')), 5000);
    const aborted = () => finish(new ServiceError(400, 'BODY_ABORTED'));
    const data = (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) finish(new ServiceError(413, 'BODY_TOO_LARGE'));
      else chunks.push(chunk);
    };
    const end = () => {
      try {
        finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        finish(new ServiceError(400, 'INVALID_JSON'));
      }
    };
    function finish(error, value) {
      clearTimeout(timer);
      request.removeListener('data', data);
      request.removeListener('end', end);
      request.removeListener('error', aborted);
      request.removeListener('aborted', aborted);
      if (error) {
        request.pause();
        reject(error);
      } else resolve(value);
    }
    request.on('data', data).once('end', end).once('error', aborted).once('aborted', aborted);
  });
}

/** Demo authentication. Use an application authorizer returning a stable user ID in production. */
export function bearerAuthorizer(token) {
  if (typeof token !== 'string' || token.length < 24 || /\s/.test(token)) {
    throw new TypeError('BACKEND_API_TOKEN must have at least 24 non-whitespace characters.');
  }
  const expected = Buffer.from(`Bearer ${token}`);
  return (request) => {
    const actual = Buffer.from(request.headers.authorization ?? '');
    return actual.length === expected.length && timingSafeEqual(actual, expected)
      ? 'demo-user'
      : null;
  };
}

/** Client authentication and session-scoped cloud callback authentication are separate. */
export function createVoiceHandler({ service, authorize, allowedOrigins = [] }) {
  if (typeof authorize !== 'function')
    throw new TypeError('An application authorizer is required.');
  const origins = new Set(allowedOrigins);
  return async (request, response) => {
    const reply = (status, body) => {
      if (!response.destroyed && !response.writableEnded) {
        response.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(JSON.stringify(body));
      }
    };
    try {
      const origin = request.headers.origin;
      response.setHeader('Vary', 'Origin');
      if (origin && !origins.has(origin)) throw new ServiceError(403, 'ORIGIN_DENIED');
      if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.method !== 'POST') throw new ServiceError(405, 'METHOD_NOT_ALLOWED');
      const path = new URL(request.url, 'http://server.invalid').pathname;
      const toolRoute = /^\/voice\/sessions\/([\da-f-]{36})\/tools\/(invoke|next|result)$/.exec(
        path,
      );
      if (toolRoute?.[2] === 'invoke') {
        const relay = service.authorizeToolCall(toolRoute[1], request.headers.authorization);
        return reply(200, await relay.invoke(await readBody(request)));
      }
      const hasBody =
        request.headers['transfer-encoding'] || Number(request.headers['content-length'] ?? 0) > 0;
      if (hasBody && path !== '/voice/sessions' && toolRoute?.[2] !== 'result') {
        response.setHeader('Connection', 'close');
        throw new ServiceError(413, 'BODY_NOT_ALLOWED');
      }
      const owner = await authorize(request);
      if (typeof owner !== 'string' || !owner) throw new ServiceError(401, 'UNAUTHORIZED');
      if (path === '/voice/sessions') {
        const body = hasBody ? await readBody(request) : {};
        if (
          !body ||
          typeof body !== 'object' ||
          Array.isArray(body) ||
          Object.keys(body).some((key) => key !== 'tools') ||
          (hasBody && !Array.isArray(body.tools))
        )
          throw new ServiceError(400, 'INVALID_SESSION_OPTIONS');
        return reply(201, await service.createSession(owner, body));
      }
      if (toolRoute) {
        if (toolRoute[2] === 'result')
          return reply(
            200,
            await service.submitToolResult(toolRoute[1], owner, await readBody(request)),
          );
        const controller = new AbortController();
        const abort = () => controller.abort();
        response.once('close', abort);
        try {
          return reply(200, await service.nextToolCall(toolRoute[1], owner, controller.signal));
        } finally {
          response.removeListener('close', abort);
        }
      }
      const match =
        /^\/voice\/sessions\/([\da-f-]{36})\/(start|stop|renew|token|rtm-token|transcripts)$/.exec(
          path,
        );
      if (!match) throw new ServiceError(404, 'NOT_FOUND');
      const operations = {
        start: 'startAgent',
        stop: 'stopSession',
        renew: 'renewSession',
        token: 'refreshToken',
        'rtm-token': 'refreshRtmToken',
        transcripts: 'getTranscripts',
      };
      reply(200, await service[operations[match[2]]](match[1], owner));
    } catch (error) {
      // Close unread/oversized request bodies without accumulating or draining them indefinitely.
      if (!request.complete) response.setHeader('Connection', 'close');
      reply(error instanceof ServiceError ? error.status : 500, {
        error: error instanceof ServiceError ? error.code : 'INTERNAL_ERROR',
      });
    }
  };
}
