import { Agent, AgoraClient, Area, generateConvoAIToken } from 'agora-agents';

/** Configure the official server SDK. A saved AI Studio pipeline supplies ASR/LLM/TTS. */
export function createAgoraAgentFactory({ appId, certificate, pipelineId, area = 'AP' }) {
  if (!pipelineId || !['AP', 'CN', 'US', 'EU'].includes(area))
    throw new TypeError('Set AGORA_PIPELINE_ID and a valid AGORA_AREA.');
  const client = new AgoraClient({
    area: Area[area],
    appId,
    appCertificate: certificate,
    timeoutInSeconds: 15,
    maxRetries: 0,
  });
  const agent = new Agent({ client, pipelineId });
  return ({ sessionId, channel, uid, botUid, maxDurationSeconds }) => {
    const session = agent.createSession({
      name: `aiui-${sessionId}`,
      channel,
      agentUid: String(botUid),
      remoteUids: [String(uid)],
      enableStringUid: false,
      idleTimeout: 60,
      expiresIn: maxDurationSeconds,
    });
    let agentId;
    let uncertainUntil = 0;
    return {
      async start() {
        try {
          agentId = await session.start();
          if (!agentId) throw new Error('The cloud did not return an agent ID.');
        } catch (error) {
          // A lost HTTP response does not prove that the cloud failed to create the agent.
          uncertainUntil = Date.now() + 60_000;
          throw error;
        }
      },
      async stop() {
        if (!agentId && uncertainUntil) {
          const auth = generateConvoAIToken({
            appId,
            appCertificate: certificate,
            channelName: channel,
            uid: botUid,
          });
          const page = await client.agents.list(
            { appid: appId, channel, state: '0,1,2,3', limit: 100 },
            {
              headers: { Authorization: `agora token=${auth}` },
            },
          );
          for await (const found of page) {
            if (found.agent_id) await client.stopAgent(found.agent_id);
          }
          // Retain the record for repeated queries while creation may still become visible.
          if (Date.now() < uncertainUntil)
            throw new Error('Cloud start reconciliation is pending.');
          uncertainUntil = 0;
        }
        if (!agentId) return;
        // Stop by ID so a failed stop can be retried by the reconciler.
        // AgentSession.stop() cannot be called again after entering its error state.
        await client.stopAgent(agentId);
        agentId = null;
      },
    };
  };
}
