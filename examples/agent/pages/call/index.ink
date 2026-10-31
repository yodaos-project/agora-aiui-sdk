<script setup>
  import { createAgoraVoiceSession } from '../../lib/sdk/session.js';
  import { createHttpVoiceBackend } from '../../lib/sdk/http-backend.js';
  import { createWorkerTranscripts } from '../../lib/transcript-channel.js';
  import configuration from '../../configuration.js';
  import { changedFields, presentCall, readConversation } from './presentation.js';

  export default {
    data: {
      ...presentCall(),
      micMuted: false,
      micSuppressed: false,
      speakerMuted: false,
      clock: '00:00',
      bar1: 3,
      bar2: 3,
      bar3: 3,
      orbScale: 1,
      userLine: '',
      transcriptNote: '',
    },
    onLoad() {
      this.unloaded = false;
      this.cloudActivity = {};
      this.backend = createHttpVoiceBackend({
        baseURL: configuration.backendURL,
        authorization: configuration.authorization,
      });
      const source = createWorkerTranscripts((options) => this.connectWorker('transcripts', options));
      // Observe the existing source contract and preserve the SDK's activity callback.
      this.transcriptSource = {
        connect: (options) =>
          source.connect({
            ...options,
            onActivity: (activity) => {
              options.onActivity?.(activity);
              if (this.unloaded || options.signal.aborted) return;
              this.cloudActivity = { ...this.cloudActivity, ...activity };
              if (this.voice) this.refreshAudio(this.voice);
            },
          }),
      };
    },
    onUnload() {
      this.unloaded = true;
      this.clearLevelTimer();
      this.clearTranscripts();
      if (this.voice && this.update) this.voice.removeEventListener('statechange', this.update);
      void this.voice?.stop();
    },
    clearLevelTimer() {
      if (this.levelTimer != null) clearInterval(this.levelTimer);
      this.levelTimer = null;
    },
    renderCall(state, speaking = false, bars = [3, 3, 3], energy = 0) {
      const elapsed = this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0;
      const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const seconds = String(elapsed % 60).padStart(2, '0');
      if (Date.now() < (this.interruptedUntil || 0)) bars = [3, 3, 3];
      const patch = changedFields(this.data, {
        ...presentCall(state, speaking, {
          thinking: this.cloudActivity?.thinking,
          interrupted: Date.now() < (this.interruptedUntil || 0),
        }),
        micMuted: state.microphoneMuted,
        micSuppressed: state.microphoneSuppressed,
        speakerMuted: state.speakerMuted,
        clock: `${minutes}:${seconds}`,
        bar1: bars[0],
        bar2: bars[1],
        bar3: bars[2],
        orbScale: 1 + Math.round(energy * 8) / 100,
      });
      if (Object.keys(patch).length) this.setData(patch);
    },
    async connect() {
      if (this.unloaded || this.data.active || this.data.busy) return;
      this.clearLevelTimer();
      this.clearTranscripts();
      if (this.voice && this.update) this.voice.removeEventListener('statechange', this.update);
      this.setData({ userLine: '', transcriptNote: '' });
      this.cloudActivity = {};
      this.interruptedUntil = 0;
      this.interruptedKey = '';
      this.startedAt = 0;
      this.speakingUntil = 0;
      const voice = createAgoraVoiceSession({
        backend: this.backend,
        timeout: 45000,
        transcripts: this.transcriptSource,
        microphoneMode: configuration.microphoneMode ?? 'full-duplex',
      });
      this.voice = voice;
      this.update = () => {
        if (this.unloaded || this.voice !== voice) return;
        const state = voice.getState();
        if (state.lifecycle !== 'running') {
          this.clearLevelTimer();
          if (['stopping', 'stopped', 'failed'].includes(state.lifecycle)) this.clearTranscripts();
          this.speakingUntil = 0;
        }
        this.renderCall(state, Date.now() < this.speakingUntil);
      };
      voice.addEventListener('statechange', this.update);
      this.transcriptUpdate = () => this.refreshTranscripts(voice);
      this.transcriptStateUpdate = () => this.refreshTranscripts(voice);
      voice.addEventListener('transcriptchange', this.transcriptUpdate);
      voice.addEventListener('transcriptstatechange', this.transcriptStateUpdate);
      try {
        await voice.start();
        if (this.unloaded || this.voice !== voice || voice.getState().lifecycle !== 'running')
          return;
        this.startedAt = Date.now();
        this.levelTimer = setInterval(() => this.refreshAudio(voice), 160);
        this.refreshAudio(voice);
        this.refreshTranscripts(voice);
      } catch {
        if (this.voice === voice) this.update();
      }
    },
    refreshAudio(voice) {
      if (this.unloaded || this.voice !== voice) return;
      const state = voice.getState();
      const audible = state.audio === 'running' && state.media === 'connected';
      const levels = audible ? voice.getAudioLevels() : { local: -60, remote: -60 };
      if (audible && !state.speakerMuted && levels.remote > -46)
        this.speakingUntil = Date.now() + 450;
      if (!audible || state.speakerMuted) this.speakingUntil = 0;
      const speaking = Date.now() < this.speakingUntil;
      const level = speaking
        ? levels.remote
        : state.microphoneMuted || state.microphoneSuppressed
          ? -60
          : levels.local;
      const energy = audible ? Math.max(0, Math.min(1, (level + 55) / 35)) : 0;
      this.renderCall(
        state,
        speaking,
        [3 + Math.round(energy * 8), 3 + Math.round(energy * 16), 3 + Math.round(energy * 24)],
        energy,
      );
    },
    clearTranscripts() {
      if (this.transcriptUpdate)
        this.voice?.removeEventListener('transcriptchange', this.transcriptUpdate);
      if (this.transcriptStateUpdate)
        this.voice?.removeEventListener('transcriptstatechange', this.transcriptStateUpdate);
      this.transcriptUpdate = null;
      this.transcriptStateUpdate = null;
    },
    refreshTranscripts(voice) {
      if (this.unloaded || this.voice !== voice) return;
      const state = voice.getTranscriptState();
      if (['failed', 'disconnected', 'closed'].includes(state.status)) this.cloudActivity = {};
      const columns = Math.max(
        12,
        Math.min(24, Math.floor(((window.innerWidth || 448) - 48) / 17)),
      );
      const { userLine, interruptedKey } = readConversation(voice.getTranscriptSnapshot(), columns);
      if (interruptedKey && interruptedKey !== this.interruptedKey) {
        this.interruptedKey = interruptedKey;
        this.interruptedUntil = Date.now() + 1200;
        this.speakingUntil = 0;
        this.cloudActivity = {};
      }
      const patch = changedFields(this.data, {
        userLine,
        transcriptNote:
          state.status === 'failed'
            ? '实时文字暂不可用，语音可以继续'
            : state.status === 'disconnected'
              ? '文字连接恢复中…'
              : '',
      });
      if (Object.keys(patch).length) this.setData(patch);
      this.refreshAudio(voice);
    },
    toggleMicrophone() {
      if (this.data.canControl) this.voice?.setMicrophoneMuted(!this.data.micMuted);
    },
    toggleSpeaker() {
      if (this.data.canControl) this.voice?.setSpeakerMuted(!this.data.speakerMuted);
    },
    async resumeAudio() {
      const voice = this.voice;
      if (!this.data.canResume || !voice) return;
      try {
        await voice.resumeAudio();
      } catch {
        if (!this.unloaded && this.voice === voice && this.data.canResume)
          this.setData({ hint: '请回到前台，再点击继续聊天' });
      }
    },
    stop() {
      this.clearLevelTimer();
      this.clearTranscripts();
      void this.voice?.stop();
    },
  };
</script>
<page>
  <view class="screen state-{{phase}}">
    <view class="header">
      <view class="identity">
        <text class="name">小语</text>
        <text class="activity">{{title}}</text>
      </view>
      <view class="connection {{connected ? 'online' : ''}}">
        <view class="connection-dot"></view>
        <text class="cloud">{{cloud}}</text>
        <text class="clock">{{connected ? clock : ''}}</text>
      </view>
    </view>

    <view class="presence">
      <view class="orb-envelope" style="transform: scale({{orbScale}});">
        <view class="orb-halo"></view>
        <view class="orb-orbit"></view>
        <view class="orb">
          <view class="orb-light"></view>
          <view class="orb-fluid"></view>
          <view class="orb-tide"></view>
          <view class="orb-glint"></view>
          <view ink:if="{{phase === 'thinking' || phase === 'connecting'}}" class="thought">
            <view class="thought-dot dot-one"></view>
            <view class="thought-dot dot-two"></view>
            <view class="thought-dot dot-three"></view>
          </view>
          <view ink:else class="wave">
            <view class="wave-bar" style="transform: scaleY({{bar1 / 30}});"></view>
            <view class="wave-bar" style="transform: scaleY({{bar2 / 30}});"></view>
            <view class="wave-bar" style="transform: scaleY({{bar3 / 30}});"></view>
            <view class="wave-bar" style="transform: scaleY({{bar2 / 30}});"></view>
            <view class="wave-bar" style="transform: scaleY({{bar1 / 30}});"></view>
          </view>
        </view>
        <view ink:if="{{phase === 'interrupted'}}" class="interrupt-ring"></view>
      </view>
    </view>

    <text class="user-line {{userLine && !transcriptNote ? 'has-speech' : ''}}"
      >{{phase === 'failed' || phase === 'paused' || phase === 'recovering' ? hint : transcriptNote
      || userLine || hint}}</text
    >

    <view ink:if="{{active}}" class="controls">
      <button
        ink:if="{{canControl}}"
        class="control {{micMuted || micSuppressed ? 'is-muted' : ''}}"
        disabled="{{!canControl || micSuppressed}}"
        bindtap="toggleMicrophone"
      >
        <image
          ink:if="{{!micSuppressed}}"
          class="control-icon"
          src="{{micMuted || micSuppressed ? '/assets/microphone-off.svg' : '/assets/microphone.svg'}}"
          mode="aspectFit"
        />
        <text>{{micSuppressed ? '等我说完' : micMuted ? '开麦' : '静音'}}</text>
      </button>
      <button class="control end" disabled="{{phase === 'stopping'}}" bindtap="stop">
        <image class="control-icon" src="/assets/end.svg" mode="aspectFit" />
        <text>{{phase === 'connecting' ? '取消' : '结束'}}</text>
      </button>
      <button ink:if="{{canResume}}" class="resume" bindtap="resumeAudio">
        <text>继续聊天</text>
      </button>
      <button
        ink:if="{{canControl && !canResume}}"
        class="control {{speakerMuted ? 'is-muted' : ''}}"
        bindtap="toggleSpeaker"
      >
        <image
          class="control-icon"
          src="{{speakerMuted ? '/assets/speaker-off.svg' : '/assets/speaker.svg'}}"
          mode="aspectFit"
        />
        <text>{{speakerMuted ? '开声音' : '声音'}}</text>
      </button>
    </view>
    <view ink:else class="controls">
      <button class="start" disabled="{{busy}}" bindtap="connect">
        <image class="control-icon" src="/assets/call.svg" mode="aspectFit" />
        <text
          >{{phase === 'failed' ? '重新连接' : phase === 'stopped' ? '再聊一会儿' :
          '开始聊天'}}</text
        >
      </button>
    </view>
  </view>
</page>
<style>
  .screen {
    width: 100%;
    height: 100vh;
    box-sizing: border-box;
    padding: 20px 24px;
    gap: 14px;
    flex-direction: column;
    background-color: var(--color-background);
    color: var(--color-text-primary);
  }
  .header,
  .identity,
  .connection,
  .controls {
    flex-direction: row;
    align-items: center;
  }
  .header {
    width: 100%;
    min-height: 20px;
    flex-shrink: 0;
    justify-content: space-between;
  }
  .identity {
    gap: 10px;
  }
  .name {
    font-size: 14px;
    color: var(--color-text-secondary);
  }
  .activity {
    font-size: 14px;
    font-weight: 500;
    color: var(--color-primary);
  }
  .connection {
    gap: 5px;
  }
  .connection-dot {
    width: 4px;
    height: 4px;
    border-radius: 2px;
    background-color: var(--color-text-secondary);
  }
  .cloud,
  .clock {
    font-size: 14px;
    color: var(--color-text-secondary);
  }
  .clock {
    margin-left: 4px;
  }
  .online .connection-dot {
    background-color: var(--color-secondary);
  }
  .presence {
    flex: 1;
    min-height: 0;
    align-items: center;
    justify-content: center;
  }
  .orb-envelope {
    position: relative;
    width: 108px;
    height: 108px;
    flex-shrink: 0;
    transition: transform 160ms ease-out;
  }
  .orb-halo {
    position: absolute;
    width: 160%;
    height: 160%;
    left: -30%;
    top: -30%;
    border-radius: 50%;
    background-image: radial-gradient(
      circle at center,
      var(--color-primary-40) 0%,
      transparent 68%
    );
    opacity: 0.7;
    animation: aura-breathe 3.6s ease-in-out infinite alternate;
  }
  .orb-orbit {
    position: absolute;
    top: -8%;
    left: -8%;
    width: 116%;
    height: 116%;
    border-radius: 50%;
    border: 1px solid var(--color-primary-40);
    opacity: 0.5;
    animation: orbit-breathe 3.6s ease-in-out infinite alternate;
  }
  .orb {
    position: absolute;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    overflow: hidden;
    align-items: center;
    justify-content: center;
    background-color: var(--color-primary);
  }
  .orb-light {
    position: absolute;
    width: 100%;
    height: 100%;
    left: 0;
    top: 0;
    background-image: radial-gradient(
      circle at 35% 25%,
      var(--color-text-primary) 0%,
      var(--color-primary) 45%,
      var(--color-background) 100%
    );
  }
  .orb-fluid {
    position: absolute;
    width: 140%;
    height: 140%;
    left: -20%;
    top: -20%;
    background-image: radial-gradient(
      ellipse at 20% 45%,
      var(--color-secondary) 0%,
      transparent 62%
    );
    animation: fluid-drift 7s ease-in-out infinite alternate;
  }
  .orb-tide {
    position: absolute;
    width: 130%;
    height: 130%;
    left: -15%;
    top: -15%;
    background-image: radial-gradient(
      ellipse at 65% 75%,
      var(--color-text-primary) 0%,
      transparent 55%
    );
    opacity: 0.7;
    animation: fluid-drift 5s ease-in-out infinite alternate-reverse;
  }
  .orb-glint {
    position: absolute;
    width: 100%;
    height: 100%;
    left: 0;
    top: 0;
    border-radius: 50%;
    border: 1px solid var(--color-primary-60);
    opacity: 0.8;
  }
  .wave,
  .thought {
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 34px;
  }
  .wave-bar {
    width: 4px;
    height: 30px;
    border-radius: 3px;
    background-color: var(--color-background);
    opacity: 0.78;
    transition: transform 140ms ease-out;
  }
  .thought-dot {
    width: 4px;
    height: 4px;
    border-radius: 2px;
    background-color: var(--color-background);
    animation: thought-pulse 900ms ease-in-out infinite alternate;
  }
  .dot-two {
    animation-delay: 200ms;
  }
  .dot-three {
    animation-delay: 400ms;
  }
  .state-thinking .orb-fluid,
  .state-connecting .orb-fluid {
    animation: fluid-turn 1.8s linear infinite;
  }
  .state-thinking .orb-orbit,
  .state-connecting .orb-orbit {
    animation: orbit-breathe 900ms ease-in-out infinite alternate;
  }
  .state-speaking .orb-fluid {
    animation: fluid-drift 1.4s ease-in-out infinite alternate;
  }
  .state-speaking .orb-tide {
    animation: fluid-turn 3s linear infinite;
  }
  .state-speaking .orb-orbit {
    border-color: var(--color-secondary);
    animation-duration: 700ms;
  }
  .state-interrupted .orb-fluid {
    animation: interrupt-settle 350ms ease-out both;
  }
  .interrupt-ring {
    position: absolute;
    left: -6%;
    top: -6%;
    width: 112%;
    height: 112%;
    border-radius: 50%;
    border: 1px solid var(--color-text-primary);
    animation: interrupt-release 1.1s ease-out both;
  }
  .state-idle .orb-envelope,
  .state-stopped .orb-envelope,
  .state-stopping .orb-envelope,
  .state-failed .orb-envelope,
  .state-muted .orb-envelope,
  .state-paused .orb-envelope,
  .state-quiet .orb-envelope,
  .state-recovering .orb-envelope {
    opacity: 0.42;
  }
  .state-idle .orb-fluid,
  .state-idle .orb-tide,
  .state-idle .orb-halo,
  .state-idle .orb-orbit,
  .state-stopped .orb-fluid,
  .state-stopped .orb-tide,
  .state-stopped .orb-halo,
  .state-stopped .orb-orbit,
  .state-stopping .orb-fluid,
  .state-stopping .orb-tide,
  .state-stopping .orb-halo,
  .state-stopping .orb-orbit,
  .state-failed .orb-fluid,
  .state-failed .orb-tide,
  .state-failed .orb-halo,
  .state-failed .orb-orbit,
  .state-muted .orb-fluid,
  .state-muted .orb-tide,
  .state-muted .orb-halo,
  .state-muted .orb-orbit,
  .state-paused .orb-fluid,
  .state-paused .orb-tide,
  .state-paused .orb-halo,
  .state-paused .orb-orbit,
  .state-quiet .orb-fluid,
  .state-quiet .orb-tide,
  .state-quiet .orb-halo,
  .state-quiet .orb-orbit,
  .state-recovering .orb-fluid,
  .state-recovering .orb-tide,
  .state-recovering .orb-halo,
  .state-recovering .orb-orbit {
    animation: none;
  }
  .user-line {
    width: 100%;
    height: 26px;
    flex-shrink: 0;
    font-size: 16px;
    line-height: 26px;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--color-text-secondary);
  }
  .has-speech {
    color: var(--color-text-primary);
  }
  .controls {
    flex-shrink: 0;
    justify-content: center;
    gap: 14px;
    height: 38px;
  }
  .control,
  .start,
  .resume {
    height: 38px;
    padding: 0 15px;
    border: 1px solid var(--color-primary-40);
    border-radius: 20px;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background-color: transparent;
  }
  .control text,
  .start text,
  .resume text {
    font-size: 14px;
  }
  .control-icon {
    width: 16px;
    height: 16px;
    --image-svg-tint: var(--color-text-primary);
  }
  .control,
  .resume {
    width: 88px;
    padding-left: 0;
    padding-right: 0;
    flex-shrink: 0;
  }
  .end {
    width: 72px;
    background-color: var(--color-text-primary);
    border-color: var(--color-text-primary);
    color: var(--color-background);
  }
  .end:focus,
  .end:hover {
    background-color: var(--color-text-primary);
    color: var(--color-background);
    border-color: var(--color-text-primary);
  }
  .end .control-icon {
    --image-svg-tint: var(--color-background);
  }
  .start,
  .resume {
    color: var(--color-primary);
    border-color: var(--color-primary);
  }
  .start {
    min-width: 130px;
  }
  .start .control-icon,
  .is-muted .control-icon {
    --image-svg-tint: var(--color-primary);
  }
  .is-muted {
    color: var(--color-primary);
    border-color: var(--color-primary);
  }
  @keyframes aura-breathe {
    from {
      transform: scale(0.92);
      opacity: 0.5;
    }
    to {
      transform: scale(1.08);
      opacity: 0.8;
    }
  }
  @keyframes orbit-breathe {
    from {
      transform: scale(0.98);
      opacity: 0.3;
    }
    to {
      transform: scale(1.08);
      opacity: 0.65;
    }
  }
  @keyframes fluid-drift {
    from {
      transform: rotate(-25deg) scale(0.94);
    }
    to {
      transform: rotate(38deg) scale(1.1);
    }
  }
  @keyframes fluid-turn {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes thought-pulse {
    from {
      opacity: 0.2;
      transform: scale(0.8);
    }
    to {
      opacity: 0.8;
      transform: scale(1.15);
    }
  }
  @keyframes interrupt-settle {
    from {
      transform: scale(1.15);
    }
    to {
      transform: scale(0.96);
    }
  }
  @keyframes interrupt-release {
    from {
      transform: scale(0.96);
      opacity: 0.9;
    }
    to {
      transform: scale(1.3);
      opacity: 0;
    }
  }
  @media (max-height: 220px) {
    .screen {
      padding: 8px 16px;
      gap: 5px;
    }
    .header {
      min-height: 18px;
    }
    .name,
    .activity {
      font-size: 14px;
    }
    .orb-envelope {
      width: 56px;
      height: 56px;
    }
    .orb-orbit {
      width: 110%;
      height: 110%;
      top: -5%;
      left: -5%;
    }
    .wave {
      gap: 3px;
    }
    .wave-bar {
      width: 3px;
    }
    .user-line {
      height: 23px;
      line-height: 23px;
      font-size: 16px;
    }
    .controls {
      height: 30px;
      gap: 12px;
    }
    .control,
    .start,
    .resume {
      height: 30px;
      padding: 0 12px;
      border-radius: 16px;
    }
    .control-icon {
      width: 14px;
      height: 14px;
    }
    .control,
    .resume {
      width: 74px;
      padding-left: 0;
      padding-right: 0;
    }
    .end {
      width: 64px;
    }
  }
  @media (max-width: 380px) {
    .screen {
      padding-left: 12px;
      padding-right: 12px;
    }
    .identity {
      gap: 6px;
    }
    .clock {
      display: none;
    }
    .cloud {
      font-size: 14px;
    }
    .start {
      padding-left: 10px;
      padding-right: 10px;
    }
  }
</style>
