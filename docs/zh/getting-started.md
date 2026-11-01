# 完成第一次语音对话

[English](../getting-started.md) · [全部文档](README.md)

这份指南使用项目自带的 AIUI Agent 和 Node.js 参考后端，带你完成一次“说话 → AI 回答”的测试。
建议先在同一台电脑上跑通，再尝试手机或眼镜。

## 1. 安装工具

先准备好以下内容。未安装 Node.js 时，可以从[官网](https://nodejs.org/en/download)下载。
Ink 桌面程序可在 [Ink Releases](https://github.com/jsar-project/ink/releases) 获取，
选择与你的系统对应、包含 WHIP 支持的 `ink-open` 可执行文件。

示例的实时文字需要使用包含
[Page–Worker 消息通道和 Worker WebSocket](https://github.com/jsar-project/ink/pull/800)
支持的新版 Ink。

| 所需内容                       | 从哪里获取                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| Node.js 22+ 和 Git             | 安装在开发电脑上。                                                                             |
| Ink 宿主                       | 使用包含 `WHIPSession`、WebRTC、Web Audio 和麦克风能力的 Ink 构建。桌面端可以使用 `ink-open`。 |
| 项目 App ID 和 App Certificate | 在声网或 Agora 项目设置中获取。Certificate 只保存在后端。                                      |
| 双向 WHIP 地址                 | 确认服务商已为你的项目和区域开通双向 WHIP。                                                    |
| Signaling（RTM）               | 为同一个项目启用 Signaling，用来接收实时对话文字。                                             |
| 已发布的语音 pipeline          | 在 AI Studio 中配置并发布一个语音助手。                                                        |

### 从零注册并配置声网（中国）

1. 打开[声网控制台](https://console.shengwang.cn/)，注册并登录。根据控制台提示完成账号所需的验证。
2. 创建**通用项目**，鉴权选择安全模式。在项目总览复制 **App ID** 和**主要证书（App Certificate）**。证书是密钥，只放在后端，勿发给他人或提交到 Git。
3. 在该项目的「全部产品」中开通**对话式 AI 引擎**和 **Signaling（RTM）**。还需要向声网确认项目已开通**双向 WHIP**及可用的服务地址。详见[声网开通服务指南](https://doc.shengwang.cn/doc/toybox/iot/get-started/enable-service)。
4. 在 AI Studio 新建智能体，选择当前项目，配置中文语音识别（ASR）、大模型（LLM）和语音合成（TTS）。按所选服务的提示配置供应商密钥；这些服务可能分别计费。
5. 在 Studio 测试面板允许麦克风，与智能体说话并听到回答。**保存后还要发布**：草稿列表中的 Pipeline ID 显示 `-` 时，先发布，再查看已发布智能体的 Pipeline ID 或嵌入代码中的 `pipeline_id`。

记录项目的 App ID、主要证书、已发布的 Pipeline ID、开通的 WHIP 地址。不要把嵌入代码里的临时 token 当作 Pipeline ID；本示例后端会为每次会话生成新 token 和不同的字符串 UID。

### 从零注册并配置 Agora 国际站

1. 前往 [Agora Console](https://console.agora.io/) 注册并登录。在 Projects 创建项目，选择 **APP ID + Token** 安全模式。
2. 打开项目详情，复制 **App ID** 和 **Primary Certificate**。在项目中启用 Conversational AI Engine 与 Signaling（RTM），并联系 Agora 确认双向 WHIP 已开通及对应地址。[项目和证书说明](https://docs.agora.io/en/realtime-media/rtc/reference/console-overview)
3. 打开 Agent Studio 创建语音智能体，配置 ASR、LLM、TTS 和语言；根据供应商要求配置 API key。先在测试面板听到回答，再发布智能体。[智能体配置说明](https://docs.agora.io/en/ai/studio/build/customize-agent)
4. 在 **Agents → Action → Embed Agent** 中，从生成代码复制 `pipeline_id`。草稿需要先发布。[官方操作说明](https://docs.agora.io/en/ai/studio/deploy/connect-agent)

请选择与你的项目匹配的一套服务，避免混用两边的项目、证书和 Pipeline。控制台界面可能变化，请以官方说明为准。

## 2. 下载并准备示例

```sh
git clone https://github.com/yodaos-project/agora-aiui-sdk.git
cd agora-aiui-sdk
npm ci
npm run example:prepare
```

`example:prepare` 会构建 RTM Worker 资源，并将本地 SDK 依赖安装到示例的 `node_modules`。
修改 SDK 源码后，需要重新执行这条命令。

## 3. 配置并启动后端

在仓库根目录执行：

```sh
cp examples/server/.env.example examples/server/.env
```

使用声网中国时，改为复制到 `examples/server/.env.shengwang`：

```sh
cp examples/server/.env.example examples/server/.env.shengwang
```

编辑你刚复制的配置文件：国际站用 `examples/server/.env`，声网中国用 `examples/server/.env.shengwang`。先填入项目凭证，再按下方区域说明调整：

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

声网中国请编辑 `.env.shengwang` 中同名字段，并调整：

```dotenv
AGORA_AREA=CN
AGORA_AGENTS_API_BASE_URL=https://api.sd-rtn.com
AGORA_WHIP_BASE_URL=replace-with-your-enabled-whip-url
```

将 WHIP 地址替换为声网确认已为项目开通的地址。本项目曾用 `https://ap-webrtc-whip.ap.sd-rtn.com` 与声网项目实测通话；这不代表它适用于所有项目或保证中国境内数据驻留。

区域和 WHIP 地址以你的部署为准。上面的 `AP` 配置是示例默认值，不代表你的项目一定已经开通。
生成一个至少 24 个字符的测试口令：

```sh
node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"
```

把生成的值填入 `BACKEND_API_TOKEN`，然后启动：

```sh
npm run example:server
```

声网中国运行 `npm run example:server:cn`，读取 `.env.shengwang`。不要同时启动两个占用同一端口的后端。

保持这个终端运行。看到 `Voice backend is listening.` 就表示开始监听了。
默认地址为 `http://127.0.0.1:8787`。

本次桌面测试将后端运行在你的电脑上。正式部署时，换成自己的 HTTPS 服务。
音频直接在 Ink 与 Agora Cloud 之间传输。

## 4. 为 AIUI Agent 填写后端地址

示例默认 `provider: 'agora'`，显示英文界面和 **Agora Cloud**。使用
[声网后端](backend.md)时，改为 `provider: 'shengwang'`，显示中文界面和
**声网 Cloud**。它只切换界面；云端区域在后端配置，对话语言在 pipeline 中配置。

将 `examples/agent/configuration.js` 改为：

```js
export default {
  provider: 'agora',
  backendURL: 'http://127.0.0.1:8787',
  localTools: false,
  microphoneMode: 'full-duplex',
  async authorization() {
    return 'Bearer paste-the-same-BACKEND_API_TOKEN-here';
  },
};
```

把 `Bearer ` 后面的占位内容替换成第 3 步的口令。
使用声网中国时，将 `provider` 改成 `shengwang`。初次对话保持 `localTools: false`；需要语音改色和挂断时，按[本地工具指南](local-tools.md)配置公网 HTTPS 回调后再启用。
这个共享口令只用于私下测试；发布 AIUI Agent 时，需要换成业务用户登录凭证。
不要在这里填写 Agora App Certificate，也不要提交已填写口令的文件；分享改动前恢复占位配置。

## 5. 打开 AIUI Agent，开始说话

确认 `ink-open` 已加入 PATH，在另一个终端的仓库根目录执行：

```sh
ink-open examples/agent --networking-transport native --permission-checks
```

如果可执行文件在其他位置，用完整路径替换 `ink-open`。
示例已声明 `RECORD_AUDIO` 权限。宿主或系统询问时，请允许使用麦克风。

1. 点击 **Let’s talk**（声网版为「开始聊天」）。
2. 等待显示 **Listening**（声网版为「正在聆听」），Cloud 旁的连接指示点亮起。
3. 用助手配置的语言，问一个简短问题。
4. 听 AI 回答。是否主动播放欢迎语，取决于你的 pipeline。
5. 你说的话会在一行中实时更新；语音球显示聆听、思考、说话和确认打断的状态，不展示 AI 回复文字。
6. 测试完毕，点击 **End**（声网版为「结束」）。

通话时保持 Ink 在前台。切回窗口后如果音频暂停，点击 **Resume**（声网版为「继续聊天」）。

判断成功的标准是：你确实听到了针对自己问题的回答。
连接指示和音量条可以帮助判断状态，但不能代替实际听音。

## 换到其他宿主

- **Ink Web**：以完整前台 AIUI Agent 打开，允许录音，使用 HTTPS 后端。
  在 `createInkView` 中为 SDK 设置有限的初始化时限，例如 `scriptExecution: { timeoutMs: 10000 }`。
  在 `ALLOWED_ORIGINS` 中加入 Web 宿主页面的准确来源，见[宿主要求](integration.md#宿主要求)。
- **Android 或眼镜**：部署设备可访问的 HTTPS 后端，再修改 `backendURL`。
  设备上的 `127.0.0.1` 指设备自己，不是你的电脑。

遇到问题先看[常见问题](troubleshooting.md)。示例跑通后，再[接入自己的 AIUI Agent](integration.md)。
