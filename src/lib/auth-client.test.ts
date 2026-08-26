import { describe, expect, it } from "vitest";

import {
  arrayBufferToBase64Url,
  base64UrlToArrayBuffer,
  mapPasskeyError,
  PasskeyAuthError,
  serializeAuthenticationCredential,
  serializeRegistrationCredential,
} from "./auth-client";

function bytes(...values: number[]): ArrayBuffer {
  return Uint8Array.from(values).buffer;
}

function byteValues(value: ArrayBuffer): number[] {
  return Array.from(new Uint8Array(value));
}

describe("passkey base64url conversion", () => {
  it("round-trips arbitrary binary data without padding", () => {
    const source = bytes(0, 1, 2, 127, 128, 251, 255, 239);
    const encoded = arrayBufferToBase64Url(source);

    expect(encoded).not.toMatch(/[+/=]/u);
    expect(byteValues(base64UrlToArrayBuffer(encoded))).toEqual(
      byteValues(source),
    );
  });

  it("uses the URL-safe alphabet", () => {
    expect(arrayBufferToBase64Url(bytes(251, 255, 239))).toBe("-__v");
    expect(byteValues(base64UrlToArrayBuffer("-__v"))).toEqual([
      251, 255, 239,
    ]);
  });

  it("rejects malformed base64url", () => {
    expect(() => base64UrlToArrayBuffer("not+url-safe")).toThrow(
      PasskeyAuthError,
    );
  });
});

describe("passkey credential serialization", () => {
  it("serializes a registration response", () => {
    const credential = {
      id: "registration-id",
      rawId: bytes(1, 2, 3),
      type: "public-key",
      authenticatorAttachment: "platform",
      getClientExtensionResults: () => ({ credProps: { rk: true } }),
      response: {
        clientDataJSON: bytes(4, 5),
        attestationObject: bytes(6, 7),
        getTransports: () => ["internal", "hybrid"],
      },
    } as unknown as PublicKeyCredential;

    expect(serializeRegistrationCredential(credential)).toEqual({
      id: "registration-id",
      rawId: "AQID",
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: { credProps: { rk: true } },
      response: {
        clientDataJSON: "BAU",
        attestationObject: "Bgc",
        transports: ["internal", "hybrid"],
      },
    });
  });

  it("serializes a discoverable login response", () => {
    const credential = {
      id: "login-id",
      rawId: bytes(8, 9),
      type: "public-key",
      authenticatorAttachment: null,
      getClientExtensionResults: () => ({
        prf: { results: { first: bytes(10, 11) } },
      }),
      response: {
        clientDataJSON: bytes(12),
        authenticatorData: bytes(13, 14),
        signature: bytes(15, 16),
        userHandle: bytes(17, 18),
      },
    } as unknown as PublicKeyCredential;

    expect(serializeAuthenticationCredential(credential)).toEqual({
      id: "login-id",
      rawId: "CAk",
      type: "public-key",
      authenticatorAttachment: null,
      clientExtensionResults: {
        prf: { results: { first: "Cgs" } },
      },
      response: {
        clientDataJSON: "DA",
        authenticatorData: "DQ4",
        signature: "DxA",
        userHandle: "ERI",
      },
    });
  });

  it("preserves a null user handle", () => {
    const credential = {
      id: "login-id",
      rawId: bytes(1),
      type: "public-key",
      authenticatorAttachment: null,
      getClientExtensionResults: () => ({}),
      response: {
        clientDataJSON: bytes(2),
        authenticatorData: bytes(3),
        signature: bytes(4),
        userHandle: null,
      },
    } as unknown as PublicKeyCredential;

    expect(
      serializeAuthenticationCredential(credential).response.userHandle,
    ).toBeNull();
  });
});

describe("passkey error mapping", () => {
  it("maps user cancellation to a retryable cancellation error", () => {
    const error = mapPasskeyError({ name: "NotAllowedError" });

    expect(error).toMatchObject({
      name: "PasskeyAuthError",
      code: "cancelled",
    });
  });

  it("maps browser support failures", () => {
    const error = mapPasskeyError({ name: "NotSupportedError" });

    expect(error).toMatchObject({
      name: "PasskeyAuthError",
      code: "unsupported",
    });
  });
});
