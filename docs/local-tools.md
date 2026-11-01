# Let the AI operate your interface

[简体中文](zh/local-tools.md) · [All docs](README.md)

Define a tool in your **AIUI Agent**, next to your page logic. Give it a name,
description, parameter schema, and `execute()` function. The LLM receives the
description and parameters; the function stays on the device.

```javascript
const voice = createAgoraVoiceSession({
  backend,
  tools: [
    {
      name: 'setOrbColor',
      description: 'Change the orb color when the user asks.',
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
      description: 'Hang up only when the user explicitly asks to end this call.',
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

Use this inside a page method, where `this` is your page. Declare `orbColor` in
page data and bind it to your styles, as the [example](../examples/agent/pages/call/index.ink)
does. Say “Make the orb purple” or “End this call.”

## Enable the delivery path

Local definition and execution do not mean the cloud can directly call a JavaScript
function. [Agora custom tools](https://docs.agora.io/en/ai/build/tools/custom-tools)
currently call public HTTPS endpoints. The reference backend relays those requests
to the current AIUI Agent and returns its result to the LLM:

**LLM → your session backend → local `execute()` → result → LLM**

No per-tool server implementation is needed. Tool schemas are registered when the
AIUI Agent reserves its session. JavaScript functions and source code are never uploaded.

1. Deploy the existing reference backend on HTTPS. Set `VOICE_TOOLS_PUBLIC_URL` to
   its externally reachable base URL, such as `https://voice.example.com`.
2. Use a published pipeline whose LLM supports function calling. The backend
   supplies `llm.tools` and `advanced_features.enable_tools` at startup. This
   replaces any custom tool list supplied by the pipeline for this session.
3. In `examples/agent/configuration.js`, set `localTools: true`. Keep `backendURL`
   and your user authentication configured as usual, then run `npm run example:prepare`.

The business actions are in [pages/call/tools.js](../examples/agent/pages/call/tools.js).
The example leaves tools off until this delivery path is configured, so ordinary
voice calls keep working. Agora and Shengwang use the same local tool API.
Direct-media mode cannot register tools with an externally managed LLM.

## Execution rules

- Register up to 32 tools before `start()`. Use unique letter/digit names starting
  with a letter; names are case-insensitive and cannot start with `mcp`.
- Parameters use a small JSON Schema subset: objects, arrays, strings, numbers,
  integers, and booleans; scalar enums, length/item limits, and numeric ranges.
  All object fields must be required, with `additionalProperties: false`.
  Unsupported constraints are rejected. Schemas are limited to 8 KiB each, 48 KiB
  in total, and four nested levels.
- Only registered names and valid arguments execute. Return JSON. Calls and result
  envelopes are limited to 8 KiB. Error details from your function are not sent to the model.
- Each execution has at most five seconds. For async work, pass `signal` to requests
  and check it again **after each await**, before changing the UI. Cancellation
  cannot undo an action or forcibly stop code that ignores its signal.
- Use the context's `endConversation()` for a tool-triggered hangup. The SDK first
  attempts to submit the result, then calls `voice.stop()` to release the microphone,
  media, and cloud AI. It still hangs up if submission fails or takes over two seconds.
  Return `ending: true`; this is not a claim that cloud cleanup has completed.
- Delivery is serialized and call IDs are deduplicated for this session. A timed-out
  call is not executed again. The reference backend allows eight pending and 128
  total calls per session; it does not persist tool calls across server restarts.

The client keeps one authenticated waiting request open. A new call wakes it
immediately; an idle request returns after ten seconds. This does not poll ASR
history or change the existing RTM transcript path. Observe `toolstatechange`
and read `voice.getToolState()` for delivery status. Loss of tool delivery does
not end an already established audio call.

Your business backend must authenticate users and enforce session ownership. The
reference server uses a separate, random per-session credential for Agora's tool
callbacks. When deploying multiple backend instances, share session/call state or
route a session to its owning instance.
