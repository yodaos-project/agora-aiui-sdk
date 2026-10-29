import {
  AgoraVoiceSession,
  createAgoraVoiceSession,
  createHttpVoiceBackend,
  type VoiceBackend,
  type VoiceState,
  type VoiceTranscript,
} from '../../src/index.js';

const backend = createHttpVoiceBackend({
  baseURL: 'https://backend.example.test',
  authorization: async () => 'Bearer application-session',
});
const session = createAgoraVoiceSession({ backend });
session.addEventListener('statechange', () => {
  const state: Readonly<VoiceState> = session.getState();
  console.log(state.media, state.agent, state.audio);
});
await session.start({ signal: new AbortController().signal });
session.setMicrophoneMuted(true);
session.setSpeakerMuted(false);
session.setVolume(0.8);
await session.getStats();
const transcripts: readonly VoiceTranscript[] = await session.getTranscripts();
for (const entry of transcripts) console.log(entry.role, entry.text, entry.interrupted);
// @ts-expect-error transcript messages are read-only
transcripts[0].text = 'changed';
await session.resumeAudio();
await session.stop();

const adapter: VoiceBackend = {
  async createSession({ signal }) {
    signal.throwIfAborted();
    return {
      id: 'business-session',
      whip: {
        baseURL: 'https://whip.example.test',
        channel: 'demo',
        uid: 'aiui-test',
        token: 'temporary-whip-jwt',
      },
    };
  },
  async startAgent({ sessionId }) {
    console.log(sessionId);
  },
  async stopSession({ sessionId }) {
    console.log(sessionId);
  },
};
new AgoraVoiceSession({ backend: adapter });
new AgoraVoiceSession({
  connection: async () => ({
    baseURL: 'https://whip.example.test',
    channel: 'demo',
    uid: 'aiui-direct',
    token: async () => 'temporary-whip-jwt',
  }),
});
// @ts-expect-error choose either a managed backend or a direct connection
new AgoraVoiceSession({ backend, connection: { baseURL: '', channel: '', uid: 1, token: '' } });
// @ts-expect-error an identity must be a string account or a numeric UID
createAgoraVoiceSession({ connection: { baseURL: '', channel: '', uid: {}, token: '' } });
