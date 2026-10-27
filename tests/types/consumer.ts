import {
  AgoraVoiceSession,
  createAgoraVoiceSession,
  createHttpVoiceBackend,
  type VoiceBackend,
  type VoiceState,
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
        uid: 10001,
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
    uid: 10001,
    token: async () => 'temporary-whip-jwt',
  }),
});
// @ts-expect-error choose either a managed backend or a direct connection
new AgoraVoiceSession({ backend, connection: { baseURL: '', channel: '', uid: 1, token: '' } });
// @ts-expect-error numeric identity is required
createAgoraVoiceSession({ connection: { baseURL: '', channel: '', uid: '10001', token: '' } });
