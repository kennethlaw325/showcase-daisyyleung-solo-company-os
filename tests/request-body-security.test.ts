import { describe, expect, it } from "vitest";
import { InvalidRequestBodyError, RequestBodyTooLargeError, errorResponse, readJson, readText } from "../src/lib/server/route-utils";

function streamedRequest(chunks: Uint8Array[], contentLength = "1"): Request {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
  return new Request("http://localhost/api/test", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "content-length": contentLength },
    duplex: "half",
  } as RequestInit);
}

describe("bounded request bodies", () => {
  it("accepts a body whose UTF-8 byte length is exactly the configured cap", async () => {
    const payload = new TextEncoder().encode("é");
    await expect(readText(new Request("http://localhost/api/test", { method: "POST", body: payload }), payload.byteLength)).resolves.toBe("é");
  });

  it("counts multibyte UTF-8 bytes rather than characters", async () => {
    const payload = new TextEncoder().encode("é");
    await expect(readText(new Request("http://localhost/api/test", { method: "POST", body: payload }), payload.byteLength - 1)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it("counts actual streamed bytes instead of trusting a short Content-Length", async () => {
    const payload = new TextEncoder().encode("{\"safe\":true}");
    await expect(readJson(streamedRequest([payload], "1"), payload.byteLength)).resolves.toEqual({ safe: true });
    await expect(readText(streamedRequest([new TextEncoder().encode("12345")], "1"), 4)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it("cancels a stream and returns a typed 413 when the actual body exceeds the cap", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(8));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("http://localhost/api/test", { method: "POST", body, duplex: "half" } as RequestInit);
    await expect(readText(request, 4)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    await expect(readText(new Request("http://localhost/api/test", { method: "POST", body: "012345" }), 4)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });

  it("maps malformed JSON and invalid UTF-8 to controlled 400 responses", async () => {
    let malformedJson: unknown;
    try {
      await readJson(new Request("http://localhost/api/test", { method: "POST", body: "not-json" }));
    } catch (error) {
      malformedJson = error;
    }
    expect(malformedJson).toBeInstanceOf(InvalidRequestBodyError);
    const malformedJsonResponse = errorResponse(malformedJson);
    expect(malformedJsonResponse.status).toBe(400);
    await expect(malformedJsonResponse.json()).resolves.toEqual({ error: "Invalid JSON" });

    let invalidUtf8: unknown;
    try {
      await readText(new Request("http://localhost/api/test", { method: "POST", body: new Uint8Array([0xff]) }));
    } catch (error) {
      invalidUtf8 = error;
    }
    const invalidUtf8Response = errorResponse(invalidUtf8);
    expect(invalidUtf8Response.status).toBe(400);
    await expect(invalidUtf8Response.json()).resolves.toEqual({ error: "Invalid UTF-8 request body" });
  });

  it("maps streamed overflow to a 413 response and preserves intentional empty text reads", async () => {
    let oversized: unknown;
    try {
      await readText(streamedRequest([new TextEncoder().encode("12345")], "1"), 4);
    } catch (error) {
      oversized = error;
    }
    expect(oversized).toBeInstanceOf(RequestBodyTooLargeError);
    const oversizedResponse = errorResponse(oversized);
    expect(oversizedResponse.status).toBe(413);
    await expect(oversizedResponse.json()).resolves.toEqual({ error: "Request body too large" });
    await expect(readText(new Request("http://localhost/api/test", { method: "POST" }), 4)).resolves.toBe("");
  });

  it("preserves classified AI errors without exposing arbitrary server failures", async () => {
    const timeout = Object.assign(new Error("AI generation timed out. Please try again."), {
      status: 504,
      aiError: true,
      aiErrorCode: "timeout",
    });
    const timeoutResponse = errorResponse(timeout);
    expect(timeoutResponse.status).toBe(504);
    await expect(timeoutResponse.json()).resolves.toEqual({ error: "AI generation timed out. Please try again." });

    const unclassified = Object.assign(new Error("private provider or persistence detail"), { status: 500 });
    const unclassifiedResponse = errorResponse(unclassified);
    expect(unclassifiedResponse.status).toBe(500);
    await expect(unclassifiedResponse.json()).resolves.toEqual({ error: "Internal server error" });

    const forgedCodeWithoutMarker = Object.assign(new Error("private detail"), { status: 502, aiErrorCode: "provider_request" });
    await expect(errorResponse(forgedCodeWithoutMarker).json()).resolves.toEqual({ error: "Internal server error" });
  });
});
