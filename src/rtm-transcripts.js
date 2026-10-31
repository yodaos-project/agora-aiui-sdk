import { AgoraVoiceError, acquire, checkSignal, positiveMilliseconds } from './errors.js';
import { transcriptSnapshot } from './transcripts.js';

const FRAME_LIMIT = 64 * 1024;
const textError = () =>
  new AgoraVoiceError('TRANSCRIPTS', 'Live conversation text is unavailable.');

/** Fold cumulative RTM updates into bounded turns, without inferring audio playback timing. */
export function createTranscriptReducer() {
  let messages = [];
  const sequences = new Map();
  const interruptedTurns = new Set();
  let evictedThrough = -1;
  return (message) => {
    const turn = message?.turn_id;
    if (!Number.isSafeInteger(turn) || turn < 0) return null;
    const interrupted = message.object === 'message.interrupt';
    const role = message.object === 'user.transcription' ? 'user' : 'assistant';
    if (!interrupted && !['user.transcription', 'assistant.transcription'].includes(message.object))
      return null;
    const stream = Number.isSafeInteger(message.stream_id) ? message.stream_id : 0;
    const id = `${role}:${turn}:${stream}`;
    const index = messages.findIndex((entry) => entry.id === id);
    if (!interrupted && index < 0 && turn <= evictedThrough) return null;
    const previous = messages[index];
    if (interrupted) {
      interruptedTurns.add(turn);
      if (interruptedTurns.size > 20)
        interruptedTurns.delete(interruptedTurns.values().next().value);
      let changed = false;
      messages = messages.map((entry) => {
        if (!entry.id.startsWith(`assistant:${turn}:`) || entry.interrupted) return entry;
        changed = true;
        return { ...entry, interrupted: true, status: 'interrupted' };
      });
      return changed ? transcriptSnapshot(messages) : null;
    }
    if (role === 'assistant' && interruptedTurns.has(turn)) return null;
    if (typeof message.text !== 'string') return null;
    const status =
      role === 'user'
        ? message.final === true
          ? 'final'
          : 'in-progress'
        : message.turn_status === 2
          ? 'interrupted'
          : message.turn_status === 1
            ? 'final'
            : 'in-progress';
    const sequence = message.turn_seq_id;
    if (Number.isSafeInteger(sequence) && sequence < (sequences.get(id) ?? -1)) return null;
    if (
      previous?.status === 'interrupted' ||
      (previous?.status === 'final' && status === 'in-progress')
    )
      return null;
    const text = message.text.slice(0, 2000);
    if (!text.trim()) return null;
    if (Number.isSafeInteger(sequence)) sequences.set(id, sequence);
    if (previous?.text === text && previous.status === status) return null;
    const next = { id, role, text, status, interrupted: status === 'interrupted' };
    if (index < 0) messages.push(next);
    else messages[index] = next;
    messages.sort(
      (a, b) =>
        Number(a.id.split(':')[1]) - Number(b.id.split(':')[1]) ||
        (a.role === b.role ? 0 : a.role === 'user' ? -1 : 1),
    );
    const before = messages;
    messages = [...transcriptSnapshot(messages)];
    const retained = new Set(messages.map((entry) => entry.id));
    for (const entry of before)
      if (!retained.has(entry.id))
        evictedThrough = Math.max(evictedThrough, Number(entry.id.split(':')[1]));
    for (const key of sequences.keys()) if (!retained.has(key)) sequences.delete(key);
    return transcriptSnapshot(messages);
  };
}

/** Use an injected official RTM constructor; audio remains on Ink WHIP/WebRTC. */
export function createAgoraRtmTranscripts({ RTM, timeout } = {}) {
  if (typeof RTM !== 'function') throw new TypeError('Provide the official Agora RTM constructor.');
  const deadline = positiveMilliseconds(timeout, 15000, 'RTM timeout');
  let cachedClient;
  let cachedIdentity;
  let inUse = false;
  return Object.freeze({
    connect({ connection, signal, onUpdate, onState, onActivity }) {
      if (
        !connection ||
        ['appId', 'userId', 'agentUserId', 'channel'].some(
          (key) => typeof connection[key] !== 'string' || !connection[key],
        ) ||
        !['string', 'function'].includes(typeof connection.token)
      )
        throw new TypeError('The backend must provide RTM credentials.');
      if (inUse) throw new TypeError('Stop the previous RTM subscription before starting another.');
      const controller = new AbortController();
      const fold = createTranscriptReducer();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const frameBytes = new Uint8Array(FRAME_LIMIT);
      const identity = JSON.stringify([connection.appId, connection.userId]);
      if (cachedIdentity !== identity) {
        cachedClient = new RTM(connection.appId, connection.userId, {
          logLevel: 'none',
          logUpload: false,
          useStringUserId: true,
        });
        cachedIdentity = identity;
      }
      // RTM 2.3.0 rejects a second constructor for the same account even after logout.
      // Keep only the most recent client; rotating reservation IDs do not grow a pool.
      const client = cachedClient;
      inUse = true;
      const listeners = [];
      let closed = false;
      let closing;
      let timer;
      let renewal;
      const state = (status) => {
        if (!closed) onState({ status, error: status === 'failed' ? textError() : null });
      };
      const listen = (name, callback) => {
        client.addEventListener(name, callback);
        listeners.push(() => client.removeEventListener(name, callback));
      };
      const getToken = async () => {
        const token = await acquire(
          typeof connection.token === 'function'
            ? connection.token({ signal: controller.signal })
            : connection.token,
          controller.signal,
        );
        if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) throw textError();
        return token;
      };
      const abort = () => {
        void close().catch(() => {});
      };
      function close() {
        if (closing) return closing;
        closed = true;
        if (timer != null) clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        controller.abort();
        for (const remove of listeners.splice(0)) remove();
        // The official RTM logout also cancels a pending login/reconnect.
        closing = Promise.resolve()
          .then(() => client.logout())
          .finally(() => {
            inUse = false;
          });
        return closing;
      }
      listen('message', (event) => {
        if (closed || event.publisher !== connection.agentUserId) return;
        if (event.channelType !== 'USER' && event.channelName !== connection.channel) return;
        try {
          let data = event.message;
          if (typeof data === 'string') {
            if (
              data.length > FRAME_LIMIT ||
              encoder.encodeInto(data, frameBytes).read !== data.length
            )
              return;
          } else {
            if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) return;
            if (data.byteLength > FRAME_LIMIT) return;
            data = decoder.decode(data);
          }
          const message = JSON.parse(data);
          if (
            message.object === 'user.transcription' &&
            message.user_id != null &&
            String(message.user_id) !== connection.userId
          )
            return;
          const snapshot = fold(message);
          if (snapshot) onUpdate(snapshot);
        } catch {
          /* Ignore unrelated or malformed RTM messages. */
        }
      });
      listen('linkState', (event) => {
        if (event.currentState === 'CONNECTED') state('connected');
        else if (event.currentState === 'FAILED') state('failed');
        else if (['DISCONNECTED', 'SUSPENDED', 'CONNECTING'].includes(event.currentState))
          state('disconnected');
      });
      listen('presence', (event) => {
        if (
          closed ||
          event.publisher !== connection.agentUserId ||
          event.channelName !== connection.channel
        )
          return;
        const changed = event.stateChanged;
        if (!changed) return;
        const activity = {};
        for (const key of ['listening', 'thinking', 'speaking']) {
          if (changed[key] === true || changed[key] === 'true') activity[key] = true;
          else if (changed[key] === false || changed[key] === 'false') activity[key] = false;
        }
        if (['listening', 'thinking', 'speaking', 'idle', 'silent'].includes(changed.state)) {
          if (activity.thinking === undefined) activity.thinking = changed.state === 'thinking';
          if (activity.speaking === undefined) activity.speaking = changed.state === 'speaking';
        }
        if (Object.keys(activity).length) onActivity?.(activity);
      });
      listen('tokenPrivilegeWillExpire', () => {
        if (closed || renewal) return;
        if (typeof connection.token !== 'function') {
          state('failed');
          return;
        }
        renewal = getToken()
          .then((token) => {
            checkSignal(controller.signal);
            return client.renewToken(token);
          })
          .catch(() => state('failed'))
          .finally(() => {
            renewal = null;
          });
      });
      state('connecting');
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      timer = setTimeout(() => {
        state('failed');
        abort();
      }, deadline);
      const ready = (async () => {
        try {
          checkSignal(controller.signal);
          const token = await getToken();
          await acquire(client.login({ token }), controller.signal);
          checkSignal(controller.signal);
          await acquire(
            client.subscribe(connection.channel, {
              withMessage: true,
              withPresence: true,
              withMetadata: false,
              withLock: false,
            }),
            controller.signal,
          );
          checkSignal(controller.signal);
          state('connected');
        } catch {
          state('failed');
          abort();
          throw textError();
        } finally {
          if (timer != null) clearTimeout(timer);
        }
      })();
      return Object.freeze({ ready, close });
    },
  });
}
