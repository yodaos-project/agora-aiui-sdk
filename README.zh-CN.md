# Agora AIUI SDK

**让你的 AIUI Agent 开口说话，成为可以自然交谈的 AI 助手。**

[![检查](https://github.com/yodaos-project/agora-aiui-sdk/actions/workflows/check.yml/badge.svg)](https://github.com/yodaos-project/agora-aiui-sdk/actions/workflows/check.yml)
[![许可证：MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[English](README.md) · 简体中文

[开始使用](docs/zh/getting-started.md) · [体验示例](examples/agent) · [API 参考](docs/zh/api.md)

## 什么是 Voice Agent？

Voice Agent 是一个可以用语音交流的 AI 助手。你提出问题，它听懂后用语音回答。
开启插话后，你也可以在它回答时打断，继续追问或换个话题。

语音交互让用户解放双手，把注意力留在正在做的事情上，适合 AI 眼镜、语言练习、
互动讲解和操作指导等场景。

**Agora AIUI SDK** 为运行在 [Ink](https://github.com/jsar-project/ink) 上的 AIUI Agent
接入这些能力。AIUI Agent 负责采集声音、播放回答，Agora Cloud 负责语音识别、
大模型推理和语音合成。你可以在 Agora Agent Studio 中配置助手的角色、语言和声音。

## 可以用来做什么？

| 场景         | 用户可以这样说               |
| ------------ | ---------------------------- |
| AI 眼镜助手  | “告诉我下一步怎么做。”       |
| 语言练习     | “陪我练习用英语点一杯咖啡。” |
| 互动讲解     | “介绍一下这件展品。”         |
| 产品使用引导 | “带我一步步完成设置。”       |

## 从一个语音伙伴开始

项目附带名为「**小语**」的语音示例，界面适合眼镜尺寸，支持彩色和单绿主题。
你可以直接体验，也可以改造成自己的 AIUI Agent。

- **自然对话**：双向语音，支持麦克风和扬声器控制。
- **随时插话**：宿主具备回声消除或使用耳机时，可以在 AI 回答中打断。
- **看见识别结果**：你最新说的话在一行中实时更新。
- **感知对话状态**：动态语音球呈现聆听、思考、说话和确认打断的状态。
- **保持界面流畅**：原生 Ink 将实时文字处理放在 Agent Worker 中，与页面动画和音频分开运行。

SDK 还提供 AI 回复文字、音频电平、连接状态和音量控制，方便你设计自己的界面。
示例不展示 AI 回复文字，让用户专注于语音交流。

音频使用 Ink 的 WHIP 和 WebRTC 能力；实时文字使用官方 Agora RTM SDK，
由示例的 Worker 加载。项目提供 JavaScript 模块和 TypeScript 类型声明。

## 跑通第一次对话

你需要准备：

- Node.js 22+，以及支持麦克风、WHIP 和 Worker 联网的新版 Ink 宿主。
- 已开通双向 WHIP 和 Signaling（RTM）的 Agora 项目。
- 在 Agora Agent Studio 中发布的语音助手，以及它的 `pipelineId`。

```sh
git clone https://github.com/yodaos-project/agora-aiui-sdk.git
cd agora-aiui-sdk
npm ci
npm run example:prepare
```

按照 **[入门指南](docs/zh/getting-started.md)** 获取 Agora 配置、设置参考后端，
再为 AIUI Agent 填写后端地址和登录凭证。

配置完成后，在一个终端启动后端：

```sh
npm run example:server
```

在另一个终端打开示例：

```sh
ink-open examples/agent --networking-transport native --permission-checks --theme yodaos-sprite-color
```

点击「**开始聊天**」，允许使用麦克风，再问一个问题。也可以在较长的回答中尝试插话。
结束时点击「**结束**」。通话期间保持 AIUI Agent 在前台；切换窗口后如果播放暂停，
点击「**继续聊天**」。

## 接入自己的 AIUI Agent

使用 npm 打包的项目，可以从 GitHub 安装：

```sh
npm install github:yodaos-project/agora-aiui-sdk
```

直接加载本地脚本的 AIUI Agent，可以选择[复制 SDK 模块](docs/zh/integration.md#使用本地脚本的-aiui-agent)。
准备好后端和应用登录配置后：

```js
import { createAgoraVoiceSession, createHttpVoiceBackend } from '@yodaos-pkg/agora-aiui-sdk';
import configuration from './configuration.js';

const backend = createHttpVoiceBackend({
  baseURL: configuration.backendURL,
  authorization: configuration.authorization,
});
const voice = createAgoraVoiceSession({ backend });

// 在「开始」按钮的处理函数中调用：
await voice.start();

// 在「结束」按钮或页面卸载时调用：
await voice.stop();
```

每次通话创建一个新的 session。[接入指南](docs/zh/integration.md)提供完整页面示例，
包括生命周期和音频控制。需要实时文字时，可以参考[示例 Worker](examples/agent/workers/transcripts.js)。

## 它们如何协作？

| 组成部分     | 负责什么                          |
| ------------ | --------------------------------- |
| AIUI Agent   | 采集声音、播放回答、呈现对话。    |
| 你的会话后端 | 签发临时凭证，启动和停止云端 AI。 |
| Agora Cloud  | 传输音频，运行你配置的语音助手。  |

音频直接在 Ink 和 Agora Cloud 之间传输，会话后端负责连接准备和结束清理。
你可以使用项目中的 Node.js 参考后端，也可以接入已有服务；如果系统已经管理云端 AI，
还可以[使用已有临时凭证](docs/zh/integration.md#使用已有临时凭证)。

**App Certificate 和模型 API Key 只放在服务端。**
参考后端会为 AIUI Agent 和云端 AI 分配不同的字符串 UID。

## 兼容性与验证

macOS 示例已经连接真实 Agora，验证语音、实时 ASR、插话和连续连接、结束。
用户确认说话和插话均流畅；性能数据和各宿主的验证范围见[验证记录](docs/zh/validation.md#真实云端验证)。

原生 Ink 会用独立线程运行 RTM Worker。Ink Web 的 Worker realm 目前仍共享浏览器主事件循环，
Web 性能需要单独验证。没有回声消除的宿主请使用耳机，或改用[轮流说话模式](docs/zh/api.md#轮流说话)。

当前版本专注于前台语音对话。自动重连、后台通话、通用聊天消息、本地工具调用，
以及与播放逐字同步的字幕，暂不在当前 API 范围内。

## 文档导航

| 我想……                     | 阅读                                   |
| -------------------------- | -------------------------------------- |
| 完成第一次语音对话         | [入门指南](docs/zh/getting-started.md) |
| 给 AIUI Agent 加入语音能力 | [接入指南](docs/zh/integration.md)     |
| 配置 Agora 和登录认证      | [后端指南](docs/zh/backend.md)         |
| 查找方法和参数             | [API 参考](docs/zh/api.md)             |
| 排查连接或声音问题         | [常见问题](docs/zh/troubleshooting.md) |
| 运行测试或参与开发         | [开发与验证](docs/zh/validation.md)    |

## 参与贡献

问题、建议和反馈，欢迎提交到 [GitHub Issues](https://github.com/yodaos-project/agora-aiui-sdk/issues)。
请附上 Ink 宿主、SDK 版本和简短复现步骤，去掉凭证信息。

```sh
npm ci
npm run check
```

项目采用 [MIT 许可证](LICENSE)。Agora 云端用量按你的 Agora 套餐计费。
