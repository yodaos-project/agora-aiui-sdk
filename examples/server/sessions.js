import { randomInt, randomUUID } from 'node:crypto';
import { agoraEndpoint } from '../../src/agora.js';
import { createWhipToken } from './token.js';

/** Use separate UID ranges within the cloud Agent API's signed 32-bit limit. */
export function participantUids(uid = randomInt(1, 1_000_000_000)) {
  if (!Number.isInteger(uid) || uid < 1 || uid >= 1_000_000_000) {
    throw new RangeError('Client UID must be between 1 and 999999999.');
  }
  return { uid, botUid: uid + 1_000_000_000 };
}

export class ServiceError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

/** Single-process reference store. Replace with durable storage and a scheduled reconciler when deploying. */
export function createSessionService({
  appId,
  certificate,
  baseURL,
  createAgent,
  leaseMs = 90_000,
  maxDurationMs = 30 * 60_000,
  maxSessions = 20,
  tokenLifetime = 600,
  now = Date.now,
}) {
  if (typeof createAgent !== 'function') throw new TypeError('createAgent is required.');
  if (
    !Number.isFinite(leaseMs) ||
    leaseMs < 100 ||
    !Number.isFinite(maxDurationMs) ||
    maxDurationMs < leaseMs ||
    !Number.isInteger(maxSessions) ||
    maxSessions < 1
  )
    throw new TypeError('Invalid session limits.');
  // Validate at startup before accepting requests, using placeholder session identities.
  agoraEndpoint({ baseURL, channel: 'validation', uid: 1 });
  createWhipToken({ appId, certificate, channel: 'validation', uid: 1, lifetime: tokenLifetime });
  const records = new Map();
  let closing = false;

  function lookup(id, owner, open = true) {
    const record = records.get(id);
    if (!record || record.owner !== owner) throw new ServiceError(404, 'SESSION_NOT_FOUND');
    if (open && (record.closing || record.expiresAt <= now() || record.deadline <= now())) {
      void stopRecord(record).catch(() => {});
      throw new ServiceError(410, 'SESSION_ENDED');
    }
    return record;
  }

  function lease(record) {
    return {
      expiresAt: record.expiresAt,
      renewAfterMs: Math.max(1, Math.floor((record.expiresAt - now()) / 3)),
    };
  }

  function token(record) {
    return createWhipToken({
      appId,
      certificate,
      channel: record.channel,
      uid: record.uid,
      lifetime: tokenLifetime,
      now: now(),
    });
  }

  function stopRecord(record) {
    record.closing = true;
    if (record.stopped) return Promise.resolve();
    if (record.stopPromise) return record.stopPromise;
    record.stopPromise = Promise.resolve()
      .then(async () => {
        // A delayed start must finish before stopping its returned cloud resource.
        if (record.startPromise) {
          try {
            await record.startPromise;
          } catch {
            /* No confirmed start. */
          }
        }
        if (record.agent) await record.agent.stop();
        record.stopped = true;
        record.closedAt = now();
      })
      .finally(() => {
        record.stopPromise = null;
      });
    return record.stopPromise;
  }

  return {
    createSession(owner) {
      if (closing) throw new ServiceError(503, 'SERVER_STOPPING');
      if (
        records.size >= maxSessions * 4 ||
        [...records.values()].filter((r) => !r.stopped).length >= maxSessions
      ) {
        throw new ServiceError(429, 'SESSION_LIMIT');
      }
      const id = randomUUID();
      const { uid, botUid } = participantUids();
      const record = {
        id,
        owner,
        channel: `aiui-${id}`,
        uid,
        botUid,
        expiresAt: now() + leaseMs,
        deadline: now() + maxDurationMs,
        closing: false,
        stopped: false,
      };
      records.set(id, record);
      return {
        id,
        whip: { baseURL, channel: record.channel, uid, stringUid: `aiui-${uid}`, ...token(record) },
        lease: lease(record),
      };
    },

    async startAgent(id, owner) {
      const record = lookup(id, owner);
      if (!record.startPromise) {
        // Assign before invoking external code to make concurrent starts idempotent.
        record.startPromise = Promise.resolve().then(async () => {
          if (record.closing || record.expiresAt <= now())
            throw new ServiceError(410, 'SESSION_ENDED');
          record.agent = createAgent({
            sessionId: id,
            channel: record.channel,
            uid: record.uid,
            botUid: record.botUid,
            maxDurationSeconds: Math.ceil(maxDurationMs / 1000),
          });
          await record.agent.start();
        });
      }
      try {
        await record.startPromise;
      } catch {
        void stopRecord(record).catch(() => {});
        throw new ServiceError(502, 'AGENT_START_FAILED');
      }
      if (record.closing) throw new ServiceError(410, 'SESSION_ENDED');
      return { agent: 'running' };
    },

    async stopSession(id, owner) {
      const record = lookup(id, owner, false);
      try {
        await stopRecord(record);
      } catch {
        throw new ServiceError(502, 'AGENT_STOP_UNCONFIRMED');
      }
      return { stopped: true };
    },

    renewSession(id, owner) {
      const record = lookup(id, owner);
      record.expiresAt = Math.min(now() + leaseMs, record.deadline);
      return { lease: lease(record) };
    },

    refreshToken(id, owner) {
      return token(lookup(id, owner));
    },

    async sweep() {
      const jobs = [];
      for (const [id, record] of records) {
        if (record.stopped && now() - record.closedAt >= leaseMs) records.delete(id);
        else if (
          !record.stopped &&
          (record.closing || record.expiresAt <= now() || record.deadline <= now())
        ) {
          jobs.push(stopRecord(record));
        }
      }
      return Promise.allSettled(jobs);
    },

    async close() {
      closing = true;
      const results = await Promise.allSettled([...records.values()].map(stopRecord));
      if (results.some((result) => result.status === 'rejected'))
        throw new ServiceError(502, 'AGENT_STOP_UNCONFIRMED');
    },
  };
}
