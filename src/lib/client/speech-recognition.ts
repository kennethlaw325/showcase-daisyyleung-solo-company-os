/**
 * Provider-neutral browser recording helpers. All capture is performed with
 * MediaRecorder and forwarded only after the user explicitly stops.
 */

export type SpeechLocale = "en" | "zh-Hant";
export type SpeechInputLanguage = "en-US" | "zh-HK";
export type RecordingLanguage = "en" | "zh";
export type RecordingAudioMimeType = "audio/webm" | "audio/ogg" | "audio/wav";

export const MAX_RECORDING_DURATION_MS = 120_000;
export const MAX_RECORDING_BYTES = 10 * 1024 * 1024;
export const RECORDING_MIME_TYPES: readonly RecordingAudioMimeType[] = ["audio/webm", "audio/ogg", "audio/wav"];

export function defaultSpeechInputLanguage(
  locale: SpeechLocale,
  browserLanguage?: string,
): SpeechInputLanguage {
  const normalizedBrowserLanguage = browserLanguage?.trim().toLowerCase() ?? "";
  if (normalizedBrowserLanguage.startsWith("en")) return "en-US";
  if (normalizedBrowserLanguage.startsWith("zh") || normalizedBrowserLanguage.startsWith("yue")) return "zh-HK";
  return locale === "zh-Hant" ? "zh-HK" : "en-US";
}

export function recordingLanguage(locale: SpeechLocale): RecordingLanguage {
  return locale === "zh-Hant" ? "zh" : "en";
}

/** Normalizes codec parameters while keeping the provider MIME allowlist tight. */
export function normalizeRecordingMimeType(value: string | null | undefined): RecordingAudioMimeType | null {
  if (typeof value !== "string") return null;
  const base = value.split(";", 1)[0]?.trim().toLowerCase();
  return (RECORDING_MIME_TYPES as readonly string[]).includes(base)
    ? base as RecordingAudioMimeType
    : null;
}

export function appendTranscriptSegment(currentValue: string, segment: string): string {
  const normalizedSegment = segment.trim();
  if (!normalizedSegment) return currentValue;
  if (!currentValue.trim()) return normalizedSegment;

  // Keep existing user text intact while guaranteeing a boundary between a
  // typed/pasted value and the newly transcribed segment.
  const separator = /\s$/.test(currentValue) ? "" : "\n";
  return `${currentValue}${separator}${normalizedSegment}`;
}

type MediaRecorderConstructorLike = {
  new (stream: MediaStream, options?: MediaRecorderOptions): MediaRecorder;
  isTypeSupported?: (mimeType: string) => boolean;
};

/**
 * Selects one allowlisted recording MIME type. A browser may expose
 * MediaRecorder but reject every candidate; callers should then present the
 * manual-entry recovery path.
 */
export function getSupportedRecordingMimeType(
  recorderConstructor?: MediaRecorderConstructorLike | null,
): RecordingAudioMimeType | null {
  if (!recorderConstructor && typeof window === "undefined") return null;
  const Constructor = recorderConstructor ?? (typeof MediaRecorder === "undefined" ? null : MediaRecorder);
  if (!Constructor) return null;
  for (const candidate of RECORDING_MIME_TYPES) {
    try {
      if (!Constructor.isTypeSupported || Constructor.isTypeSupported(candidate)) return candidate;
    } catch {
      // Continue through the finite allowlist when a browser rejects a probe.
    }
  }
  return null;
}

export function hasRecordingSupport(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") return false;
  return Boolean(getSupportedRecordingMimeType());
}
