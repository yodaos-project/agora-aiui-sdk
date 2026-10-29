import { agoraEndpoint, whipOptions } from './agora.js';
import { transcriptSnapshot } from './transcripts.js';
import {
  AgoraVoiceError,
  acquire,
  bounded,
  cancelled,
  checkSignal,
  positiveMilliseconds,
} from './errors.js';

const CAPTURE = {
  audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

function stopTracks(stream) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** One foreground voice call. Create a new instance for another call. */
export class AgoraVoiceSession extends EventTarget {
  constructor(options = {}) {
    super();
    if (Boolean(options.connection) === Boolean(options.backend)) {
      throw new TypeError('Provide exactly one of connection or backend.');
    }
    if (
      options.backend &&
      ['createSession', 'startAgent', 'stopSession'].some(
        (name) => typeof options.backend[name] !== 'function',
      )
    )
      throw new TypeError('backend must implement createSession, startAgent and stopSession.');
    if (options.transcripts && typeof options.transcripts.connect !== 'function')
      throw new TypeError('transcripts must implement connect.');
    if (options.transcripts && !options.backend)
      throw new TypeError('Live transcripts require a managed backend reservation.');
    if (
      options.microphoneMode !== undefined &&
      !['full-duplex', 'half-duplex'].includes(options.microphoneMode)
    )
      throw new TypeError('microphoneMode must be full-duplex or half-duplex.');
    this._options = { ...options };
    this._timeout = positiveMilliseconds(options.timeout, 15_000, 'timeout');
    this._cleanupTimeout = positiveMilliseconds(options.cleanupTimeout, 5_000, 'cleanupTimeout');
    this._controller = new AbortController();
    this._lifecycle = 'idle';
    this._media = 'new';
    this._agent = options.backend ? 'idle' : 'not-managed';
    this._micMuted = false;
    this._micSuppressed = options.microphoneMode === 'half-duplex';
    this._microphoneHoldUntil = 0;
    this._agentSpeaking = false;
    this._agentThinking = false;
    this._speakerMuted = false;
    this._volume = 1;
    this._listeners = [];
    this._sources = [];
    this._remoteTracks = new Set();
    this._remoteStreams = new Set();
    this._buffers = { local: new Float32Array(1024), remote: new Float32Array(1024) };
    this._levelCache = { local: -60, remote: -60 };
    this._lastLevelTime = -Infinity;
    this._error = null;
    this._cleanupReport = null;
    this._transcriptMessages = Object.freeze([]);
    this._transcriptState = Object.freeze({ status: 'disabled', error: null });
  }

  /** A sanitized snapshot: signaling, transport and cloud agent states are separate. */
  getState() {
    return Object.freeze({
      lifecycle: this._lifecycle,
      media: this._media,
      agent: this._agent,
      audio: this._audio?.state ?? 'closed',
      microphoneMuted: this._micMuted,
      microphoneSuppressed: this._micSuppressed,
      speakerMuted: this._speakerMuted,
      volume: this._volume,
      error: this._error
        ? Object.freeze({ code: this._error.code, message: this._error.message })
        : null,
      cleanup: this._cleanupReport,
    });
  }

  /** Start capture, connect media, then start the managed cloud agent. */
  start({ signal } = {}) {
    if (this._startPromise) return this._startPromise;
    if (this._lifecycle !== 'idle') return Promise.reject(cancelled());
    const pending = deferred();
    this._startPromise = pending.promise;
    // Run immediately so AudioContext.resume() remains inside the user's click handler.
    this._runStart(signal).then(pending.resolve, pending.reject);
    return pending.promise;
  }

  async _runStart(externalSignal) {
    const signal = this._controller.signal;
    const abort = () => this._controller.abort();
    externalSignal?.addEventListener('abort', abort, { once: true });
    if (externalSignal?.aborted) abort();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abort();
    }, this._timeout);
    let step = 'UNSUPPORTED';
    try {
      checkSignal(signal);
      if (
        typeof globalThis.WHIPSession !== 'function' ||
        typeof globalThis.AudioContext !== 'function' ||
        !globalThis.navigator?.mediaDevices?.getUserMedia
      ) {
        throw new AgoraVoiceError(
          'UNSUPPORTED',
          'This page needs Ink WHIP, WebRTC and microphone support.',
        );
      }
      this._lifecycle = 'starting';
      step = 'AUDIO';
      this._audio = new AudioContext();
      this._listen(this._audio, 'statechange', () => {
        this._refreshMicrophoneGate();
        this._notify();
      });
      const resumed = this._audio.resume();
      this._notify();
      await acquire(resumed, signal);
      checkSignal(signal);

      step = 'BACKEND';
      let connection;
      if (this._options.backend) {
        const backend = this._options.backend;
        await acquire(
          backend.createSession({ signal }),
          signal,
          (reservation) => {
            this._reservation = reservation;
          },
          (reservation) => this._releaseLateReservation(backend, reservation),
        );
        checkSignal(signal);
        if (!this._reservation?.id || typeof this._reservation.id !== 'string') {
          throw new TypeError('The backend returned an invalid reservation.');
        }
        connection = this._reservation.whip;
        this._scheduleRenewal(this._reservation.lease);
      } else {
        connection = await acquire(
          typeof this._options.connection === 'function'
            ? this._options.connection({ signal })
            : this._options.connection,
          signal,
        );
      }
      checkSignal(signal);
      step = 'CONFIGURATION';
      const endpoint = agoraEndpoint(connection);
      const options = whipOptions(connection);
      this._whip = new WHIPSession(endpoint, options);
      // Do not retain credential-bearing connection or configuration objects after setup.
      delete this._options.connection;
      const pc = this._whip.peerConnection;
      this._listen(pc, 'connectionstatechange', () => this._refreshTransport());
      this._listen(pc, 'iceconnectionstatechange', () => this._refreshTransport());
      this._listen(pc, 'track', (event) => this._receiveTrack(event));
      this._media = 'connecting';
      this._notify();
      checkSignal(signal);

      step = 'MICROPHONE';
      await acquire(
        navigator.mediaDevices.getUserMedia(CAPTURE),
        signal,
        (stream) => {
          this._stream = stream;
        },
        stopTracks,
      );
      checkSignal(signal);
      const track = this._stream.getAudioTracks()[0];
      if (!track || track.readyState === 'ended') throw new Error('No live audio track.');
      track.enabled = !this._micMuted && !this._micSuppressed;
      const microphoneEnded = () => this._fail('MICROPHONE', 'The microphone stopped.');
      if (typeof track.addEventListener === 'function')
        this._listen(track, 'ended', microphoneEnded);
      else {
        // Ink track objects in the initial WHIP release expose readyState without EventTarget.
        this._trackTimer = setInterval(() => {
          if (track.readyState === 'ended') microphoneEnded();
        }, 1000);
      }
      this._buildLocalAudio();
      if (this._options.microphoneMode === 'half-duplex')
        this._microphoneGateTimer = setInterval(() => this._refreshMicrophoneGate(), 100);
      pc.addTransceiver(track, { direction: 'sendrecv', streams: [this._stream] });

      step = 'MEDIA';
      await acquire(this._whip.connect({ signal, timeout: this._timeout }), signal);
      checkSignal(signal);
      await acquire(this._whip.waitForConnection({ signal, timeout: this._timeout }), signal);
      checkSignal(signal);
      this._refreshTransport();
      checkSignal(signal);
      if (this._media !== 'connected') throw new Error('The media transport is unavailable.');

      if (this._options.backend) {
        // Subscribe before starting the cloud AI so its first words are not missed.
        await this._connectTranscripts();
        checkSignal(signal);
        step = 'AGENT';
        this._agent = 'starting';
        this._notify();
        checkSignal(signal);
        await acquire(
          this._options.backend.startAgent({ sessionId: this._reservation.id, signal }),
          signal,
        );
        checkSignal(signal);
        this._agent = 'running';
      }
      if (this._options.microphoneMode === 'half-duplex')
        this._microphoneHoldUntil = Math.max(this._microphoneHoldUntil, Date.now() + 1000);
      this._lifecycle = 'running';
      this._refreshMicrophoneGate();
      this._notify();
      checkSignal(signal);
      return this.getState();
    } catch (cause) {
      if (this._stopPromise) throw this._error ?? cancelled();
      const error = timedOut
        ? new AgoraVoiceError('TIMEOUT', 'Starting the voice session timed out.')
        : signal.aborted
          ? cancelled()
          : cause instanceof AgoraVoiceError
            ? cause
            : new AgoraVoiceError(
                step,
                {
                  UNSUPPORTED: 'The required voice APIs are unavailable.',
                  AUDIO: 'Audio playback could not start. Try again from a user action.',
                  BACKEND: 'The voice backend could not reserve a session.',
                  CONFIGURATION: 'The Agora connection configuration is invalid.',
                  MICROPHONE: 'The microphone could not be opened. Check microphone permission.',
                  MEDIA: 'The Agora media connection could not be established.',
                  AGENT: 'The cloud voice agent could not start.',
                }[step],
              );
      this._error = error;
      await this._stop(error.code !== 'ABORTED');
      throw error;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abort);
    }
  }

  _listen(target, name, callback) {
    target.addEventListener(name, callback);
    this._listeners.push(() => target.removeEventListener(name, callback));
  }

  /** Half duplex gates transmission separately from the user's persistent mute choice. */
  _refreshMicrophoneGate() {
    if (this._options.microphoneMode !== 'half-duplex' || this._controller.signal.aborted) return;
    const now = Date.now();
    if (
      this._lifecycle === 'running' &&
      this._audio?.state === 'running' &&
      this._remoteAnalyser &&
      this.getAudioLevels().remote > -48
    )
      this._microphoneHoldUntil = now + 700;
    const suppressed =
      this._lifecycle !== 'running' ||
      this._audio?.state !== 'running' ||
      this._agentThinking ||
      this._agentSpeaking ||
      now < this._microphoneHoldUntil;
    if (suppressed === this._micSuppressed) return;
    this._micSuppressed = suppressed;
    for (const track of this._stream?.getAudioTracks() ?? [])
      track.enabled = !this._micMuted && !suppressed;
    this._notify();
  }

  _notify() {
    this.dispatchEvent(new Event('statechange'));
  }

  _buildLocalAudio() {
    this._localAnalyser = this._audio.createAnalyser();
    this._localAnalyser.fftSize = 1024;
    const source = this._audio.createMediaStreamSource(this._stream);
    const silent = this._audio.createGain();
    silent.gain.value = 0;
    source.connect(this._localAnalyser);
    this._localAnalyser.connect(silent);
    silent.connect(this._audio.destination);
    this._sources.push(source, this._localAnalyser, silent);
    this._remoteAnalyser = this._audio.createAnalyser();
    this._remoteAnalyser.fftSize = 1024;
    this._gain = this._audio.createGain();
    this._gain.gain.value = this._speakerMuted ? 0 : this._volume;
    this._remoteAnalyser.connect(this._gain);
    this._gain.connect(this._audio.destination);
    this._sources.push(this._remoteAnalyser, this._gain);
  }

  _receiveTrack(event) {
    if (this._controller.signal.aborted || event.track?.kind !== 'audio') return;
    if (this._remoteTracks.has(event.track)) return;
    try {
      const stream = event.streams?.[0] ?? new MediaStream([event.track]);
      // Multiple track events can refer to the same stream; connect that stream only once.
      this._remoteTracks.add(event.track);
      if (this._remoteStreams.has(stream)) return;
      this._remoteStreams.add(stream);
      const source = this._audio.createMediaStreamSource(stream);
      source.connect(this._remoteAnalyser);
      this._sources.push(source);
    } catch {
      this._fail('AUDIO', 'The remote audio could not be played.');
    }
  }

  _refreshTransport() {
    if (this._controller.signal.aborted || !this._whip) return;
    const pc = this._whip.peerConnection;
    const states = [pc.connectionState, pc.iceConnectionState];
    const media = states.includes('failed')
      ? 'failed'
      : states.includes('closed')
        ? 'closed'
        : states.includes('disconnected')
          ? 'disconnected'
          : pc.connectionState === 'connected'
            ? 'connected'
            : 'connecting';
    if (this._media !== media) {
      this._media = media;
      this._notify();
    }
    if (media === 'failed' || media === 'closed') {
      this._fail('MEDIA', 'The Agora media connection ended.');
    }
  }

  _fail(code, message) {
    if (this._stopPromise || this._controller.signal.aborted) return;
    this._error = new AgoraVoiceError(code, message);
    void this._stop(true);
  }

  _scheduleRenewal(lease) {
    if (!lease) return;
    if (
      !this._options.backend.renewSession ||
      !Number.isFinite(lease.expiresAt) ||
      !Number.isFinite(lease.renewAfterMs) ||
      lease.renewAfterMs <= 0
    ) {
      throw new TypeError('A leased backend must implement renewSession and return renewAfterMs.');
    }
    if (this._renewTimer != null) clearTimeout(this._renewTimer);
    this._renewTimer = setTimeout(
      async () => {
        if (this._controller.signal.aborted) return;
        const backend = this._options.backend;
        const outcome = await bounded(
          async (signal) => {
            const next = await backend.renewSession({ sessionId: this._reservation.id, signal });
            if (!next?.lease) throw new TypeError('The backend omitted its renewed lease.');
            if (!this._controller.signal.aborted && !signal.aborted)
              this._scheduleRenewal(next.lease);
          },
          this._timeout,
          this._controller.signal,
        );
        if (outcome !== 'complete')
          this._fail('LEASE', 'The voice session lease could not be renewed.');
      },
      Math.min(lease.renewAfterMs, 2_147_483_647),
    );
  }

  _releaseLateReservation(backend, reservation) {
    if (!reservation?.id) return;
    return bounded(
      (signal) => backend.stopSession({ sessionId: reservation.id, signal }),
      this._cleanupTimeout,
    );
  }

  setMicrophoneMuted(muted) {
    this._micMuted = Boolean(muted);
    for (const track of this._stream?.getAudioTracks() ?? [])
      track.enabled = !this._micMuted && !this._micSuppressed;
    this._notify();
  }

  setSpeakerMuted(muted) {
    this._speakerMuted = Boolean(muted);
    if (this._gain) this._gain.gain.value = this._speakerMuted ? 0 : this._volume;
    this._notify();
  }

  setVolume(volume) {
    if (!Number.isFinite(volume) || volume < 0 || volume > 1)
      throw new RangeError('volume must be between 0 and 1.');
    this._volume = volume;
    if (this._gain) this._gain.gain.value = this._speakerMuted ? 0 : volume;
    this._notify();
  }

  /** Call from a user action after an audio interruption or foreground transition. */
  async resumeAudio() {
    if (!this._audio || this._controller.signal.aborted) throw cancelled();
    try {
      await this._audio.resume();
    } catch {
      throw new AgoraVoiceError('AUDIO', 'Audio playback could not resume.');
    }
    this._notify();
  }

  /** dBFS levels, measured at most five times per second with reused sample buffers. */
  getAudioLevels() {
    const now = globalThis.performance?.now() ?? Date.now();
    if (now - this._lastLevelTime >= 200) {
      this._lastLevelTime = now;
      for (const name of ['local', 'remote']) {
        const analyser = name === 'local' ? this._localAnalyser : this._remoteAnalyser;
        let level = -60;
        if (analyser && this._audio?.state === 'running' && !(name === 'local' && this._micMuted)) {
          const samples = this._buffers[name];
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
          level = Math.max(
            -60,
            Math.min(0, 20 * Math.log10(Math.sqrt(sum / samples.length) || 1e-6)),
          );
        }
        this._levelCache[name] = level;
      }
    }
    return { ...this._levelCache };
  }

  /** Read standard RTC statistics on demand; no background statistics polling is installed. */
  async getStats() {
    if (!this._whip || this._controller.signal.aborted) throw cancelled();
    return this._whip.peerConnection.getStats();
  }

  /** Read ASR and assistant history text. This is not a word-synchronized TTS feed. */
  async getTranscripts({ signal } = {}) {
    const backend = this._options.backend;
    if (typeof backend?.getTranscripts !== 'function') {
      throw new AgoraVoiceError('UNSUPPORTED', 'This backend does not provide conversation text.');
    }
    if (this._lifecycle !== 'running' || !this._reservation) throw cancelled();
    const controller = new AbortController();
    const parent = this._controller.signal;
    const abort = () => controller.abort();
    parent.addEventListener('abort', abort, { once: true });
    signal?.addEventListener('abort', abort, { once: true });
    if (parent.aborted || signal?.aborted) abort();
    const timer = setTimeout(abort, this._timeout);
    try {
      checkSignal(controller.signal);
      const snapshot = await acquire(
        backend.getTranscripts({ sessionId: this._reservation.id, signal: controller.signal }),
        controller.signal,
      );
      return transcriptSnapshot(snapshot);
    } catch {
      if (parent.aborted || signal?.aborted) throw cancelled();
      throw new AgoraVoiceError('TRANSCRIPTS', 'Conversation text could not be loaded.');
    } finally {
      clearTimeout(timer);
      parent.removeEventListener('abort', abort);
      signal?.removeEventListener('abort', abort);
      controller.abort();
    }
  }

  /** Read the latest RTM snapshot synchronously from a transcriptchange listener. */
  getTranscriptSnapshot() {
    return this._transcriptMessages;
  }

  /** Text transport status is independent of audio and media state. */
  getTranscriptState() {
    return this._transcriptState;
  }

  _setTranscriptState({ status, error = null }) {
    if (
      this._transcriptState.status === status &&
      this._transcriptState.error?.code === error?.code
    )
      return;
    this._transcriptState = Object.freeze({
      status,
      error: error
        ? Object.freeze({ code: 'TRANSCRIPTS', message: 'Live conversation text is unavailable.' })
        : null,
    });
    this.dispatchEvent(new Event('transcriptstatechange'));
  }

  async _connectTranscripts() {
    if (!this._options.transcripts) return;
    const signal = this._controller.signal;
    try {
      this._transcriptSource = this._options.transcripts.connect({
        connection: this._reservation.rtm,
        signal,
        onUpdate: (snapshot) => {
          if (signal.aborted) return;
          if (this._options.microphoneMode === 'half-duplex') {
            let assistant;
            for (let index = snapshot.length - 1; index >= 0; index--)
              if (snapshot[index].role === 'assistant') {
                assistant = snapshot[index];
                break;
              }
            const assistantKey =
              assistant && `${assistant.id}:${assistant.status}:${assistant.text.length}`;
            if (assistantKey && assistantKey !== this._assistantTextKey) {
              this._assistantTextKey = assistantKey;
              this._microphoneHoldUntil = Date.now() + 700;
              this._refreshMicrophoneGate();
            }
          }
          this._transcriptMessages = transcriptSnapshot(snapshot);
          this.dispatchEvent(new Event('transcriptchange'));
        },
        onState: (state) => {
          if (!signal.aborted) {
            if (['failed', 'disconnected', 'closed'].includes(state.status)) {
              this._agentSpeaking = false;
              this._agentThinking = false;
              this._refreshMicrophoneGate();
            }
            this._setTranscriptState(state);
          }
        },
        onActivity: (activity) => {
          if (signal.aborted) return;
          if (typeof activity.speaking === 'boolean') this._agentSpeaking = activity.speaking;
          if (typeof activity.thinking === 'boolean') this._agentThinking = activity.thinking;
          this._refreshMicrophoneGate();
        },
      });
      await acquire(this._transcriptSource.ready, signal);
    } catch {
      checkSignal(signal);
      this._setTranscriptState({ status: 'failed', error: true });
    }
  }

  /** Stop capture synchronously, then independently attempt remote and audio cleanup. */
  stop() {
    return this._stop(false);
  }

  _stop(failed) {
    if (this._stopPromise) return this._stopPromise;
    const pending = deferred();
    this._stopPromise = pending.promise;
    this._controller.abort();
    if (this._options.transcripts) this._setTranscriptState({ status: 'closed' });
    if (this._renewTimer != null) clearTimeout(this._renewTimer);
    if (this._trackTimer != null) clearInterval(this._trackTimer);
    if (this._microphoneGateTimer != null) clearInterval(this._microphoneGateTimer);
    for (const remove of this._listeners.splice(0)) remove();
    stopTracks(this._stream);
    this._stream = null;
    for (const node of this._sources.splice(0)) {
      try {
        node.disconnect();
      } catch {
        /* Already disconnected. */
      }
    }
    this._remoteTracks.clear();
    this._remoteStreams.clear();
    this._localAnalyser = null;
    this._remoteAnalyser = null;
    this._gain = null;
    this._media = 'closed';
    this._lifecycle = 'stopping';
    if (this._options.backend && this._agent !== 'idle') this._agent = 'unknown';
    this._notify();
    const whip = this._whip;
    const audio = this._audio;
    const reservation = this._reservation;
    const transcriptSource = this._transcriptSource;
    this._transcriptSource = null;
    this._whip = null;
    this._reservation = null;
    delete this._options.connection;
    Promise.all([
      whip ? bounded(() => whip.close(), this._cleanupTimeout) : 'not-needed',
      audio ? bounded(() => audio.close(), this._cleanupTimeout) : 'not-needed',
      reservation?.id
        ? bounded(
            (signal) => this._options.backend.stopSession({ sessionId: reservation.id, signal }),
            this._cleanupTimeout,
          )
        : 'not-needed',
      transcriptSource
        ? bounded(() => transcriptSource.close(), this._cleanupTimeout)
        : 'not-needed',
    ]).then(([media, audioResult, backend, transcripts]) => {
      this._cleanupReport = Object.freeze({
        media,
        audio: audioResult,
        backend,
        ...(this._options.transcripts ? { transcripts } : {}),
      });
      if (this._options.backend)
        this._agent = backend === 'complete' || backend === 'not-needed' ? 'stopped' : 'unknown';
      this._lifecycle = failed ? 'failed' : 'stopped';
      this._notify();
      pending.resolve(this._cleanupReport);
    }, pending.reject);
    return pending.promise;
  }
}

export function createAgoraVoiceSession(options) {
  return new AgoraVoiceSession(options);
}
