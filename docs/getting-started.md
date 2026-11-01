# Your first voice conversation

[简体中文](zh/getting-started.md) · [All docs](README.md)

This guide runs the included AIUI Agent with the reference Node.js backend.
By the end, you can speak into your microphone and hear an AI answer.
Start on one computer before trying a phone or glasses.

## 1. Prepare Agora and Ink

Have these ready. Download [Node.js](https://nodejs.org/en/download) if needed;
Ink desktop binaries are available from [Ink releases](https://github.com/jsar-project/ink/releases).
Choose the `ink-open` executable for your operating system and a build with WHIP support.

For the example's live text, use a recent Ink build that includes
[Page–Worker messaging and Worker WebSockets](https://github.com/jsar-project/ink/pull/800).

| Item                       | How to get it                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Node.js 22+ and Git        | Install them on your development computer.                                                                   |
| Ink host                   | Use an Ink build with `WHIPSession`, WebRTC, Web Audio, and microphone support. For desktop, use `ink-open`. |
| App ID and App Certificate | Find them in your provider project's settings. The certificate stays on the backend.                         |
| Duplex WHIP endpoint       | Confirm that your provider has enabled two-way WHIP for your project and region.                             |
| Signaling (RTM)            | Enable Signaling for the same project to receive live conversation text.                                     |
| Published voice pipeline   | Configure and publish a voice agent in AI Studio.                                                            |

### Register and set up Agora

1. Create an account and sign in at [Agora Console](https://console.agora.io/). Complete any account verification requested by the console.
2. Under Projects, create a project using **APP ID + Token** authentication. Open its details and copy the **App ID** and **Primary Certificate**. Keep the certificate on your backend. See the [console guide](https://docs.agora.io/en/realtime-media/rtc/reference/console-overview).
3. Enable Conversational AI Engine and Signaling (RTM) for that project. Ask Agora to enable **duplex WHIP** and confirm its endpoint for your project and region.
4. In Agent Studio, create a voice agent for the same project. Choose speech recognition (ASR), a language model (LLM), and a voice (TTS), and provide vendor keys if required. Services may have separate charges. See [agent configuration](https://docs.agora.io/en/ai/studio/build/customize-agent).
5. Allow microphone access in Studio's test panel and verify you can hear the agent answer. Save and **publish** it. In **Agents → Action → Embed Agent**, copy the `pipeline_id` from the generated code. A draft needs publishing first. See [Connect your agent](https://docs.agora.io/en/ai/studio/deploy/connect-agent).

Keep the App ID, Primary Certificate, published pipeline ID and enabled WHIP URL for the next steps. The sample backend creates fresh tokens and distinct string identities for each call; do not use an embedded temporary token as the pipeline ID.

### Use Shengwang China instead

1. Register and sign in at [Shengwang Console](https://console.shengwang.cn/). Create a general project with secure authentication and copy its App ID and Primary Certificate.
2. Enable Conversational AI Engine and Signaling (RTM). Confirm duplex WHIP access and the endpoint with Shengwang. See the [service setup guide](https://doc.shengwang.cn/doc/toybox/iot/get-started/enable-service).
3. Create an agent in AI Studio under the same project. Configure ASR, LLM and TTS, including any required vendor credentials. Test a conversation, then publish the agent and copy its Pipeline ID or the `pipeline_id` in its embed code. A draft may show `-` until published.

Use credentials and the pipeline from the same provider and project. Console labels can change; follow the linked official guides if needed.

## 2. Download and prepare the example

```sh
git clone https://github.com/yodaos-project/agora-aiui-sdk.git
cd agora-aiui-sdk
npm ci
npm run example:prepare
```

`example:prepare` builds the RTM Worker bundle and installs the local SDK dependency in the example’s `node_modules`.
Run it again after changing the SDK source.

## 3. Configure and start the backend

From the repository root:

```sh
cp examples/server/.env.example examples/server/.env
```

For Shengwang China, copy the file to `examples/server/.env.shengwang` instead:

```sh
cp examples/server/.env.example examples/server/.env.shengwang
```

Edit the file you just copied: `examples/server/.env` for Agora, or `examples/server/.env.shengwang` for Shengwang. Fill in your project credentials and adjust the regional settings below:

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

For Shengwang, edit `.env.shengwang` and use these values in addition to your project's credentials:

```dotenv
AGORA_AREA=CN
AGORA_AGENTS_API_BASE_URL=https://api.sd-rtn.com
AGORA_WHIP_BASE_URL=replace-with-your-enabled-whip-url
```

Replace the WHIP URL with the endpoint enabled for your project. The example has been tested with a Shengwang project using `https://ap-webrtc-whip.ap.sd-rtn.com`; that does not establish availability or China data residency for other projects.

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

For Shengwang, run `npm run example:server:cn` to load `.env.shengwang`. Do not start both servers on the same port.

Leave this terminal running. You should see `Voice backend is listening.`
The default address is `http://127.0.0.1:8787`.

For this desktop test, the backend runs on your computer. For deployment, use
your own HTTPS service. Audio goes directly between Ink and Agora Cloud.

## 4. Point the AIUI Agent at the backend

The example uses English and **Agora Cloud** with `provider: 'agora'`.
For a [Shengwang backend](backend.md), use
`provider: 'shengwang'` for Chinese and **声网 Cloud**. This setting changes only
the UI; configure cloud routing in the backend and spoken language in the pipeline.

Replace `examples/agent/configuration.js` with:

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

Replace the text after `Bearer ` with the token from step 3. This shared token is
for private development only. For a released AIUI Agent, use your user login flow instead. Never put the Agora App Certificate in this file or commit your
configured file. Restore the placeholder before sharing changes.
For Shengwang, change `provider` to `shengwang`. Leave `localTools: false` for
the first conversation; follow the [local tools guide](local-tools.md) to enable
voice-controlled color and hangup after configuring an HTTPS callback.

## 5. Open the AIUI Agent and talk

In another terminal, from the repository root, with `ink-open` available on your PATH:

```sh
ink-open examples/agent --networking-transport native --permission-checks
```

If your executable is elsewhere, use its full path in place of `ink-open`.
The example already declares `RECORD_AUDIO`. Allow microphone access when your
host or operating system asks.

1. Tap **Let’s talk**.
2. Wait for **Listening** and the active connection dot beside **Agora Cloud**.
3. Say a short question in the language configured for your agent.
4. Listen for the reply. A greeting is optional and depends on your pipeline.
5. Watch your recognized speech update in one line. The orb indicates listening, thinking, speaking, and confirmed interruption; AI reply text is hidden.
6. Tap **End** when finished.

Keep Ink in the foreground. If you return from another window and see paused
audio, tap the **Resume** prompt to resume playback.

Success means you hear an answer to what you said. Connection indicators and
moving meters are useful checks, but do not replace listening.

## Use another host

- **Ink Web:** open the AIUI Agent in the foreground, allow microphone permission,
  and use an HTTPS session backend. Allow a bounded SDK initialization budget such
  as `scriptExecution: { timeoutMs: 10000 }` on `createInkView`. Add the Web host page's exact origin to
  `ALLOWED_ORIGINS`. See [host requirements](integration.md#host-requirements).
- **Android or glasses:** deploy a reachable HTTPS backend and change
  `backendURL`. `127.0.0.1` on the device refers to the device itself, not your computer.

If something fails, start with [troubleshooting](troubleshooting.md). Once the
example works, [add voice to your own AIUI Agent](integration.md).
