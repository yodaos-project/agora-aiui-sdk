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

| 参数             | 含义                                                                   | 默认值  |
| ---------------- | ---------------------------------------------------------------------- | ------- |
| `backend`        | 实现 `VoiceBackend` 的对象，负责预留凭证、启停 AI。                    | —       |
| `connection`     | `AgoraConnection`，或 `async ({ signal }) => connection`，只连接音频。 | —       |
| `timeout`        | 启动全过程的超时时间，单位毫秒。                                       | `15000` |
| `cleanupTimeout` | 每项独立清理操作的超时时间，单位毫秒。                                 | `5000`  |

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
| `volume`                           | `0` 到 `1`，初始为 `1`。                                                                             |
| `error`                            | `null` 或 `{ code, message }`，message 可以展示给用户。                                              |
| `cleanup`                          | 清理完成前为 `null`，完成后为清理报告。                                                              |

不要只根据 `lifecycle: running` 或 `agent: running` 显示“音频已连接”。
`agent` 不反映 AI 此刻是否仍在线、正在说话。短暂媒体断开可能恢复，彻底失败会触发清理。
当前版本没有自动重连，也没有订阅云端状态事件。

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

排查顺序见[常见问题](troubleshooting.md)。
