# 接入自己的 AIUI Agent

[English](../integration.md) · [全部文档](README.md)

建议先跑通[示例](getting-started.md)。接入时记住三件事：每次通话创建一个 session，
由用户操作发起连接，页面关闭时结束通话。

## 安装客户端

根据项目的脚本加载方式，选择一种。

### 使用本地脚本的 AIUI Agent

把本仓库 `src/` 中所有 `.js` 文件复制到 AIUI Agent 的 `lib/agora-voice/` 目录，
保留文件名和相对引用关系。在 `pages/call/` 中的页面可以这样导入：

```js
import { createAgoraVoiceSession, createHttpVoiceBackend } from '../../lib/agora-voice/index.js';
```

项目示例也是这个方式。`npm run example:prepare` 会把文件复制到
`examples/agent/lib/sdk/`。

### 使用 npm 打包的项目

从 GitHub 安装即可，这个步骤不要求包已发布到 npm registry：

```sh
npm install github:yodaos-project/agora-aiui-sdk
```

```js
import { createAgoraVoiceSession, createHttpVoiceBackend } from '@yodaos-pkg/agora-aiui-sdk';
```

安装包不会自动为普通浏览器补齐 Ink 的媒体 API。
客户端需要运行在具备下方能力的 Ink 宿主中。

## 接入页面

使用[入门指南](getting-started.md)中配置的后端地址和 `authorization()`。
发布 AIUI Agent 时，这个函数应返回已登录用户的完整 Authorization 请求头，例如
`Bearer <application-access-token>`。这是访问业务后端的凭证，不是 Agora 凭证。

下面的脚本适用于 `pages/call/` 中的页面。
把「连接」按钮绑定到 `connect`，「结束」按钮绑定到 `stop`，在页面上显示 `status`。

```js
import { createAgoraVoiceSession, createHttpVoiceBackend } from '../../lib/agora-voice/index.js';
import configuration from '../../configuration.js';

export default {
  data: { status: '准备就绪' },
  onLoad() {
    this.unloaded = false;
    this.backend = createHttpVoiceBackend({
      baseURL: configuration.backendURL,
      authorization: configuration.authorization,
    });
  },
  async connect() {
    const phase = this.voice?.getState().lifecycle;
    if (['starting', 'running', 'stopping'].includes(phase)) return;

    const voice = createAgoraVoiceSession({ backend: this.backend, timeout: 30000 });
    this.voice = voice;
    const update = () => {
      if (this.unloaded || this.voice !== voice) return;
      const state = voice.getState();
      this.setData({
        status: state.error?.message ?? `${state.lifecycle} · ${state.media} · ${state.audio}`,
      });
    };
    voice.addEventListener('statechange', update);
    try {
      await voice.start();
    } catch {
      update();
    }
  },
  stop() {
    void this.voice?.stop();
  },
  onUnload() {
    this.unloaded = true;
    void this.voice?.stop();
  },
};
```

按钮、音量条和适合眼镜的布局，可以参考[完整页面](../../examples/agent/pages/call/index.ink)。
每个 session 只使用一次；结束或失败后，上面的 `connect()` 会重新创建一个。

## 添加音频控制

对页面当前的 `voice` 调用：

```js
voice.setMicrophoneMuted(true); // 保持通话，不发送你的声音。
voice.setMicrophoneMuted(false);
voice.setSpeakerMuted(true); // 继续接收，但不播放。
voice.setSpeakerMuted(false);
voice.setVolume(0.8); // 0 为静音，1 为最大音量。
const { local, remote } = voice.getAudioLevels();
```

电平范围是 `-60`（静音）到 `0` dBFS。绘制音量条时，每秒读取约 5 次即可，
结束或卸载时清除定时器。播放暂停后，在用户点击时调用 `voice.resumeAudio()`。

## 使用已有临时凭证

如果你的系统已经负责启动云端 AI，并提供短期有效的 WHIP 凭证，可以选择直接连接模式。
这个模式运行时不需要会话后端，只负责连接音频，不会替你启动或停止云端 AI。

```js
const voice = createAgoraVoiceSession({
  connection: {
    baseURL: 'https://ap-webrtc-whip.ap.sd-rtn.com',
    channel: 'your-channel',
    uid: 'aiui-client-10001',
    token: 'temporary-whip-jwt-from-your-trusted-service',
  },
});

// 在用户点击「连接」时调用。
await voice.start();
```

启动云端 AI 时，使用同一个频道和客户端**字符串 UID**，AI 自己使用另一个字符串 UID。
如果你自己准备凭证，请看[身份与凭证](backend.md#身份与凭证)。
只支持推流的 WHIP 地址无法提供对话所需的下行音频。

`token` 也可以是返回新 JWT 的异步函数。关闭会话时，SDK 可能再次调用它。
这个机制不会为已有 RTC 连接续期或重连。
本地通话用 `voice.stop()` 结束，云端 AI 的生命周期仍由你的系统管理。

## 宿主要求

- Ink 构建需要提供 `WHIPSession`、`RTCPeerConnection`、`AudioContext`
  和 `navigator.mediaDevices.getUserMedia`。
- 在 `app.json` 中声明 `"permissions": ["RECORD_AUDIO"]`，并在宿主或系统中允许录音。
- 以完整前台 AIUI Agent 打开，Widget 和列表预览不支持通话。
- 使用独立桌面程序 `ink-open` 测试时，指定 `--networking-transport native`。
- Ink Web 打开 bundle 时使用
  `hostOptions: { initialTarget: '_blank', initialFocus: 'focus' }`，
  并由宿主处理麦克风权限请求。部署时使用安全的 Web 来源和 HTTPS 后端。

后台音频行为由宿主决定。如果切换窗口后播放暂停，请将 AIUI Agent 带回前台，并提供调用
`resumeAudio()` 的按钮。如何分别判断媒体连接与播放状态，见[常见问题](troubleshooting.md)。
