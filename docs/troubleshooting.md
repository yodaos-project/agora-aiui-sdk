# Troubleshooting

[简体中文](zh/troubleshooting.md) · [All docs](README.md)

Start by reading the state while the problem is happening:

```js
console.log(voice.getState());
```

For a managed call, look for `media: connected`, `agent: running`, and
`audio: running`. These describe different parts of the call. They do not alone
prove that the AI's reply is audible.

## The AIUI Agent cannot connect

| Symptom                 | First checks                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `UNSUPPORTED`           | Use an Ink build with WHIP, WebRTC, audio, and microphone support. Installing this package in a regular browser is not enough. |
| `BACKEND`               | Confirm the server is running, its URL is reachable, and the Authorization header matches your authentication.                 |
| Browser request blocked | Check HTTPS and `ALLOWED_ORIGINS`. Use the Web host's exact origin.                                                            |
| `MICROPHONE`            | Allow recording in both the host and operating system; check that the input device is available.                               |
| `MEDIA` / `TIMEOUT`     | Check the enabled Agora WHIP endpoint, project access, network, channel, and fresh JWT.                                        |
| AI startup fails        | Check the backend's App ID, Certificate, area, pipeline ID, and cloud response.                                                |

On a phone, `127.0.0.1` is the phone itself. Use a reachable HTTPS backend.
After a failed call, create a new session; reusing the old object does not retry.

## It connects, but I cannot hear the AI

1. Confirm `audio` is `running`. If suspended, bring Ink to the foreground and tap
   the example's resume control, or call `resumeAudio()` from a user action.
2. Check speaker mute, SDK volume, system volume, and the selected output device.
3. Speak and watch the local meter. If it stays silent, check input device and mute.
4. Check the remote meter while expecting a reply. A moving remote meter with no
   audible sound points toward playback; a silent meter needs further checks.
5. Test the same published agent in Studio. Confirm its language and voice services work.

If you manage credentials yourself, use the same channel, a client **string UID**,
and a different AI string UID. Set `enable_string_uid: true` and subscribe to the
exact client account in `remote_rtc_uids`. See [identity and tokens](backend.md#identity-and-tokens).
The managed reference backend does this automatically.

No welcome message is required: some pipelines wait for you to speak first.
`agent: running` only acknowledges the start request; it does not monitor the AI's
ongoing health. If needed, use `getStats()` to check received audio packets alongside
cloud conversation history. Packet counts alone do not confirm audible speech.

## The AI stops halfway through a reply

Check `audio` and `media` at the moment it stops:

- **`audio: suspended`:** the host has paused local audio. Bring the AIUI Agent forward
  and resume from a tap. The media connection can remain connected during this pause.
- **`media: disconnected`:** the media path has been interrupted. Wait for recovery;
  a terminal failure ends the session. Start a new session to retry afterward.
- **Both still running/connected:** compare with headphones and with the microphone
  muted during one reply. This helps distinguish playback/focus issues from sound
  returning through the microphone or cloud turn interruption. Check the pipeline's
  interruption settings and cloud history before changing them.

A pause alone does not identify the cause. Repeated early reply cutoffs in the
native demo are still under investigation; see [verification scope](validation.md#real-cloud-results).

## A call ends after a while

Look for `error.code`, especially `LEASE`. The reference backend requires regular
renewal, has a 30-minute call limit, and starts the AI with a 60-second idle timeout.
These are separate from media connectivity and token expiry. If you need different
limits, adjust your backend policy and cloud configuration.

## Do I need a backend running on my computer?

Only for the local reference setup. A deployed AIUI Agent uses your HTTPS service.
If another system already starts the AI and issues temporary credentials,
[direct mode](integration.md#use-existing-temporary-credentials) connects without
a session backend at runtime. Keep signing certificates off the client.

## Can I add captions, messages, or tools?

The SDK can display ASR and AI reply text from conversation history. Live
word-synchronized captions, RTM messages, AI semantic events, and local tool
execution need additional integration.
Audio transport does not itself create a messaging channel.

## What should I include in a support report?

Include the SDK version, Ink host/build, operating system, steps, timestamp with
time zone, and state snapshots before/after the failure. For Agora investigations,
also provide the channel and the cloud start response's **`agent_id`** from your
backend. The local reservation `id` and cloud `agent_id` are different identifiers.

Do not include App Certificates, access tokens, or model keys. The SDK does not
automatically collect logs or expose the cloud agent ID in `getState()`.
