import { getCallCopy } from './copy.js';

/** Playback, cloud thinking and confirmed interruption remain separate signals. */
export function presentCall(state = {}, speaking = false, feedback = {}, provider = 'agora') {
  const copy = getCallCopy(provider);
  const active = ['starting', 'running', 'stopping'].includes(state.lifecycle);
  const busy = state.lifecycle === 'starting' || state.lifecycle === 'stopping';
  const connected =
    state.media === 'connected' && active && state.lifecycle !== 'stopping' && !state.error;
  let phase = 'idle';

  if (state.error || state.lifecycle === 'failed') phase = 'failed';
  else if (state.lifecycle === 'stopping') phase = 'stopping';
  else if (state.lifecycle === 'stopped') phase = 'stopped';
  else if (state.media === 'disconnected' && active) phase = 'recovering';
  else if (state.lifecycle === 'starting') phase = 'connecting';
  else if (state.lifecycle === 'running') {
    if (!connected) phase = 'recovering';
    else if (state.audio !== 'running') phase = 'paused';
    else if (state.speakerMuted) phase = 'quiet';
    else if (feedback.interrupted) phase = 'interrupted';
    else if (speaking) phase = 'speaking';
    else if (state.microphoneMuted) phase = 'muted';
    else if (feedback.thinking) phase = 'thinking';
    else phase = 'listening';
  }

  const canControl = state.lifecycle === 'running' && connected;
  const orbAction = !active
    ? 'start'
    : phase === 'paused'
      ? 'resume'
      : canControl && state.speakerMuted
        ? 'soundOn'
        : canControl && !state.microphoneSuppressed
          ? state.microphoneMuted
            ? 'unmute'
            : 'mute'
          : '';

  return {
    ...copy.phases[phase],
    hint:
      phase === 'failed'
        ? (copy.errors[state.error?.code] ?? copy.phases.failed.hint)
        : copy.phases[phase].hint,
    phase,
    active,
    busy,
    connected,
    canControl,
    orbAction,
    orbLabel: orbAction ? copy[orbAction] : copy.phases[phase].title,
    canResume: phase === 'paused',
    cloud: copy.cloud,
  };
}

/** Keep only the latest user's cumulative ASR and the newest interrupted AI turn. */
export function readConversation(messages, columns = 24) {
  let text = '';
  let interruptedKey = '';
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!text && message.role === 'user') text = message.text.trim();
    if (
      !interruptedKey &&
      message.role === 'assistant' &&
      (message.interrupted || message.status === 'interrupted')
    )
      interruptedKey = message.id;
    if (text && interruptedKey) break;
  }
  const characters = Array.from(text.replace(/\s+/g, ' '));
  const limit = Math.max(8, Math.floor(columns));
  return {
    userLine:
      characters.length > limit
        ? `…${characters.slice(-(limit - 1)).join('')}`
        : characters.join(''),
    interruptedKey,
  };
}

/** Keep the page update small: unchanged text and audio feedback need no new binding work. */
export function changedFields(current, next) {
  const changed = {};
  for (const key of Object.keys(next)) {
    if (current[key] !== next[key]) changed[key] = next[key];
  }
  return changed;
}

/** Smooth each direction separately so speaking over the AI still lights the input glow. */
export function audioFeedback(state, levels, previous = { input: 0, output: 0 }, elapsed = 160) {
  const running =
    state.lifecycle === 'running' && state.media === 'connected' && state.audio === 'running';
  const energy = (level) =>
    Number.isFinite(level) ? Math.max(0, Math.min(1, (level + 52) / 28)) : 0;
  const input =
    running && !state.microphoneMuted && !state.microphoneSuppressed ? energy(levels.local) : 0;
  const output = running && !state.speakerMuted ? energy(levels.remote) : 0;
  const smooth = (value, target) =>
    value + (target - value) * (1 - Math.exp(-Math.max(0, elapsed) / (target > value ? 180 : 550)));
  return { input: smooth(previous.input, input), output: smooth(previous.output, output) };
}
