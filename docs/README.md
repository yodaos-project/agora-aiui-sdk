# Documentation

[简体中文](zh/README.md) · [Project overview](../README.md)

New to voice agents? Start with [what a Voice Agent is](../README.md#what-is-a-voice-agent),
then follow the getting started guide. You do not need to understand WHIP or WebRTC
to run the example.

| Guide                                         | What you will learn                                           |
| --------------------------------------------- | ------------------------------------------------------------- |
| [Getting started](getting-started.md)         | Configure Agora and have your first voice conversation.       |
| [Add voice to your app](integration.md)       | Install the SDK, manage a call, and use existing credentials. |
| [Backend setup](backend.md)                   | Configure the reference server or implement its session API.  |
| [API reference](api.md)                       | Look up methods, options, states, and error codes.            |
| [Troubleshooting](troubleshooting.md)         | Work through connection, microphone, and playback problems.   |
| [Development and verification](validation.md) | Run checks and understand the scope of real-cloud testing.    |

## A few useful terms

| Term             | Meaning here                                                                  |
| ---------------- | ----------------------------------------------------------------------------- |
| AIUI app / agent | Your local Ink application: its page, microphone, and controls.               |
| Voice Agent      | The cloud AI participant that listens and speaks.                             |
| Pipeline         | A saved configuration for the AI's recognition, model, and voice services.    |
| Channel          | A room where your app and the cloud AI exchange audio.                        |
| UID              | A participant's identity in that room. This integration uses string accounts. |
| Session backend  | Your service that prepares credentials and manages the cloud AI's lifetime.   |
| WHIP / WebRTC    | The connection setup and real-time audio transport used by the SDK.           |

The local app and cloud AI are different participants in the same channel.
The SDK takes care of the app's voice connection; your published pipeline defines
the AI's behavior.
