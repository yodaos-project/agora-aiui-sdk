const COPY = {
  idle: { title: '嗨，想聊点什么？', hint: '我是小语，你的语音伙伴。' },
  connecting: { title: '稍等，这就来。', hint: '正在为你接通语音…' },
  ready: { title: '我在，慢慢说。', hint: '直接开口，就像和朋友聊天。' },
  speaking: { title: '正在回应你', hint: '听听小语怎么说。' },
  muted: { title: '安静陪你一会儿。', hint: '麦克风已静音，想说话时再打开。' },
  quiet: { title: '声音暂时关掉了。', hint: '打开扬声器，就能听见回答。' },
  paused: { title: '我们暂停一下。', hint: '回到前台后，点这里继续聊天。' },
  recovering: { title: '稍等一下。', hint: '连接中断了，正在等待恢复。' },
  stopping: { title: '下次再聊。', hint: '正在结束这次通话…' },
  stopped: { title: '下次再聊。', hint: '想说话时，我还在这里。' },
  failed: { title: '连接遇到点问题。', hint: '检查网络和配置，再试一次。' },
};

const ERRORS = {
  MICROPHONE: '请允许使用麦克风，再试一次。',
  AUDIO: '请回到前台，检查声音后再试。',
  UNSUPPORTED: '当前宿主尚未提供所需的语音能力。',
  BACKEND: '暂时联系不上服务，请稍后重试。',
  AGENT: '语音伙伴暂时没接通，请稍后重试。',
  LEASE: '会话已中断，可以重新开始聊天。',
};

/** Present transport and playback separately; speaking is measured audio activity, not an AI event. */
export function presentCall(state = {}, speaking = false) {
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
    else if (speaking) phase = 'speaking';
    else if (state.microphoneMuted) phase = 'muted';
    else phase = 'ready';
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

/** Keep the page update small: unchanged text and audio bars need no new binding work. */
export function changedFields(current, next) {
  const changed = {};
  for (const key of Object.keys(next)) {
    if (current[key] !== next[key]) changed[key] = next[key];
  }
  return changed;
}
