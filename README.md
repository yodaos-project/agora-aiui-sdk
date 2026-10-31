# Agora AIUI SDK

**Give your AIUI Agent a voice people can talk to.**

[![Checks](https://github.com/yodaos-project/agora-aiui-sdk/actions/workflows/check.yml/badge.svg)](https://github.com/yodaos-project/agora-aiui-sdk/actions/workflows/check.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

English · [简体中文](README.zh-CN.md)

[Get started](docs/getting-started.md) · [Try the example](examples/agent) · [API reference](docs/api.md)

## What is a Voice Agent?

A Voice Agent is an AI assistant you can speak with. It listens to your question,
understands what you mean, and answers aloud. With interruptions enabled, you can
speak while it is answering and guide the conversation in a new direction.

Voice keeps your hands free and lets you focus on what you are doing. It works
well for AI glasses, language practice, interactive guides, and step-by-step help.

**Agora AIUI SDK** brings these conversations to AIUI Agents running on
[Ink](https://github.com/jsar-project/ink). Your AIUI Agent captures speech and
plays replies; Agora Cloud provides speech recognition, the language model, and
the AI's voice. Configure its personality, language, and voice in Agora Agent Studio.

## What you can build

| Use case             | Try saying…                           |
| -------------------- | ------------------------------------- |
| AI glasses assistant | “Tell me what to do next.”            |
| Language practice    | “Help me practice ordering a coffee.” |
| Interactive guide    | “Tell me more about this exhibit.”    |
| Product onboarding   | “Walk me through setting this up.”    |

## A conversation, ready to adapt

The included example is a compact voice companion named **小语**, designed for
color and green-only glasses displays.

- **Speak naturally.** Two-way audio with microphone and speaker controls.
- **Interrupt the reply.** Full-duplex conversation on hosts with echo cancellation or with headphones.
- **See what was heard.** Your latest recognized speech updates in a single line.
- **Follow the conversation.** An animated orb shows listening, thinking, speaking, and confirmed interruptions.
- **Keep the interface responsive.** Native Ink processes real-time text in an Agent Worker, separately from page animation and audio.

The SDK also exposes AI reply text, audio levels, connection states, and volume
controls for your own interface. The example keeps AI reply text off the screen.

Audio uses Ink's WHIP and WebRTC APIs. Live text uses the official Agora RTM SDK,
loaded by the example's Worker. JavaScript modules and TypeScript declarations are included.

## Run your first conversation

You will need:

- Node.js 22+ and a recent Ink host with microphone, WHIP, and Worker networking support.
- An Agora project enabled for duplex WHIP and Signaling (RTM).
- A published voice agent in Agora Agent Studio and its `pipelineId`.

```sh
git clone https://github.com/yodaos-project/agora-aiui-sdk.git
cd agora-aiui-sdk
npm ci
npm run example:prepare
```

Follow the **[getting started guide](docs/getting-started.md)** to find your Agora
settings, configure the reference backend, and point the AIUI Agent at it.

Start the configured backend in one terminal:

```sh
npm run example:server
```

Open the example in another terminal:

```sh
ink-open examples/agent --networking-transport native --permission-checks --theme yodaos-sprite-color
```

Tap **开始聊天** (Start chat), allow the microphone, and ask a question. Try
interrupting a longer answer. Tap **结束** (End) when you are done.
Keep the AIUI Agent in the foreground; if playback pauses after switching windows,
tap **继续聊天** (Continue chatting).

## Add voice to your AIUI Agent

For a project with an npm bundler:

```sh
npm install github:yodaos-project/agora-aiui-sdk
```

AIUI Agents that load local scripts can [copy the SDK modules](docs/integration.md#aiui-agent-with-local-scripts).
With your backend and application authentication configured:

```js
import { createAgoraVoiceSession, createHttpVoiceBackend } from '@yodaos-pkg/agora-aiui-sdk';
import configuration from './configuration.js';

const backend = createHttpVoiceBackend({
  baseURL: configuration.backendURL,
  authorization: configuration.authorization,
});
const voice = createAgoraVoiceSession({ backend });

// In your Start button handler:
await voice.start();

// In your End button or page unload handler:
await voice.stop();
```

Create a new session for each call. The [integration guide](docs/integration.md)
shows a complete page with lifecycle handling and audio controls. Use the
[example Worker](examples/agent/workers/transcripts.js) to add live text.

## How it works

| Piece                | Responsibility                                              |
| -------------------- | ----------------------------------------------------------- |
| Your AIUI Agent      | Capture speech, play replies, and present the conversation. |
| Your session backend | Issue temporary credentials and start/stop the cloud AI.    |
| Agora Cloud          | Transport audio and run your configured voice agent.        |

Audio travels directly between Ink and Agora Cloud. The session backend handles
setup and cleanup. Use the included Node.js backend as a starting point, connect
your own service, or [use existing temporary credentials](docs/integration.md#use-existing-temporary-credentials)
when your system already manages the cloud AI.

**Keep App Certificates and model API keys on the server.** The reference backend
uses different string UIDs for the AIUI Agent and the cloud AI.

## Compatibility and verification

The macOS example has been tested with real Agora audio, live ASR, interruptions,
and repeated connect/stop cycles. The user confirmed fluent speech and interruptions;
measurements and host-specific results are in [verification notes](docs/validation.md#real-cloud-results).

Native Ink runs the RTM Worker on a separate thread. Ink Web currently shares its
browser event loop with the Worker realm; measure Web performance separately.
For hosts without echo cancellation, use headphones or [turn-taking mode](docs/api.md#take-turns-speaking).

This version focuses on foreground conversations. Automatic call reconnection,
background calling, general chat messaging, local tool calls, and word captions
synchronized to playback are outside the current API.

## Documentation

| I want to…                      | Read                                               |
| ------------------------------- | -------------------------------------------------- |
| Have my first conversation      | [Getting started](docs/getting-started.md)         |
| Add voice to an AIUI Agent      | [Integration guide](docs/integration.md)           |
| Set up Agora and authentication | [Backend guide](docs/backend.md)                   |
| Find a method or option         | [API reference](docs/api.md)                       |
| Fix a connection or audio issue | [Troubleshooting](docs/troubleshooting.md)         |
| Run tests or contribute         | [Development and verification](docs/validation.md) |

## Contribute

Questions, bugs, and ideas are welcome in [GitHub Issues](https://github.com/yodaos-project/agora-aiui-sdk/issues).
Include your Ink host, SDK version, and a short reproduction without credentials.

```sh
npm ci
npm run check
```

Licensed under the [MIT License](LICENSE). Agora Cloud usage follows your Agora plan.
