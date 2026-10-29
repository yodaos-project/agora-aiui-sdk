# 客户端 API 参考

[English](../api.md) · [全部文档](README.md)

完整页面用法见[AIUI Agent 接入](integration.md)。这里介绍公开的客户端 API；
TypeScript 类型定义见 [src/index.d.ts](../../src/index.d.ts)。

## 创建会话

```js
const voice = createAgoraVoiceSession({ backend, timeout: 30000 });
```

`createAgoraVoiceSession(options)` 返回 `AgoraVoiceSession`，它继承 `EventTarget`。
使用 `new AgoraVoiceSession(options)` 也一样。`backend` 与 `connection` 必须且只能选择一个。

| 参数             | 含义                                                                   | 默认值        |
| ---------------- | ---------------------------------------------------------------------- | ------------- |
| `backend`        | 实现 `VoiceBackend` 的对象，负责预留凭证、启停 AI。                    | —             |
| `connection`     | `AgoraConnection`，或 `async ({ signal }) => connection`，只连接音频。 | —             |
| `timeout`        | 启动全过程的超时时间，单位毫秒。                                       | `15000`       |
| `cleanupTimeout` | 每项独立清理操作的超时时间，单位毫秒。                                 | `5000`        |
| `microphoneMode` | `full-duplex`，或在 AI 回答时暂停收音的 `half-duplex`。                | `full-duplex` |

超时时间必须是有限正数。SDK 管理自己创建的麦克风轨道和音频上下文，
当前版本不接收调用方提供的媒体流或音频上下文。

## 开始与结束

### `start({ signal? })`

返回 `Promise<Readonly<VoiceState>>`，在用户点击时调用。
它依次准备音频、获取凭证、打开麦克风、连接媒体；使用后端时，再启动云端 AI。
失败时以 `AgoraVoiceError` 拒绝，并尝试清理资源。

`signal` 只取消启动过程。已经建立的通话用 `stop()` 结束。
重复调用 `start()` 返回同一个启动 Promise。每个实例只用一次，结束或失败后创建新实例。

返回值是状态快照，不是 Agora 云端的 `agent_id`。
后端从 Agora 启动接口获得这个 ID，应保存它用于清理和支持排查。

### `stop()`

立即停止麦克风采集，然后返回 `Promise<Readonly<VoiceCleanupReport>>`，
等待媒体、音频和后端清理。可以重复调用，返回同一个清理 Promise。
在「结束」按钮和页面卸载时调用。

```js
const cleanup = await voice.stop();
console.log(cleanup); // { media, audio, backend }
```

每项结果为 `complete`、`failed`、`timeout` 或 `not-needed`。
后端清理失败或超时后，后端仍需继续回收云端 AI。
`media: complete` 只表示本地 WHIP 关闭完成，不确认远端资源一定已删除。

## 观察状态

```js
voice.addEventListener('statechange', () => {
  const state = voice.getState();
  console.log(state.media, state.audio, state.error?.message);
});
```

`getState()` 返回只读快照。`statechange` 不携带自定义状态数据，在事件回调中重新读取即可。
快照不包含 token、连接地址和后端原始响应。SDK 不会自动输出日志。

| 字段                               | 取值或含义                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `lifecycle`                        | `idle`、`starting`、`running`、`stopping`、`stopped`、`failed`，表示整体通话进度。                   |
| `media`                            | `new`、`connecting`、`connected`、`disconnected`、`failed`、`closed`，表示实际媒体连接。             |
| `agent`                            | `not-managed`、`idle`、`starting`、`running`、`stopped`、`unknown`，表示后端确认的云端 AI 操作状态。 |
| `audio`                            | `running`、`suspended`、`closed`，表示本地音频上下文状态，创建前也是 `closed`。                      |
| `microphoneMuted` / `speakerMuted` | 布尔值，初始均为 `false`。                                                                           |
| `microphoneSuppressed`             | 轮流说话模式自动暂停麦克风传输，与用户手动静音分开。                                                 |
| `volume`                           | `0` 到 `1`，初始为 `1`。                                                                             |
| `error`                            | `null` 或 `{ code, message }`，message 可以展示给用户。                                              |
| `cleanup`                          | 清理完成前为 `null`，完成后为清理报告。                                                              |

不要只根据 `lifecycle: running` 或 `agent: running` 显示“音频已连接”。
`agent` 不反映 AI 此刻是否仍在线、正在说话。短暂媒体断开可能恢复，彻底失败会触发清理。
当前版本不会自动重建媒体会话，也不监测云端 AI 的健康状态。
RTM 文字连接状态通过 `getTranscriptState()` 单独提供。

## 控制音频

| 方法                          | 效果                                                                 |
| ----------------------------- | -------------------------------------------------------------------- |
| `setMicrophoneMuted(boolean)` | 启用或禁用本地音频轨道，保留通话。                                   |
| `setSpeakerMuted(boolean)`    | 静音播放，远端音量条仍会测量收到的声音。                             |
| `setVolume(number)`           | 设置 `[0, 1]` 的音量，取消静音后恢复该值。无效值抛出 `RangeError`。  |
| `resumeAudio()`               | 返回恢复播放的 Promise，在用户操作时调用。                           |
| `getAudioLevels()`            | 返回 `{ local, remote }`，范围均为 `[-60, 0]` dBFS，`-60` 表示静音。 |
| `getStats()`                  | 返回当前连接的 `Promise<RTCStatsReport>`。                           |

电平最多每秒测量 5 次，音频暂停时返回静音。
远端电平在扬声器音量和静音之前测量，因此静音时仍可能跳动。
诊断统计每 2–3 秒读取一次即可，结束或卸载时清除页面定时器。

### 轮流说话

示例设置了 `microphoneMode: 'half-duplex'`：AI 思考、说话和本地播放期间，暂不发送麦克风音频。
播放结束、声音安静后自动恢复，保留用户原本的手动静音选择。
暂停期间，麦克风按钮显示「等我说完」。请等 AI 说完再讲话；本地播放被暂停时，也会暂停收音。

这个模式用来避免没有回声消除的宿主把扬声器声音、回答期间的插话再次传给 AI。
它是轮流说话策略，不是回声消除。支持有效回声消除或使用耳机时，可保留默认的 `full-duplex`，
并在云端 pipeline 开启打断。已经产生的 ASR 结果仍如实显示，不会按消息到达时间删除文字。

## 显示实时对话文字

`npm run example:prepare` 会为示例准备官方 RTM 构造器：

```js
import { createAgoraVoiceSession, createAgoraRtmTranscripts } from './lib/sdk/index.js';
import AgoraRTM from './lib/sdk/rtm-vendor.js';

const transcriptSource = createAgoraRtmTranscripts({ RTM: AgoraRTM.RTM });
const voice = createAgoraVoiceSession({ backend, transcripts: transcriptSource, timeout: 45000 });
voice.addEventListener('transcriptchange', () => {
  const messages = voice.getTranscriptSnapshot();
  for (const message of messages) console.log(message.role, message.text, message.status);
});
voice.addEventListener('transcriptstatechange', () => {
  console.log(voice.getTranscriptState().status);
});
```

后端预留会话时需要返回 `rtm` 凭证。`start()` 会先登录、订阅 RTM，再启动云端 AI。
文字通过 RTM 事件推送；同步读取 `getTranscriptSnapshot()` 不会发起 HTTP 请求。
每次事件都用新的消息列表替换页面内容。同一轮的中间结果会被后续结果更新，
不要把每次更新都当成一条新消息追加。
连续通话时保留同一个 `transcriptSource`，等待 `voice.stop()` 完成后再复用。
固定账号会复用已经注销的 RTM 客户端，因为官方 SDK 不允许为相同账号再次调用构造器。
不同固定账号分别使用适配器；每次分配新账号的会话只保留最近的一个客户端，不积累实例池。

每条 `VoiceTranscript` 包含 `id`、`role`（`user` 或 `assistant`）、`text` 和 `interrupted`。
RTM 消息还包含 `status`：`in-progress`（进行中）、`final`（完成）或 `interrupted`（已打断）。
ASR 可以在整句识别结束前显示中间结果，AI 文字随服务端生成而更新。
首次出字仍受云端 ASR 处理时间影响。这些事件不与本地声音逐字同步，也不代表文字已经播放。

`getTranscriptState()` 返回 `{ status, error }`。状态为 `disabled`、`connecting`、`connected`、
`disconnected`、`failed` 或 `closed`。文字错误与 `getState().error` 分开，不会结束已经建立的语音通话。
RTM 建连默认最多等待 15 秒，可用 `createAgoraRtmTranscripts({ RTM, timeout })` 调整；
这个过程也计入整个会话的启动时限。

最多保留 20 条消息，每条最多 2,000 个字符，总计最多 12,000 个字符；过长内容会截断。
示例把最新消息显示在前面。收起文字会保留有数量限制的实时订阅，再次展开时不会丢失期间的消息。
`stop()` 会移除监听并注销本次 RTM 客户端；启用实时文字时，清理结果会额外包含 `transcripts`。

RTM 构造器由调用方传入，纯语音会话不需要加载它。示例通过专用加载器打包 RTM 2.3.0，
不会加载 Agora RTC SDK，也不会改动 Ink 的全局 API。
在 Ink Web 中，应为较大的 SDK 留出初始化时间，例如
`createInkView({ canvas, scriptExecution: { timeoutMs: 10000 } })`，保持有限的执行时限。

## 按需读取历史记录

```js
const transcripts = await voice.getTranscripts();
for (const message of transcripts) {
  console.log(message.role, message.text, message.interrupted);
}
```

`getTranscripts({ signal? })` 在后端管理的会话运行期间返回只读的对话记录快照。
每条 `VoiceTranscript` 包含 `id`、`role`（`user` 或 `assistant`）、`text` 和 `interrupted`。
用户文字是语音识别结果，助手文字是记录中的 AI 回复。
文字可能在播放完成前出现，不提供逐字时间，也不代表这些字都已经播放给用户。

这个可选方法只发起一次后端请求。示例不会用它显示实时文字，也不会轮询对话记录。
历史记录使用与实时文字相同的数量和长度限制，但没有实时 `status` 字段。

后端需要实现可选的 `getTranscripts`。直接连接和未实现此方法的旧后端会返回 `UNSUPPORTED`。
读取失败使用 `TRANSCRIPTS`，不会结束语音通话，也不会改动通话错误状态。
调用方的 signal 只取消当前读取；结束通话也会取消未完成的读取。
请只在通话仍运行时重试。

## 配置直接连接

`AgoraConnection` 示例：

```js
const connection = {
  baseURL: 'https://ap-webrtc-whip.ap.sd-rtn.com',
  channel: 'your-channel',
  uid: 'aiui-client-10001',
  token: 'temporary-raw-whip-jwt',
};
```

| 字段               | 要求                                                                   |
| ------------------ | ---------------------------------------------------------------------- |
| `baseURL`          | HTTPS 来源地址，不包含 `/pub`、用户名密码、查询参数或片段。            |
| `channel`          | 非空字符串，最多 64 个字符，并符合你的部署要求。                       |
| `uid`              | 云端 AI 使用字符串账号，1–255 个 UTF-8 字节，不含 NUL 字符。           |
| `token`            | 原始 WHIP JWT，或同步、异步返回 JWT 的函数，不要添加 `Bearer `。       |
| `rtcConfiguration` | 可选的标准 `RTCConfiguration`，默认包含 `bundlePolicy: 'max-bundle'`。 |

历史数字模式可使用 `1` 到 `4294967294` 的 `uid`，以及可选的 `stringUid` 别名，
默认别名为 `aiui-${uid}`。字符串模式如同时填写 `stringUid`，它必须等于 `uid`。
云端 AI 请统一使用字符串，见[身份与凭证](backend.md#身份与凭证)。

`agoraEndpoint(connection)` 返回编码后的双向 WHIP URL。
字符串模式使用 `?stringuid=...&duplex=true`，不包含数字 `Uid`。
历史数字模式还会发送区分大小写的 `Uid` 参数。

## 连接 HTTP 后端

```js
const backend = createHttpVoiceBackend({
  baseURL: 'https://your-backend.example.com',
  authorization: 'Bearer your-application-access-token',
  timeout: 15000,
});
```

| 参数            | 含义                                                                |
| --------------- | ------------------------------------------------------------------- |
| `baseURL`       | 后端地址，可含代理前缀。使用 HTTPS，本地开发允许回环 HTTP。         |
| `authorization` | 完整的业务 Authorization 请求头，或每次请求同步、异步返回它的函数。 |
| `timeout`       | 单次请求超时，单位毫秒，默认 `15000`。                              |
| `fetch`         | 可选的自定义 Fetch 函数，默认使用全局 `fetch`。                     |

返回实现 `VoiceBackend` 的对象，使用[后端 HTTP 接口](backend.md#http-接口)，
拒绝重定向，JSON 响应上限为 64 KiB。
在上报的过期时间临近时，按需获取新的 WHIP 凭证，但不会重连已有媒体连接。

## 处理错误

`AgoraVoiceError` 继承 `Error`，额外提供 `code`。
启动失败会使 `start()` 拒绝；通话中的失败通过 `statechange` 和 `getState().error` 通知。
构造或配置参数无效时，也可能抛出普通 JavaScript 错误。

| 错误码          | 检查什么                                |
| --------------- | --------------------------------------- |
| `UNSUPPORTED`   | Ink 宿主是否提供所需能力。              |
| `CONFIGURATION` | 连接字段和临时凭证。                    |
| `BACKEND`       | 后端网络、认证和响应。                  |
| `MICROPHONE`    | 录音权限、麦克风是否可用。              |
| `AUDIO`         | 是否已允许播放、AIUI Agent 是否在前台。 |
| `MEDIA`         | WHIP/RTC 连接与网络。                   |
| `AGENT`         | 后端启动云端 AI 的过程。                |
| `TIMEOUT`       | 启动超时、网络或服务是否可用。          |
| `ABORTED`       | 启动被取消。                            |
| `LEASE`         | 后端会话续约失败。                      |
| `TRANSCRIPTS`   | 对话文字读取失败，语音通话可以继续。    |

排查顺序见[常见问题](troubleshooting.md)。
