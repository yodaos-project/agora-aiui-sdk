# Add voice to your app

[简体中文](zh/integration.md) · [All docs](README.md)

Start here after completing the [example](getting-started.md). Keep one session
per call, start it from a user action, and stop it when the page closes.

## Install the client

Choose the option that matches your project.

### Ink app with local scripts

Copy all `.js` files from this repository's `src/` directory into your app's
`lib/agora-voice/` directory. Keep the filenames and relative imports together.
From a page under `pages/call/`, import:

```js
import { createAgoraVoiceSession, createHttpVoiceBackend } from '../../lib/agora-voice/index.js';
```

The included example uses the same approach, with `npm run example:prepare`
copying files to `examples/agent/lib/sdk/`.

### Project with an npm bundler

Install from GitHub; this setup does not require an npm registry release:

```sh
npm install github:yodaos-project/agora-aiui-sdk
```

```js
import { createAgoraVoiceSession, createHttpVoiceBackend } from '@yodaos-pkg/agora-aiui-sdk';
```

Installing the package alone does not add Ink's media APIs to a regular browser.
The client runs inside an Ink host with the capabilities listed below.

## Connect your page

Use the backend URL and `authorization()` configured in the
[getting started guide](getting-started.md). For a released app, the function
should return your signed-in user's complete Authorization header, such as
`Bearer <application-access-token>`. This authenticates your backend, not Agora.

The following script fits a page under `pages/call/`. Bind your Connect button to
`connect`, your End button to `stop`, and show `status` on the page.

```js
import { createAgoraVoiceSession, createHttpVoiceBackend } from '../../lib/agora-voice/index.js';
import configuration from '../../configuration.js';

export default {
  data: { status: 'Ready' },
  onLoad() {
    this.unloaded = false;
    this.backend = createHttpVoiceBackend({
      baseURL: configuration.backendURL,
      authorization: configuration.authorization,
    });
  },
  async connect() {
    const phase = this.voice?.getState().lifecycle;
    if (['starting', 'running', 'stopping'].includes(phase)) return;

    const voice = createAgoraVoiceSession({ backend: this.backend, timeout: 30000 });
    this.voice = voice;
    const update = () => {
      if (this.unloaded || this.voice !== voice) return;
      const state = voice.getState();
      this.setData({
        status: state.error?.message ?? `${state.lifecycle} · ${state.media} · ${state.audio}`,
      });
    };
    voice.addEventListener('statechange', update);
    try {
      await voice.start();
    } catch {
      update();
    }
  },
  stop() {
    void this.voice?.stop();
  },
  onUnload() {
    this.unloaded = true;
    void this.voice?.stop();
  },
};
```

See the [complete example page](../examples/agent/pages/call/index.ink) for buttons,
audio meters, and a glasses-sized layout. Each session is single-use; after stop
or failure, `connect()` above creates a new one.

## Add audio controls

Call these on the page's active `voice` session:

```js
voice.setMicrophoneMuted(true); // Keep the call, stop sending your voice.
voice.setMicrophoneMuted(false);
voice.setSpeakerMuted(true); // Keep receiving, mute playback.
voice.setSpeakerMuted(false);
voice.setVolume(0.8); // 0 = silent, 1 = full volume.
const { local, remote } = voice.getAudioLevels();
```

Audio levels range from `-60` (silence) to `0` dBFS. For a meter, read them about
five times per second and clear your timer on stop/unload. When playback is paused,
call `voice.resumeAudio()` from a user's tap.

## Use existing temporary credentials

Choose direct mode if your system already starts the cloud AI and supplies
short-lived WHIP credentials. This mode needs no session backend at runtime;
it connects audio and does not start or stop the cloud AI for you.

```js
const voice = createAgoraVoiceSession({
  connection: {
    baseURL: 'https://ap-webrtc-whip.ap.sd-rtn.com',
    channel: 'your-channel',
    uid: 'aiui-client-10001',
    token: 'temporary-whip-jwt-from-your-trusted-service',
  },
});

// Run from your Connect button.
await voice.start();
```

Use the same channel and client **string UID** when starting the cloud AI.
Its own UID must be a different string. See [identity and tokens](backend.md#identity-and-tokens)
if you prepare credentials yourself. A plain ingest-only WHIP endpoint cannot
provide the return audio required for this conversation.

`token` may also be an async function returning a fresh raw JWT. It may be called
again during close. This does not renew or reconnect the established RTC session.
End the local call with `voice.stop()`; your system remains responsible for the
cloud AI's lifetime.

## Host requirements

- Use an Ink build exposing `WHIPSession`, `RTCPeerConnection`, `AudioContext`,
  and `navigator.mediaDevices.getUserMedia`.
- Declare `"permissions": ["RECORD_AUDIO"]` in `app.json` and allow microphone
  access in the host/operating system.
- Open a full foreground app. Widget and list previews do not support calls.
- For standalone desktop testing, use `--networking-transport native` with `ink-open`.
- For Ink Web, open the bundle with
  `hostOptions: { initialTarget: '_blank', initialFocus: 'focus' }` and have the
  host handle microphone permission requests. Use a secure Web origin and an
  HTTPS backend for deployment.

Background audio depends on the host. If a window change pauses playback, bring
the app forward and offer a tap to `resumeAudio()`. See [troubleshooting](troubleshooting.md)
for reading media and playback states separately.
