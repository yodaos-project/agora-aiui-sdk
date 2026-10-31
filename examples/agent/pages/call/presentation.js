const COPY = {
  idle: { title: '准备好了', hint: '开始一段对话' },
  connecting: { title: '正在连接', hint: '马上就好…' },
  listening: { title: '正在聆听', hint: '说点什么，我在听' },
  thinking: { title: '正在思考', hint: '正在想你的问题' },
  speaking: { title: '正在说话', hint: '你可以随时插话' },
  interrupted: { title: '已打断', hint: '我在听，你继续说' },
  muted: { title: '麦克风已关', hint: '打开麦克风，继续聊天' },
  quiet: { title: '声音已关', hint: '打开扬声器，听见回答' },
  paused: { title: '播放已暂停', hint: '回到前台，继续聊天' },
  recovering: { title: '正在重连', hint: '等待音频连接恢复…' },
  stopping: { title: '正在结束', hint: '下次再聊' },
  stopped: { title: '对话已结束', hint: '想说话时，我还在' },
  failed: { title: '连接失败', hint: '检查网络和配置，再试一次' },
};

const ERRORS = {
  MICROPHONE: '请允许使用麦克风，再试一次。',
  AUDIO: '请回到前台，检查声音后再试。',
  UNSUPPORTED: '当前宿主尚未提供所需的语音能力。',
  BACKEND: '暂时联系不上服务，请稍后重试。',
  AGENT: '语音伙伴暂时没接通，请稍后重试。',
  LEASE: '会话已中断，可以重新开始聊天。',
};

/** Playback, cloud thinking and confirmed interruption remain separate signals. */
export function presentCall(state = {}, speaking = false, feedback = {}) {
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

  return {
    ...COPY[phase],
    hint: phase === 'failed' ? (ERRORS[state.error?.code] ?? COPY.failed.hint) : COPY[phase].hint,
    phase,
    active,
    busy,
    connected,
    canControl: state.lifecycle === 'running' && connected,
    canResume: phase === 'paused',
    cloud: state.error
      ? 'Agora · 未连接'
      : connected
        ? 'Agora · 已连接'
        : phase === 'recovering'
          ? 'Agora · 等待恢复'
          : phase === 'connecting'
            ? 'Agora · 连接中'
            : 'Agora Cloud',
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

/** Keep the page update small: unchanged text and audio bars need no new binding work. */
export function changedFields(current, next) {
  const changed = {};
  for (const key of Object.keys(next)) {
    if (current[key] !== next[key]) changed[key] = next[key];
  }
  return changed;
}
