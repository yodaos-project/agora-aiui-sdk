# 完成第一次语音对话

[English](../getting-started.md) · [全部文档](README.md)

这份指南使用项目自带的 AIUI Agent 和 Node.js 参考后端，带你完成一次“说话 → AI 回答”的测试。
建议先在同一台电脑上跑通，再尝试手机或眼镜。

## 1. 准备 Agora 和 Ink

先准备好以下内容。未安装 Node.js 时，可以从[官网](https://nodejs.org/en/download)下载。
Ink 桌面程序可在 [Ink Releases](https://github.com/jsar-project/ink/releases) 获取，
选择与你的系统对应、包含 WHIP 支持的 `ink-open` 可执行文件。

示例的实时文字需要使用包含
[Page–Worker 消息通道和 Worker WebSocket](https://github.com/jsar-project/ink/pull/800)
支持的新版 Ink。

| 所需内容                        | 从哪里获取                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| Node.js 22+ 和 Git              | 安装在开发电脑上。                                                                             |
| Ink 宿主                        | 使用包含 `WHIPSession`、WebRTC、Web Audio 和麦克风能力的 Ink 构建。桌面端可以使用 `ink-open`。 |
| Agora App ID 和 App Certificate | 在 Agora 项目设置中获取。Certificate 只保存在后端。                                            |
| 双向 WHIP 地址                  | 确认 Agora 已为你的项目和区域开通双向 WHIP。                                                   |
| Signaling（RTM）                | 为同一个 Agora 项目启用 Signaling，用来接收实时对话文字。                                      |
| 已发布的语音 pipeline           | 在 Agora Agent Studio 中配置并发布一个语音助手。                                               |

先在 Studio 测试面板中确认可以与助手语音对话。
根据用户的语言，配置好语音识别、模型和发音服务。

**`pipelineId` 怎么找？** 在已发布的助手上打开 **Agents → Action → Embed Agent**，
从生成的代码中复制 `pipeline_id`。只需复制这个 ID，后端会为每次通话创建新的频道、身份和凭证。
也可以查看 [Agora 官方说明](https://docs.agora.io/en/ai/studio/deploy/connect-agent)。

请确认 pipeline 与 App ID 可以配合使用。云端用量可能计入你的 Agora 项目费用。

## 2. 下载并准备示例

```sh
git clone https://github.com/yodaos-project/agora-aiui-sdk.git
cd agora-aiui-sdk
npm ci
npm run example:prepare
```

`example:prepare` 会把客户端 SDK 复制到示例 AIUI Agent 中，供 Ink 加载。
修改 SDK 源码后，需要重新执行这条命令。

## 3. 配置并启动后端

在仓库根目录执行：

```sh
cp examples/server/.env.example examples/server/.env
```

编辑 `examples/server/.env`，替换占位内容：

```dotenv
AGORA_APP_ID=your-app-id
AGORA_APP_CERTIFICATE=your-app-certificate
AGORA_PIPELINE_ID=your-published-pipeline-id
AGORA_AREA=AP
AGORA_WHIP_BASE_URL=https://ap-webrtc-whip.ap.sd-rtn.com
BACKEND_API_TOKEN=your-random-private-demo-token
ALLOWED_ORIGINS=http://localhost:5173
HOST=127.0.0.1
PORT=8787
```

区域和 WHIP 地址以你的部署为准。上面的 `AP` 配置是示例默认值，不代表你的项目一定已经开通。
生成一个至少 24 个字符的测试口令：

```sh
node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"
```

把生成的值填入 `BACKEND_API_TOKEN`，然后启动：

```sh
npm run example:server
```

保持这个终端运行。看到 `Voice backend is listening.` 就表示开始监听了。
默认地址为 `http://127.0.0.1:8787`。

本次桌面测试将后端运行在你的电脑上。正式部署时，换成自己的 HTTPS 服务。
音频直接在 Ink 与 Agora Cloud 之间传输。

## 4. 为 AIUI Agent 填写后端地址

将 `examples/agent/configuration.js` 改为：

```js
export default {
  backendURL: 'http://127.0.0.1:8787',
  async authorization() {
    return 'Bearer paste-the-same-BACKEND_API_TOKEN-here';
  },
};
```

把 `Bearer ` 后面的占位内容替换成第 3 步的口令。
这个共享口令只用于私下测试；发布 AIUI Agent 时，需要换成业务用户登录凭证。
不要在这里填写 Agora App Certificate，也不要提交已填写口令的文件；分享改动前恢复占位配置。

## 5. 打开 AIUI Agent，开始说话

确认 `ink-open` 已加入 PATH，在另一个终端的仓库根目录执行：

```sh
ink-open examples/agent --networking-transport native --permission-checks
```

如果可执行文件在其他位置，用完整路径替换 `ink-open`。
示例已声明 `RECORD_AUDIO` 权限。宿主或系统询问时，请允许使用麦克风。

1. 点击「开始聊天」。
2. 等待显示「正在聆听」和「Agora · 已连接」。
3. 用助手配置的语言，问一个简短问题。
4. 听 AI 回答。是否主动播放欢迎语，取决于你的 pipeline。
5. 你说的话会在一行中实时更新；语音球显示聆听、思考、说话和确认打断的状态，不展示 AI 回复文字。
6. 测试完毕，点击「结束」。

通话时保持 Ink 在前台。切回窗口后如果音频暂停，点击提示中的「继续聊天」。

判断成功的标准是：你确实听到了针对自己问题的回答。
连接指示和音量条可以帮助判断状态，但不能代替实际听音。

## 换到其他宿主

- **Ink Web**：以完整前台 AIUI Agent 打开，允许录音，使用 HTTPS 后端。
  在 `createInkView` 中为 SDK 设置有限的初始化时限，例如 `scriptExecution: { timeoutMs: 10000 }`。
  在 `ALLOWED_ORIGINS` 中加入 Web 宿主页面的准确来源，见[宿主要求](integration.md#宿主要求)。
- **Android 或眼镜**：部署设备可访问的 HTTPS 后端，再修改 `backendURL`。
  设备上的 `127.0.0.1` 指设备自己，不是你的电脑。

遇到问题先看[常见问题](troubleshooting.md)。示例跑通后，再[接入自己的 AIUI Agent](integration.md)。
