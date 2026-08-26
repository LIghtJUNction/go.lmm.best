export type Population = {
  humanPlayers?: number;
  aiPlayers?: number;
  activeGames?: number;
  waitingHumans?: number;
  waitingAi?: number;
  online?: number;
  [key: string]: unknown;
};

export type QueueEntry = {
  id?: string;
  ticketId?: string;
  participantId?: string;
  position?: number;
  joinedAt?: string;
  role?: "human" | "agent";
  modelId?: string;
  displayName?: string;
  [key: string]: unknown;
};

export type GameSnapshot = {
  id?: string;
  gameId?: string;
  revision: number;
  status?: string;
  board?: unknown;
  turn?: string;
  [key: string]: unknown;
};

export type Bootstrap = {
  population?: Population;
  queue?: QueueEntry[];
  queueEntry?: QueueEntry | null;
  game?: GameSnapshot | null;
  resumeToken?: string;
  [key: string]: unknown;
};

export type ClientCommand<TPayload = unknown> = {
  id: string;
  type: string;
  expectedRevision?: number;
  payload: TPayload;
};

export type ServerEvent<TPayload = unknown> = {
  seq: number;
  type: string;
  payload: TPayload;
};

export type RealtimeConnectionState =
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed";

export type RequestOptions = {
  expectedRevision?: number;
  timeoutMs?: number;
};

export type RealtimeTimerHandle =
  | number
  | ReturnType<typeof globalThis.setTimeout>;

export type RealtimeScheduler = {
  setTimeout(callback: () => void, delayMs: number): RealtimeTimerHandle;
  clearTimeout(handle: RealtimeTimerHandle): void;
};

export type RealtimeSocket = {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

export type RealtimeEventTarget = {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
};

export type RealtimeClientOptions = {
  origin?: string;
  path?: string;
  socketFactory?: (url: string) => RealtimeSocket;
  scheduler?: RealtimeScheduler;
  random?: () => number;
  idFactory?: () => string;
  requestTimeoutMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  reconnectJitter?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  visibilityTarget?: RealtimeEventTarget;
  onlineTarget?: RealtimeEventTarget;
  isVisible?: () => boolean;
  isOnline?: () => boolean;
  autoConnect?: boolean;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: RealtimeTimerHandle;
};

type EventListenerFor<TPayload = unknown> = (
  event: ServerEvent<TPayload>,
) => void;

type StateListener = (state: RealtimeConnectionState) => void;
type AuthListener = (error: AuthenticationExpiredError) => void;

type ErrorDetails = {
  code: string;
  message: string;
  currentRevision?: number;
  details: unknown;
};

const OPEN = 1;
const DEFAULT_PATH = "/api/v1/ws";
const AUTH_EVENT_TYPES = new Set([
  "auth.expired",
  "auth_expired",
  "authentication_expired",
]);
const ACK_EVENT_TYPES = new Set(["ack", "command.ack", "command_ack"]);
const ERROR_EVENT_TYPES = new Set(["error", "command.error", "command_error"]);

export class RealtimeError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "RealtimeError";
    this.code = code;
    this.details = details;
  }
}

export class DisconnectedError extends RealtimeError {
  constructor(message = "The realtime connection is not open") {
    super("disconnected", message);
    this.name = "DisconnectedError";
  }
}

export class ConnectionLostError extends RealtimeError {
  constructor() {
    super(
      "connection_lost",
      "The realtime connection closed before the command was acknowledged",
    );
    this.name = "ConnectionLostError";
  }
}

export class ClientClosedError extends RealtimeError {
  constructor() {
    super("client_closed", "The realtime client was closed");
    this.name = "ClientClosedError";
  }
}

export class RequestTimeoutError extends RealtimeError {
  readonly requestId: string;

  constructor(requestId: string) {
    super("request_timeout", `Realtime request ${requestId} timed out`);
    this.name = "RequestTimeoutError";
    this.requestId = requestId;
  }
}

export class RevisionStaleError extends RealtimeError {
  readonly currentRevision?: number;

  constructor(message: string, currentRevision?: number, details?: unknown) {
    super("revision_stale", message, details);
    this.name = "RevisionStaleError";
    this.currentRevision = currentRevision;
  }
}

export class AuthenticationExpiredError extends RealtimeError {
  constructor(message = "Realtime authentication expired", details?: unknown) {
    super("authentication_expired", message, details);
    this.name = "AuthenticationExpiredError";
  }
}

function defaultScheduler(): RealtimeScheduler {
  return {
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
  };
}

function defaultIdFactory(): () => string {
  let counter = 0;
  return () => {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    counter += 1;
    return `rt-${Date.now().toString(36)}-${counter.toString(36)}`;
  };
}

function browserOrigin(): string {
  if (typeof globalThis.location?.origin !== "string") {
    throw new Error("RealtimeClient requires an origin outside a browser");
  }
  return globalThis.location.origin;
}

export function realtimeWebSocketUrl(
  origin: string,
  path = DEFAULT_PATH,
): string {
  const url = new URL(path, origin);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`Unsupported realtime origin protocol: ${url.protocol}`);
  }
  return url.toString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function parseEvent(data: unknown): ServerEvent | null {
  let value: unknown;
  try {
    value = typeof data === "string" ? JSON.parse(data) : data;
  } catch {
    return null;
  }
  const record = asRecord(value);
  if (
    !record ||
    typeof record.seq !== "number" ||
    !Number.isSafeInteger(record.seq) ||
    record.seq < 0 ||
    typeof record.type !== "string"
  ) {
    return null;
  }
  return {
    seq: record.seq,
    type: record.type,
    payload: record.payload,
  };
}

function errorDetails(payload: Record<string, unknown>): ErrorDetails {
  const nested = asRecord(payload.error);
  const codeValue = nested?.code ?? payload.code ?? payload.error;
  const messageValue = nested?.message ?? payload.message;
  const currentRevision = nested?.currentRevision ?? payload.currentRevision;
  return {
    code: typeof codeValue === "string" ? codeValue : "request_failed",
    message:
      typeof messageValue === "string" ? messageValue : "Realtime request failed",
    currentRevision:
      typeof currentRevision === "number" ? currentRevision : undefined,
    details: payload,
  };
}

export class RealtimeClient {
  readonly url: string;

  private readonly socketFactory: (url: string) => RealtimeSocket;
  private readonly scheduler: RealtimeScheduler;
  private readonly random: () => number;
  private readonly idFactory: () => string;
  private readonly requestTimeoutMs: number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly reconnectJitter: number;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly visibilityTarget?: RealtimeEventTarget;
  private readonly onlineTarget?: RealtimeEventTarget;
  private readonly isVisible: () => boolean;
  private readonly isOnline: () => boolean;
  private readonly eventListeners = new Map<string, Set<EventListenerFor>>();
  private readonly stateListeners = new Set<StateListener>();
  private readonly authListeners = new Set<AuthListener>();
  private readonly pending = new Map<string, PendingRequest>();

  private socket: RealtimeSocket | null = null;
  private reconnectTimer: RealtimeTimerHandle | null = null;
  private heartbeatTimer: RealtimeTimerHandle | null = null;
  private heartbeatDeadline: RealtimeTimerHandle | null = null;
  private heartbeatId: string | null = null;
  private reconnectAttempt = 0;
  private manuallyClosed = false;
  private lastSeq = -1;
  private currentState: RealtimeConnectionState = "connecting";

  private readonly handleVisibility = () => {
    if (this.isVisible()) this.recoverNow();
  };

  private readonly handleOnline = () => {
    if (this.isOnline()) this.recoverNow();
  };

  constructor(options: RealtimeClientOptions = {}) {
    this.url = realtimeWebSocketUrl(
      options.origin ?? browserOrigin(),
      options.path ?? DEFAULT_PATH,
    );
    this.socketFactory =
      options.socketFactory ??
      ((url) => new globalThis.WebSocket(url) as RealtimeSocket);
    this.scheduler = options.scheduler ?? defaultScheduler();
    this.random = options.random ?? Math.random;
    this.idFactory = options.idFactory ?? defaultIdFactory();
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 500;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 30_000;
    this.reconnectJitter = Math.min(
      1,
      Math.max(0, options.reconnectJitter ?? 0.2),
    );
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 20_000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 10_000;
    this.visibilityTarget =
      options.visibilityTarget ??
      (typeof document === "undefined" ? undefined : document);
    this.onlineTarget =
      options.onlineTarget ??
      (typeof window === "undefined" ? undefined : window);
    this.isVisible =
      options.isVisible ??
      (() => typeof document === "undefined" || document.visibilityState !== "hidden");
    this.isOnline =
      options.isOnline ??
      (() => typeof navigator === "undefined" || navigator.onLine !== false);

    this.visibilityTarget?.addEventListener(
      "visibilitychange",
      this.handleVisibility,
    );
    this.onlineTarget?.addEventListener("online", this.handleOnline);

    if (options.autoConnect !== false) this.connect();
  }

  get state(): RealtimeConnectionState {
    return this.currentState;
  }

  get lastSequence(): number | null {
    return this.lastSeq < 0 ? null : this.lastSeq;
  }

  connect(): void {
    if (this.manuallyClosed || this.socket) return;
    this.clearReconnectTimer();
    if (!this.isOnline()) {
      this.setState("reconnecting");
      this.scheduleReconnect();
      return;
    }

    this.setState(this.reconnectAttempt === 0 ? "connecting" : "reconnecting");
    let socket: RealtimeSocket;
    try {
      socket = this.socketFactory(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = (event) => this.onOpen(socket, event);
    socket.onmessage = (event) => this.onMessage(socket, event);
    socket.onerror = () => this.onSocketError(socket);
    socket.onclose = () => this.onSocketClose(socket);
  }

  request<TResult = unknown, TPayload = unknown>(
    type: string,
    payload: TPayload,
    options: RequestOptions = {},
  ): Promise<TResult> {
    if (this.manuallyClosed) return Promise.reject(new ClientClosedError());
    if (!this.socket || this.socket.readyState !== OPEN) {
      return Promise.reject(new DisconnectedError());
    }
    if (!type) return Promise.reject(new TypeError("Command type is required"));
    if (
      options.expectedRevision !== undefined &&
      (!Number.isSafeInteger(options.expectedRevision) ||
        options.expectedRevision < 0)
    ) {
      return Promise.reject(
        new TypeError("expectedRevision must be a non-negative safe integer"),
      );
    }

    const id = this.idFactory();
    const envelope: ClientCommand<TPayload> = { id, type, payload };
    if (options.expectedRevision !== undefined) {
      envelope.expectedRevision = options.expectedRevision;
    }
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;

    return new Promise<TResult>((resolve, reject) => {
      const timeout = this.scheduler.setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new RequestTimeoutError(id));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      try {
        this.socket?.send(JSON.stringify(envelope));
      } catch {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        this.scheduler.clearTimeout(pending.timeout);
        reject(new ConnectionLostError());
        this.onSocketError(this.socket);
      }
    });
  }

  send<TResult = unknown, TPayload = unknown>(
    type: string,
    payload: TPayload,
    options?: RequestOptions,
  ): Promise<TResult> {
    return this.request<TResult, TPayload>(type, payload, options);
  }

  subscribe<TPayload = unknown>(
    type: string,
    listener: EventListenerFor<TPayload>,
  ): () => void {
    const listeners = this.eventListeners.get(type) ?? new Set<EventListenerFor>();
    listeners.add(listener as EventListenerFor);
    this.eventListeners.set(type, listeners);
    return () => {
      listeners.delete(listener as EventListenerFor);
      if (listeners.size === 0) this.eventListeners.delete(type);
    };
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onAuthenticationExpired(listener: AuthListener): () => void {
    this.authListeners.add(listener);
    return () => this.authListeners.delete(listener);
  }

  close(code = 1000, reason = "client closed"): void {
    if (this.manuallyClosed) return;
    this.manuallyClosed = true;
    this.clearReconnectTimer();
    this.clearHeartbeatTimers();
    this.visibilityTarget?.removeEventListener(
      "visibilitychange",
      this.handleVisibility,
    );
    this.onlineTarget?.removeEventListener("online", this.handleOnline);
    this.rejectPending(new ClientClosedError());

    const socket = this.socket;
    this.socket = null;
    if (socket) {
      this.detachSocket(socket);
      socket.close(code, reason);
    }
    this.setState("closed");
    this.eventListeners.clear();
    this.stateListeners.clear();
    this.authListeners.clear();
  }

  private onOpen(socket: RealtimeSocket, _event: Event): void {
    if (this.socket !== socket || this.manuallyClosed) return;
    this.reconnectAttempt = 0;
    this.setState("open");
    this.scheduleHeartbeat();
  }

  private onMessage(socket: RealtimeSocket, message: MessageEvent): void {
    if (this.socket !== socket || this.manuallyClosed) return;
    this.markAlive();
    const event = parseEvent(message.data);
    if (!event || event.seq <= this.lastSeq) return;
    this.lastSeq = event.seq;

    const payload = asRecord(event.payload);
    if (payload && (ACK_EVENT_TYPES.has(event.type) || ERROR_EVENT_TYPES.has(event.type))) {
      this.settleRequest(event.type, payload);
    }

    if (AUTH_EVENT_TYPES.has(event.type)) {
      const messageValue = payload?.message;
      const error = new AuthenticationExpiredError(
        typeof messageValue === "string" ? messageValue : undefined,
        event.payload,
      );
      for (const listener of this.authListeners) listener(error);
    }

    this.emitEvent(event);
  }

  private settleRequest(type: string, payload: Record<string, unknown>): void {
    const idValue = payload.id ?? payload.requestId ?? payload.commandId;
    if (typeof idValue !== "string") return;
    if (idValue === this.heartbeatId) {
      this.heartbeatId = null;
      return;
    }

    const pending = this.pending.get(idValue);
    if (!pending) return;
    this.pending.delete(idValue);
    this.scheduler.clearTimeout(pending.timeout);

    const failed =
      ERROR_EVENT_TYPES.has(type) || payload.ok === false || payload.error !== undefined;
    if (failed) {
      const details = errorDetails(payload);
      if (details.code === "revision_stale" || details.code === "stale_revision") {
        pending.reject(
          new RevisionStaleError(
            details.message,
            details.currentRevision,
            details.details,
          ),
        );
      } else if (
        details.code === "authentication_expired" ||
        details.code === "auth_expired"
      ) {
        pending.reject(new AuthenticationExpiredError(details.message, payload));
      } else {
        pending.reject(new RealtimeError(details.code, details.message, payload));
      }
      return;
    }

    if (Object.hasOwn(payload, "result")) pending.resolve(payload.result);
    else if (Object.hasOwn(payload, "data")) pending.resolve(payload.data);
    else pending.resolve(payload);
  }

  private emitEvent(event: ServerEvent): void {
    const listeners = [
      ...(this.eventListeners.get(event.type) ?? []),
      ...(this.eventListeners.get("*") ?? []),
    ];
    for (const listener of listeners) listener(event);
  }

  private onSocketError(socket: RealtimeSocket | null): void {
    if (!socket || this.socket !== socket || this.manuallyClosed) return;
    try {
      socket.close(1011, "realtime transport error");
    } catch {
      this.onSocketClose(socket);
    }
  }

  private onSocketClose(socket: RealtimeSocket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.detachSocket(socket);
    this.clearHeartbeatTimers();
    this.rejectPending(new ConnectionLostError());
    if (this.manuallyClosed) return;
    this.setState("reconnecting");
    this.scheduleReconnect();
  }

  private detachSocket(socket: RealtimeSocket): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
  }

  private scheduleReconnect(): void {
    if (this.manuallyClosed || this.reconnectTimer !== null) return;
    const exponential = Math.min(
      this.reconnectMaxMs,
      this.reconnectBaseMs * 2 ** Math.min(this.reconnectAttempt, 30),
    );
    const jitter = 1 + (this.random() * 2 - 1) * this.reconnectJitter;
    const delay = Math.min(
      this.reconnectMaxMs,
      Math.max(0, Math.round(exponential * jitter)),
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = this.scheduler.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private recoverNow(): void {
    if (this.manuallyClosed || this.socket) return;
    this.clearReconnectTimer();
    this.connect();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) return;
    this.scheduler.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private scheduleHeartbeat(): void {
    if (this.heartbeatIntervalMs <= 0) return;
    if (this.heartbeatTimer !== null) {
      this.scheduler.clearTimeout(this.heartbeatTimer);
    }
    this.heartbeatTimer = this.scheduler.setTimeout(() => {
      this.heartbeatTimer = null;
      this.sendHeartbeat();
      this.scheduleHeartbeat();
    }, this.heartbeatIntervalMs);
  }

  private sendHeartbeat(): void {
    if (!this.socket || this.socket.readyState !== OPEN || this.heartbeatId) return;
    const id = this.idFactory();
    this.heartbeatId = id;
    try {
      this.socket.send(
        JSON.stringify({ id, type: "ping", payload: {} } satisfies ClientCommand),
      );
    } catch {
      this.onSocketError(this.socket);
      return;
    }
    this.heartbeatDeadline = this.scheduler.setTimeout(() => {
      this.heartbeatDeadline = null;
      const socket = this.socket;
      if (!socket || !this.heartbeatId) return;
      this.heartbeatId = null;
      try {
        socket.close(4000, "heartbeat timeout");
      } catch {
        this.onSocketClose(socket);
      }
    }, this.heartbeatTimeoutMs);
  }

  private markAlive(): void {
    this.heartbeatId = null;
    if (this.heartbeatDeadline === null) return;
    this.scheduler.clearTimeout(this.heartbeatDeadline);
    this.heartbeatDeadline = null;
  }

  private clearHeartbeatTimers(): void {
    if (this.heartbeatTimer !== null) {
      this.scheduler.clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatDeadline !== null) {
      this.scheduler.clearTimeout(this.heartbeatDeadline);
      this.heartbeatDeadline = null;
    }
    this.heartbeatId = null;
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      this.scheduler.clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private setState(state: RealtimeConnectionState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    for (const listener of this.stateListeners) listener(state);
  }
}

export function createRealtimeClient(
  options?: RealtimeClientOptions,
): RealtimeClient {
  return new RealtimeClient(options);
}
