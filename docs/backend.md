# Set up your session backend

[简体中文](zh/backend.md) · [All docs](README.md)

The session backend prepares a call: it issues temporary credentials, starts the
cloud AI after Ink connects, and stops it when the call ends. It does not relay
audio. For the fastest setup, follow the [getting started guide](getting-started.md).

If your system already provides credentials and manages the AI, use
[direct mode](integration.md#use-existing-temporary-credentials) instead.

## Configure the reference server

The example requires Node.js 22+. Copy `examples/server/.env.example` to
`examples/server/.env`, fill in your values, then run `npm run example:server`
from the repository root after `npm ci`.

| Variable                | What to enter                                                                     |
| ----------------------- | --------------------------------------------------------------------------------- |
| `AGORA_APP_ID`          | Your Agora project's App ID.                                                      |
| `AGORA_APP_CERTIFICATE` | The same project's signing certificate. Keep it on the server.                    |
| `AGORA_PIPELINE_ID`     | Your published Agent Studio configuration's `pipeline_id`.                        |
| `AGORA_AREA`            | Cloud API area: `AP`, `CN`, `US`, or `EU`. Default: `AP`.                         |
| `AGORA_WHIP_BASE_URL`   | Your enabled duplex WHIP origin. Default: `https://ap-webrtc-whip.ap.sd-rtn.com`. |
| `BACKEND_API_TOKEN`     | A random private-demo token of at least 24 characters, without whitespace.        |
| `ALLOWED_ORIGINS`       | Comma-separated Web host origins, such as `https://app.example.com`.              |
| `HOST` / `PORT`         | Listen address. Defaults: `127.0.0.1` / `8787`.                                   |

To find `pipeline_id`, publish your agent, then open **Agents → Action → Embed Agent**.
Copy the ID from the generated code; do not reuse the snippet's temporary tokens
for ongoing calls. See [Agora's embed guide](https://docs.agora.io/en/ai/studio/deploy/connect-agent).

The pipeline supplies the speech recognition, language model, and voice settings.
The reference server uses the official [Agora server SDK](https://github.com/AgoraIO/agora-agents-ts)
to start and stop it. That server SDK belongs on the backend; this project's client
SDK belongs in your AIUI Agent.

## Choose the right addresses

There are three separate destinations:

| Address               | Used for                                                             |
| --------------------- | -------------------------------------------------------------------- |
| Your backend URL      | AIUI Agent requests for session setup, start, stop, and renewal.     |
| `AGORA_WHIP_BASE_URL` | The AIUI Agent's real-time audio connection to Agora.                |
| Agora cloud Agent API | Backend requests to start and stop the AI, selected by `AGORA_AREA`. |

For deployment, use HTTPS for your backend. The client permits HTTP only on
localhost/loopback for development. A phone cannot reach your computer through
`127.0.0.1`; use a reachable HTTPS service.

For Ink Web, put the host page's exact origin in `ALLOWED_ORIGINS`, including the
scheme and port when present. For example, `http://localhost:5173` and
`http://127.0.0.1:5173` are different origins. CORS controls browser access;
Authorization still authenticates each session request.

## Identity and tokens

For cloud AI voice, use **two different string accounts in the same channel**:

- Client: for example, `aiui-client-10001`.
- Cloud AI: for example, `agent-10001`.

The reference backend sets this up for each call. If you start the AI yourself,
set `enable_string_uid: true`, set `agent_rtc_uid` to the AI's account, and put the
exact client account in `remote_rtc_uids`.

Three credentials serve different purposes:

| Credential           | Sent by                   | Purpose                                                                                        |
| -------------------- | ------------------------- | ---------------------------------------------------------------------------------------------- |
| Business login token | AIUI Agent → your backend | Authorize your user's session operations. The private demo uses `BACKEND_API_TOKEN`.           |
| WHIP JWT             | AIUI Agent → Agora WHIP   | Authorize the audio connection. The server signs it and gives the AIUI Agent a temporary copy. |
| RTC/ConvoAI token    | Backend → Agora           | Authenticate cloud operations and the AI participant's channel identity.                       |

For a custom signer, follow `examples/server/token.js`: the string-mode WHIP JWT
has `version`, `appID`, `streamID`, `exp`, `action: 'pub'`, and `enableSubAuth: true`.
It omits `uid`; the AIUI Agent's account travels in the URL's `stringuid` parameter.
Sign HS256 with the certificate's text value, not hex-decoded bytes.
The SDK constructs the duplex URL without a numeric `Uid` parameter.

The reference server uses `RtcTokenBuilder.buildTokenWithRtm` from `agora-token`
for the AI's exact string account. It passes explicit account tokens to
`agora-agents@2.12.0`; that version's automatic `AgentSession` token generation
expects numeric UIDs. Stop and reconciliation requests obtain fresh tokens too.
Update the client and backend together: older numeric-only clients cannot read
string-account reservations.

## Use your own backend

Keep App Certificates and model API keys on the server. Replace the demo's shared
token authorizer with your user authentication, returning a stable
user ID. Check that user owns the session on every operation.

Use `createHttpVoiceBackend` if you implement the HTTP contract below. If your
service already has another API, implement the `VoiceBackend` methods from
[src/index.d.ts](../src/index.d.ts):

| Method                                  | Responsibility                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| `createSession({ signal })`             | Reserve credentials and return `{ id, whip, lease? }`. Do not start the AI yet.  |
| `startAgent({ sessionId, signal })`     | Start the AI after the AIUI Agent's media is connected.                          |
| `stopSession({ sessionId, signal })`    | Stop the AI and release the reservation. Also handle a start that finishes late. |
| `renewSession({ sessionId, signal })`   | Return `{ lease }`. Required if reservations include a lease.                    |
| `getTranscripts({ sessionId, signal })` | Return conversation messages. Optional; enables ASR and assistant text.          |

The optional transcript method returns normalized ASR/assistant messages. The
reference factory reads Agora history with fresh server-side authorization. No
provider metadata or signing credentials are returned to the client.

## HTTP contract

All operations use authenticated **POST requests without a body** and return JSON.
The standalone example serves `/voice/sessions`. A proxy prefix can be included
in the client's `baseURL` if your proxy routes that prefix.

### Reserve a session

`POST /voice/sessions` returns HTTP 201:

```json
{
  "id": "a-server-generated-session-id",
  "whip": {
    "baseURL": "https://ap-webrtc-whip.ap.sd-rtn.com",
    "channel": "aiui-server-generated-channel",
    "uid": "aiui-server-generated-client",
    "token": "temporary-whip-jwt",
    "tokenExpiresAt": 1800000000000
  },
  "lease": {
    "expiresAt": 1800000000000,
    "renewAfterMs": 30000
  }
}
```

Generate channels and participant identities on the server. `tokenExpiresAt` is
required by the HTTP adapter. HTTP timestamps are Unix **milliseconds**; JWT `exp`
uses **seconds**. A lease is a reservation expiry that the client extends while
active, so the backend can reclaim abandoned calls.

### Manage the reserved session

The following successful operations return HTTP 200:

| Endpoint                    | Response                                                             | Behavior                                                                      |
| --------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `/voice/sessions/:id/start` | `{ "agent": "running" }`                                             | Start at most one AI for repeated/concurrent requests. Reject ended sessions. |
| `/voice/sessions/:id/stop`  | `{ "stopped": true }`                                                | Confirm cloud cleanup, including any pending start. Repeated stops are safe.  |
| `/voice/sessions/:id/renew` | `{ "lease": { "expiresAt": 1800000000000, "renewAfterMs": 30000 } }` | Extend an active lease; reject ended sessions.                                |
| `/voice/sessions/:id/token` | `{ "token": "fresh-whip-jwt", "tokenExpiresAt": 1800000000000 }`     | Issue fresh WHIP authorization for the reserved channel.                      |

`agent: running` acknowledges startup; it is not a live status feed.
The reference backend returns errors as `{ "error": "CODE" }` with a non-2xx
status. The client exposes a safe `BACKEND` error; inspect server-side logs when
you need the underlying reason.

### Read conversation text

`POST /voice/sessions/:id/transcripts` returns HTTP 200:

```json
{
  "transcripts": [
    { "id": "user:1", "role": "user", "text": "Hello.", "interrupted": false },
    { "id": "assistant:1", "role": "assistant", "text": "Hi!", "interrupted": false }
  ]
}
```

This optional endpoint reads the running AI's conversation history. It checks
ownership and expiry before reading and checks again before returning. Concurrent
reads for one reservation share one cloud request. Ended sessions cannot be read.
A custom `VoiceBackend.getTranscripts({ sessionId, signal })` returns the message
array directly, without the HTTP `transcripts` wrapper.

The AIUI Agent example polls every two seconds. This is conversation text, not an RTM
stream or a word-synchronized TTS transcript. For large deployments or live captions,
use a provider event/messaging feed and account for your API rate limits.

## Before deploying

The included server uses **single-process, in-memory storage**. Its defaults are
20 active sessions, a 90-second renewable lease, a 30-minute call limit, and a
cleanup sweep every 10 seconds. These are example policies you can change in
`createSessionService`, not SDK-wide or Agora guarantees.

For production, store session ownership, channel/UIDs, cloud `agent_id`, pending
starts, and cleanup state durably. Coordinate repeated operations across server
instances and run cleanup independently of client requests. Reconcile uncertain
starts by the reserved channel and allow for delayed cloud visibility.

Retain failed stops for retry. A process restart loses this example's in-memory
records. Client unload or a lost response can also prevent final cleanup from
being confirmed. Token expiry and the AI's 60-second idle timeout are not
substitutes for backend cleanup or a guaranteed maximum call duration.

Next: [client API](api.md) · [troubleshooting](troubleshooting.md)
