<script setup>
  import { createAgoraVoiceSession, createHttpVoiceBackend } from '../../lib/sdk/index.js';
  import configuration from '../../configuration.js';
  import { changedFields, presentCall } from './presentation.js';

  export default {
    data: {
      ...presentCall(),
      micMuted: false,
      speakerMuted: false,
      clock: '00:00',
      bar1: 3,
      bar2: 3,
      bar3: 3,
    },
    onLoad() {
      this.unloaded = false;
      this.backend = createHttpVoiceBackend({
        baseURL: configuration.backendURL,
        authorization: configuration.authorization,
      });
    },
    onUnload() {
      this.unloaded = true;
      this.clearLevelTimer();
      if (this.voice && this.update) this.voice.removeEventListener('statechange', this.update);
      void this.voice?.stop();
    },
    clearLevelTimer() {
      if (this.levelTimer != null) clearInterval(this.levelTimer);
      this.levelTimer = null;
    },
    renderCall(state, speaking = false, bars = [3, 3, 3]) {
      const elapsed = this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0;
      const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const seconds = String(elapsed % 60).padStart(2, '0');
      const patch = changedFields(this.data, {
        ...presentCall(state, speaking),
        micMuted: state.microphoneMuted,
        speakerMuted: state.speakerMuted,
        clock: `${minutes}:${seconds}`,
        bar1: bars[0],
        bar2: bars[1],
        bar3: bars[2],
      });
      if (Object.keys(patch).length) this.setData(patch);
    },
    async connect() {
      if (this.unloaded || this.data.active || this.data.busy) return;
      this.clearLevelTimer();
      if (this.voice && this.update) this.voice.removeEventListener('statechange', this.update);
      this.startedAt = 0;
      this.speakingUntil = 0;
      const voice = createAgoraVoiceSession({ backend: this.backend, timeout: 30000 });
      this.voice = voice;
      this.update = () => {
        if (this.unloaded || this.voice !== voice) return;
        const state = voice.getState();
        if (state.lifecycle !== 'running') {
          this.clearLevelTimer();
          this.speakingUntil = 0;
        }
        this.renderCall(state, Date.now() < this.speakingUntil);
      };
      voice.addEventListener('statechange', this.update);
      try {
        await voice.start();
        if (this.unloaded || this.voice !== voice || voice.getState().lifecycle !== 'running')
          return;
        this.startedAt = Date.now();
        this.levelTimer = setInterval(() => this.refreshAudio(voice), 200);
        this.refreshAudio(voice);
      } catch {
        if (this.voice === voice) this.update();
      }
    },
    refreshAudio(voice) {
      if (this.unloaded || this.voice !== voice) return;
      const state = voice.getState();
      const audible = state.audio === 'running' && state.media === 'connected';
      const levels = audible ? voice.getAudioLevels() : { local: -60, remote: -60 };
      // A short hold keeps the indicator steady between words; it does not infer AI turn events.
      if (audible && !state.speakerMuted && levels.remote > -46)
        this.speakingUntil = Date.now() + 500;
      if (!audible || state.speakerMuted) this.speakingUntil = 0;
      const speaking = Date.now() < this.speakingUntil;
      const level = speaking ? levels.remote : state.microphoneMuted ? -60 : levels.local;
      const energy = audible ? Math.max(0, Math.min(1, (level + 55) / 35)) : 0;
      this.renderCall(state, speaking, [
        3 + Math.round(energy * 5),
        3 + Math.round(energy * 11),
        3 + Math.round(energy * 17),
      ]);
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
        if (!this.unloaded && this.voice === voice && this.data.canResume) {
          this.setData({ hint: '请回到前台，再点击继续聊天。' });
        }
      }
    },
    stop() {
      this.clearLevelTimer();
      void this.voice?.stop();
    },
  };
</script>
<page>
  <view class="screen">
    <view class="header">
      <view class="identity">
        <text class="name">小语</text>
        <text class="role">AI 语音伙伴</text>
      </view>
      <view class="connection {{connected ? 'online' : ''}}">
        <view class="connection-dot"></view>
        <text class="cloud">{{cloud}}</text>
        <text class="clock">{{connected ? clock : ''}}</text>
      </view>
    </view>

    <view class="conversation">
      <view class="avatar">
        <view class="avatar-inner {{phase === 'speaking' ? 'responding' : ''}}">
          <image class="portrait" src="/assets/companion.svg" mode="aspectFit" />
        </view>
      </view>
      <view class="words">
        <text class="title {{phase === 'speaking' ? 'responding-title' : ''}}">{{title}}</text>
        <button
          class="hint-button {{canResume ? 'resume' : ''}}"
          disabled="{{!canResume}}"
          bindtap="resumeAudio"
        >
          <text class="hint-copy {{canResume ? 'resume-copy' : ''}}">{{hint}}</text>
        </button>
        <view class="voice-signal">
          <view
            class="bar {{phase === 'ready' || phase === 'speaking' ? 'live-bar' : ''}}"
            style="height: {{bar1}}px;"
          ></view>
          <view
            class="bar {{phase === 'ready' || phase === 'speaking' ? 'live-bar' : ''}}"
            style="height: {{bar2}}px;"
          ></view>
          <view
            class="bar {{phase === 'ready' || phase === 'speaking' ? 'live-bar' : ''}}"
            style="height: {{bar3}}px;"
          ></view>
          <view
            class="bar {{phase === 'ready' || phase === 'speaking' ? 'live-bar' : ''}}"
            style="height: {{bar2}}px;"
          ></view>
          <view
            class="bar {{phase === 'ready' || phase === 'speaking' ? 'live-bar' : ''}}"
            style="height: {{bar1}}px;"
          ></view>
        </view>
      </view>
    </view>

    <view ink:if="{{active}}" class="controls">
      <button
        ink:if="{{canControl}}"
        class="control {{micMuted ? 'is-muted' : ''}}"
        disabled="{{!canControl}}"
        bindtap="toggleMicrophone"
      >
        <image
          class="control-icon"
          src="{{micMuted ? '/assets/microphone-off.svg' : '/assets/microphone.svg'}}"
          mode="aspectFit"
        />
        <text>{{micMuted ? '开麦' : '静音'}}</text>
      </button>
      <button class="control end" disabled="{{phase === 'stopping'}}" bindtap="stop">
        <image class="control-icon" src="/assets/end.svg" mode="aspectFit" />
        <text>{{phase === 'connecting' ? '取消' : '结束通话'}}</text>
      </button>
      <button
        ink:if="{{canControl}}"
        class="control {{speakerMuted ? 'is-muted' : ''}}"
        disabled="{{!canControl}}"
        bindtap="toggleSpeaker"
      >
        <image
          class="control-icon"
          src="{{speakerMuted ? '/assets/speaker-off.svg' : '/assets/speaker.svg'}}"
          mode="aspectFit"
        />
        <text>{{speakerMuted ? '开声音' : '扬声器'}}</text>
      </button>
    </view>
    <view ink:else class="controls">
      <button class="start" disabled="{{busy}}" bindtap="connect">
        <image class="control-icon" src="/assets/call.svg" mode="aspectFit" />
        <text
          >{{phase === 'failed' ? '再试一次' : phase === 'stopped' ? '再聊一会儿' :
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
    padding: 18px 22px;
    flex-direction: column;
    gap: 12px;
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
    justify-content: space-between;
    flex-shrink: 0;
    min-height: 20px;
  }
  .identity {
    gap: 8px;
  }
  .name {
    font-size: 17px;
    font-weight: 600;
  }
  .role,
  .cloud,
  .clock {
    font-size: 12px;
    color: var(--color-text-secondary);
  }
  .connection {
    gap: 6px;
    flex-shrink: 0;
  }
  .connection-dot {
    width: 4px;
    height: 4px;
    border-radius: 2px;
    background-color: var(--color-text-secondary);
  }
  .online .connection-dot {
    background-color: var(--color-secondary);
  }
  .online .cloud {
    color: var(--color-secondary);
  }
  .clock {
    margin-left: 6px;
  }
  .conversation {
    width: 100%;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    align-items: center;
    justify-content: center;
    gap: 16px;
  }
  .avatar {
    position: relative;
    width: 96px;
    height: 96px;
    flex-shrink: 0;
    border-radius: 48px;
    border: 1px solid var(--color-primary-40);
    align-items: center;
    justify-content: center;
  }
  .avatar-inner {
    width: 80px;
    height: 80px;
    border-radius: 40px;
    border: 1px solid var(--color-primary);
    align-items: center;
    justify-content: center;
  }
  .portrait {
    width: 61px;
    height: 61px;
    --image-svg-tint: var(--color-primary);
  }
  .words {
    flex-direction: column;
    align-items: center;
    gap: 5px;
  }
  .title {
    font-size: 24px;
    line-height: 30px;
    font-weight: 600;
  }
  .hint-copy {
    color: var(--color-text-secondary);
    font-size: 14px;
    line-height: 20px;
  }
  .voice-signal {
    height: 20px;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }
  .bar {
    width: 3px;
    min-height: 3px;
    border-radius: 2px;
    background-color: var(--color-primary-40);
  }
  .live-bar {
    background-color: var(--color-primary);
  }
  .responding {
    border-color: var(--color-secondary);
  }
  .responding-title {
    color: var(--color-primary);
  }
  .controls {
    justify-content: center;
    gap: 10px;
    flex-shrink: 0;
  }
  .control,
  .start {
    height: 38px;
    padding: 0 14px;
    border: 1px solid var(--border-color-muted);
    border-radius: 19px;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 7px;
    background-color: transparent;
  }
  .control text,
  .start text {
    font-size: 14px;
  }
  .control-icon {
    width: 17px;
    height: 17px;
    --image-svg-tint: var(--color-text-primary);
  }
  .start {
    min-width: 152px;
    border: 2px solid var(--color-primary);
    color: var(--color-primary);
  }
  .start .control-icon,
  .is-muted .control-icon {
    --image-svg-tint: var(--color-primary);
  }
  .is-muted {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }
  .end {
    border-color: var(--border-color-default);
  }
  .hint-button {
    padding: 0;
    border: none;
    background-color: transparent;
    color: var(--color-primary);
  }
  .resume-copy {
    color: var(--color-primary);
    font-size: 14px;
    line-height: 20px;
  }
  @media (max-height: 220px) {
    .screen {
      padding: 9px 16px;
      gap: 8px;
    }
    .conversation {
      flex-direction: row;
      gap: 20px;
      max-width: 380px;
      align-self: center;
    }
    .avatar {
      width: 70px;
      height: 70px;
      border-radius: 35px;
    }
    .avatar-inner {
      width: 58px;
      height: 58px;
      border-radius: 29px;
    }
    .portrait {
      width: 46px;
      height: 46px;
    }
    .words {
      flex: 1;
      min-width: 0;
      align-items: flex-start;
      gap: 3px;
    }
    .title {
      font-size: 22px;
      line-height: 27px;
    }
    .voice-signal {
      height: 16px;
    }
    .control,
    .start {
      height: 34px;
      border-radius: 17px;
    }
  }
  @media (max-width: 380px) {
    .screen {
      padding-left: 10px;
      padding-right: 10px;
    }
    .role {
      display: none;
    }
    .conversation {
      gap: 12px;
    }
    .title {
      font-size: 20px;
    }
    .control {
      padding-left: 10px;
      padding-right: 10px;
    }
  }
</style>
