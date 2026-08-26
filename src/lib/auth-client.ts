export type PasskeyAuthErrorCode =
  | "cancelled"
  | "invalid_response"
  | "network_error"
  | "unsupported"
  | (string & {});

export class PasskeyAuthError extends Error {
  readonly code: PasskeyAuthErrorCode;
  readonly status?: number;

  constructor(
    code: PasskeyAuthErrorCode,
    message: string,
    options: { cause?: unknown; status?: number } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "PasskeyAuthError";
    this.code = code;
    this.status = options.status;
  }
}

export interface AuthSession {
  authenticated?: boolean;
  user?: {
    id?: string;
    displayName?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

type JsonValue =
  | boolean
  | number
  | string
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface RegistrationCredentialJSON {
  id: string;
  rawId: string;
  type: PublicKeyCredentialType;
  authenticatorAttachment: string | null;
  clientExtensionResults: Record<string, JsonValue>;
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports: string[];
  };
}

export interface AuthenticationCredentialJSON {
  id: string;
  rawId: string;
  type: PublicKeyCredentialType;
  authenticatorAttachment: string | null;
  clientExtensionResults: Record<string, JsonValue>;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string | null;
  };
}

export interface PasskeyAuthClient {
  getSession(): Promise<AuthSession | null>;
  register(displayName: string): Promise<AuthSession | null>;
  login(): Promise<AuthSession | null>;
  signOut(): Promise<void>;
}

interface CredentialDescriptorJSON
  extends Omit<PublicKeyCredentialDescriptor, "id"> {
  id: string;
}

interface CreationOptionsJSON
  extends Omit<
    PublicKeyCredentialCreationOptions,
    "challenge" | "excludeCredentials" | "user"
  > {
  challenge: string;
  excludeCredentials?: CredentialDescriptorJSON[];
  user: Omit<PublicKeyCredentialUserEntity, "id"> & { id: string };
}

interface RequestOptionsJSON
  extends Omit<
    PublicKeyCredentialRequestOptions,
    "allowCredentials" | "challenge"
  > {
  allowCredentials?: CredentialDescriptorJSON[];
  challenge: string;
}

interface OptionsResponse<T> {
  challengeId: string;
  options: T;
}

interface ApiErrorResponse {
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

interface ClientOptions {
  baseUrl?: string;
  credentials?: Pick<CredentialsContainer, "create" | "get">;
  fetcher?: typeof fetch;
}

function asBytes(value: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

export function arrayBufferToBase64Url(
  value: ArrayBuffer | ArrayBufferView,
): string {
  const bytes = asBytes(value);
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  if (!/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) {
    throw new PasskeyAuthError(
      "invalid_response",
      "The server returned invalid base64url data.",
    );
  }

  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");

  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
  } catch (error) {
    throw new PasskeyAuthError(
      "invalid_response",
      "The server returned invalid base64url data.",
      { cause: error },
    );
  }
}

export function decodeCreationOptions(
  options: CreationOptionsJSON,
): PublicKeyCredentialCreationOptions {
  return {
    ...options,
    challenge: base64UrlToArrayBuffer(options.challenge),
    user: {
      ...options.user,
      id: base64UrlToArrayBuffer(options.user.id),
    },
    excludeCredentials: options.excludeCredentials?.map((credential) => ({
      ...credential,
      id: base64UrlToArrayBuffer(credential.id),
    })),
  };
}

export function decodeRequestOptions(
  options: RequestOptionsJSON,
): PublicKeyCredentialRequestOptions {
  return {
    ...options,
    challenge: base64UrlToArrayBuffer(options.challenge),
    allowCredentials: options.allowCredentials?.map((credential) => ({
      ...credential,
      id: base64UrlToArrayBuffer(credential.id),
    })),
  };
}

function serializeExtensionValue(value: unknown): JsonValue {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return arrayBufferToBase64Url(value);
  }
  if (Array.isArray(value)) return value.map(serializeExtensionValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        serializeExtensionValue(entry),
      ]),
    );
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  return null;
}

function commonCredentialJSON(credential: PublicKeyCredential) {
  if (credential.type !== "public-key") {
    throw new PasskeyAuthError(
      "invalid_response",
      "The authenticator returned an invalid credential type.",
    );
  }

  return {
    id: credential.id,
    rawId: arrayBufferToBase64Url(credential.rawId),
    type: "public-key" as const,
    authenticatorAttachment: credential.authenticatorAttachment ?? null,
    clientExtensionResults: serializeExtensionValue(
      credential.getClientExtensionResults(),
    ) as Record<string, JsonValue>,
  };
}

export function serializeRegistrationCredential(
  credential: PublicKeyCredential,
): RegistrationCredentialJSON {
  const response = credential.response as AuthenticatorAttestationResponse;
  if (!("attestationObject" in response)) {
    throw new PasskeyAuthError(
      "invalid_response",
      "The authenticator returned an invalid registration response.",
    );
  }

  return {
    ...commonCredentialJSON(credential),
    response: {
      clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
      attestationObject: arrayBufferToBase64Url(response.attestationObject),
      transports: response.getTransports?.() ?? [],
    },
  };
}

export function serializeAuthenticationCredential(
  credential: PublicKeyCredential,
): AuthenticationCredentialJSON {
  const response = credential.response as AuthenticatorAssertionResponse;
  if (!("authenticatorData" in response) || !("signature" in response)) {
    throw new PasskeyAuthError(
      "invalid_response",
      "The authenticator returned an invalid login response.",
    );
  }

  return {
    ...commonCredentialJSON(credential),
    response: {
      clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
      authenticatorData: arrayBufferToBase64Url(response.authenticatorData),
      signature: arrayBufferToBase64Url(response.signature),
      userHandle: response.userHandle
        ? arrayBufferToBase64Url(response.userHandle)
        : null,
    },
  };
}

export function isPasskeySupported(): boolean {
  return (
    globalThis.PublicKeyCredential !== undefined &&
    globalThis.navigator !== undefined &&
    typeof globalThis.navigator.credentials?.create === "function" &&
    typeof globalThis.navigator.credentials?.get === "function"
  );
}

export function mapPasskeyError(error: unknown): PasskeyAuthError {
  if (error instanceof PasskeyAuthError) return error;

  const name =
    error && typeof error === "object" && "name" in error
      ? String(error.name)
      : "";
  if (name === "NotAllowedError" || name === "AbortError") {
    return new PasskeyAuthError(
      "cancelled",
      "The passkey request was cancelled. You can try again.",
      { cause: error },
    );
  }
  if (name === "NotSupportedError") {
    return new PasskeyAuthError(
      "unsupported",
      "Passkeys are not supported by this browser or device.",
      { cause: error },
    );
  }

  return new PasskeyAuthError(
    "webauthn_error",
    error instanceof Error ? error.message : "The passkey request failed.",
    { cause: error },
  );
}

function normalizeSession(value: unknown): AuthSession | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") {
    throw new PasskeyAuthError(
      "invalid_response",
      "The server returned an invalid session response.",
    );
  }

  if ("session" in value) {
    return normalizeSession((value as { session: unknown }).session);
  }
  if (
    "authenticated" in value &&
    (value as { authenticated?: unknown }).authenticated === false
  ) {
    return null;
  }
  return value as AuthSession;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/u, "")}${path}`;
}

export function createPasskeyAuthClient({
  baseUrl = "",
  credentials,
  fetcher = globalThis.fetch,
}: ClientOptions = {}): PasskeyAuthClient {
  const request = async <T>(
    path: string,
    init: RequestInit = {},
    responseBody: "required" | "optional" = "required",
  ): Promise<T> => {
    const headers = new Headers(init.headers);
    if (init.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    let response: Response;
    try {
      response = await fetcher(joinUrl(baseUrl, path), {
        ...init,
        credentials: "same-origin",
        headers,
      });
    } catch (error) {
      throw new PasskeyAuthError(
        "network_error",
        "Unable to reach the authentication service.",
        { cause: error },
      );
    }

    const body = (await response.json().catch(() => null)) as
      | ApiErrorResponse
      | T
      | null;
    if (!response.ok) {
      const apiError = body as ApiErrorResponse | null;
      const code =
        typeof apiError?.error?.code === "string"
          ? apiError.error.code
          : "request_failed";
      const message =
        typeof apiError?.error?.message === "string"
          ? apiError.error.message
          : `Authentication request failed (${response.status}).`;
      throw new PasskeyAuthError(code, message, { status: response.status });
    }
    if (body === null) {
      if (responseBody === "optional") return undefined as T;
      throw new PasskeyAuthError(
        "invalid_response",
        "The server returned an empty response.",
        { status: response.status },
      );
    }
    return body as T;
  };

  const getCredentials = (): Pick<CredentialsContainer, "create" | "get"> => {
    if (!isPasskeySupported() && credentials === undefined) {
      throw new PasskeyAuthError(
        "unsupported",
        "Passkeys are not supported by this browser or device.",
      );
    }
    return credentials ?? globalThis.navigator.credentials;
  };

  const getSession = async (): Promise<AuthSession | null> => {
    try {
      return normalizeSession(await request<unknown>("/api/v1/session"));
    } catch (error) {
      if (error instanceof PasskeyAuthError && error.status === 401) return null;
      throw error;
    }
  };

  return {
    getSession,

    async register(displayName) {
      const normalizedDisplayName = displayName.trim();
      if (!normalizedDisplayName) {
        throw new PasskeyAuthError(
          "display_name_required",
          "Enter a display name to create a passkey.",
        );
      }

      const optionPayload = await request<OptionsResponse<CreationOptionsJSON>>(
        "/api/v1/auth/register/options",
        {
          method: "POST",
          body: JSON.stringify({ displayName: normalizedDisplayName }),
        },
      );

      try {
        const credential = (await getCredentials().create({
          publicKey: decodeCreationOptions(optionPayload.options),
        })) as PublicKeyCredential | null;
        if (!credential) throw { name: "NotAllowedError" };

        await request<void>(
          "/api/v1/auth/register/verify",
          {
            method: "POST",
            body: JSON.stringify({
              challengeId: optionPayload.challengeId,
              response: serializeRegistrationCredential(credential),
            }),
          },
          "optional",
        );
      } catch (error) {
        throw mapPasskeyError(error);
      }

      return getSession();
    },

    async login() {
      const optionPayload = await request<OptionsResponse<RequestOptionsJSON>>(
        "/api/v1/auth/login/options",
        { method: "POST", body: JSON.stringify({}) },
      );

      try {
        const credential = (await getCredentials().get({
          publicKey: decodeRequestOptions(optionPayload.options),
        })) as PublicKeyCredential | null;
        if (!credential) throw { name: "NotAllowedError" };

        await request<void>(
          "/api/v1/auth/login/verify",
          {
            method: "POST",
            body: JSON.stringify({
              challengeId: optionPayload.challengeId,
              response: serializeAuthenticationCredential(credential),
            }),
          },
          "optional",
        );
      } catch (error) {
        throw mapPasskeyError(error);
      }

      return getSession();
    },

    async signOut() {
      await request<void>(
        "/api/v1/session",
        { method: "DELETE" },
        "optional",
      );
    },
  };
}

