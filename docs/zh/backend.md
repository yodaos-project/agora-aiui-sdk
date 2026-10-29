# 配置会话后端

[English](../backend.md) · [全部文档](README.md)

会话后端负责为通话做准备：签发临时凭证，在 Ink 连接后启动云端 AI，通话结束时停止 AI。
音频不会经过它。第一次使用，请先按[入门指南](getting-started.md)跑通。

如果你的系统已经提供凭证并管理 AI，可以选择[直接连接](integration.md#使用已有临时凭证)。

## 配置参考服务

示例需要 Node.js 22+。复制 `examples/server/.env.example` 为
`examples/server/.env`，填好配置。在仓库根目录执行 `npm ci` 后，运行 `npm run example:server`。

| 环境变量                | 填什么                                                                    |
| ----------------------- | ------------------------------------------------------------------------- |
| `AGORA_APP_ID`          | Agora 项目的 App ID。                                                     |
| `AGORA_APP_CERTIFICATE` | 同一项目的签名证书，只放服务端。                                          |
| `AGORA_PIPELINE_ID`     | 已发布的 Agent Studio 配置中的 `pipeline_id`。                            |
| `AGORA_AREA`            | 云端 API 区域：`AP`、`CN`、`US` 或 `EU`，默认 `AP`。                      |
| `AGORA_WHIP_BASE_URL`   | 已开通的双向 WHIP 地址，默认 `https://ap-webrtc-whip.ap.sd-rtn.com`。     |
| `BACKEND_API_TOKEN`     | 私下测试用的随机口令，至少 24 个字符，不含空白。                          |
| `ALLOWED_ORIGINS`       | 允许访问后端的 Web 宿主来源，以逗号分隔，例如 `https://app.example.com`。 |
| `HOST` / `PORT`         | 监听地址，默认 `127.0.0.1` / `8787`。                                     |

获取 `pipeline_id`：发布助手后，打开 **Agents → Action → Embed Agent**，复制代码中的 ID。
持续通话时，不要重复使用示例代码里的临时 token，见 [Agora 嵌入指南](https://docs.agora.io/en/ai/studio/deploy/connect-agent)。

Pipeline 提供语音识别、模型和声音配置。
参考服务通过 [Agora 官方服务端 SDK](https://github.com/AgoraIO/agora-agents-ts)启停助手。
官方服务端 SDK 放在后端，本项目的客户端 SDK 放在 Ink 应用中。

## 分清三个地址

| 地址                  | 用来做什么                                        |
| --------------------- | ------------------------------------------------- |
| 你的后端地址          | 应用请求创建、启动、停止和续约会话。              |
| `AGORA_WHIP_BASE_URL` | 应用与 Agora 建立实时音频连接。                   |
| Agora 云端 Agent API  | 后端请求启动、停止 AI，由 `AGORA_AREA` 选择区域。 |

部署时，后端使用 HTTPS。客户端只允许在 localhost/回环地址使用 HTTP 做本地开发。
手机无法通过 `127.0.0.1` 访问你的电脑，请使用设备可访问的 HTTPS 服务。

Ink Web 需要在 `ALLOWED_ORIGINS` 中填写宿主页面的准确来源，包含协议和实际使用的端口。
例如 `http://localhost:5173` 与 `http://127.0.0.1:5173` 是两个来源。
CORS 决定浏览器能否跨域访问，Authorization 仍负责验证每次会话请求。

## 身份与凭证

连接云端 AI 时，使用**同一频道中的两个不同字符串账号**：

- 客户端，例如 `aiui-client-10001`。
- 云端 AI，例如 `agent-10001`。

参考后端会为每次通话自动配置。如果你自己启动 AI，需要设置 `enable_string_uid: true`，
将 `agent_rtc_uid` 设为 AI 的账号，并在 `remote_rtc_uids` 中填入完全一致的客户端账号。

三种凭证各有用途：

| 凭证              | 谁发给谁          | 用途                                                       |
| ----------------- | ----------------- | ---------------------------------------------------------- |
| 应用登录凭证      | 应用 → 你的后端   | 允许用户操作自己的会话。私下测试使用 `BACKEND_API_TOKEN`。 |
| WHIP JWT          | 应用 → Agora WHIP | 允许建立音频连接，由服务端签发临时提供给应用。             |
| RTC/ConvoAI Token | 后端 → Agora      | 验证云端操作，以及 AI 参与者的频道身份。                   |

自己签发时，可以参考 `examples/server/token.js`。字符串模式的 WHIP JWT 包含
`version`、`appID`、`streamID`、`exp`、`action: 'pub'` 和 `enableSubAuth: true`，
不包含 `uid`。客户端身份通过 URL 的 `stringuid` 参数传递。
使用 Certificate 的原始文本做 HS256 签名，不要先将它按十六进制解码。
SDK 构建的双向 URL 不包含数字 `Uid` 参数。

参考后端用 `agora-token` 的 `RtcTokenBuilder.buildTokenWithRtm` 为 AI 的准确字符串账号生成凭证，
再显式传给 `agora-agents@2.12.0`。这个版本的 `AgentSession` 自动生成凭证流程要求数字 UID，
因此不能直接替换。停止和清理查询也会使用新凭证。
请同步更新客户端和后端：旧的纯数字客户端无法读取字符串账号的会话结果。

## 使用自己的后端

App Certificate 和模型 API Key 保留在服务端。
将示例中的共享口令验证替换成应用的用户登录验证，并返回稳定的用户 ID。
每次操作都应确认会话属于这个用户。

实现下方 HTTP 接口后，可以直接使用 `createHttpVoiceBackend`。
如果已有不同的业务接口，实现 [src/index.d.ts](../../src/index.d.ts) 中的 `VoiceBackend` 方法即可：

| 方法                                  | 负责什么                                             |
| ------------------------------------- | ---------------------------------------------------- |
| `createSession({ signal })`           | 预留凭证，返回 `{ id, whip, lease? }`，先不启动 AI。 |
| `startAgent({ sessionId, signal })`   | 应用媒体连接完成后，启动 AI。                        |
| `stopSession({ sessionId, signal })`  | 停止 AI、释放预留会话，也要处理较晚才完成的启动。    |
| `renewSession({ sessionId, signal })` | 返回 `{ lease }`。会话包含租约时必须实现。           |

## HTTP 接口

所有操作都是已认证、**不带请求体的 POST 请求**，返回 JSON。
独立示例的路径从 `/voice/sessions` 开始。
如果通过代理添加路径前缀，客户端 `baseURL` 也可以包含这个前缀。

### 预留会话

`POST /voice/sessions` 返回 HTTP 201：

```json
{
  "id": "a-server-generated-session-id",
  "whip": {
    "baseURL": "https://ap-webrtc-whip.ap.sd-rtn.com",
    "channel": "aiui-server-generated-channel",
    "uid": "aiui-server-generated-client",
    "token": "temporary-whip-jwt",
    "tokenExpiresAt": 1800000000000
  },
  "lease": {
    "expiresAt": 1800000000000,
    "renewAfterMs": 30000
  }
}
```

频道和参与者身份由服务端生成。HTTP 适配器要求返回 `tokenExpiresAt`。
HTTP 接口时间戳使用 Unix **毫秒**，JWT 的 `exp` 使用**秒**。
租约可以理解为会话的有效期：客户端定期延长，后端据此回收失联客户端留下的通话。

### 管理已预留的会话

以下操作成功时返回 HTTP 200：

| 接口                        | 返回值                                                               | 行为                                                    |
| --------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| `/voice/sessions/:id/start` | `{ "agent": "running" }`                                             | 重复、并发请求最多启动一个 AI，已结束的会话不能再启动。 |
| `/voice/sessions/:id/stop`  | `{ "stopped": true }`                                                | 确认云端已清理，包括仍在启动中的 AI；允许重复停止。     |
| `/voice/sessions/:id/renew` | `{ "lease": { "expiresAt": 1800000000000, "renewAfterMs": 30000 } }` | 延长有效租约，拒绝已结束的会话。                        |
| `/voice/sessions/:id/token` | `{ "token": "fresh-whip-jwt", "tokenExpiresAt": 1800000000000 }`     | 为已预留频道签发新 WHIP 凭证。                          |

`agent: running` 表示启动请求被确认，不是持续的在线状态通知。
参考后端发生错误时，以非 2xx 状态返回 `{ "error": "CODE" }`。
客户端显示安全的 `BACKEND` 错误，需要具体原因时查看服务端日志。

## 部署前需要调整什么？

参考服务采用**单进程内存存储**。默认最多 20 个活动会话，租约有效期 90 秒，
可续约；每次通话最长 30 分钟，每 10 秒清理一次。
这些是 `createSessionService` 中的示例策略，不是 SDK 或 Agora 的统一保证。

正式服务应持久保存用户归属、频道和 UID、云端 `agent_id`、待完成的启动以及清理状态。
多个服务实例之间要协调重复操作，并独立于客户端请求执行清理。
启动结果不确定时，应按预留频道查询，并考虑云端结果可能延迟可见。

停止失败时保留记录重试。示例进程重启会丢失内存记录；页面卸载、响应丢失也可能使最终清理无法确认。
Token 过期和 AI 的 60 秒空闲超时，不能代替后端清理，也不能保证最长通话时间。

继续阅读：[客户端 API](api.md) · [常见问题](troubleshooting.md)
