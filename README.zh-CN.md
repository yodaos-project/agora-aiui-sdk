# Agora AIUI SDK

**让你的 AIUI Agent 开口说话，打造可以自然交谈的 AI 助手。**

[![检查](https://github.com/yodaos-project/agora-aiui-sdk/actions/workflows/check.yml/badge.svg)](https://github.com/yodaos-project/agora-aiui-sdk/actions/workflows/check.yml)
[![许可证：MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[English](README.md) · 简体中文

[开始使用](docs/zh/getting-started.md) · [文档](docs/zh/README.md) · [示例 AIUI Agent](examples/agent) · [API](docs/zh/api.md)

## 什么是 Voice Agent？

Voice Agent 是一个能听、能理解、能回答的 AI 语音助手。你对着麦克风提问，
它理解你的话，再用语音回答。用户无需打字或一直盯着屏幕，就能与 AIUI Agent 交流。

使用这个 SDK 时，你的 AIUI Agent 运行在 [Ink](https://github.com/jsar-project/ink) 中，负责采集声音和播放回答，
Agora 云端的 Voice Agent 负责语音识别、大模型推理和语音合成。
你可以在 Agora Agent Studio 中选择这些服务，配置助手的角色、语言和声音。

### 为什么使用语音交互？

- **解放双手**：适合 AI 眼镜，以及需要边做事边获取帮助的场景。
- **降低使用门槛**：让用户用自己的话表达需求。
- **边聊边引导**：通过对话完成讲解、操作指导或练习。

### 可以用来做什么？

| 场景         | 用户可以这样说               |
| ------------ | ---------------------------- |
| AI 眼镜助手  | “告诉我下一步怎么做。”       |
| 语言练习     | “陪我练习用英语点一杯咖啡。” |
| 产品使用引导 | “这个功能怎么用？”           |
| 互动讲解     | “介绍一下这件展品。”         |

这些是应用方向。助手知道什么、使用哪种语言、如何回答，取决于你提供的云端配置。

## 这个 SDK 提供什么？

- **双向语音**：通过 Agora WHIP 和 WebRTC 发送麦克风声音、播放 AI 回答。
- **通话控制**：连接、结束、麦克风静音、扬声器静音和音量调节。
- **状态反馈**：读取连接状态，以及本地和远端的音频电平。
- **灵活接入**：使用参考后端、接入已有业务后端，或直接使用临时凭证。
- **可改造的示例**：适合眼镜尺寸的 Ink 页面，适配彩色和单绿主题。

客户端使用 Ink 自带的媒体能力，没有额外运行时依赖。
项目提供 JavaScript 模块和 TypeScript 类型声明。

## 先跑通示例

你需要 Node.js 22+、支持 WHIP 和麦克风的 Ink 宿主、已开通双向 WHIP 的 Agora 项目，
以及一个在 Agent Studio 中发布的语音助手。Agora 云端用量可能按你的套餐产生费用。

```sh
git clone https://github.com/yodaos-project/agora-aiui-sdk.git
cd agora-aiui-sdk
npm ci
npm run example:prepare
```

接下来按照 **[入门指南](docs/zh/getting-started.md)** 配置 Agora、启动参考后端，
再用 Ink 打开示例。指南会逐步说明每个参数从哪里获取，包括 `pipelineId`。

第一次测试的目标：点击「开始聊天」，说一句话，听到 AI 回答，再点击「结束通话」。
通话期间请保持 AIUI Agent 在前台。

## 用 JavaScript 发起通话

使用 npm 打包的项目，可以从 GitHub 安装：

```sh
npm install github:yodaos-project/agora-aiui-sdk
```

准备好后端和 AIUI Agent 配置后，按下面的方式发起通话。
直接加载本地脚本的 AIUI Agent，可以选择[复制 SDK 文件](docs/zh/integration.md#使用本地脚本的-aiui-agent)。

```js
import { createAgoraVoiceSession, createHttpVoiceBackend } from '@yodaos-pkg/agora-aiui-sdk';
import configuration from './configuration.js';

const backend = createHttpVoiceBackend({
  baseURL: configuration.backendURL,
  authorization: configuration.authorization,
});

const voice = createAgoraVoiceSession({ backend });

voice.addEventListener('statechange', () => {
  console.log(voice.getState());
});

// 在用户点击「连接」时调用。
await voice.start();
```

在「结束」按钮和页面卸载时调用 `voice.stop()`。下一次通话需要创建新的 session。
安装方式、页面生命周期和音频控制，见[接入自己的 AIUI Agent](docs/zh/integration.md)。

## 它们如何协作？

| 组成部分            | 负责什么                           |
| ------------------- | ---------------------------------- |
| AIUI Agent + 本 SDK | 采集语音、播放回答、展示通话控制。 |
| 你的会话后端        | 签发临时凭证，启动和停止云端 AI。  |
| Agora Cloud         | 传输音频，运行你配置的 AI 对话。   |

音频直接在 Ink 和 Agora Cloud 之间传输，会话后端负责连接准备和结束清理。
项目中的 Node.js 后端可以作为你自己服务的起点；也可以[使用已有临时凭证连接](docs/zh/integration.md#使用已有临时凭证)。

**App Certificate 和模型 API Key 只放在服务端。**
参考后端会为 AIUI Agent 和云端 AI 分配不同的**字符串 UID**，满足本次云端语音接入的身份要求。

## 文档导航

| 我想……                         | 阅读                                      |
| ------------------------------ | ----------------------------------------- |
| 完成第一次语音对话             | [入门指南](docs/zh/getting-started.md)    |
| 给已有 AIUI Agent 加入语音能力 | [AIUI Agent 接入](docs/zh/integration.md) |
| 配置 Agora 或接入自己的后端    | [后端指南](docs/zh/backend.md)            |
| 查找方法和参数                 | [API 参考](docs/zh/api.md)                |
| 排查无声、连接失败、播放中断   | [常见问题](docs/zh/troubleshooting.md)    |
| 了解测试范围或参与开发         | [开发与验证](docs/zh/validation.md)       |

0.1.0 版本专注于前台语音对话，暂不包含字幕、RTM 消息、本地工具调用、自动重连和后台通话。
Ink Web 已通过真实云端的多轮语音测试；各宿主的验证范围和待验证事项，见[验证记录](docs/zh/validation.md#真实云端验证)。

## 参与贡献

发现问题或有建议？欢迎[提交 Issue](https://github.com/yodaos-project/agora-aiui-sdk/issues)。
请附上 Ink 宿主、SDK 版本和简短复现步骤，去掉凭证信息。

```sh
npm ci
npm run check
```

欢迎贡献代码和文档。项目采用 [MIT 许可证](LICENSE)。
