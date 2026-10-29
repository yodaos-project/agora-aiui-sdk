export type VoiceLifecycle = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
export type VoiceMediaState =
  'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';
export type VoiceAgentState =
  'not-managed' | 'idle' | 'starting' | 'running' | 'stopped' | 'unknown';
export type CleanupResult = 'complete' | 'failed' | 'timeout' | 'not-needed';

export interface VoiceCleanupReport {
  /** WHIP close completed locally; this does not confirm remote DELETE success. */
  readonly media: CleanupResult;
  readonly audio: CleanupResult;
  /** The backend acknowledged stop, or cleanup is unconfirmed. */
  readonly backend: CleanupResult;
  readonly transcripts?: CleanupResult;
}

export interface VoiceState {
  readonly lifecycle: VoiceLifecycle;
  readonly media: VoiceMediaState;
  /** running means the backend acknowledged start, not that the bot is speaking. */
  readonly agent: VoiceAgentState;
  readonly audio: AudioContextState;
  readonly microphoneMuted: boolean;
  /** Half-duplex playback/turn-taking gate; independent of the user's mute choice. */
  readonly microphoneSuppressed: boolean;
  readonly speakerMuted: boolean;
  readonly volume: number;
  readonly error: Readonly<{ code: string; message: string }> | null;
  readonly cleanup: Readonly<VoiceCleanupReport> | null;
}

export interface AgoraConnection {
  /** HTTPS origin of an Agora duplex WHIP deployment. */
  baseURL: string;
  channel: string;
  /** RTC string account (recommended for cloud AI) or a legacy numeric UID. */
  uid: string | number;
  /** Optional alias for numeric mode. In string mode it must equal uid. */
  stringUid?: string;
  /** Raw WHIP JWT, without the Bearer prefix. The callback can refresh it for DELETE. */
  token: string | (() => string | Promise<string>);
  rtcConfiguration?: RTCConfiguration;
}

export interface VoiceLease {
  /** Unix timestamp in milliseconds. */
  expiresAt: number;
  renewAfterMs: number;
}

export interface VoiceReservation {
  id: string;
  whip: AgoraConnection;
  lease?: VoiceLease;
  rtm?: AgoraRtmConnection;
}

/** A bounded conversation-history message, without word or playback timing. */
export interface VoiceTranscript {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly interrupted: boolean;
  /** Present on RTM updates; this does not report local playback progress. */
  readonly status?: 'in-progress' | 'final' | 'interrupted';
}

export interface AgoraRtmConnection {
  appId: string;
  userId: string;
  agentUserId: string;
  channel: string;
  token: string | ((options: { signal: AbortSignal }) => string | Promise<string>);
}

export interface VoiceTranscriptState {
  readonly status: 'disabled' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';
  readonly error: Readonly<{ code: string; message: string }> | null;
}

export interface VoiceTranscriptSource {
  connect(options: {
    connection?: AgoraRtmConnection;
    signal: AbortSignal;
    onUpdate: (snapshot: readonly VoiceTranscript[]) => void;
    onState: (state: Readonly<VoiceTranscriptState>) => void;
    onActivity?: (activity: {
      listening?: boolean;
      thinking?: boolean;
      speaking?: boolean;
    }) => void;
  }): { ready: Promise<void>; close(): Promise<unknown> };
}

/** Structural subset of the official RTM client used by this SDK. */
export interface AgoraRtmClient {
  login(options: { token: string }): Promise<unknown>;
  subscribe(
    channel: string,
    options: {
      withMessage: boolean;
      withPresence: boolean;
      withMetadata: boolean;
      withLock: boolean;
    },
  ): Promise<unknown>;
  logout(): Promise<unknown>;
  renewToken(token: string): Promise<unknown>;
  addEventListener(name: string, callback: (...args: any[]) => void): unknown;
  removeEventListener(name: string, callback: (...args: any[]) => void): unknown;
}

export function createAgoraRtmTranscripts(options: {
  RTM: new (
    appId: string,
    userId: string,
    options: {
      logLevel: 'none';
      logUpload: false;
      useStringUserId: true;
    },
  ) => AgoraRtmClient;
  timeout?: number;
}): VoiceTranscriptSource;

export interface VoiceBackend {
  /** Reserve credentials only. Do not start the cloud agent here. */
  createSession(options: { signal: AbortSignal }): Promise<VoiceReservation>;
  startAgent(options: { sessionId: string; signal: AbortSignal }): Promise<unknown>;
  /** Idempotent; must reconcile delayed starts as well as already running agents. */
  stopSession(options: { sessionId: string; signal: AbortSignal }): Promise<unknown>;
  renewSession?(options: {
    sessionId: string;
    signal: AbortSignal;
  }): Promise<{ lease: VoiceLease }>;
  /** Optional ASR/assistant history snapshot. A failure must not end the audio call. */
  getTranscripts?(options: {
    sessionId: string;
    signal: AbortSignal;
  }): Promise<readonly VoiceTranscript[]>;
}

interface CommonVoiceOptions {
  /** Default full-duplex. Half-duplex pauses microphone transmission while the AI replies. */
  microphoneMode?: 'full-duplex' | 'half-duplex';
  /** Optional live RTM text. Managed backend reservations must include rtm credentials. */
  transcripts?: VoiceTranscriptSource;
  /** Maximum startup duration in ms. Default 15000. */
  timeout?: number;
  /** Independent deadline for each cleanup operation in ms. Default 5000. */
  cleanupTimeout?: number;
}

export type AgoraVoiceOptions = CommonVoiceOptions &
  (
    | {
        connection:
          | AgoraConnection
          | ((options: { signal: AbortSignal }) => AgoraConnection | Promise<AgoraConnection>);
        backend?: never;
        transcripts?: never;
      }
    | { backend: VoiceBackend; connection?: never }
  );

export class AgoraVoiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
}

/** Uses the foreground page's global WHIPSession, AudioContext and mediaDevices. */
export class AgoraVoiceSession extends EventTarget {
  constructor(options: AgoraVoiceOptions);
  getState(): Readonly<VoiceState>;
  /** Signal cancels startup only. Call stop() to end an established call. */
  start(options?: { signal?: AbortSignal }): Promise<Readonly<VoiceState>>;
  /** Stops owned capture tracks before returning this promise. Safe to call repeatedly. */
  stop(): Promise<Readonly<VoiceCleanupReport>>;
  setMicrophoneMuted(muted: boolean): void;
  setSpeakerMuted(muted: boolean): void;
  setVolume(volume: number): void;
  resumeAudio(): Promise<void>;
  /** Local and remote pre-speaker-gain levels in dBFS, clamped to [-60, 0]. */
  getAudioLevels(): { local: number; remote: number };
  getStats(): Promise<RTCStatsReport>;
  /** Fetch history while running; callers choose polling. Does not synchronize text to audio. */
  getTranscripts(options?: { signal?: AbortSignal }): Promise<readonly VoiceTranscript[]>;
  /** Listen for transcriptchange, then read the pushed messages without a network request. */
  getTranscriptSnapshot(): readonly VoiceTranscript[];
  /** Listen for transcriptstatechange to observe text transport availability. */
  getTranscriptState(): Readonly<VoiceTranscriptState>;
}

export function createAgoraVoiceSession(options: AgoraVoiceOptions): AgoraVoiceSession;
export function agoraEndpoint(connection: AgoraConnection): string;

export interface HttpVoiceBackendOptions {
  baseURL: string;
  /** Complete business API Authorization header value; unrelated to the WHIP JWT. */
  authorization: string | (() => string | Promise<string>);
  timeout?: number;
  fetch?: typeof fetch;
}

/** Implements the bodyless POST protocol described in docs/backend.md. */
export function createHttpVoiceBackend(options: HttpVoiceBackendOptions): VoiceBackend;
