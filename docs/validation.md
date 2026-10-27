# Verification

## Automated checks

Run `npm run check` for:

- Session lifecycle, permission/capture failure, cancellation and delayed results.
- Immediate microphone stop, independent cleanup deadlines and backend lease renewal.
- RTC/ICE state consistency and no duplicate remote playback sources.
- Mute/volume behavior and reuse of audio level sample arrays.
- HTTP control response size limits, authorization and CORS.
- Backend concurrent starts, delayed start/stop, lease expiry and failed-stop retry.
- JWT signing and official `agora-agents` requests against a mock cloud endpoint.
- Public TypeScript declarations and formatting.

Run `npm run example:prepare` and `npm pack --dry-run` to check the AIUI copy and
client package contents. The package must not include the reference server or credentials.

## Optional Ink Web runtime check

With a built Ink Web SDK containing WHIP support and Chrome/Chromium installed:

```sh
INK_WEB_DIST=/absolute/path/to/ink/packages/ink-web/dist npm run test:ink
```

This launches an isolated headless browser with a virtual microphone. It renders
the AIUI sample at 480 × 352 with the color theme and 448 × 170 with the green-only
theme. A probe imports the SDK inside Ink's QuickJS runtime, opens real audio and
capture APIs, intentionally fails authorization before any external WHIP request,
and checks track shutdown and context/peer cleanup. Set `INK_TEST_SCREENSHOT` to
an absolute PNG output path to inspect the sample layout.

This check does not contact Agora or validate a cloud conversation. Microphone
permission and playback activation in an interactive app still need device testing.

The initial implementation passed this runtime check on 2026-10-27 using an Ink
Web build containing PR #735, along with the Node suite, TypeScript check,
formatting check, example preparation and installation of the packed client in a clean directory.

## Real-cloud acceptance

A real-cloud test needs an enabled duplex gateway, a usable App ID/Certificate,
and an AI Studio pipeline (or an existing backend implementing this SDK's adapter).
Automated mock tests do not replace these steps:

1. Start a managed session from a user action and allow the microphone.
2. Confirm media is `connected`, agent is `running`, audio is `running`.
3. Speak and confirm the cloud AI's actual answer is audible.
4. Confirm outgoing/incoming RTP counters increase and both meters react to speech.
5. Test microphone mute, speaker mute, volume and audio resume after returning to the page.
6. End the call; confirm microphone capture stops immediately and the backend confirms bot stop.
7. Interrupt startup and unload the page. Verify the backend reclaims the reservation/bot.
8. Repeat on each target desktop, Android and Ink Web host.

## Live cloud result: 2026-10-27

With a published Studio pipeline, the managed backend successfully started and
stopped real cloud agents. Cloud history confirmed recognition of the injected
speech and generation of an assistant response. Capture and audio/RTC cleanup
completed after the call.

Full cloud voice acceptance is still **blocked on downlink interoperability** on
the tested `ap-webrtc-whip.ap.sd-rtn.com` deployment:

| Client                                                                  | Uplink / cloud processing      | Cloud agent audio received                          |
| ----------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------- |
| Ink Web running this SDK                                                | ASR and LLM response confirmed | 0 inbound RTP packets                               |
| Native Chrome WHIP, without Ink or WHIPSession                          | ASR and LLM response confirmed | 0 inbound RTP packets                               |
| Official Agora RTC SDK control receiver in the same respective channels | Received the WHIP publisher    | Received bot Opus packets and decoded speech energy |

Both WHIP clients completed ICE/DTLS and negotiated `sendrecv`. Their native
browser receiver tracks remained muted with no inbound audio RTP statistics.
The RTC control measured the bot track separately, so its received audio was not
confused with the WHIP publisher's microphone.

This reproduces outside Ink and narrows the remaining issue to the tested
gateway's cloud-agent downlink path or its required configuration. Provider
confirmation is still needed; these results do not identify a specific server
implementation defect. All test agents were stopped afterward.

Earlier Ink-to-Ink WHIP audio tests establish a different interoperability path.
Fresh Android/device voice acceptance for this SDK remains outstanding.
