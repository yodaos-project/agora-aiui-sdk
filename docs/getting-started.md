# Your first voice conversation

[简体中文](zh/getting-started.md) · [All docs](README.md)

This guide runs the included AIUI Agent with the reference Node.js backend.
By the end, you can speak into your microphone and hear an AI answer.
Start on one computer before trying a phone or glasses.

## 1. Prepare Agora and Ink

Have these ready. Download [Node.js](https://nodejs.org/en/download) if needed;
Ink desktop binaries are available from [Ink releases](https://github.com/jsar-project/ink/releases).
Choose the `ink-open` executable for your operating system and a build with WHIP support.

| Item                             | How to get it                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Node.js 22+ and Git              | Install them on your development computer.                                                                   |
| Ink host                         | Use an Ink build with `WHIPSession`, WebRTC, Web Audio, and microphone support. For desktop, use `ink-open`. |
| Agora App ID and App Certificate | Find them in your Agora project's settings. The certificate stays on the backend.                            |
| Duplex WHIP endpoint             | Confirm that Agora has enabled two-way WHIP for your project and region.                                     |
| Published voice pipeline         | Configure and publish a voice agent in Agora Agent Studio.                                                   |

In Studio, first confirm that you can speak to your agent in its test panel.
Choose recognition, model, voice, and language settings appropriate for your users.

To find **`pipelineId`**: open **Agents → Action → Embed Agent** for the published
agent and copy `pipeline_id` from the generated code. You only need that ID;
the backend creates fresh channel identities and tokens for each call.
See [Agora's instructions](https://docs.agora.io/en/ai/studio/deploy/connect-agent).

Make sure the pipeline and App ID can be used together. Agora usage may be billed
to your project.

## 2. Download and prepare the example

```sh
git clone https://github.com/yodaos-project/agora-aiui-sdk.git
cd agora-aiui-sdk
npm ci
npm run example:prepare
```

`example:prepare` copies the client SDK into the example AIUI Agent so Ink can load it.
Run it again after changing the SDK source.

## 3. Configure and start the backend

From the repository root:

```sh
cp examples/server/.env.example examples/server/.env
```

Edit `examples/server/.env` and replace the placeholders:

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

Use your deployment's area and WHIP endpoint. The `AP` values above are the
example defaults, not a guarantee that your project has access.
Generate a demo token of at least 24 characters:

```sh
node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"
```

Paste it into `BACKEND_API_TOKEN`, then start the server:

```sh
npm run example:server
```

Leave this terminal running. You should see `Voice backend is listening.`
The default address is `http://127.0.0.1:8787`.

For this desktop test, the backend runs on your computer. For deployment, use
your own HTTPS service. Audio goes directly between Ink and Agora Cloud.

## 4. Point the AIUI Agent at the backend

Replace `examples/agent/configuration.js` with:

```js
export default {
  backendURL: 'http://127.0.0.1:8787',
  async authorization() {
    return 'Bearer paste-the-same-BACKEND_API_TOKEN-here';
  },
};
```

Replace the text after `Bearer ` with the token from step 3. This shared token is
for private development only. For a released AIUI Agent, use your user login flow instead. Never put the Agora App Certificate in this file or commit your
configured file. Restore the placeholder before sharing changes.

## 5. Open the AIUI Agent and talk

In another terminal, from the repository root, with `ink-open` available on your PATH:

```sh
ink-open examples/agent --networking-transport native --permission-checks
```

If your executable is elsewhere, use its full path in place of `ink-open`.
The example already declares `RECORD_AUDIO`. Allow microphone access when your
host or operating system asks.

1. Tap **开始聊天** (Start chat).
2. Wait for **我在，慢慢说。** and **Agora · 已连接**.
3. Say a short question in the language configured for your agent.
4. Listen for the reply. A greeting is optional and depends on your pipeline.
5. Tap **结束通话** (End call) when finished.

Keep Ink in the foreground. If you return from another window and see paused
audio, tap the **继续聊天** resume prompt to resume playback.

Success means you hear an answer to what you said. Connection indicators and
moving meters are useful checks, but do not replace listening.

## Use another host

- **Ink Web:** open the AIUI Agent in the foreground, allow microphone permission,
  and use an HTTPS session backend. Add the Web host page's exact origin to
  `ALLOWED_ORIGINS`. See [host requirements](integration.md#host-requirements).
- **Android or glasses:** deploy a reachable HTTPS backend and change
  `backendURL`. `127.0.0.1` on the device refers to the device itself, not your computer.

If something fails, start with [troubleshooting](troubleshooting.md). Once the
example works, [add voice to your own AIUI Agent](integration.md).
