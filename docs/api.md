# Client API reference

[简体中文](zh/api.md) · [All docs](README.md)

Use the [integration guide](integration.md) for a complete page example.
This page describes the public client API; TypeScript users can also read
[src/index.d.ts](../src/index.d.ts).

## Create a session

```js
const voice = createAgoraVoiceSession({ backend, timeout: 30000 });
```

`createAgoraVoiceSession(options)` returns an `AgoraVoiceSession`, an `EventTarget`.
`new AgoraVoiceSession(options)` is equivalent. Choose exactly one of `backend`
or `connection`.

| Option           | Meaning                                                                           | Default |
| ---------------- | --------------------------------------------------------------------------------- | ------- |
| `backend`        | A `VoiceBackend` that reserves credentials and starts/stops the AI.               | —       |
| `connection`     | An `AgoraConnection`, or `async ({ signal }) => connection`. Connects audio only. | —       |
| `timeout`        | Total startup deadline in milliseconds.                                           | `15000` |
| `cleanupTimeout` | Deadline for each independent cleanup operation, in milliseconds.                 | `5000`  |

Both deadlines must be positive finite numbers. The session owns the microphone
tracks and audio context it creates; this version does not accept caller-provided
streams or audio contexts.

## Start and stop

### `start({ signal? })`

Returns `Promise<Readonly<VoiceState>>`. Call from a user's tap/click.
It prepares audio, obtains credentials, opens the microphone, connects media,
and then starts the AI when using a backend. Failure rejects with an
`AgoraVoiceError` and attempts cleanup.

`signal` cancels startup only. To end an established call, use `stop()`.
Repeated starts return the same startup promise. Each instance is single-use;
create a new instance after stop or failure.

The resolved value is a state snapshot, not Agora's cloud `agent_id`. The backend
receives that ID from Agora's start response and should retain it for cleanup and
support requests.

### `stop()`

Stops microphone capture immediately, then returns a
`Promise<Readonly<VoiceCleanupReport>>` for media, audio, and backend cleanup.
Safe to call repeatedly; repeated calls return the same cleanup promise.
Call from your End button and page unload handler.

```js
const cleanup = await voice.stop();
console.log(cleanup); // { media, audio, backend }
```

Each result is `complete`, `failed`, `timeout`, or `not-needed`. If backend cleanup
fails or times out, the backend must still reclaim the cloud AI. `media: complete`
means the local WHIP close finished; it does not confirm remote resource deletion.

## Observe state

```js
voice.addEventListener('statechange', () => {
  const state = voice.getState();
  console.log(state.media, state.audio, state.error?.message);
});
```

`getState()` returns a read-only snapshot. Read it inside the event handler;
`statechange` does not carry a custom state payload. Snapshots exclude tokens,
endpoints, and raw backend responses. The SDK does not log automatically.

| Field                              | Values / meaning                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `lifecycle`                        | `idle`, `starting`, `running`, `stopping`, `stopped`, `failed`. Overall call progress.                              |
| `media`                            | `new`, `connecting`, `connected`, `disconnected`, `failed`, `closed`. Actual media transport.                       |
| `agent`                            | `not-managed`, `idle`, `starting`, `running`, `stopped`, `unknown`. Backend acknowledgement of cloud AI operations. |
| `audio`                            | `running`, `suspended`, `closed`. Local audio context; `closed` before creation too.                                |
| `microphoneMuted` / `speakerMuted` | Boolean mute states, initially `false`.                                                                             |
| `volume`                           | Speaker volume from `0` to `1`, initially `1`.                                                                      |
| `error`                            | `null` or `{ code, message }`. The message is suitable for display.                                                 |
| `cleanup`                          | `null` until cleanup completes, then the cleanup report.                                                            |

Do not use `lifecycle: running` or `agent: running` alone to display “audio connected.”
`agent` does not report whether the AI is currently alive or speaking. Temporary
media disconnections may recover; terminal failure triggers cleanup. There is no
automatic reconnect or cloud status event subscription in this version.

## Control audio

| Method                        | Effect                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `setMicrophoneMuted(boolean)` | Enable/disable the local audio tracks without ending the call.                                  |
| `setSpeakerMuted(boolean)`    | Mute playback; the remote meter continues measuring incoming audio.                             |
| `setVolume(number)`           | Set volume in `[0, 1]`. Unmuting restores the chosen volume. Invalid values throw `RangeError`. |
| `resumeAudio()`               | Return a promise for resuming playback. Call from a user action.                                |
| `getAudioLevels()`            | Return `{ local, remote }`, each in `[-60, 0]` dBFS. `-60` represents silence.                  |
| `getStats()`                  | Return `Promise<RTCStatsReport>` for the current peer connection.                               |

Levels are measured at most five times per second. Suspended audio reads as
silence. The remote meter measures before speaker volume/mute, so it can move
while your speaker is muted. For diagnostics, polling stats every 2–3 seconds
is enough; clear any UI timers on stop/unload.

## Read conversation text

```js
const transcripts = await voice.getTranscripts();
for (const message of transcripts) {
  console.log(message.role, message.text, message.interrupted);
}
```

`getTranscripts({ signal? })` returns a read-only conversation-history snapshot
while a managed session is running. Each `VoiceTranscript` has `id`, `role`
(`user` or `assistant`), `text`, and `interrupted`. User text is the recognized
speech; assistant text is the recorded AI reply. It can appear before playback
finishes and does not provide word-level timing or confirm which words were heard.

The method does not poll by itself. The example refreshes every two seconds after
the previous read finishes, backs off on errors, and cancels pending reads on stop
or unload. It displays the newest messages first; hiding text also pauses polling.
Snapshots retain at most 20 messages, 2,000 characters per message and
12,000 characters in total. Long text is truncated.

A backend must implement optional `getTranscripts`. Direct mode and older custom
backends reject with `UNSUPPORTED`. Read failures use `TRANSCRIPTS` and do not end
the audio call or change its error state. A caller's signal cancels only this read;
ending the call also cancels outstanding reads. Retry only while the call is active.
For live word-by-word captions, use a separate transcript messaging integration.

## Configure a direct connection

An `AgoraConnection` contains:

```js
const connection = {
  baseURL: 'https://ap-webrtc-whip.ap.sd-rtn.com',
  channel: 'your-channel',
  uid: 'aiui-client-10001',
  token: 'temporary-raw-whip-jwt',
};
```

| Field              | Requirement                                                                          |
| ------------------ | ------------------------------------------------------------------------------------ |
| `baseURL`          | HTTPS origin only, without `/pub`, credentials, query, or fragment.                  |
| `channel`          | A nonempty string of at most 64 characters, accepted by your deployment.             |
| `uid`              | For cloud AI, a string account of 1–255 UTF-8 bytes, without a NUL character.        |
| `token`            | Raw WHIP JWT, or a function returning one (sync or async). Do not include `Bearer `. |
| `rtcConfiguration` | Optional standard `RTCConfiguration`. Defaults include `bundlePolicy: 'max-bundle'`. |

Legacy numeric integrations can use `uid` from `1` through `4294967294` and an
optional `stringUid` alias (default `aiui-${uid}`). In string mode, if `stringUid`
is supplied it must equal `uid`. Use strings consistently for cloud AI; see
[identity and tokens](backend.md#identity-and-tokens).

`agoraEndpoint(connection)` returns the encoded duplex WHIP URL. In string mode
it uses `?stringuid=...&duplex=true`, without numeric `Uid`. Legacy numeric mode
also sends the case-sensitive `Uid` parameter.

## Connect an HTTP backend

```js
const backend = createHttpVoiceBackend({
  baseURL: 'https://your-backend.example.com',
  authorization: 'Bearer your-application-access-token',
  timeout: 15000,
});
```

| Option          | Meaning                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| `baseURL`       | Your backend URL, optionally including a proxy prefix. Use HTTPS; loopback HTTP is allowed for development. |
| `authorization` | A complete business Authorization header, or a sync/async function returning one for each request.          |
| `timeout`       | Per-request deadline in milliseconds. Default: `15000`.                                                     |
| `fetch`         | Optional custom Fetch function. Default: global `fetch`.                                                    |

This returns a `VoiceBackend`. The adapter uses the [HTTP contract](backend.md#http-contract),
rejects redirects, and limits JSON responses to 64 KiB. It refreshes WHIP tokens
on demand near their reported expiry; it does not reconnect existing media.

## Handle errors

`AgoraVoiceError` extends `Error` and has a `code`. Startup failures reject
`start()`; failures during a call appear through `statechange` and `getState().error`.
Invalid construction/configuration arguments may also throw ordinary JavaScript errors.

| Code            | What to check                                                  |
| --------------- | -------------------------------------------------------------- |
| `UNSUPPORTED`   | Ink host capabilities.                                         |
| `CONFIGURATION` | Connection fields and temporary credentials.                   |
| `BACKEND`       | Backend connectivity, authentication, and responses.           |
| `MICROPHONE`    | Permission and microphone availability.                        |
| `AUDIO`         | Playback activation and foreground state.                      |
| `MEDIA`         | WHIP/RTC connection and network access.                        |
| `AGENT`         | Cloud AI startup through your backend.                         |
| `TIMEOUT`       | Startup deadline and network/service availability.             |
| `ABORTED`       | Startup was cancelled.                                         |
| `TRANSCRIPTS`   | Conversation text could not be read; the audio call continues. |
| `LEASE`         | Backend session renewal failed.                                |

For a diagnosis workflow, see [troubleshooting](troubleshooting.md).
