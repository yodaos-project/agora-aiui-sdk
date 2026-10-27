import assert from 'node:assert/strict';

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export const tick = () => new Promise((resolve) => setImmediate(resolve));

export function fakeRuntime(t, overrides = {}) {
  const order = [];
  const streams = [];
  const audios = [];
  const whips = [];
  const nodes = [];
  class Track extends EventTarget {
    kind = 'audio';
    enabled = true;
    readyState = 'live';
    stop() {
      this.readyState = 'ended';
      order.push('track.stop');
    }
  }
  class Stream {
    constructor(tracks = [new Track()]) {
      this.tracks = tracks;
    }
    getTracks() {
      return this.tracks;
    }
    getAudioTracks() {
      return this.tracks;
    }
  }
  class Node {
    gain = { value: 1 };
    connected = false;
    samples = [];
    constructor() {
      nodes.push(this);
    }
    connect() {
      this.connected = true;
    }
    disconnect() {
      this.connected = false;
    }
    getFloatTimeDomainData(buffer) {
      this.samples.push(buffer);
      buffer.fill(0.5);
    }
  }
  class Audio extends EventTarget {
    state = 'suspended';
    destination = {};
    constructor() {
      super();
      audios.push(this);
    }
    async resume() {
      this.state = 'running';
      order.push('audio.resume');
    }
    async close() {
      this.state = 'closed';
      order.push('audio.close');
    }
    createMediaStreamSource() {
      return new Node();
    }
    createGain() {
      return new Node();
    }
    createAnalyser() {
      return new Node();
    }
  }
  class PC extends EventTarget {
    connectionState = 'new';
    iceConnectionState = 'new';
    addTransceiver(track, options) {
      this.track = track;
      assert.equal(options.direction, 'sendrecv');
    }
    async getStats() {
      return new Map();
    }
  }
  class Whip {
    peerConnection = new PC();
    constructor(endpoint, options) {
      this.endpoint = endpoint;
      this.options = options;
      whips.push(this);
    }
    async connect() {
      order.push('whip.connect');
      await overrides.connect?.(this);
    }
    async waitForConnection() {
      if (overrides.waitForConnection) await overrides.waitForConnection(this);
      this.peerConnection.connectionState = 'connected';
      this.peerConnection.iceConnectionState = 'connected';
      order.push('media.connected');
      this.peerConnection.dispatchEvent(new Event('connectionstatechange'));
    }
    async close() {
      order.push('whip.close');
      this.peerConnection.connectionState = 'closed';
      if (overrides.close) await overrides.close();
    }
  }
  const values = {
    AudioContext: Audio,
    WHIPSession: Whip,
    MediaStream: Stream,
    navigator: {
      mediaDevices: {
        async getUserMedia() {
          order.push('capture');
          if (overrides.getUserMedia) return overrides.getUserMedia();
          const stream = new Stream();
          streams.push(stream);
          return stream;
        },
      },
    },
  };
  const originals = Object.fromEntries(
    Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => {
    for (const key of Object.keys(values)) {
      if (originals[key]) Object.defineProperty(globalThis, key, originals[key]);
      else delete globalThis[key];
    }
  });
  return { order, streams, audios, whips, nodes, Stream, Track };
}

export const connection = {
  baseURL: 'https://whip.example.test',
  channel: 'test-channel',
  uid: 10001,
  token: 'test-only-token',
};

export function backend(runtime, overrides = {}) {
  return {
    async createSession() {
      runtime.order.push('backend.reserve');
      return { id: 'reservation-1', whip: connection };
    },
    async startAgent() {
      runtime.order.push('agent.start');
      return { agent: 'running' };
    },
    async stopSession() {
      runtime.order.push('agent.stop');
      return { stopped: true };
    },
    ...overrides,
  };
}
