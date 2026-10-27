# Agora AIUI SDK

[中文说明](README.zh-CN.md)

Build a voice conversation in an [Ink](https://github.com/jsar-project/ink) AIUI agent.
The SDK connects the microphone and speaker to Agora over WHIP and WebRTC. An optional
business backend starts an Agora cloud Voice Agent in the same channel.

Version **0.1.0** provides:

- Bidirectional audio, microphone/speaker mute, volume and audio levels.
- Separate media, playback and cloud agent states.
- Cancellation, immediate microphone shutdown and bounded cleanup.
- Direct connection with temporary credentials, or a managed session backend.
- JavaScript modules, TypeScript declarations, a compact AIUI example and a Node backend example.

**Live test status:** Cloud agent startup, speech recognition and LLM responses
are verified. Cloud-agent audio did not reach the tested WHIP deployment, also
reproduced in native Chrome without Ink. Full voice acceptance remains open;
see [verification results](docs/validation.md#live-cloud-result-2026-10-27).

The client has no runtime package dependencies. It uses Ink's `WHIPSession`,
`RTCPeerConnection`, `AudioContext` and `navigator.mediaDevices` APIs. Use an Ink
build containing [WHIP support](https://github.com/jsar-project/ink/pull/735).
Android, desktop and Web hosts must enable WebRTC and microphone permission.
Open the agent as a foreground app; widget/list previews do not permit voice.
An Ink Web host should open the bundle with
`hostOptions: { initialTarget: '_blank', initialFocus: 'focus' }` and provide microphone permission decisions.

## 1. Try the AIUI example

```sh
git clone https://github.com/yodaos-project/agora-aiui-sdk.git
cd agora-aiui-sdk
npm ci
npm run example:prepare
```

1. Set up a business backend using the [backend guide](docs/backend.md). You need an
   Agora App ID, App Certificate and an AI Studio pipeline configured for voice.
2. Edit `examples/agent/configuration.js`: set your backend URL and return your
   application's Authorization header from `authorization()`.
3. Open `examples/agent` in an Ink host, such as `ink-open examples/agent`.
4. Allow microphone access and tap **连接**. Keep the page in the foreground.

The example uses your backend for session management; audio goes directly between
Ink and Agora Cloud. A production deployment does not require a server running on
the developer's computer. The reference backend can run on your own HTTPS service.

The page uses Ink theme colors, including `yodaos-sprite-color` and
`yodaos-sprite-greenonly`, and a compact layout for glasses.

## 2. Use the SDK in your agent

For AIUI projects that load files directly, copy `src/*.js` into a directory such
as `lib/agora-voice/` in your app. Preserve the filenames and relative imports.
The example preparation command does this for `examples/agent/lib/sdk/`.

For projects with an npm bundler, install from GitHub:

```sh
npm install github:yodaos-project/agora-aiui-sdk
```

The package name is `@yodaos-pkg/agora-aiui-sdk`. This first version is delivered
through GitHub; the setup does not assume an npm registry release.

```js
import { createAgoraVoiceSession, createHttpVoiceBackend } from './lib/agora-voice/index.js';

const backend = createHttpVoiceBackend({
  baseURL: 'https://your-backend.example.com',
  authorization: async () => `Bearer ${await getApplicationAccessToken()}`,
});

const voice = createAgoraVoiceSession({ backend, timeout: 30000 });
voice.addEventListener('statechange', () => {
  const { lifecycle, media, agent, audio, error } = voice.getState();
  // Update your page here. Show errors using error.message.
  console.log(lifecycle, media, agent, audio, error?.code);
});

// Run start() from a user action, such as tapping your Connect button.
await voice.start();
voice.setMicrophoneMuted(true);
voice.setSpeakerMuted(false);
voice.setVolume(0.8);
const { local, remote } = voice.getAudioLevels(); // dBFS, -60 to 0

// Call this on End and page unload. Capture stops before the promise settles.
const cleanup = await voice.stop();
```

`getApplicationAccessToken()` is supplied by your application. It authenticates
your business backend, and is different from an Agora WHIP JWT.

## 3. Connect with existing temporary credentials

Use direct mode if your system already starts the cloud agent, or to call another
RTC participant. No session backend is required at runtime in this mode.

```js
import { createAgoraVoiceSession } from './lib/agora-voice/index.js';

const voice = createAgoraVoiceSession({
  connection: {
    baseURL: 'https://ap-webrtc-whip.ap.sd-rtn.com',
    channel: 'your-channel',
    uid: 10001,
    stringUid: 'aiui-client-10001',
    token: 'temporary-whip-jwt-from-your-trusted-service',
  },
});
await voice.start();
// ... talk to a cloud agent or another participant in the channel ...
await voice.stop();
```

The JWT must authorize the same channel and **numeric UID**. Each participant,
including the bot, needs a different numeric UID. `stringUid` is an additional
gateway alias. This SDK targets Agora's duplex WHIP extension; standard ingest-only
WHIP services cannot provide the downlink required for a voice conversation.

For longer calls, use a token callback that obtains a fresh JWT when needed.
The SDK can request authorization again when closing the WHIP resource. It does
not restart an existing RTC session when a token changes.

## Understand the states

| Field       | What it tells your UI                                                                    |
| ----------- | ---------------------------------------------------------------------------------------- |
| `lifecycle` | Whether startup, a call or cleanup is in progress.                                       |
| `media`     | Actual RTC transport, including `disconnected` and `failed`.                             |
| `agent`     | Whether the backend acknowledged cloud agent startup/stop. Direct mode is `not-managed`. |
| `audio`     | Whether the audio context is `running`, `suspended` or `closed`.                         |

Successful HTTP signaling alone does not mean audio is connected. `agent: running`
means the start request was acknowledged; it does not prove the bot is currently
alive, speaking or audible. This version does not subscribe to cloud agent status events.

Transient `disconnected` remains visible while RTC attempts recovery. A terminal
transport failure ends the call and releases its resources. To try again after
stop/failure, create a **new session instance**. There is no automatic reconnect.
Call `resumeAudio()` from a user action after playback is interrupted. Background
capture/playback depends on the host; this SDK is intended for foreground pages.

## What is outside this version?

Captions, RTM messages, cloud agent semantic events, local tool execution and
background workers are not implemented. WHIP audio does not by itself provide an
Agora messaging channel. No ASR, LLM or TTS API keys belong in the client bundle.

## Development and validation

```sh
npm ci
npm run check
npm run example:prepare
npm pack --dry-run
```

Tests cover lifecycle races, late microphone/reservation results, mute/volume,
transport state, cleanup deadlines, HTTP response limits, backend authentication,
leases and requests made by the actual official server SDK against a local mock.
They do **not** establish real-cloud or device audio interoperability. Before
shipping your app, verify audible two-way audio against your pipeline on each host.

See [API](docs/api.md), [backend setup/protocol](docs/backend.md) and
[verification notes](docs/validation.md).
