import { timingSafeEqual } from 'node:crypto';
import { ServiceError } from './sessions.js';

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

/** Node HTTP handler, also usable behind a reverse proxy. No request payload controls Agora credentials. */
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
        response.setHeader('Access-Control-Allow-Headers', 'Authorization');
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.method !== 'POST') throw new ServiceError(405, 'METHOD_NOT_ALLOWED');
      // All current operations are bodyless. Drain nothing unbounded into memory.
      if (
        request.headers['transfer-encoding'] ||
        Number(request.headers['content-length'] ?? 0) > 0
      ) {
        response.setHeader('Connection', 'close');
        throw new ServiceError(413, 'BODY_NOT_ALLOWED');
      }
      const owner = await authorize(request);
      if (typeof owner !== 'string' || !owner) throw new ServiceError(401, 'UNAUTHORIZED');
      const path = new URL(request.url, 'http://server.invalid').pathname;
      if (path === '/voice/sessions') return reply(201, await service.createSession(owner));
      const match =
        /^\/voice\/sessions\/([\da-f-]{36})\/(start|stop|renew|token|transcripts)$/.exec(path);
      if (!match) throw new ServiceError(404, 'NOT_FOUND');
      const operations = {
        start: 'startAgent',
        stop: 'stopSession',
        renew: 'renewSession',
        token: 'refreshToken',
        transcripts: 'getTranscripts',
      };
      reply(200, await service[operations[match[2]]](match[1], owner));
    } catch (error) {
      reply(error instanceof ServiceError ? error.status : 500, {
        error: error instanceof ServiceError ? error.code : 'INTERNAL_ERROR',
      });
    }
  };
}
