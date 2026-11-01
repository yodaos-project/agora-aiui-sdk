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
  readonly tools?: CleanupResult;
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
  /** Explicit acknowledgement that local tool delivery is configured. */
  tools?: boolean;
}

export type ToolJSON = null | boolean | number | string | ToolJSON[] | { [key: string]: ToolJSON };

/** Supported JSON Schema subset. All object fields must be required. */
export type VoiceToolSchema = { description?: string } & (
  | { type: 'string'; enum?: string[]; maxLength?: number }
  | { type: 'number' | 'integer'; enum?: number[]; minimum?: number; maximum?: number }
  | { type: 'boolean' }
  | { type: 'array'; items: VoiceToolSchema; maxItems?: number }
  | {
      type: 'object';
      properties: Record<string, VoiceToolSchema>;
      required: string[];
      additionalProperties: false;
    }
);

export interface VoiceToolDefinition {
  /** Case-insensitively unique, starts with a letter, letters/digits only, at most 64 characters. */
  name: string;
  description: string;
  parameters: Extract<VoiceToolSchema, { type: 'object' }>;
}

export interface VoiceToolContext {
  readonly callId: string;
  /** Aborted on stop or after at most five seconds. Check it before any delayed UI change. */
  readonly signal: AbortSignal;
  /** Request hangup after the result submission attempt (at most two seconds). */
  endConversation(): void;
}

export interface VoiceLocalTool extends VoiceToolDefinition {
  /** Runs locally. Return JSON to the LLM; the function is never sent to the backend. */
  execute(
    arguments_: Record<string, ToolJSON>,
    context: VoiceToolContext,
  ): ToolJSON | void | Promise<ToolJSON | void>;
}

export interface VoiceToolCall {
  id: string;
  name: string;
  arguments: Record<string, ToolJSON>;
  expiresAt: number;
}

export type VoiceToolResult = { id: string } & (
  | { ok: true; result: ToolJSON }
  | { ok: false; error: 'INVALID_ARGUMENTS' | 'EXPIRED' | 'TIMEOUT' | 'EXECUTION_FAILED' }
);

export type VoiceToolState = 'disabled' | 'connecting' | 'connected' | 'disconnected' | 'closed';

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
  createSession(options: {
    signal: AbortSignal;
    tools?: VoiceToolDefinition[];
  }): Promise<VoiceReservation>;
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
  /** Wait for one call or a bounded heartbeat. Only needed when local tools are registered. */
  nextToolCall?(options: {
    sessionId: string;
    signal: AbortSignal;
  }): Promise<{ call: VoiceToolCall | null }>;
  submitToolResult?(
    options: VoiceToolResult & { sessionId: string; signal: AbortSignal },
  ): Promise<unknown>;
}

interface CommonVoiceOptions {
  /** Definitions are sent at reservation time; execute functions stay in this AIUI Agent. */
  tools?: VoiceLocalTool[];
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
        tools?: never;
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
  /** Listen for toolstatechange. Tool delivery is independent of audio availability. */
  getToolState(): VoiceToolState;
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

/** Implements the reference backend protocol, including optional local tool delivery. */
export function createHttpVoiceBackend(options: HttpVoiceBackendOptions): VoiceBackend;

/** The Ink Agent Worker port used by the transcript transport. */
export interface VoiceWorkerPort {
  readonly closed: boolean;
  postMessage(value: unknown): void;
  close(): void;
  onmessage: ((event: Event & { readonly data: any }) => void) | null;
  onmessageerror: ((event: Event) => void) | null;
  onclose: ((event: Event) => void) | null;
}

/** Connect the foreground session to a dedicated Agent Worker for live text. */
export function createWorkerTranscripts(
  connectPort: (options: { signal: AbortSignal; timeout: number }) => Promise<VoiceWorkerPort>,
  options?: {
    timeout?: number;
    cleanupTimeout?: number;
    onActivity?: (activity: {
      listening?: boolean;
      thinking?: boolean;
      speaking?: boolean;
    }) => void;
  },
): VoiceTranscriptSource;
