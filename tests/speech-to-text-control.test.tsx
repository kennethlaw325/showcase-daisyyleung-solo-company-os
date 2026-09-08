// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpeechToTextControl } from "../src/components/portal/speech-to-text-control";

type MockTrack = { stop: ReturnType<typeof vi.fn> };
type MockStream = { getTracks: () => MockTrack[] };

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  static isTypeSupported = vi.fn((mimeType: string) => mimeType === "audio/webm");
  readonly start = vi.fn(() => {
    this.state = "recording";
    this.onstart?.();
  });
  readonly stop = vi.fn(() => {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio fixture"], { type: this.mimeType }) } as BlobEvent);
    this.onstop?.();
  });
  state: RecordingState = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstart: (() => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? this.mimeType;
    MockMediaRecorder.instances.push(this);
  }
}

const mediaState = {
  tracks: [] as MockTrack[],
  getUserMedia: vi.fn(),
};

function installMediaSupport(): void {
  vi.stubGlobal("MediaRecorder", MockMediaRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: mediaState.getUserMedia },
  });
}

function streamFixture(): MockStream {
  const track = { stop: vi.fn() };
  mediaState.tracks.push(track);
  return {
    getTracks: () => [track],
  };
}

function renderControl(options?: { value?: string; onChange?: (value: string) => void; disabled?: boolean; locale?: "en" | "zh-Hant" }) {
  const onChange = options?.onChange ?? vi.fn();
  render(
    <>
      <textarea id="source-text" aria-label="Source text" defaultValue={options?.value ?? ""} />
      <SpeechToTextControl
        value={options?.value ?? ""}
        onChange={onChange}
        locale={options?.locale ?? "en"}
        disabled={options?.disabled}
        targetTextareaId="source-text"
      />
    </>,
  );
  return onChange;
}

beforeEach(() => {
  mediaState.tracks = [];
  mediaState.getUserMedia.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ transcript: "Transcribed words" }), { status: 200 })));
});

afterEach(() => {
  cleanup();
  MockMediaRecorder.instances = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SpeechToTextControl", () => {
  it("uses the shared secondary action treatment and keeps idle copy concise", async () => {
    installMediaSupport();
    renderControl();

    const control = await screen.findByTestId("speech-to-text-control");
    expect(control.className).toContain("speech-to-text-control");
    expect(screen.getByRole("button", { name: "Start recording" }).className).toContain("portal-secondary-button");
    expect(screen.getByText("After you stop, the recording is sent to Groq for transcription. Solo Company OS does not store the recording.")).toBeTruthy();
    expect((await screen.findByRole("status")).textContent).toBe("Ready.");
  });

  it("keeps manual text entry available when recording is unsupported", async () => {
    renderControl();

    expect((await screen.findByRole("status")).textContent).toContain("Protected recording is unavailable");
    expect((screen.getByRole("button", { name: "Start recording" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("textbox", { name: "Source text" }) as HTMLTextAreaElement).disabled).toBe(false);
  });

  it("captures locally and appends a Groq transcript without erasing existing text", async () => {
    installMediaSupport();
    const stream = streamFixture();
    mediaState.getUserMedia.mockResolvedValue(stream);
    const onChange = renderControl({ value: "Existing context" });

    const start = await screen.findByRole("button", { name: "Start recording" });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(start);
    await waitFor(() => expect(MockMediaRecorder.instances).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Stop and transcribe" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("Existing context\nTranscribed words"));
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/transcription/groq");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get("language")).toBe("en");
    expect(stream.getTracks()[0].stop).toHaveBeenCalled();
  });

  it("does not issue a duplicate request when Stop is clicked repeatedly", async () => {
    installMediaSupport();
    mediaState.getUserMedia.mockResolvedValue(streamFixture());
    const pending = new Promise<Response>(() => undefined);
    vi.stubGlobal("fetch", vi.fn(() => pending));
    renderControl();
    fireEvent.click(await screen.findByRole("button", { name: "Start recording" }));
    await waitFor(() => expect(MockMediaRecorder.instances).toHaveLength(1));
    const stop = screen.getByRole("button", { name: "Stop and transcribe" });
    fireEvent.click(stop);
    fireEvent.click(stop);
    expect(MockMediaRecorder.instances[0].stop).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("shows a microphone permission recovery message", async () => {
    installMediaSupport();
    mediaState.getUserMedia.mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    renderControl();
    fireEvent.click(await screen.findByRole("button", { name: "Start recording" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Microphone permission was denied");
  });

  it("maps an unavailable Groq response to an actionable error", async () => {
    installMediaSupport();
    mediaState.getUserMedia.mockResolvedValue(streamFixture());
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "unavailable", code: "provider_unavailable" }), { status: 503 })));
    renderControl();
    fireEvent.click(await screen.findByRole("button", { name: "Start recording" }));
    await waitFor(() => expect(MockMediaRecorder.instances).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Stop and transcribe" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Groq service is temporarily unavailable");
  });

  it("shows provider credential rejection separately and leaves typed text unchanged", async () => {
    installMediaSupport();
    mediaState.getUserMedia.mockResolvedValue(streamFixture());
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: "PRIVATE_PROVIDER_BODY",
      code: "unauthorized",
    }), { status: 503 })));
    const onChange = renderControl({ value: "Typed context" });
    const start = await screen.findByRole("button", { name: "Start recording" });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(start);
    await waitFor(() => expect(MockMediaRecorder.instances).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Stop and transcribe" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Groq rejected the configured server credentials");
    expect(alert.textContent).not.toContain("not configured");
    expect(alert.textContent).not.toContain("PRIVATE_PROVIDER_BODY");
    expect(onChange).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox", { name: "Source text" }) as HTMLTextAreaElement).value).toBe("Typed context");
  });

  it("keeps missing Groq configuration distinct from provider credential rejection", async () => {
    installMediaSupport();
    mediaState.getUserMedia.mockResolvedValue(streamFixture());
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: "Groq transcription is not configured.",
      code: "not_configured",
    }), { status: 503 })));
    const onChange = renderControl({ value: "Typed context", locale: "zh-Hant" });
    const start = await screen.findByRole("button", { name: "開始錄音" });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(start);
    await waitFor(() => expect(MockMediaRecorder.instances).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "停止錄音並轉錄" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Groq 尚未完成設定");
    expect(alert.textContent).not.toContain("拒絕");
    expect(onChange).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox", { name: "Source text" }) as HTMLTextAreaElement).value).toBe("Typed context");
  });

  it("cleans up tracks, timers, and pending transcription on unmount", async () => {
    installMediaSupport();
    const stream = streamFixture();
    mediaState.getUserMedia.mockResolvedValue(stream);
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    }));
    const rendered = render(<SpeechToTextControl value="" onChange={vi.fn()} locale="en" />);
    fireEvent.click(await screen.findByRole("button", { name: "Start recording" }));
    await waitFor(() => expect(MockMediaRecorder.instances).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Stop and transcribe" }));
    await waitFor(() => expect(signal).toBeDefined());
    rendered.unmount();

    expect(stream.getTracks()[0].stop).toHaveBeenCalled();
    expect(signal?.aborted).toBe(true);
  });
});
