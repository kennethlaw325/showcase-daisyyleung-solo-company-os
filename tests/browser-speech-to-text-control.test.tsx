// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpeechToTextControl } from "../src/components/portal/browser-speech-to-text-control";

interface MockRecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}

interface MockRecognitionEvent {
  resultIndex: number;
  results: MockRecognitionResult[];
}

class MockSpeechRecognition {
  static instances: MockSpeechRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = "";
  maxAlternatives = 0;
  onstart: (() => void) | null = null;
  onresult: ((event: MockRecognitionEvent) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  readonly start = vi.fn(() => this.onstart?.());
  readonly stop = vi.fn();
  readonly abort = vi.fn();

  constructor() {
    MockSpeechRecognition.instances.push(this);
  }

  emitResult(transcript: string, isFinal: boolean): void {
    this.onresult?.({
      resultIndex: 0,
      results: [{ 0: { transcript }, isFinal }],
    });
  }

  emitError(error: string): void {
    this.onerror?.({ error });
  }

  finish(): void {
    this.onend?.();
  }
}

function installSpeechRecognitionSupport(): void {
  vi.stubGlobal("SpeechRecognition", undefined);
  vi.stubGlobal("webkitSpeechRecognition", MockSpeechRecognition);
}

function renderControl(options?: {
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  locale?: "en" | "zh-Hant";
}) {
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
  MockSpeechRecognition.instances = [];
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("browser SpeechToTextControl", () => {
  it("uses free browser recognition and exposes Cantonese and English choices", async () => {
    installSpeechRecognitionSupport();
    renderControl();

    expect(await screen.findByText(/browser's free speech recognition/i)).toBeTruthy();
    expect(screen.getByRole("option", { name: "Cantonese (Hong Kong)" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "English" })).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "Spoken language" }) as HTMLSelectElement).value).toBe("en-US");
    expect(await screen.findByText("Choose a language, then start speaking.")).toBeTruthy();
  });

  it("keeps manual text entry available when browser recognition is unsupported", async () => {
    renderControl();

    expect((await screen.findByRole("status")).textContent).toContain("Speech recognition is unavailable");
    expect((screen.getByRole("button", { name: "Start voice input" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("textbox", { name: "Source text" }) as HTMLTextAreaElement).disabled).toBe(false);
  });

  it("appends recognized English without calling Groq, OpenAI, or any app endpoint", async () => {
    installSpeechRecognitionSupport();
    const onChange = renderControl({ value: "Existing context" });

    const start = await screen.findByRole("button", { name: "Start voice input" });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(start);
    const recognition = MockSpeechRecognition.instances[0];
    expect(recognition.lang).toBe("en-US");
    recognition.emitResult("An English voice note", true);
    fireEvent.click(screen.getByRole("button", { name: "Stop and add text" }));
    recognition.finish();

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("Existing context\nAn English voice note"));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("recognizes Cantonese when the user selects Hong Kong Cantonese", async () => {
    installSpeechRecognitionSupport();
    const onChange = renderControl({ locale: "zh-Hant" });
    const language = await screen.findByRole("combobox", { name: "語音語言" });
    fireEvent.change(language, { target: { value: "zh-HK" } });
    const start = screen.getByRole("button", { name: "開始語音輸入" });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(start);
    const recognition = MockSpeechRecognition.instances[0];
    expect(recognition.lang).toBe("zh-HK");
    recognition.emitResult("呢段係廣東話語音", true);
    fireEvent.click(screen.getByRole("button", { name: "停止並加入文字" }));
    recognition.finish();

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("呢段係廣東話語音"));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("uses the browser language as the first default", async () => {
    installSpeechRecognitionSupport();
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("zh-HK");
    renderControl({ locale: "en" });

    await waitFor(() => {
      expect((screen.getByRole("combobox", { name: "Spoken language" }) as HTMLSelectElement).value).toBe("zh-HK");
    });
  });

  it("shows live interim words without changing the textarea before completion", async () => {
    installSpeechRecognitionSupport();
    const onChange = renderControl();
    const start = await screen.findByRole("button", { name: "Start voice input" });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(start);
    MockSpeechRecognition.instances[0].emitResult("words still being recognized", false);

    expect((await screen.findByRole("status")).textContent).toContain("words still being recognized");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not stop twice when the stop button is activated repeatedly", async () => {
    installSpeechRecognitionSupport();
    renderControl();
    const start = await screen.findByRole("button", { name: "Start voice input" });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(start);
    const recognition = MockSpeechRecognition.instances[0];
    const stop = screen.getByRole("button", { name: "Stop and add text" });
    fireEvent.click(stop);
    fireEvent.click(stop);

    expect(recognition.stop).toHaveBeenCalledTimes(1);
  });

  it("shows microphone permission and language recovery messages", async () => {
    installSpeechRecognitionSupport();
    renderControl({ locale: "zh-Hant" });
    const start = await screen.findByRole("button", { name: "開始語音輸入" });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(start);
    MockSpeechRecognition.instances[0].emitError("not-allowed");
    expect((await screen.findByRole("alert")).textContent).toContain("麥克風權限被拒絕");

    fireEvent.click(screen.getByRole("button", { name: "再試一次語音輸入" }));
    MockSpeechRecognition.instances[1].emitError("language-not-supported");
    expect((await screen.findByRole("alert")).textContent).toContain("不支援所選語言");
  });

  it("aborts browser recognition on unmount without changing typed text", async () => {
    installSpeechRecognitionSupport();
    const onChange = vi.fn();
    const rendered = render(<SpeechToTextControl value="Typed context" onChange={onChange} locale="en" />);
    const start = await screen.findByRole("button", { name: "Start voice input" });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(start);
    const recognition = MockSpeechRecognition.instances[0];
    rendered.unmount();

    expect(recognition.abort).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});
