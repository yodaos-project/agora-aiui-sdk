# Development and verification

[简体中文](zh/validation.md) · [All docs](README.md)

This page is for contributors and developers checking whether the SDK meets their
AIUI Agent's needs. To run your first conversation, use [getting started](getting-started.md).

## Run local checks

From the repository root with Node.js 22+:

```sh
npm ci
npm run check
npm run example:prepare
npm pack --dry-run
```

`check` runs unit tests, TypeScript declaration checks, and Prettier. The tests
cover startup/cancellation, delayed results, immediate microphone stop, cleanup
timeouts, connection states, audio controls, lease renewal, HTTP authentication,
response limits, and backend races. Official Agora server SDK requests are checked
against a local mock endpoint, not the live cloud.

`example:prepare` copies the client into the example AIUI Agent. `npm pack --dry-run`
lists package contents; server code and credentials must not be included.

For documentation changes, keep English and Chinese pages aligned, check relative
links and heading anchors, and validate code examples against the current API.
These docs are Markdown files read on GitHub; there is no separate documentation
site to build.

## Optional Ink Web check

With Chrome/Chromium and a built Ink Web SDK containing WHIP support:

```sh
INK_WEB_DIST=/absolute/path/to/ink/packages/ink-web/dist npm run test:ink
```

This uses a virtual microphone, renders the sample at 448 × 170 in both color
and green-only themes, also checks a 480 × 352 color layout, and checks SDK startup/cleanup
inside Ink's JavaScript runtime. Authorization intentionally fails before an
external WHIP request. Set `INK_TEST_SCREENSHOT` to an absolute PNG path to save
an image of the sample.

This is a runtime smoke test. It does not contact Agora or prove that someone
can hear the AI on a physical device.

The example loads RTM and its Wasm in the `transcripts` Agent Worker. Native Ink
runs it on a separate thread; audio and presentation stay on the Page. Ink Web
currently shares the browser event loop with its Worker realm, so this architecture
does not establish browser CPU offloading. Measure native and Web performance separately.

## Real-cloud results

As of **2026-10-29**, the tested cloud voice path uses consistent string accounts
for Ink and the AI. Each has a different UID in the same channel.

| Host / test                     | Observed result                                               | Scope                                                                               |
| ------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Native Chrome WHIP control      | Received and decoded actual AI replies.                       | A browser control, not the Ink client.                                              |
| Ink Web + this SDK              | Repeated spoken input and decoded AI replies.                 | Virtual microphone, actual Agora cloud and Ink runtime.                             |
| Native `ink-open` demo          | User confirmed audible voice conversation in both directions. | Basic manual acceptance; reports of replies cutting off remain under investigation. |
| Android / glasses with this SDK | Fresh physical-device acceptance remains outstanding.         | Earlier human-to-human WHIP tests do not verify this cloud AI SDK path.             |

A 120-second Ink Web run completed three user/assistant turns and accepted a
fourth user input before shutdown. Its last sample counted 6,556 outgoing RTP
packets and 5,514 incoming AI packets. No Agora RTC SDK or extra observer was
loaded in that run. Media, microphone, audio, and cloud cleanup completed.

These results are specific to the tested endpoint, pipeline, and host builds.
They do not establish reliability for every device, network, or pipeline.
Use the checks below with your own deployment.

On **2026-10-30**, native `ink-open` also received actual ASR partial results and
streaming AI replies through RTM, without history polling or a local relay server.
Two consecutive real RTM login/subscribe/logout cycles reused one client for a
fixed account. The user confirmed that the turn-taking example no longer mixed
AI playback or speech during the reply into the next recognized utterance.
This uses half-duplex microphone gating, not native echo cancellation; wait for
the AI to finish before speaking. It does not guarantee a particular ASR latency.

On **2026-11-01**, a release build of macOS `ink-open` ran RTM in an Agent Worker
against Agora Cloud. A 176-second call received 305 ASR updates. Across 30 four-second
windows containing ASR activity, Page animation callbacks averaged 59.7–60.0 per
second; the largest window p95 interval was 20.3 ms and the largest gap was 34.5 ms.
Startup, shutdown and audio-suspended windows were excluded. The user confirmed
fluent speech and interruptions. Two additional connect/stop cycles with the same
account completed microphone, WHIP, cloud AI and RTM cleanup. These are native
results and do not establish Web or Android performance.

## Accept a release on your target host

1. Start from a user action and allow the microphone.
2. Check media, cloud startup acknowledgement, and audio playback states.
3. Speak several different questions. Listen to complete AI replies, including a longer one.
4. Confirm local and remote meters react to the corresponding speech.
5. Test microphone mute, speaker mute, volume, and returning from another app.
6. End the call. Confirm recording stops and the backend stops the cloud AI.
7. Cancel startup and close the page; verify the backend reclaims abandoned sessions.
8. Repeat on every target desktop, Web, Android, or glasses host.

Keep test timestamps and the backend's cloud `agent_id` for support. Share state
snapshots and reproduction steps without certificates, tokens, or model keys.
See [troubleshooting](troubleshooting.md) when a check fails.
