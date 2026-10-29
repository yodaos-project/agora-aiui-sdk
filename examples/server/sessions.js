import { randomUUID } from 'node:crypto';
import agoraToken from 'agora-token';
import { agoraEndpoint, isAgoraUid } from '../../src/agora.js';
import { createWhipToken } from './token.js';

/** Allocate distinct string accounts for the client and the cloud agent. */
export function participantUids(id = randomUUID()) {
  const uid = `aiui-${id}`;
  const botUid = `agent-${id}`;
  if (typeof id !== 'string' || !id || !isAgoraUid(uid) || !isAgoraUid(botUid)) {
    throw new RangeError('Participant IDs must produce valid string accounts.');
  }
  return { uid, botUid };
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
  agoraEndpoint({ baseURL, channel: 'validation', uid: 'aiui-validation' });
  createWhipToken({
    appId,
    certificate,
    channel: 'validation',
    uid: 'aiui-validation',
    lifetime: tokenLifetime,
  });
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

  function rtmToken(record) {
    const token = agoraToken.RtcTokenBuilder.buildTokenWithRtm(
      appId,
      certificate,
      record.channel,
      record.uid,
      agoraToken.RtcRole.PUBLISHER,
      tokenLifetime,
      tokenLifetime,
    );
    if (!token) throw new ServiceError(500, 'TOKEN_FAILED');
    return { token, tokenExpiresAt: now() + tokenLifetime * 1000 };
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
      const { uid, botUid } = participantUids(id);
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
        whip: { baseURL, channel: record.channel, uid, ...token(record) },
        rtm: {
          appId,
          channel: record.channel,
          userId: record.uid,
          agentUserId: record.botUid,
          ...rtmToken(record),
        },
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

    async getTranscripts(id, owner) {
      const record = lookup(id, owner);
      if (typeof record.agent?.getTranscripts !== 'function') {
        throw new ServiceError(501, 'TRANSCRIPTS_UNAVAILABLE');
      }
      try {
        if (!record.transcriptPromise) {
          record.transcriptPromise = Promise.resolve()
            .then(() => record.agent.getTranscripts())
            .finally(() => {
              record.transcriptPromise = null;
            });
        }
        const transcripts = await record.transcriptPromise;
        lookup(id, owner);
        return { transcripts };
      } catch (error) {
        if (error instanceof ServiceError) throw error;
        throw new ServiceError(502, 'TRANSCRIPTS_UNAVAILABLE');
      }
    },

    renewSession(id, owner) {
      const record = lookup(id, owner);
      record.expiresAt = Math.min(now() + leaseMs, record.deadline);
      return { lease: lease(record) };
    },

    refreshToken(id, owner) {
      return token(lookup(id, owner));
    },

    refreshRtmToken(id, owner) {
      return rtmToken(lookup(id, owner));
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
