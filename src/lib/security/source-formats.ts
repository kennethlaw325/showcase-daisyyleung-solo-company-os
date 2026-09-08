/** MIME constants shared by browser-safe validation and server extraction. */
export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation" as const;
export const LEGACY_PPT_MIME = "application/vnd.ms-powerpoint" as const;

export const SUPPORTED_SOURCE_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  PPTX_MIME,
  "text/plain",
  "text/markdown",
] as const;

export type SupportedSourceMime = (typeof SUPPORTED_SOURCE_MIME_TYPES)[number];
