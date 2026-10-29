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
}

export interface VoiceState {
  readonly lifecycle: VoiceLifecycle;
  readonly media: VoiceMediaState;
  /** running means the backend acknowledged start, not that the bot is speaking. */
  readonly agent: VoiceAgentState;
  readonly audio: AudioContextState;
  readonly microphoneMuted: boolean;
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
}

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
}

interface CommonVoiceOptions {
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
