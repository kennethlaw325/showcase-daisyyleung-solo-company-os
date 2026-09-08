"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  appendTranscriptSegment,
  defaultSpeechInputLanguage,
  MAX_RECORDING_DURATION_MS,
  type SpeechInputLanguage,
  type SpeechLocale,
} from "@/src/lib/client/speech-recognition";

export type SpeechToTextStatus = "idle" | "recording" | "transcribing" | "error" | "unsupported";

export interface SpeechToTextControlProps {
  value: string;
  onChange: (value: string) => void;
  locale?: SpeechLocale;
  disabled?: boolean;
  label?: string;
  description?: string;
  targetTextareaId?: string;
  className?: string;
}

type FailureCode =
  | "permission"
  | "unsupported"
  | "recording"
  | "service"
  | "language"
  | "network"
  | "aborted"
  | "empty";

interface SpeechCopy {
  label: string;
  description: string;
  languageLabel: string;
  cantonese: string;
  english: string;
  start: string;
  stop: string;
  transcribing: string;
  retry: string;
  ready: string;
  recording: string;
  unsupported: string;
  permission: string;
  recordingFailure: string;
  service: string;
  language: string;
  network: string;
  aborted: string;
  empty: string;
}

interface BrowserSpeechRecognitionAlternative {
  transcript: string;
}

interface BrowserSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: BrowserSpeechRecognitionAlternative;
}

interface BrowserSpeechRecognitionResultList {
  readonly length: number;
  readonly [index: number]: BrowserSpeechRecognitionResult;
}

interface BrowserSpeechRecognitionEvent {
  readonly resultIndex: number;
  readonly results: BrowserSpeechRecognitionResultList;
}

interface BrowserSpeechRecognitionErrorEvent {
  readonly error: string;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;
type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: BrowserSpeechRecognitionConstructor;
  webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
};

function speechCopy(locale: SpeechLocale): SpeechCopy {
  return locale === "zh-Hant"
    ? {
      label: "語音輸入",
      description: "免費使用瀏覽器語音辨識；Solo Company OS 不會上載或儲存錄音。瀏覽器可能使用網上服務處理語音。",
      languageLabel: "語音語言",
      cantonese: "廣東話（香港）",
      english: "English",
      start: "開始語音輸入",
      stop: "停止並加入文字",
      transcribing: "正在完成辨識⋯",
      retry: "再試一次語音輸入",
      ready: "選好語言後便可以開始。",
      recording: "正在聆聽⋯",
      unsupported: "此瀏覽器不支援語音辨識。請使用最新版 Chrome，或繼續手動輸入。",
      permission: "麥克風權限被拒絕。請在瀏覽器設定中允許麥克風，或繼續手動輸入。",
      recordingFailure: "語音辨識未能開始或意外停止。請重試，或繼續手動輸入。",
      service: "瀏覽器語音辨識暫時不可用。請重試，或繼續手動輸入。",
      language: "瀏覽器暫時不支援所選語言。請改選另一種語言，或繼續手動輸入。",
      network: "瀏覽器的語音辨識服務暫時無法連線。請檢查網絡，或繼續手動輸入。",
      aborted: "語音辨識已取消。你仍可繼續手動輸入。",
      empty: "未辨識到語音。請靠近麥克風再試，或繼續手動輸入。",
    }
    : {
      label: "Voice input",
      description: "Uses your browser's free speech recognition. Solo Company OS does not upload or store the recording. Your browser may use an online service to process speech.",
      languageLabel: "Spoken language",
      cantonese: "Cantonese (Hong Kong)",
      english: "English",
      start: "Start voice input",
      stop: "Stop and add text",
      transcribing: "Finishing recognition...",
      retry: "Try voice input again",
      ready: "Choose a language, then start speaking.",
      recording: "Listening...",
      unsupported: "Speech recognition is unavailable in this browser. Use the latest Chrome or continue typing.",
      permission: "Microphone permission was denied. Allow microphone access in your browser settings or continue typing.",
      recordingFailure: "Speech recognition could not start or stopped unexpectedly. Try again or continue typing.",
      service: "Browser speech recognition is temporarily unavailable. Try again or continue typing.",
      language: "The selected language is unavailable in this browser. Choose another language or continue typing.",
      network: "The browser's speech recognition service could not be reached. Check your connection or continue typing.",
      aborted: "Speech recognition was cancelled. You can continue typing.",
      empty: "No speech was recognized. Move closer to the microphone and try again, or continue typing.",
    };
}

function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as SpeechRecognitionWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function recognitionFailureCode(error: string): FailureCode {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "permission";
    case "audio-capture":
      return "recording";
    case "language-not-supported":
    case "language-unavailable":
      return "language";
    case "network":
      return "network";
    case "aborted":
      return "aborted";
    case "no-speech":
      return "empty";
    default:
      return "service";
  }
}

function statusCopy(status: SpeechToTextStatus, failure: FailureCode | null, copy: SpeechCopy, interim: string): string {
  if (status === "recording") return interim ? `${copy.recording} ${interim}` : copy.recording;
  if (status === "transcribing") return copy.transcribing;
  if (status === "unsupported") return copy.unsupported;
  if (status === "error") {
    switch (failure) {
      case "permission": return copy.permission;
      case "unsupported": return copy.unsupported;
      case "recording": return copy.recordingFailure;
      case "language": return copy.language;
      case "network": return copy.network;
      case "aborted": return copy.aborted;
      case "empty": return copy.empty;
      default: return copy.service;
    }
  }
  return copy.ready;
}

export function SpeechToTextControl({
  value,
  onChange,
  locale = "en",
  disabled = false,
  label,
  description,
  targetTextareaId,
  className,
}: SpeechToTextControlProps) {
  const [support, setSupport] = useState<"unknown" | "supported" | "unsupported">("unknown");
  const [status, setStatus] = useState<SpeechToTextStatus>("idle");
  const [failure, setFailure] = useState<FailureCode | null>(null);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [inputLanguage, setInputLanguage] = useState<SpeechInputLanguage>(() => defaultSpeechInputLanguage(locale));
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const mountedRef = useRef(false);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const finalSegmentsRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopRequestedRef = useRef(false);
  const sessionFailedRef = useRef(false);
  const languageCustomizedRef = useRef(false);
  const id = useId().replace(/:/g, "");
  const controlId = `speech-to-text-${id}`;
  const descriptionId = `${controlId}-description`;
  const languageId = `${controlId}-language`;
  const statusId = `${controlId}-status`;
  const copy = speechCopy(locale);

  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  }, [onChange, value]);

  useEffect(() => {
    if (languageCustomizedRef.current) return;
    const browserLanguage = typeof navigator === "undefined" ? undefined : navigator.language;
    setInputLanguage(defaultSpeechInputLanguage(locale, browserLanguage));
  }, [locale]);

  useEffect(() => {
    mountedRef.current = true;
    const supported = Boolean(getSpeechRecognitionConstructor());
    queueMicrotask(() => {
      if (!mountedRef.current) return;
      setSupport(supported ? "supported" : "unsupported");
    });

    return () => {
      mountedRef.current = false;
      clearTimer();
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      if (recognition) {
        recognition.onstart = null;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        try {
          recognition.abort();
        } catch {
          // The browser may have already ended the recognition session.
        }
      }
      finalSegmentsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!disabled || !recognitionRef.current) return;
    sessionFailedRef.current = true;
    clearTimer();
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    try {
      recognition.abort();
    } catch {
      // The browser may have already ended the recognition session.
    }
    finalSegmentsRef.current = [];
    setInterimTranscript("");
    setFailure(null);
    setStatus("idle");
  }, [disabled]);

  function clearTimer(): void {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  function setFailureState(code: FailureCode): void {
    if (!mountedRef.current) return;
    clearTimer();
    setInterimTranscript("");
    setFailure(code);
    setStatus("error");
  }

  function finishRecognition(recognition: BrowserSpeechRecognition): void {
    if (recognitionRef.current === recognition) recognitionRef.current = null;
    clearTimer();
    if (!mountedRef.current || sessionFailedRef.current) return;
    const transcript = finalSegmentsRef.current.join(" ").replace(/\s+/g, " ").trim();
    finalSegmentsRef.current = [];
    setInterimTranscript("");
    if (!transcript) {
      setFailureState("empty");
      return;
    }
    const nextValue = appendTranscriptSegment(valueRef.current, transcript);
    valueRef.current = nextValue;
    onChangeRef.current(nextValue);
    setFailure(null);
    setStatus("idle");
  }

  function startListening(): void {
    if (disabled || support !== "supported" || recognitionRef.current) return;
    const Constructor = getSpeechRecognitionConstructor();
    if (!Constructor) {
      setSupport("unsupported");
      setFailureState("unsupported");
      return;
    }

    const recognition = new Constructor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = inputLanguage;
    recognition.maxAlternatives = 1;
    finalSegmentsRef.current = [];
    stopRequestedRef.current = false;
    sessionFailedRef.current = false;
    setInterimTranscript("");
    setFailure(null);
    setStatus("recording");

    recognition.onstart = () => {
      if (!mountedRef.current || recognitionRef.current !== recognition) return;
      setStatus("recording");
    };
    recognition.onresult = (event) => {
      if (!mountedRef.current || recognitionRef.current !== recognition) return;
      const interimSegments: string[] = [];
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript?.trim() ?? "";
        if (!transcript) continue;
        if (result.isFinal) finalSegmentsRef.current.push(transcript);
        else interimSegments.push(transcript);
      }
      setInterimTranscript(interimSegments.join(" "));
    };
    recognition.onerror = (event) => {
      if (!mountedRef.current || recognitionRef.current !== recognition) return;
      sessionFailedRef.current = true;
      recognitionRef.current = null;
      finalSegmentsRef.current = [];
      setFailureState(recognitionFailureCode(event.error));
    };
    recognition.onend = () => finishRecognition(recognition);
    recognitionRef.current = recognition;

    try {
      recognition.start();
      timerRef.current = setTimeout(() => stopListening(), MAX_RECORDING_DURATION_MS);
    } catch {
      recognitionRef.current = null;
      sessionFailedRef.current = true;
      setFailureState("recording");
    }
  }

  function stopListening(): void {
    const recognition = recognitionRef.current;
    if (!recognition || stopRequestedRef.current) return;
    stopRequestedRef.current = true;
    clearTimer();
    if (mountedRef.current) setStatus("transcribing");
    try {
      recognition.stop();
    } catch {
      recognitionRef.current = null;
      sessionFailedRef.current = true;
      setFailureState("recording");
    }
  }

  function changeLanguage(nextLanguage: SpeechInputLanguage): void {
    if (recognitionRef.current) return;
    languageCustomizedRef.current = true;
    setInputLanguage(nextLanguage);
    setFailure(null);
    setStatus("idle");
  }

  const visibleStatus = support === "unsupported" ? "unsupported" : status;
  const statusText = statusCopy(visibleStatus, failure, copy, interimTranscript);
  const buttonText = visibleStatus === "recording"
    ? copy.stop
    : visibleStatus === "transcribing"
      ? copy.transcribing
      : visibleStatus === "error"
        ? copy.retry
        : copy.start;
  const controlClassName = ["speech-to-text-control", className].filter(Boolean).join(" ");

  return (
    <div className={controlClassName} data-testid="speech-to-text-control" data-speech-status={visibleStatus}>
      <div className="speech-to-text-heading">
        <div className="speech-to-text-copy">
          <span className="speech-to-text-label">{label ?? copy.label}</span>
          <p id={descriptionId} className="speech-to-text-description">{description ?? copy.description}</p>
        </div>
        <button
          type="button"
          className="portal-secondary-button speech-to-text-button"
          aria-label={buttonText}
          aria-controls={targetTextareaId}
          aria-describedby={`${descriptionId} ${statusId}`}
          disabled={disabled || support !== "supported" || visibleStatus === "transcribing"}
          onClick={visibleStatus === "recording" ? stopListening : startListening}
        >
          {buttonText}
        </button>
      </div>
      <label className="speech-to-text-language-picker" htmlFor={languageId}>
        <span>{copy.languageLabel}</span>
        <select
          id={languageId}
          value={inputLanguage}
          disabled={disabled || visibleStatus === "recording" || visibleStatus === "transcribing"}
          onChange={(event) => changeLanguage(event.target.value as SpeechInputLanguage)}
        >
          <option value="zh-HK">{copy.cantonese}</option>
          <option value="en-US">{copy.english}</option>
        </select>
      </label>
      <p id={statusId} className="speech-to-text-status" role={visibleStatus === "error" ? "alert" : "status"} aria-live={visibleStatus === "error" ? "assertive" : "polite"} aria-atomic="true">
        {statusText}
      </p>
    </div>
  );
}
