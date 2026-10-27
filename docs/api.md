# Client API

Import from the package, or from the copied `index.js` in your AIUI app.
All SDK-created tracks and audio nodes belong to the session. Version 0.1.0
does not accept caller-owned streams or audio contexts.

## `createAgoraVoiceSession(options)`

Choose one connection mode:

| Option           | Meaning                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `backend`        | An object implementing `createSession`, `startAgent`, `stopSession`, and optionally `renewSession`. |
| `connection`     | An `AgoraConnection`, or an async function `({ signal }) => connection`.                            |
| `timeout`        | Total startup deadline in milliseconds; default 15000.                                              |
| `cleanupTimeout` | Deadline for each independent cleanup operation; default 5000 ms.                                   |

You can also use `new AgoraVoiceSession(options)`. It extends `EventTarget`.
Listen for `statechange` and read `getState()`. Snapshots contain no endpoint,
JWT, SDP or backend response body. The SDK does not write diagnostic logs.

## `AgoraConnection`

```js
{
  baseURL: 'https://ap-webrtc-whip.ap.sd-rtn.com',
  channel: 'your-channel',
  uid: 10001,
  stringUid: 'optional-client-alias',
  token: async () => 'fresh-raw-whip-jwt',
  rtcConfiguration: { bundlePolicy: 'max-bundle' },
}
```

- `baseURL`: HTTPS origin only. Do not include `/pub`, credentials, query or fragment.
- `channel`: nonempty, at most 64 characters; use a channel name accepted by your Agora deployment.
- `uid`: integer from 1 through 4294967294, matching the JWT `uid` claim.
- `stringUid`: optional alias, default `aiui-${uid}`.
- `token`: raw JWT string or a function returning one. Do not include `Bearer `.
- `rtcConfiguration`: optional standard peer connection configuration.

`agoraEndpoint(connection)` returns the encoded duplex URL. Its numeric query
parameter is `Uid`, with an uppercase `U`.

## Start and stop

`start({ signal? })` returns a promise. It resumes audio, reserves credentials,
opens the microphone, connects RTC, and then starts the managed cloud agent.
Use a user action to call `start()`, so the host can authorize audio playback.
Permission denial or startup failure ends the session and attempts cleanup.

The optional `signal` cancels **startup only**. After startup, use `stop()`.
Repeated starts return the original startup promise; a session instance is single-use.
Construct a new instance to retry after stop/failure.

`stop()` immediately stops capture, removes internal listeners and disconnects
audio nodes. It concurrently attempts WHIP close, audio context close and backend
stop. Repeated calls return the same cleanup promise. For example:

```js
const cleanup = await voice.stop();
if (cleanup.backend === 'failed' || cleanup.backend === 'timeout') {
  // Backend cleanup is unconfirmed; its lease/reconciler must finish the job.
}
```

Each result is `complete`, `failed`, `timeout` or `not-needed`. WHIP `complete`
means its close promise completed; it is not proof that the server processed DELETE.
A reservation that arrives after startup cancellation is released separately;
the backend must also expire abandoned reservations whose responses were lost.

## State

```js
const state = voice.getState();
```

| Field                             | Values                                                               |
| --------------------------------- | -------------------------------------------------------------------- |
| `lifecycle`                       | `idle`, `starting`, `running`, `stopping`, `stopped`, `failed`       |
| `media`                           | `new`, `connecting`, `connected`, `disconnected`, `failed`, `closed` |
| `agent`                           | `not-managed`, `idle`, `starting`, `running`, `stopped`, `unknown`   |
| `audio`                           | Audio context state; `closed` before creation and after close        |
| `microphoneMuted`, `speakerMuted` | Boolean control states                                               |
| `volume`                          | Number from 0 to 1                                                   |
| `error`                           | `null` or `{ code, message }` with a safe UI message                 |
| `cleanup`                         | `null` until cleanup completes, then the cleanup report              |

`running` describes local lifecycle or an acknowledged bot startup. It does not
confirm remote audibility. Render `media` and `audio` too. Transient disconnects
can recover; terminal RTC failure triggers cleanup.

Startup rejections use `AgoraVoiceError` with codes including `ABORTED`, `TIMEOUT`,
`UNSUPPORTED`, `AUDIO`, `BACKEND`, `CONFIGURATION`, `MICROPHONE`, `MEDIA`, `AGENT`.
Lease renewal failures use `LEASE`. Runtime failures are delivered through state changes.

## Audio controls

- `setMicrophoneMuted(boolean)`: disables/enables local audio tracks.
- `setSpeakerMuted(boolean)`: mutes playback without muting the incoming level meter.
- `setVolume(number)`: sets playback volume in `[0, 1]`; unmuting restores this volume.
- `resumeAudio()`: resume playback from a user action after an interruption.
- `getAudioLevels()`: `{ local, remote }` dBFS, clamped to `[-60, 0]`. Reads at most
  five times per second with reusable sample buffers. Suspended audio reads as silence.
- `getStats()`: returns the standard `RTCStatsReport` on demand. Avoid frequent
  polling; 2–3 seconds is sufficient for a diagnostic UI.

## HTTP backend adapter

```js
const backend = createHttpVoiceBackend({
  baseURL: 'https://business.example.com',
  authorization: async () => `Bearer ${await applicationLoginToken()}`,
  timeout: 15000,
});
```

`authorization` is the **complete business API header**. Each request can obtain a
fresh value. The adapter uses bodyless POST requests and rejects redirects. HTTPS
is required; HTTP is allowed on localhost/loopback for local development.

Responses are capped at 64 KiB while streaming. An optional `fetch` function
supports integration with an application's HTTP layer. Backend token responses
use Unix timestamps in **milliseconds**; the adapter refreshes WHIP credentials
on demand near expiry. See [backend protocol](backend.md).
