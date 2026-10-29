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

These historical tests used numeric UIDs. Their downlink failure was corrected
by using consistent string accounts; see the 2026-10-29 results below. At the time,
the tested `ap-webrtc-whip.ap.sd-rtn.com` deployment produced:

| Client                                                                  | Uplink / cloud processing      | Cloud agent audio received                          |
| ----------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------- |
| Ink Web running this SDK                                                | ASR and LLM response confirmed | 0 inbound RTP packets                               |
| Native Chrome WHIP, without Ink or WHIPSession                          | ASR and LLM response confirmed | 0 inbound RTP packets                               |
| Official Agora RTC SDK control receiver in the same respective channels | Received the WHIP publisher    | Received bot Opus packets and decoded speech energy |

Both WHIP clients completed ICE/DTLS and negotiated `sendrecv`. Their native
browser receiver tracks remained muted with no inbound audio RTP statistics.
The RTC control measured the bot track separately, so its received audio was not
confused with the WHIP publisher's microphone.

This reproduced outside Ink, but did not establish a server defect. Agora later
confirmed that this integration requires string UIDs. Sending both `stringuid`
and a numeric `Uid` while setting `enable_string_uid: false` did not satisfy that
requirement. All test agents were stopped afterward.

Earlier Ink-to-Ink WHIP audio tests establish a different interoperability path.
Fresh Android/device voice acceptance for this SDK remains outstanding.

## String UID correction: 2026-10-29

Following Agora's feedback, the managed example now allocates distinct string
accounts for Ink and the cloud AI:

- WHIP sends only `stringuid=<client account>&duplex=true`, without numeric `Uid`.
- The string-mode WHIP JWT authorizes the channel and omits the numeric `uid` claim.
- Agent startup sets `enable_string_uid: true`, `agent_rtc_uid` to the bot's account,
  and `remote_rtc_uids` to the exact client account.
- Official account-token generation preserves the bot's identity in its RTC/RTM
  token and REST authorization; startup, stop and reconciliation use those tokens.

Real-cloud checks used the published Studio pipeline, actual voice input through
a virtual microphone, and the current SDK running inside Ink QuickJS/Wasm:

| Client             | Outgoing RTP | Incoming AI RTP | Decoded samples | Peak remote audio |
| ------------------ | -----------: | --------------: | --------------: | ----------------: |
| Native Chrome WHIP |         2542 |            1583 |         1519200 |        -18.1 dBFS |
| Ink Web + this SDK |         2462 |            1466 |         1402080 |        -15.2 dBFS |

These are periodic samples before stop. Both clients completed cloud Agent,
capture, media and audio cleanup. The measured downlink was the actual AI reply.
The native browser and Ink results both passed; Android and native desktop hosts
still require separate acceptance for this SDK.

A second Ink Web run kept one Ink client connected to the cloud agent for a
120-second observation window, with **no Agora RTC SDK loaded or observer joined**.
The virtual microphone repeated a spoken question through the normal capture and
WHIP path. Cloud history contained three complete user/assistant turns and a fourth
user input before shutdown. The last periodic sample reported 6556 outgoing RTP
packets, 5514 incoming AI packets and 5291040 decoded samples. The native browser
peer remained connected, and capture, audio, media and cloud-agent cleanup completed.
The received WHIP audio was recorded separately from the microphone as evidence.

This verifies repeated voice input and actual decoded AI replies in Ink Web; it
does not claim a new physical Android or native desktop playback test.
