<script setup>
  import {
    createAgoraVoiceSession,
    createHttpVoiceBackend,
    createWorkerTranscripts,
  } from '@yodaos-pkg/agora-aiui-sdk/voice';
  import { getCallCopy } from './copy.js';
  import { createCallTools } from './tools.js';
  import configuration from '../../configuration.js';
  import { audioFeedback, changedFields, presentCall, readConversation } from './presentation.js';

  const copy = getCallCopy(configuration.provider);

  export default {
    data: {
      ...presentCall({}, false, {}, configuration.provider),
      copy,
      micMuted: false,
      micSuppressed: false,
      speakerMuted: false,
      clock: '00:00',
      orbScale: 1,
      orbColor: 'default',
      inputGlow: 0,
      outputGlow: 0.2,
      glowScale: 1,
      inputActive: false,
      pressed: '',
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
      this.transcriptSource = createWorkerTranscripts(
        (options) => this.connectWorker('transcripts', options),
        {
          onActivity: (activity) => {
            if (this.unloaded) return;
            this.cloudActivity = { ...this.cloudActivity, ...activity };
            if (this.voice) this.refreshAudio(this.voice);
          },
        },
      );
    },
    onUnload() {
      this.unloaded = true;
      this.clearLevelTimer();
      this.clearTranscripts();
      if (this.pressTimer != null) clearTimeout(this.pressTimer);
      if (this.voice && this.update) this.voice.removeEventListener('statechange', this.update);
      void this.voice?.stop();
    },
    clearLevelTimer() {
      if (this.levelTimer != null) clearInterval(this.levelTimer);
      this.levelTimer = null;
    },
    renderCall(state, speaking = false) {
      const { input, output } = this.audioFeedback || { input: 0, output: 0 };
      const energy = Math.max(input, output);
      const running =
        state.lifecycle === 'running' && state.media === 'connected' && state.audio === 'running';
      const elapsed = this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0;
      const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const seconds = String(elapsed % 60).padStart(2, '0');
      const patch = changedFields(this.data, {
        ...presentCall(
          state,
          speaking,
          {
            thinking: this.cloudActivity?.thinking,
            interrupted: Date.now() < (this.interruptedUntil || 0),
          },
          configuration.provider,
        ),
        micMuted: state.microphoneMuted,
        micSuppressed: state.microphoneSuppressed,
        speakerMuted: state.speakerMuted,
        clock: `${minutes}:${seconds}`,
        orbScale: 1 + Math.round(energy * 110) / 1000,
        inputGlow: running ? Math.round(input * 85) / 100 : 0,
        outputGlow: running ? 0.2 + Math.round(output * 65) / 100 : 0.15,
        glowScale: 1 + Math.round(energy * 18) / 100,
        inputActive: running && !state.microphoneMuted && !state.microphoneSuppressed && input > 0.15,
      });
      if (Object.keys(patch).length) this.setData(patch);
    },
    async connect() {
      if (this.unloaded || this.data.active || this.data.busy) return;
      this.press('start');
      this.clearLevelTimer();
      this.clearTranscripts();
      if (this.voice && this.update) this.voice.removeEventListener('statechange', this.update);
      this.setData({ userLine: '', transcriptNote: '' });
      this.cloudActivity = {};
      this.interruptedUntil = 0;
      this.interruptedKey = '';
      this.startedAt = 0;
      this.speakingUntil = 0;
      this.audioFeedback = { input: 0, output: 0 };
      this.levelUpdatedAt = 0;
      const voice = createAgoraVoiceSession({
        backend: this.backend,
        timeout: 45000,
        transcripts: this.transcriptSource,
        microphoneMode: configuration.microphoneMode ?? 'full-duplex',
        ...(configuration.localTools ? {
          tools: createCallTools((color) => {
            if (!this.unloaded && this.voice === voice) this.setData({ orbColor: color });
          }),
        } : {}),
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
        if (this.unloaded || this.voice !== voice || voice.getState().lifecycle !== 'running') return;
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
      // RTM events also refresh levels. Smooth by elapsed time, not event count.
      const now = performance.now();
      const elapsed = this.levelUpdatedAt ? Math.max(0, now - this.levelUpdatedAt) : 160;
      this.levelUpdatedAt = now;
      this.audioFeedback = audioFeedback(state, levels, this.audioFeedback, elapsed);
      this.renderCall(state, speaking);
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
      const columns = Math.max(12, Math.min(24, Math.floor(((window.innerWidth || 448) - 48) / 17)));
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
            ? copy.transcriptFailed
            : state.status === 'disconnected'
              ? copy.transcriptRecovering
              : '',
      });
      if (Object.keys(patch).length) this.setData(patch);
      this.refreshAudio(voice);
    },
    press(control) {
      if (this.pressTimer != null) clearTimeout(this.pressTimer);
      this.setData({ pressed: control });
      this.pressTimer = setTimeout(() => {
        this.pressTimer = null;
        if (!this.unloaded) this.setData({ pressed: '' });
      }, 220);
    },
    activateOrb() {
      const action = this.data.orbAction;
      if (!action || this.unloaded) return;
      if (action === 'start') void this.connect();
      else if (action === 'resume') void this.resumeAudio();
      else if (action === 'soundOn') this.toggleSpeaker();
      else this.toggleMicrophone();
      this.press('orb');
    },
    toggleMicrophone() {
      if (!this.data.canControl || this.data.micSuppressed) return;
      this.press('microphone');
      this.voice?.setMicrophoneMuted(!this.data.micMuted);
    },
    toggleSpeaker() {
      if (!this.data.canControl) return;
      this.press('speaker');
      this.voice?.setSpeakerMuted(!this.data.speakerMuted);
    },
    async resumeAudio() {
      const voice = this.voice;
      if (!this.data.canResume || !voice) return;
      this.press('resume');
      try {
        await voice.resumeAudio();
      } catch {
        if (!this.unloaded && this.voice === voice && this.data.canResume)
          this.setData({ hint: copy.resumeHint });
      }
    },
    stop() {
      this.press('end');
      this.clearLevelTimer();
      this.clearTranscripts();
      void this.voice?.stop();
    },
  };
</script>
<page>
  <view class="screen state-{{phase}} {{inputActive ? 'input-active' : ''}}">
    <view class="header">
      <view class="identity">
        <text class="name">{{copy.name}}</text>
        <text class="activity">{{title}}</text>
      </view>
      <view class="connection {{connected ? 'online' : ''}}">
        <view class="connection-dot"></view>
        <text class="cloud">{{cloud}}</text>
        <text class="clock">{{connected ? clock : ''}}</text>
      </view>
    </view>

    <view class="presence">
      <button
        class="orb-button {{pressed === 'orb' ? 'is-pressed' : ''}}"
        disabled="{{!orbAction}}"
        aria-label="{{orbLabel}}"
        bindtap="activateOrb"
      >
        <view class="orb-envelope orb-color-{{orbColor}}" style="transform: scale({{orbScale}});">
          <view
            class="orb-halo"
            style="opacity: {{outputGlow}}; transform: scale({{glowScale}});"
          ></view>
          <view
            class="input-glow"
            style="opacity: {{inputGlow}}; transform: scale({{glowScale}});"
          ></view>
          <view class="orb">
            <view class="orb-cloud cloud-blue"></view>
            <view class="orb-cloud cloud-aqua"></view>
            <view class="orb-cloud cloud-pearl"></view>
            <view class="orb-sheen"></view>
          </view>
        </view>
      </button>
    </view>

    <text class="user-line {{userLine && !transcriptNote ? 'has-speech' : ''}}"
      >{{phase === 'failed' || phase === 'paused' || phase === 'recovering' ? hint : transcriptNote ||
      userLine || hint}}</text
    >

    <view ink:if="{{active}}" class="controls">
      <button
        ink:if="{{canControl}}"
        class="control {{pressed === 'microphone' ? 'is-pressed' : ''}} {{micMuted || micSuppressed ? 'is-muted' : ''}}"
        disabled="{{!canControl || micSuppressed}}"
        bindtap="toggleMicrophone"
      >
        <image
          ink:if="{{!micSuppressed}}"
          class="control-icon"
          src="{{micMuted || micSuppressed ? '/assets/microphone-off.svg' : '/assets/microphone.svg'}}"
          mode="aspectFit"
        />
        <text>{{micSuppressed ? copy.suppressed : micMuted ? copy.unmute : copy.mute}}</text>
      </button>
      <button
        class="control end {{pressed === 'end' ? 'is-pressed' : ''}}"
        disabled="{{phase === 'stopping'}}"
        bindtap="stop"
      >
        <image class="control-icon" src="/assets/end.svg" mode="aspectFit" />
        <text>{{phase === 'connecting' ? copy.cancel : copy.end}}</text>
      </button>
      <button
        ink:if="{{canResume}}"
        class="resume {{pressed === 'resume' ? 'is-pressed' : ''}}"
        bindtap="resumeAudio"
      >
        <text>{{copy.resume}}</text>
      </button>
      <button
        ink:if="{{canControl && !canResume}}"
        class="control {{pressed === 'speaker' ? 'is-pressed' : ''}} {{speakerMuted ? 'is-muted' : ''}}"
        bindtap="toggleSpeaker"
      >
        <image
          class="control-icon"
          src="{{speakerMuted ? '/assets/speaker-off.svg' : '/assets/speaker.svg'}}"
          mode="aspectFit"
        />
        <text>{{speakerMuted ? copy.soundOn : copy.sound}}</text>
      </button>
    </view>
    <view ink:else class="controls">
      <button
        class="start {{pressed === 'start' ? 'is-pressed' : ''}}"
        disabled="{{busy}}"
        bindtap="connect"
      >
        <image class="control-icon" src="/assets/call.svg" mode="aspectFit" />
        <text
          >{{phase === 'failed' ? copy.retry : phase === 'stopped' ? copy.restart : copy.start}}</text
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
    flex-shrink: 0;
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
  .orb-button,
  .orb-button:hover,
  .orb-button:focus {
    padding: 0;
    border-width: 0;
    border-radius: 50%;
    background-color: transparent;
  }
  .orb-button {
    width: 108px;
    height: 108px;
    flex-shrink: 0;
    transition: transform 180ms ease-out;
  }
  .orb-button:hover .orb-sheen,
  .orb-button:focus .orb-sheen {
    opacity: 0.3;
  }
  .orb-button.is-pressed {
    transform: scale(0.96);
  }
  .orb-envelope {
    position: relative;
    width: 100%;
    height: 100%;
    flex-shrink: 0;
    opacity: 0.95;
    transition:
      transform 220ms ease-out,
      opacity 600ms ease;
  }
  .orb-envelope {
    --orb-primary: var(--color-primary);
    --orb-primary-60: var(--color-primary-60);
    --orb-primary-40: var(--color-primary-40);
    --orb-secondary: var(--color-secondary);
  }
  .orb-color-blue {
    --orb-primary: #408aff;
    --orb-primary-60: #3475bd;
    --orb-primary-40: #22466f;
    --orb-secondary: #92e4ff;
  }
  .orb-color-green {
    --orb-primary: #38d5a0;
    --orb-primary-60: #2e997c;
    --orb-primary-40: #20584d;
    --orb-secondary: #a3f5b5;
  }
  .orb-color-purple {
    --orb-primary: #aa7cff;
    --orb-primary-60: #7952bd;
    --orb-primary-40: #493568;
    --orb-secondary: #efb3ef;
  }
  .orb-color-orange {
    --orb-primary: #ffae64;
    --orb-primary-60: #bd7851;
    --orb-primary-40: #704a38;
    --orb-secondary: #ffe1ac;
  }
  .orb-halo,
  .input-glow {
    position: absolute;
    width: 150%;
    height: 150%;
    left: -25%;
    top: -25%;
    border-radius: 50%;
    background-image: radial-gradient(circle at center, var(--orb-primary-40) 8%, transparent 70%);
    opacity: 0.3;
    transition:
      opacity 220ms ease-out,
      transform 320ms ease-out;
  }
  .input-glow {
    background-image: radial-gradient(circle at center, var(--orb-secondary) 15%, transparent 65%);
  }
  .orb {
    position: absolute;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    overflow: hidden;
    background-color: var(--color-text-primary);
    transition: transform 350ms ease-out;
  }
  /* These loops never change with conversation state. Only their light levels do. */
  .orb-cloud {
    position: absolute;
    width: 140%;
    height: 140%;
    left: -20%;
    top: -20%;
    transition: opacity 700ms ease;
  }
  .cloud-blue {
    background-image: radial-gradient(
      ellipse at 75% 50%,
      var(--orb-primary) 12%,
      var(--orb-primary-60) 40%,
      var(--orb-primary-40) 66%
    );
    opacity: 0.9;
    animation: cloud-flow 12s linear infinite;
  }
  .cloud-aqua {
    background-image: radial-gradient(
      ellipse at 25% 55%,
      var(--orb-secondary) 5%,
      var(--orb-primary-40) 50%,
      var(--color-background) 100%
    );
    opacity: 0.25;
    animation: cloud-return 19s linear infinite;
  }
  .cloud-pearl {
    width: 160%;
    height: 120%;
    left: -30%;
    top: -10%;
    background-image: radial-gradient(
      ellipse at 35% 60%,
      var(--color-text-primary) 25%,
      var(--orb-primary-40) 75%
    );
    opacity: 0.95;
    animation: cloud-flow 16s linear infinite;
  }
  .orb-sheen {
    position: absolute;
    width: 100%;
    height: 100%;
    left: 0;
    top: 0;
    border-radius: 50%;
    background-image: radial-gradient(
      circle at 40% 30%,
      var(--color-text-primary) 0%,
      var(--orb-primary-40) 50%,
      var(--color-background) 100%
    );
    opacity: 0.16;
    transition: opacity 250ms ease-out;
  }
  .state-speaking .cloud-blue {
    opacity: 1;
  }
  .state-speaking .cloud-pearl {
    opacity: 0.8;
  }
  .state-thinking .cloud-aqua,
  .state-connecting .cloud-aqua {
    opacity: 0.4;
  }
  .state-thinking .cloud-pearl,
  .state-connecting .cloud-pearl {
    opacity: 0.75;
  }
  .state-interrupted .cloud-pearl {
    opacity: 1;
  }
  .state-interrupted .orb {
    transform: scale(0.96);
  }
  .state-connecting .orb {
    transform: scale(0.94);
  }
  .input-active .activity,
  .input-active .has-speech {
    color: var(--color-text-primary);
  }
  .state-idle .orb-envelope,
  .state-stopped .orb-envelope {
    opacity: 0.7;
  }
  .state-stopping .orb-envelope,
  .state-failed .orb-envelope,
  .state-muted .orb-envelope,
  .state-paused .orb-envelope,
  .state-quiet .orb-envelope,
  .state-recovering .orb-envelope {
    opacity: 0.4;
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
    transition:
      transform 140ms ease-out,
      background-color 180ms ease;
  }
  .control.is-pressed,
  .start.is-pressed,
  .resume.is-pressed {
    transform: scale(0.94);
  }
  .control:hover,
  .start:hover,
  .resume:hover {
    background-color: var(--color-primary-40);
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
  /* Full rotations keep both position and velocity continuous at the loop boundary. */
  @keyframes cloud-flow {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes cloud-return {
    from {
      transform: rotate(360deg);
    }
    to {
      transform: rotate(0deg);
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
    .orb-button {
      width: 56px;
      height: 56px;
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
      margin-left: 0;
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
