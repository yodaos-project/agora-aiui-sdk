# Session backend

The business backend keeps Agora's signing certificate private and controls cloud
Voice Agent lifetime. It never handles the audio stream. If you already allocate
temporary credentials and start the cloud agent elsewhere, use client direct mode instead.

## Run the reference backend

Requirements: Node 22+, an Agora project with duplex WHIP access, and an AI Studio
pipeline configured for voice input and output. The pipeline and App ID must be
usable together. Consult [Agora's server SDK](https://github.com/AgoraIO/agora-agents-ts)
for region, pipeline and model configuration.

From the repository root:

```sh
npm ci
cp examples/server/.env.example examples/server/.env
# Edit examples/server/.env with your own values.
npm run example:server
```

| Variable                | Where it comes from                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `AGORA_APP_ID`          | Your Agora project.                                                                                                          |
| `AGORA_APP_CERTIFICATE` | That project's signing certificate; keep it server-side.                                                                     |
| `AGORA_PIPELINE_ID`     | Your saved voice pipeline in Agora AI Studio.                                                                                |
| `AGORA_AREA`            | Server API region: `AP`, `CN`, `US` or `EU`. Default `AP`.                                                                   |
| `AGORA_WHIP_BASE_URL`   | Your enabled duplex gateway. Default `https://ap-webrtc-whip.ap.sd-rtn.com`. This is separate from the cloud Agent REST API. |
| `BACKEND_API_TOKEN`     | Generate a random value of at least 24 characters for **private demo authentication**.                                       |
| `ALLOWED_ORIGINS`       | Comma-separated browser application origins allowed by CORS.                                                                 |
| `HOST`, `PORT`          | Bind address; default `127.0.0.1:8787`.                                                                                      |

To obtain `AGORA_PIPELINE_ID`, publish your voice agent in Agent Studio, then
open **Agents → Action → Embed Agent** and copy `pipeline_id` from the generated
code. See [Agora's embed instructions](https://docs.agora.io/en/ai/studio/deploy/connect-agent).
The runtime allocates its own channel, UIDs and fresh tokens; you only need the
published configuration ID from the embed snippet.

The reference server uses the official `agora-agents@2.12.0` REST client and
`agora-token@2.0.7` account-token builder. Client and bot share a channel and use
**different string accounts**. It sets `enable_string_uid: true`, puts the bot's
account in `agent_rtc_uid`, and subscribes to the exact client account through
`remote_rtc_uids`. The bot starts only after the client's media connection is established.

The reference uses the SDK's REST client with an explicit string-account token:
version 2.12.0's `AgentSession` automatic token path requires numeric UIDs.
Tokens are refreshed for stop and reconciliation requests, so expired startup
credentials do not prevent cleanup.

Update the client SDK alongside this backend: older numeric-only clients reject
the string `uid` returned in new reservations.

The demo token is shared across demo clients. Do not ship that shared privileged
token in an application. Replace `bearerAuthorizer()` with your application's user
authentication, returning a stable user ID. Each session operation checks ownership.
For deployment, use HTTPS and authorize the actual browser origin; CORS is not authentication.

## Two different kinds of Agora tokens

1. **WHIP JWT**: HS256 signed with the certificate text. Claims include `appID`,
   `streamID`, `action: pub`, `enableSubAuth: true` and an expiry in seconds. In
   string mode it omits `uid`; the client identity is sent as `stringuid` in the
   WHIP URL. The client sends `Authorization: Bearer ...` to WHIP.
2. **RTC/ConvoAI tokens**: the official `RtcTokenBuilder.buildTokenWithRtm` creates
   a token for the bot's exact string account, including RTC and RTM privileges.
   It is used to join the cloud agent and authenticate its REST requests.
   These tokens are not replacements for the WHIP JWT.

`examples/server/token.js` signs only on the backend. Never copy the certificate or
that signer into your AIUI app. All committed configurations contain placeholders.

## Protocol

All operations are authenticated, **bodyless POST** requests. Responses are JSON.
Clients may put this protocol under a prefix by including it in `baseURL` and routing
that prefix at their reverse proxy. The standalone example mounts routes at `/voice/sessions`.

### `POST /voice/sessions`

Reserve a new channel, distinct client and bot string accounts, and a temporary WHIP JWT.
Do not start the cloud agent yet.

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

Timestamps in this HTTP protocol are Unix **milliseconds**, unlike the JWT `exp`.
If using the HTTP adapter, `tokenExpiresAt` is required. `lease` is optional for
custom adapters; if returned, the adapter must implement renewal.

### `POST /voice/sessions/:id/start`

Start the bot after media connects; respond `{ "agent": "running" }`.
Concurrent/repeated starts must create at most one bot. A stopped or expired
reservation cannot be restarted. This is startup acknowledgement, not a live status feed.

### `POST /voice/sessions/:id/stop`

Respond `{ "stopped": true }` only after cloud cleanup is confirmed. Idempotent.
If start is still pending, mark the record closing immediately, then stop its
eventual cloud resource before acknowledging cleanup. Do not forget failed stops.

### `POST /voice/sessions/:id/renew`

Extend an active reservation's lease and return `{ "lease": { "expiresAt": ..., "renewAfterMs": ... } }`.
Reject closed/expired reservations. The example uses a 90-second lease, a
30-minute maximum session duration and a 10-second cleanup sweep.

### `POST /voice/sessions/:id/token`

Return `{ "token": "fresh-whip-jwt", "tokenExpiresAt": ... }` for an active
reservation. Allocate channels and participant accounts on the server rather than
accepting them from the caller. String-mode WHIP JWTs authorize the reserved channel.

## Cleanup and deployment limits

The example store is **single-process, in-memory**. It handles delayed starts,
lost clients, expiry and retryable failed stops while the process remains alive.
It limits active sessions and retains closed tombstones briefly. An uncertain
start is queried by its unique channel for a reconciliation grace period.

Before production or serverless/multiple-instance deployment:

- Store reservations, channel/UID, cloud agent ID and closing state durably.
- Use atomic/idempotent operations across workers.
- Run a scheduled reconciler independently of HTTP requests and client availability.
- Persist an intention before calling the cloud, so a crash or lost start response
  can be reconciled by the reserved channel. Account for the provider's visibility delay.
- Add per-user quotas, admission limits and monitoring for unconfirmed cleanup.

`expiresIn` in the official SDK controls token lifetime, **not a guaranteed cloud
agent maximum lifetime**. The reference's duration/lease limits depend on its
process and sweeper. `idleTimeout: 60` is an extra provider-side fallback, not a
substitute for durable cleanup. Process restarts can lose in-memory records.

Native app unload may prevent the final HTTP request from completing. The backend
must expire reservations independently; a client `stop()` promise alone cannot
guarantee that every server resource was deleted.

The Node example is intentionally a reference you can adapt to your existing
business backend. It is not a distributed production session service.
