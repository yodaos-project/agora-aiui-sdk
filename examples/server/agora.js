import { AgoraClient, Area } from 'agora-agents';
import agoraToken from 'agora-token';
import { isAgoraUid } from '../../src/agora.js';

const { RtcTokenBuilder, RtcRole } = agoraToken;

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
  return ({ sessionId, channel, uid, botUid, maxDurationSeconds }) => {
    if (
      typeof uid !== 'string' ||
      typeof botUid !== 'string' ||
      !isAgoraUid(uid) ||
      !isAgoraUid(botUid) ||
      uid === botUid
    ) {
      throw new TypeError('The client and agent must use distinct string accounts.');
    }
    if (!Number.isInteger(maxDurationSeconds) || maxDurationSeconds < 1) {
      throw new TypeError('The cloud agent duration must be a positive number of seconds.');
    }
    const lifetime = Math.min(maxDurationSeconds, 86400);
    // AgentSession 2.12 auto-token generation parses agentUid as an integer.
    // The generated REST client accepts an explicit account token without that conversion.
    const token = () => {
      const value = RtcTokenBuilder.buildTokenWithRtm(
        appId,
        certificate,
        channel,
        botUid,
        RtcRole.PUBLISHER,
        lifetime,
        lifetime,
      );
      if (!value) throw new Error('The cloud agent token could not be generated.');
      return value;
    };
    const authorization = () => ({ headers: { Authorization: `agora token=${token()}` } });
    const stopAgent = async (id) => {
      try {
        await client.agents.stop({ appid: appId, agentId: id }, authorization());
      } catch (error) {
        if (error.statusCode !== 404) throw error;
      }
    };
    let agentId;
    let uncertainUntil = 0;
    return {
      async start() {
        try {
          const rtcToken = token();
          const result = await client.agents.start(
            {
              appid: appId,
              name: `aiui-${sessionId}`,
              pipeline_id: pipelineId,
              properties: {
                channel,
                token: rtcToken,
                agent_rtc_uid: botUid,
                remote_rtc_uids: [uid],
                enable_string_uid: true,
                idle_timeout: 60,
              },
            },
            { headers: { Authorization: `agora token=${rtcToken}` } },
          );
          agentId = result.agent_id;
          if (!agentId) throw new Error('The cloud did not return an agent ID.');
        } catch (error) {
          // A lost HTTP response does not prove that the cloud failed to create the agent.
          uncertainUntil = Date.now() + 60_000;
          throw error;
        }
      },
      async stop() {
        if (!agentId && uncertainUntil) {
          const page = await client.agents.list(
            { appid: appId, channel, state: '0,1,2,3', limit: 100 },
            authorization(),
          );
          for await (const found of page) {
            if (found.agent_id) await stopAgent(found.agent_id);
          }
          // Retain the record for repeated queries while creation may still become visible.
          if (Date.now() < uncertainUntil)
            throw new Error('Cloud start reconciliation is pending.');
          uncertainUntil = 0;
        }
        if (!agentId) return;
        // Retain the ID after a failed stop so the reconciler can retry with fresh auth.
        await stopAgent(agentId);
        agentId = null;
      },
    };
  };
}
