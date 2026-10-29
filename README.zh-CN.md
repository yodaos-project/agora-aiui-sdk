# Agora AIUI SDK

[English](README.md)

让 Ink 中的 AIUI Agent 与 Agora 云端语音 Agent 通话。
SDK 负责麦克风采集、双向音频、静音、音量和连接状态。业务后端负责分配频道、
签发临时凭证，以及启动和结束云端 AI。音频直接在 Ink 和 Agora Cloud 之间传输。

## 第一版包含什么？

- 通过 Agora WHIP + WebRTC 双向通话。
- 麦克风静音、扬声器静音、音量和两端音频电平。
- 独立的媒体连接、音频播放和云端 Agent 状态。
- 取消连接、立即停止采集、超时清理和后端会话租约。
- JavaScript 模块、TypeScript 类型声明、眼镜尺寸的 AIUI 页面和参考后端。

**当前实测状态：** 客户端和云端 AI 必须统一使用字符串 UID。
之前使用数字 UID 的测试无法收到 AI 语音；改用字符串账号后的宿主与对话验证结果，
详见[验证记录](docs/validation.md#string-uid-correction-2026-10-29)。

客户端没有额外运行时依赖，使用 Ink 自带的 WHIP、WebRTC、Web Audio 和麦克风 API。
需要包含 [WHIP 支持](https://github.com/jsar-project/ink/pull/735) 的 Ink 构建，
并由宿主启用 WebRTC、允许录音。页面应保持在前台运行。
请打开完整应用页面，列表/Widget 预览不能通话。Web 宿主打开 bundle 时使用
`hostOptions: { initialTarget: '_blank', initialFocus: 'focus' }`，并提供麦克风权限处理。

## 先跑示例

```sh
git clone https://github.com/yodaos-project/agora-aiui-sdk.git
cd agora-aiui-sdk
npm ci
npm run example:prepare
```

1. 准备 Agora App ID、App Certificate 和已配置语音能力的 AI Studio pipelineId。
2. 按[后端说明](docs/backend.md)启动参考后端，或让已有业务后端实现相同接口。
3. 修改 `examples/agent/configuration.js`，填入后端地址，实现获取业务登录凭证的 `authorization()`。
4. 用 Ink 打开 `examples/agent`，例如 `ink-open examples/agent`。
5. 允许录音，点击「连接」，等待显示「已连接 Agora」。

页面使用 Ink 主题颜色，适配 `yodaos-sprite-color` 和 `yodaos-sprite-greenonly`。
正式使用时，把后端部署到自己的 HTTPS 服务；不需要开发者电脑持续运行服务。

## 接入自己的 AIUI Agent

如果项目直接使用相对路径加载脚本，把 `src/` 中的 `.js` 文件复制到应用的
`lib/agora-voice/`，保留文件名和目录关系。示例中的 `example:prepare` 就是在做这件事。

使用 npm 打包的项目可以先从 GitHub 安装：

```sh
npm install github:yodaos-project/agora-aiui-sdk
```

包名为 `@yodaos-pkg/agora-aiui-sdk`。第一版通过 GitHub 交付，尚不要求 npm registry 已发布。

```js
import { createAgoraVoiceSession, createHttpVoiceBackend } from './lib/agora-voice/index.js';

const backend = createHttpVoiceBackend({
  baseURL: 'https://your-backend.example.com',
  authorization: async () => `Bearer ${await getApplicationAccessToken()}`,
});

const voice = createAgoraVoiceSession({ backend, timeout: 30000 });
voice.addEventListener('statechange', () => {
  const state = voice.getState();
  // 将 state.media、state.agent、state.audio 和 state.error 更新到页面。
});

// 在用户点击连接按钮时执行。
await voice.start();
voice.setMicrophoneMuted(true);
voice.setSpeakerMuted(false);
voice.setVolume(0.8);
const { local, remote } = voice.getAudioLevels(); // -60 到 0 dBFS

// 用户结束通话或页面卸载时调用。调用时立即停止麦克风。
await voice.stop();
```

`getApplicationAccessToken()` 由你的应用提供，用来登录业务后端，和 Agora WHIP JWT 不是同一个凭证。
SDK 不提供用户登录系统。

## 已有临时凭证时，直接连接

如果你的系统已经启动云端 Agent，或者只是希望与频道中的另一个 RTC 用户通话，可以使用直接连接模式。
此模式在运行时不需要会话管理后端，也不会自动启动云端 AI。

```js
import { createAgoraVoiceSession } from './lib/agora-voice/index.js';

const voice = createAgoraVoiceSession({
  connection: {
    baseURL: 'https://ap-webrtc-whip.ap.sd-rtn.com',
    channel: 'your-channel',
    uid: 'aiui-client-10001',
    token: '从可信服务获取的临时 WHIP JWT',
  },
});
await voice.start();
// 通话中……
await voice.stop();
```

JWT 授权的频道必须与连接配置一致。连接云端 AI 时，客户端使用**字符串 UID**，通过
WHIP URL 的 `stringuid` 传入；云端设置 `enable_string_uid: true`，并把同一个客户端
字符串填入 `remote_rtc_uids`，AI 自己的 `agent_rtc_uid` 使用另一个字符串账号。
此模式不发送数字 `Uid` 参数，WHIP JWT 也不包含 `uid` 字段。
这里使用 Agora 的双向 WHIP 扩展；只支持推流的标准 WHIP
服务不能直接提供语音对话所需的下行音频。

长时间通话可以把 `token` 换成异步函数，按需获取新 JWT。关闭 WHIP 会话时也可能再次请求凭证。
更新 JWT 不会自动重启已有 RTC 会话。

## 怎样判断是否真的连上？

| 状态        | 含义                                                         |
| ----------- | ------------------------------------------------------------ |
| `lifecycle` | 正在连接、通话中、正在清理或已结束。                         |
| `media`     | 实际 RTC 连接，断开时会显示 `disconnected`。                 |
| `agent`     | 后端是否已确认启动/停止云端 AI；直接连接时是 `not-managed`。 |
| `audio`     | 音频播放上下文是否为 `running`、`suspended` 或 `closed`。    |

HTTP 请求成功不等于媒体已连接。`agent: running` 表示后端确认了启动请求，不代表 AI 当前一定还在线、
正在说话或对方一定能听见。第一版尚未订阅云端 Agent 的实时状态事件。

短暂断线时保留 `disconnected`，等待 RTC 自身恢复；连接彻底失败后自动清理。
结束或失败后，创建新的 session 再连接；第一版不做自动重连。
音频因失焦等原因暂停时，可以在用户点击后调用 `resumeAudio()`。
SDK 不保证后台持续录音或播放，这取决于宿主策略。

## 凭证放在哪里？

- **App Certificate、云端模型 API Key**：只放服务端环境变量。
- **WHIP JWT**：服务端签发后临时发给客户端，授权频道并设置有效期；字符串身份在 URL 的 `stringuid` 中传入。
- **业务登录凭证**：用于访问你自己的会话后端。

参考后端使用官方 [`agora-agents`](https://github.com/AgoraIO/agora-agents-ts) 启停云端 AI。
不要把这个服务端 SDK 打进 AIUI 客户端。

## 第一版暂不包含

字幕、RTM 消息、云端 AI 的语义事件、本地工具调用和后台 Worker。
WHIP 音频本身不等于已接入 Agora 的消息通道。

## 验证

```sh
npm run check
npm run example:prepare
npm pack --dry-run
```

自动化测试覆盖清理、并发取消、连接状态、HTTP 和官方服务端 SDK 的请求格式。
模拟测试通过不能代替真实云端和设备通话验证；请使用自己的 pipeline，
在目标宿主上确认双方实际能听到声音。

更多内容：[API](docs/api.md)、[后端配置与接口](docs/backend.md)、[验证记录](docs/validation.md)。
