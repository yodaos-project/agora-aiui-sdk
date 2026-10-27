<script setup>
import { createAgoraVoiceSession, createHttpVoiceBackend } from '../../lib/sdk/index.js';
import configuration from '../../configuration.js';

export default {
  data: {
    status: '准备连接 Agora Cloud',
    media: 'new',
    agent: 'idle',
    audio: 'closed',
    active: false,
    busy: false,
    micMuted: false,
    speakerMuted: false,
    local: '—',
    remote: '—',
    localWidth: 0,
    remoteWidth: 0,
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
    if (this.levelTimer != null) clearInterval(this.levelTimer);
    this.voice?.stop();
  },
  async connect() {
    if (this.data.active || this.data.busy) return;
    const voice = createAgoraVoiceSession({ backend: this.backend, timeout: 30000 });
    this.voice = voice;
    const update = () => {
      if (this.unloaded || this.voice !== voice) return;
      const state = voice.getState();
      const active = state.lifecycle === 'starting' || state.lifecycle === 'running';
      const status = state.error ? state.error.message
        : state.lifecycle === 'stopping' ? '正在结束通话'
        : state.lifecycle === 'stopped' ? '通话已结束'
        : state.media === 'disconnected' ? 'Agora 媒体中断，等待恢复'
        : state.media === 'connected' && state.agent === 'running' ? '已连接 Agora · 可以说话了'
        : state.media === 'connected' ? 'Agora 已连接 · 正在启动 AI'
        : '正在连接 Agora Cloud';
      this.setData({
        status,
        media: state.media,
        agent: state.agent,
        audio: state.audio,
        active,
        busy: state.lifecycle === 'starting' || state.lifecycle === 'stopping',
        micMuted: state.microphoneMuted,
        speakerMuted: state.speakerMuted,
      });
      if (!active) {
        if (this.levelTimer != null) clearInterval(this.levelTimer);
        this.setData({ local: '—', remote: '—', localWidth: 0, remoteWidth: 0 });
      }
    };
    voice.addEventListener('statechange', update);
    this.levelTimer = setInterval(() => {
      if (this.unloaded || this.voice !== voice) return;
      const levels = voice.getAudioLevels();
      const running = voice.getState().audio === 'running';
      this.setData({
        local: running ? `${levels.local.toFixed(0)} dB` : '已暂停',
        remote: running ? `${levels.remote.toFixed(0)} dB` : '已暂停',
        localWidth: running ? Math.round((levels.local + 60) / 60 * 100) : 0,
        remoteWidth: running ? Math.round((levels.remote + 60) / 60 * 100) : 0,
      });
    }, 200);
    try {
      await voice.start();
    } catch {
      // The SDK exposes a safe message through getState().error.
      update();
    }
  },
  toggleMicrophone() {
    this.voice?.setMicrophoneMuted(!this.data.micMuted);
  },
  toggleSpeaker() {
    this.voice?.setSpeakerMuted(!this.data.speakerMuted);
  },
  async resumeAudio() {
    try { await this.voice?.resumeAudio(); }
    catch { if (!this.unloaded) this.setData({ status: '请保持页面在前台，再重试播放' }); }
  },
  stop() {
    this.voice?.stop();
  },
};
</script>
<page>
  <view class="screen">
    <view class="header">
      <text class="brand">Agora Voice</text>
      <text class="subtitle">AIUI · WHIP / WebRTC</text>
    </view>
    <view class="connection">
      <text class="status">{{status}}</text>
      <text class="detail">媒体 {{media}} · AI {{agent}} · 音频 {{audio}}</text>
    </view>
    <view class="meters">
      <view class="meter">
        <view class="meter-label"><text>麦克风</text><text>{{local}}</text></view>
        <view class="track"><view class="fill" style="width: {{localWidth}}%;"></view></view>
      </view>
      <view class="meter">
        <view class="meter-label"><text>远端 AI</text><text>{{remote}}</text></view>
        <view class="track"><view class="fill" style="width: {{remoteWidth}}%;"></view></view>
      </view>
    </view>
    <view class="controls">
      <view class="button primary" bindtap="connect" disabled="{{active || busy}}"><text>连接</text></view>
      <view class="button" bindtap="toggleMicrophone" disabled="{{!active}}"><text>{{micMuted ? '麦克风关' : '麦克风开'}}</text></view>
      <view class="button" bindtap="toggleSpeaker" disabled="{{!active}}"><text>{{speakerMuted ? '扬声器关' : '扬声器开'}}</text></view>
      <view class="button" bindtap="stop" disabled="{{!active}}"><text>结束</text></view>
    </view>
    <view ink:if="{{active && audio !== 'running'}}" class="resume" bindtap="resumeAudio"><text>播放已暂停 · 点击恢复</text></view>
  </view>
</page>
<style>
.screen {
  width: 100%;
  height: 100vh;
  padding: 12px;
  box-sizing: border-box;
  flex-direction: column;
  gap: 10px;
  background-color: var(--color-background);
  color: var(--color-text-primary);
}
.header { flex-direction: row; align-items: center; justify-content: space-between; flex-shrink: 0; }
.brand { color: var(--color-primary); font-size: 19px; font-weight: bold; }
.subtitle, .detail { color: var(--color-text-secondary); font-size: 11px; }
.connection { flex: 1; min-height: 36px; justify-content: center; gap: 6px; }
.status { font-size: 17px; font-weight: bold; }
.meters { flex-direction: row; gap: 16px; flex-shrink: 0; }
.meter { flex: 1; gap: 6px; }
.meter-label { flex-direction: row; justify-content: space-between; font-size: 12px; }
.track { height: 2px; background-color: var(--border-color-default); }
.fill { height: 2px; background-color: var(--color-primary); }
.controls { flex-direction: row; gap: 6px; flex-shrink: 0; }
.button { flex: 1; min-height: 30px; border: 1px solid var(--border-color-default); border-radius: 6px; align-items: center; justify-content: center; font-size: 13px; }
.primary { color: var(--color-primary); border-color: var(--color-primary); }
.resume { font-size: 12px; color: var(--color-primary); flex-shrink: 0; }
@media (max-height: 200px) {
  .screen { padding: 6px 10px; gap: 6px; }
  .brand { font-size: 16px; }
  .status { font-size: 15px; }
  .button { min-height: 27px; font-size: 12px; }
}
</style>
