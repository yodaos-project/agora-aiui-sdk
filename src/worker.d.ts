import type { VoiceWorkerPort } from './index.js';
declare const worker: { onConnect(options: { port: VoiceWorkerPort }): void };
export default worker;
