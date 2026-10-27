import { createServer } from 'node:http';
import { createAgoraAgentFactory } from './agora.js';
import { bearerAuthorizer, createVoiceHandler } from './http.js';
import { createSessionService } from './sessions.js';

const appId = process.env.AGORA_APP_ID;
const certificate = process.env.AGORA_APP_CERTIFICATE;
const createAgent = createAgoraAgentFactory({
  appId,
  certificate,
  pipelineId: process.env.AGORA_PIPELINE_ID,
  area: process.env.AGORA_AREA || 'AP',
});
const service = createSessionService({
  appId,
  certificate,
  createAgent,
  baseURL: process.env.AGORA_WHIP_BASE_URL || 'https://ap-webrtc-whip.ap.sd-rtn.com',
});
const server = createServer(
  createVoiceHandler({
    service,
    authorize: bearerAuthorizer(process.env.BACKEND_API_TOKEN),
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  }),
);
server.requestTimeout = 20_000;
server.headersTimeout = 10_000;
const sweeper = setInterval(() => {
  void service.sweep();
}, 10_000);
sweeper.unref();
server.listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1', () => {
  console.log('Voice backend is listening. Agora credentials remain on this server.');
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    clearInterval(sweeper);
    server.close();
    const deadline = setTimeout(() => process.exit(1), 20_000);
    try {
      await service.close();
      clearTimeout(deadline);
      process.exitCode = 0;
    } catch {
      console.error('Cloud cleanup is unconfirmed; reconcile active sessions before restarting.');
      process.exitCode = 1;
    }
  });
}
