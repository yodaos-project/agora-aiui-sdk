// The official RTM bundle and its Wasm are evaluated only in the Agent Worker.
import { createAgoraRtmTranscripts } from '../lib/sdk/rtm-transcripts.js';
import AgoraRTM from '../lib/sdk/rtm-vendor.js';
import { serveWorkerTranscripts } from '../lib/transcript-channel.js';

const clients = new Map();
const source = {
  connect(options) {
    const { appId, userId } = options.connection;
    const identity = JSON.stringify([appId, userId]);
    let entry = clients.get(identity);
    if (!entry) {
      if (clients.size >= 8) {
        const idle = [...clients].find(([, value]) => !value.active);
        if (!idle) throw new Error('Too many live text connections.');
        clients.delete(idle[0]);
      }
      entry = { source: createAgoraRtmTranscripts({ RTM: AgoraRTM.RTM }), active: false };
      clients.set(identity, entry);
    }
    if (entry.active) throw new Error('This RTM account already has a live text connection.');
    const handle = entry.source.connect(options);
    entry.active = true;
    let closing;
    return {
      ready: handle.ready,
      close() {
        return (closing ??= Promise.resolve()
          .then(() => handle.close())
          .finally(() => {
            entry.active = false;
          }));
      },
    };
  },
};

export default {
  onConnect({ port }) {
    serveWorkerTranscripts(port, source);
  },
};
