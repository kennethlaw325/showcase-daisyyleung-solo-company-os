"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  appendTranscriptSegment,
  getSupportedRecordingMimeType,
  hasRecordingSupport,
  MAX_RECORDING_BYTES,
  MAX_RECORDING_DURATION_MS,
  normalizeRecordingMimeType,
  recordingLanguage,
  type SpeechLocale,
  type RecordingAudioMimeType,
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
  | "not_configured"
  | "unauthorized"
  | "payment_required"
  | "rate_limited"
  | "provider_unavailable"
  | "timeout"
  | "transport"
  | "invalid_response"
  | "payload_too_large"
  | "aborted"
  | "empty";

interface SpeechCopy {
  label: string;
  description: string;
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
  notConfigured: string;
  unauthorized: string;
  paymentRequired: string;
  rateLimited: string;
  providerUnavailable: string;
  timeout: string;
  transport: string;
  invalidResponse: string;
  payloadTooLarge: string;
  aborted: string;
  empty: string;
}

function speechCopy(locale: SpeechLocale): SpeechCopy {
  return locale === "zh-Hant"
    ? {
      label: "語音輸入",
      description: "停止後，錄音會傳送到 Groq 轉錄；Solo Company OS 不會儲存錄音。",
      start: "開始錄音",
      stop: "停止錄音並轉錄",
      transcribing: "正在轉錄⋯",
      retry: "再試一次語音輸入",
      ready: "可以開始錄音。",
      recording: "正在本機錄音⋯停止後才會傳送到 Groq。",
      unsupported: "此瀏覽器不支援受保護的錄音功能。你仍可手動輸入或貼上文字。",
      permission: "麥克風權限被拒絕。請在瀏覽器設定中允許麥克風，或繼續手動輸入。",
      recordingFailure: "錄音未能開始或意外停止。請重試，或繼續手動輸入。",
      service: "Groq 轉錄暫時不可用。請重試，或繼續手動輸入。",
      notConfigured: "Groq 尚未完成設定。請繼續手動輸入或貼上文字。",
      unauthorized: "Groq 拒絕了目前設定的伺服器憑證。請檢查 Groq 設定，或繼續手動輸入。",
      paymentRequired: "Groq 帳戶目前無法使用轉錄功能。請繼續手動輸入，或稍後重試。",
      rateLimited: "Groq 暫時限制轉錄請求。請稍後重試，或繼續手動輸入。",
      providerUnavailable: "Groq 服務暫時不可用。請稍後重試，或繼續手動輸入。",
      timeout: "轉錄逾時。請重試，或繼續手動輸入。",
      transport: "無法連線到 Groq。請檢查網絡，或繼續手動輸入。",
      invalidResponse: "Groq 回傳了無法使用的結果。請重試，或繼續手動輸入。",
      payloadTooLarge: "錄音太大，請錄短一點，或繼續手動輸入。",
      aborted: "轉錄已取消。你仍可繼續手動輸入。",
      empty: "沒有錄到可轉錄的音訊。請重試，或繼續手動輸入。",
    }
    : {
      label: "Voice input",
      description: "After you stop, the recording is sent to Groq for transcription. Solo Company OS does not store the recording.",
      start: "Start recording",
      stop: "Stop and transcribe",
      transcribing: "Transcribing...",
      retry: "Try voice input again",
      ready: "Ready.",
      recording: "Recording locally... the recording is sent to Groq only after you stop.",
      unsupported: "Protected recording is unavailable in this browser. You can type or paste text.",
      permission: "Microphone permission was denied. Check your browser settings or continue typing.",
      recordingFailure: "Recording could not start or stopped unexpectedly. Try again or continue typing.",
      service: "Groq transcription is temporarily unavailable. Try again or continue typing.",
      notConfigured: "Groq is not configured yet. Continue typing or pasting text.",
      unauthorized: "Groq rejected the configured server credentials. Check the Groq configuration or continue typing.",
      paymentRequired: "The Groq account cannot use transcription right now. Continue typing or try again later.",
      rateLimited: "Groq is temporarily rate limiting transcription. Try again later or continue typing.",
      providerUnavailable: "The Groq service is temporarily unavailable. Try again later or continue typing.",
      timeout: "Transcription timed out. Try again or continue typing.",
      transport: "Groq could not be reached. Check your connection or continue typing.",
      invalidResponse: "Groq returned an unusable result. Try again or continue typing.",
      payloadTooLarge: "The recording is too large. Record a shorter clip or continue typing.",
      aborted: "Transcription was cancelled. You can continue typing.",
      empty: "No audio was captured. Try again or continue typing.",
    };
}

function permissionFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error && typeof error.name === "string" ? error.name : "";
  return /notallowed|permissiondenied|security/i.test(name);
}

function localFailureCode(error: unknown): FailureCode {
  if (permissionFailure(error)) return "permission";
  if (error instanceof Error && /empty/i.test(error.message)) return "empty";
  return "recording";
}

function routeFailureCode(status: number, payload: unknown): FailureCode {
  const code = typeof payload === "object" && payload !== null && "code" in payload && typeof payload.code === "string"
    ? payload.code
    : "";
  if (code === "not_configured") return "not_configured";
  if (code === "unauthorized") return "unauthorized";
  if (code === "payment_required" || status === 402) return "payment_required";
  if (code === "rate_limited" || status === 429) return "rate_limited";
  if (code === "provider_unavailable" || status === 503) return "provider_unavailable";
  if (code === "timeout" || status === 504) return "timeout";
  if (code === "transport" || status === 502) return "transport";
  if (code === "invalid_response") return "invalid_response";
  if (code === "payload_too_large" || status === 413) return "payload_too_large";
  if (code === "aborted" || status === 499) return "aborted";
  return "service";
}

function stopTracks(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // A track may already be ended while the recorder is shutting down.
    }
  }
}

function statusCopy(status: SpeechToTextStatus, failure: FailureCode | null, copy: SpeechCopy, interim: string): string {
  if (status === "recording") return interim ? `${copy.recording} ${interim}` : copy.recording;
  if (status === "transcribing") return copy.transcribing;
  if (status === "unsupported") return copy.unsupported;
  if (status === "error") {
    switch (failure) {
      case "permission": return copy.permission;
      case "recording": return copy.recordingFailure;
      case "not_configured": return copy.notConfigured;
      case "unauthorized": return copy.unauthorized;
      case "payment_required": return copy.paymentRequired;
      case "rate_limited": return copy.rateLimited;
      case "provider_unavailable": return copy.providerUnavailable;
      case "timeout": return copy.timeout;
      case "transport": return copy.transport;
      case "invalid_response": return copy.invalidResponse;
      case "payload_too_large": return copy.payloadTooLarge;
      case "aborted": return copy.aborted;
      case "empty": return copy.empty;
      default: return copy.service;
    }
  }
  return copy.ready;
}

function recordingBlob(chunks: Blob[], mimeType: RecordingAudioMimeType): Blob {
  return new Blob(chunks, { type: mimeType });
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
  const [interimTranscript] = useState("");
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const localeRef = useRef(locale);
  const mountedRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const startInFlightRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const transcriptionStartedRef = useRef(false);
  const id = useId().replace(/:/g, "");
  const controlId = `speech-to-text-${id}`;
  const descriptionId = `${controlId}-description`;
  const statusId = `${controlId}-status`;
  const copy = speechCopy(locale);

  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
    localeRef.current = locale;
  }, [locale, onChange, value]);

  useEffect(() => {
    mountedRef.current = true;
    const supported = hasRecordingSupport();
    queueMicrotask(() => {
      if (!mountedRef.current) return;
      setSupport(supported ? "supported" : "unsupported");
    });

    return () => {
      mountedRef.current = false;
      stopRequestedRef.current = true;
      startInFlightRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      transcriptionAbortRef.current?.abort();
      transcriptionAbortRef.current = null;
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onerror = null;
        recorder.onstop = null;
        try {
          if (recorder.state !== "inactive") recorder.stop();
        } catch {
          // The recorder may already be inactive during unmount cleanup.
        }
      }
      recorderRef.current = null;
      stopTracks(streamRef.current);
      streamRef.current = null;
      chunksRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!disabled) return;
    const recorder = recorderRef.current;
    if (!recorder && !startInFlightRef.current) return;
    stopRecording();
    // stopRecording is intentionally a render-local callback; the refs it
    // reads are stable and this effect only reacts to the disabled boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  function clearTimer(): void {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  function setFailureState(code: FailureCode): void {
    if (!mountedRef.current) return;
    clearTimer();
    setFailure(code);
    setStatus("error");
  }

  async function transcribe(blob: Blob, mimeType: RecordingAudioMimeType): Promise<void> {
    if (!mountedRef.current) return;
    if (blob.size <= 0) {
      setFailureState("empty");
      return;
    }
    if (blob.size > MAX_RECORDING_BYTES) {
      setFailureState("payload_too_large");
      return;
    }
    const controller = new AbortController();
    transcriptionAbortRef.current = controller;
    const formData = new FormData();
    const extension = mimeType === "audio/ogg" ? "ogg" : mimeType === "audio/wav" ? "wav" : "webm";
    formData.append("audio", blob, `recording.${extension}`);
    formData.append("language", recordingLanguage(localeRef.current));
    try {
      const response = await fetch("/api/transcription/groq", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      if (!response.ok) {
        setFailureState(routeFailureCode(response.status, payload));
        return;
      }
      const transcript = typeof payload === "object" && payload !== null && "transcript" in payload && typeof payload.transcript === "string"
        ? payload.transcript.trim()
        : "";
      if (!transcript) {
        setFailureState("invalid_response");
        return;
      }
      const nextValue = appendTranscriptSegment(valueRef.current, transcript);
      valueRef.current = nextValue;
      onChangeRef.current(nextValue);
      if (mountedRef.current) {
        setFailure(null);
        setStatus("idle");
      }
    } catch (error) {
      if (!mountedRef.current) return;
      if (error instanceof Error && error.name === "AbortError") {
        setFailureState("aborted");
      } else {
        setFailureState("transport");
      }
    } finally {
      if (transcriptionAbortRef.current === controller) transcriptionAbortRef.current = null;
    }
  }

  async function beginRecording(): Promise<void> {
    let stream: MediaStream | null = null;
    try {
      const mimeType = getSupportedRecordingMimeType();
      if (!mimeType || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        startInFlightRef.current = false;
        if (mountedRef.current) {
          setSupport("unsupported");
          setFailureState("unsupported");
        }
        return;
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current || stopRequestedRef.current) {
        startInFlightRef.current = false;
        stopTracks(stream);
        return;
      }
      const Constructor = typeof MediaRecorder === "undefined" ? null : MediaRecorder;
      if (!Constructor) throw new Error("MediaRecorder is unavailable");
      const recorder = new Constructor(stream, { mimeType });
      recorderRef.current = recorder;
      streamRef.current = stream;
      chunksRef.current = [];
      transcriptionStartedRef.current = false;
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        stopRequestedRef.current = true;
        const activeStream = streamRef.current;
        streamRef.current = null;
        recorderRef.current = null;
        recorder.ondataavailable = null;
        recorder.onstop = null;
        stopTracks(activeStream);
        setFailureState("recording");
      };
      recorder.onstop = () => {
        if (transcriptionStartedRef.current) return;
        transcriptionStartedRef.current = true;
        const chunks = chunksRef.current;
        chunksRef.current = [];
        const chosenMimeType = normalizeRecordingMimeType(recorder.mimeType) ?? mimeType;
        recorderRef.current = null;
        if (streamRef.current === stream) {
          streamRef.current = null;
          stopTracks(stream);
        }
        clearTimer();
        if (!mountedRef.current || !chunks.length) {
          if (mountedRef.current) setFailureState("empty");
          return;
        }
        setStatus("transcribing");
        const blob = recordingBlob(chunks, chosenMimeType);
        void transcribe(blob, chosenMimeType);
      };
      recorder.start();
      startInFlightRef.current = false;
      setFailure(null);
      setStatus("recording");
      timerRef.current = setTimeout(() => stopRecording(), MAX_RECORDING_DURATION_MS);
    } catch (error) {
      startInFlightRef.current = false;
      stopTracks(stream);
      streamRef.current = null;
      recorderRef.current = null;
      if (mountedRef.current) setFailureState(localFailureCode(error));
    }
  }

  function startRecording(): void {
    if (disabled || support !== "supported" || startInFlightRef.current || recorderRef.current) return;
    startInFlightRef.current = true;
    stopRequestedRef.current = false;
    transcriptionStartedRef.current = false;
    setFailure(null);
    setStatus("recording");
    void beginRecording();
  }

  function stopRecording(): void {
    if (!startInFlightRef.current && !recorderRef.current) return;
    stopRequestedRef.current = true;
    startInFlightRef.current = false;
    clearTimer();
    const recorder = recorderRef.current;
    if (!recorder) {
      const activeStream = streamRef.current;
      streamRef.current = null;
      stopTracks(activeStream);
      if (mountedRef.current) setStatus("idle");
      return;
    }
    if (mountedRef.current) setStatus("transcribing");
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      setFailureState("recording");
    }
    // Stop tracks even when a browser emits `stop` asynchronously.
    const activeStream = streamRef.current;
    streamRef.current = null;
    stopTracks(activeStream);
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
          onClick={visibleStatus === "recording" ? stopRecording : startRecording}
        >
          {buttonText}
        </button>
      </div>
      <p id={statusId} className="speech-to-text-status" role={visibleStatus === "error" ? "alert" : "status"} aria-live={visibleStatus === "error" ? "assertive" : "polite"} aria-atomic="true">
        {statusText}
      </p>
    </div>
  );
}
