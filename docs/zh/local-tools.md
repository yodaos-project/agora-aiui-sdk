# 让 AI 操作界面

[English](../local-tools.md) · [全部文档](README.md)

工具直接定义在 **AIUI Agent** 中，和页面业务代码放在一起。提供工具名称、说明、
参数格式和 `execute()` 函数即可。LLM 只会收到工具说明和参数，函数留在设备上执行。

```javascript
const voice = createAgoraVoiceSession({
  backend,
  tools: [
    {
      name: 'setOrbColor',
      description: '用户要求改变小球颜色时调用。',
      parameters: {
        type: 'object',
        properties: { color: { type: 'string', enum: ['blue', 'purple', 'green'] } },
        required: ['color'],
        additionalProperties: false,
      },
      execute: ({ color }, { signal }) => {
        signal.throwIfAborted();
        this.setData({ orbColor: color });
        return { color };
      },
    },
    {
      name: 'endConversation',
      description: '仅在用户明确要求结束本次通话时挂断。',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      execute: (_, { endConversation }) => {
        endConversation();
        return { ending: true };
      },
    },
  ],
});
await voice.start();
```

把代码放在页面方法里，此时 `this` 指向页面。像[示例](../../examples/agent/pages/call/index.ink)
一样，在页面数据中声明 `orbColor`，再将它绑定到样式。可以说“把小球变成紫色”或“挂断通话”。

## 接通工具调用

本地定义、执行工具，并不表示云端能直接调用设备里的 JavaScript 函数。
[Agora 官方工具调用](https://docs.agora.io/en/ai/build/tools/custom-tools)目前通过公网 HTTPS
请求执行工具。参考后端负责把请求转给当前 AIUI Agent，再把执行结果交还 LLM：

**LLM → 会话后端 → 本地 `execute()` → 执行结果 → LLM**

不需要为每个工具编写服务端业务接口。AIUI Agent 创建会话时会自动注册工具说明，
函数和源码不会上传。

1. 将现有参考后端部署到 HTTPS，在其环境变量中设置
   `VOICE_TOOLS_PUBLIC_URL=https://voice.example.com`，填写云端实际可以访问的后端根地址。
2. 使用支持 function calling 的模型和已发布的 pipeline。后端启动 AI 时传入
   `llm.tools` 并开启 `advanced_features.enable_tools`。这会替换该会话的 pipeline 自定义工具列表。
3. 在 `examples/agent/configuration.js` 中设置 `localTools: true`，保留已有的
   `backendURL` 和用户认证配置，再执行 `npm run example:prepare`。

示例的业务动作在 [pages/call/tools.js](../../examples/agent/pages/call/tools.js) 中。
在调用链路配置好之前，示例默认关闭工具，普通语音仍可使用。Agora 和声网共用这套本地工具接口。
只有媒体连接的直接模式，无法替你向外部管理的 LLM 注册工具。

## 使用规则

- 在 `start()` 前注册，最多 32 个工具。名称以字母开头，只使用字母和数字，
  不区分大小写，不能以 `mcp` 开头。
- 参数支持一组常用 JSON Schema 类型：对象、数组、字符串、数字、整数、布尔值，
  以及标量枚举、长度和数量上限、数字范围。对象字段都必须放入 `required`，并设置
  `additionalProperties: false`。不支持的约束会报错。每份 schema 最多 8 KiB，合计
  最多 48 KiB，最多嵌套四层。
- 只有已注册的工具和符合格式的参数能执行。返回 JSON；一次调用和结果消息各自最多
  8 KiB。函数抛出的详细错误不会发送给模型。
- 每次执行最多五秒。异步操作要传递 `signal`，并在**每次 await 后、更新界面前**检查
  是否已取消。SDK 无法撤销已经发生的操作，也无法强制停止忽略取消信号的代码。
- 工具内使用上下文的 `endConversation()` 挂断。SDK 先尝试回传结果，再调用
  `voice.stop()` 释放麦克风、媒体连接和云端 AI。回传失败或超过两秒也会继续挂断。
  返回 `ending: true` 表示正在结束，不代表云端清理已经完成。
- 工具串行执行，同一会话内按调用 ID 去重，超时调用不会重新执行。参考后端最多保留
  八个待处理调用、128 个历史调用，不跨服务重启保存。

客户端保持一个经过认证的等待请求。有新调用时立即返回，空闲时十秒返回一次。
这不轮询 ASR 记录，也不改变实时文字的 RTM 通道。监听 `toolstatechange`，通过
`voice.getToolState()` 读取工具链路状态。工具链路断开不会结束已建立的语音通话。

正式部署时，后端需要认证用户，并确认用户拥有该会话。参考服务另用每个会话独立的随机凭证
验证 Agora 工具回调。多个后端实例要共享会话和调用状态，或把同一会话路由到其所属实例。
