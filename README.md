# Agora AIUI SDK

**Give your AIUI Agent a voice. Build an AI assistant people can talk to.**

[![Checks](https://github.com/yodaos-project/agora-aiui-sdk/actions/workflows/check.yml/badge.svg)](https://github.com/yodaos-project/agora-aiui-sdk/actions/workflows/check.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

English · [简体中文](README.zh-CN.md)

[Get started](docs/getting-started.md) · [Documentation](docs/README.md) · [Example AIUI Agent](examples/agent) · [API](docs/api.md)

## What is a Voice Agent?

A Voice Agent is an AI assistant you speak to. You ask a question through a
microphone; it understands your words, prepares a response, and speaks back.
It brings a conversation to your AIUI Agent without asking people to type or read a screen.

With this SDK, your AIUI Agent running on [Ink](https://github.com/jsar-project/ink) captures your
voice and plays the reply. Agora's cloud Voice Agent handles speech recognition,
the language model, and speech synthesis. You choose those services in Agora
Agent Studio.

### Why voice?

- **Keep hands free.** Useful on AI glasses and while doing another task.
- **Make interactions approachable.** Let people ask in their own words.
- **Guide people as they go.** Deliver instructions, explanations, or practice as a conversation.

### What can you build?

| Use case             | Example conversation                |
| -------------------- | ----------------------------------- |
| AI glasses assistant | “Explain the next step.”            |
| Language practice    | “Let's practice ordering a coffee.” |
| Product onboarding   | “How do I use this feature?”        |
| Interactive guide    | “Tell me more about this exhibit.”  |

These are starting points. The agent's knowledge, language, and behavior come
from the cloud configuration you provide.

## What this SDK does

- **Two-way voice:** send microphone audio and hear AI replies through Agora WHIP and WebRTC.
- **Call controls:** start, end, mute the microphone or speaker, and adjust volume.
- **Useful feedback:** read connection states and local/remote audio levels.
- **Conversation text:** display recognized speech and AI replies from conversation history.
- **Flexible setup:** use the included session backend, your own backend, or existing temporary credentials.
- **Ready-to-adapt example:** a compact Ink page for glasses, with color and green-only themes.

The client uses Ink's media APIs and has no additional runtime package dependencies.
JavaScript modules and TypeScript declarations are included.

## Start with the example

You need Node.js 22+, an Ink host with WHIP and microphone support, an Agora
project enabled for duplex WHIP, and a published voice agent in Agent Studio.
Agora cloud usage may incur charges under your plan.

```sh
git clone https://github.com/yodaos-project/agora-aiui-sdk.git
cd agora-aiui-sdk
npm ci
npm run example:prepare
```

Then follow the **[getting started guide](docs/getting-started.md)** to configure
Agora, start the reference backend, and open the example in Ink. It walks through
where to find each value, including `pipelineId`.

Your first milestone: tap **开始聊天** (Start chat), speak, hear the AI answer, then tap
**结束通话** (End call). Keep the AIUI Agent in the foreground during the call.

## A call in JavaScript

For a project with an npm bundler, install from GitHub:

```sh
npm install github:yodaos-project/agora-aiui-sdk
```

Once your backend and AIUI Agent configuration are ready, start a call like this.
AIUI Agents that load local scripts can [copy the SDK files instead](docs/integration.md#aiui-agent-with-local-scripts).

```js
import { createAgoraVoiceSession, createHttpVoiceBackend } from '@yodaos-pkg/agora-aiui-sdk';
import configuration from './configuration.js';

const backend = createHttpVoiceBackend({
  baseURL: configuration.backendURL,
  authorization: configuration.authorization,
});

const voice = createAgoraVoiceSession({ backend });

voice.addEventListener('statechange', () => {
  console.log(voice.getState());
});

// Run from your Connect button.
await voice.start();
```

Call `voice.stop()` from your End button and page unload handler. Create a new
session for the next call. See [add voice to your AIUI Agent](docs/integration.md) for
installation, page lifecycle, and audio controls.

## How the pieces fit together

| Piece                      | Responsibility                                              |
| -------------------------- | ----------------------------------------------------------- |
| Your AIUI Agent + this SDK | Capture speech, play replies, and show call controls.       |
| Your session backend       | Issue temporary credentials and start/stop the cloud agent. |
| Agora Cloud                | Carry the audio and run the configured AI conversation.     |

Audio travels directly between Ink and Agora Cloud. The session backend handles
setup and cleanup. The included Node.js backend is a starting point for your own
service; you can also [connect with existing credentials](docs/integration.md#use-existing-temporary-credentials).

Keep the **App Certificate and model API keys on the server**. The reference
backend configures distinct **string UIDs** for the AIUI Agent and cloud AI, as required by
this cloud voice integration.

## Documentation

| I want to…                                                | Read                                               |
| --------------------------------------------------------- | -------------------------------------------------- |
| Have my first conversation                                | [Getting started](docs/getting-started.md)         |
| Add voice to an existing AIUI Agent                       | [Integration guide](docs/integration.md)           |
| Configure Agora or use my own backend                     | [Backend guide](docs/backend.md)                   |
| Look up a method or option                                | [API reference](docs/api.md)                       |
| Fix silence, a failed connection, or interrupted playback | [Troubleshooting](docs/troubleshooting.md)         |
| Check test coverage or contribute                         | [Development and verification](docs/validation.md) |

Version 0.1.0 focuses on foreground voice conversations. Word-synchronized captions, RTM messaging,
local tool calls, automatic reconnection, and background calling are not included.
Ink Web has passed repeated real-cloud voice tests; see [verification scope](docs/validation.md#real-cloud-results)
for host-specific results and remaining checks.

## Contribute

Found a problem or have an idea? [Open an issue](https://github.com/yodaos-project/agora-aiui-sdk/issues).
Include your Ink host, SDK version, and a short reproduction. Please leave out credentials.

```sh
npm ci
npm run check
```

Contributions are welcome. This project is released under the [MIT License](LICENSE).
