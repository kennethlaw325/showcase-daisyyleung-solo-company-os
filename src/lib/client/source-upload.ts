import { getSupabaseBrowserClient } from "../supabase/client";
import type { Locale } from "../i18n/locale";
import { LEGACY_PPT_MIME, PPTX_MIME } from "../security/source-formats";
import { caseSupportCopy } from "../../data/case-support-copy";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 5;
export const ACCEPTED_FILE_TYPES = ".pdf,.docx,.pptx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/markdown";

const extensionMime: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: PPTX_MIME,
  txt: "text/plain",
  md: "text/markdown",
};

export function isLegacyPowerPointFile(file: Pick<File, "name" | "type">): boolean {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  return extension === "ppt" || (file.type.toLowerCase().split(";", 1)[0] === LEGACY_PPT_MIME && extension !== "pptx");
}

export function normalizedSourceMime(file: File): string {
  if (isLegacyPowerPointFile(file)) return "";
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  const byExtension = extensionMime[extension];
  // The filename extension is the stable UX signal; browsers disagree on
  // Office MIME values (and often report Markdown as text/plain). The server
  // still checks the bytes against this canonical type before persistence.
  if (byExtension) return byExtension;
  return "";
}

export function validateSourceFiles(files: readonly File[], existingCount = 0): string | null {
  if (files.length + existingCount > MAX_FILES) return `You can add ${Math.max(0, MAX_FILES - existingCount)} more source${MAX_FILES - existingCount === 1 ? "" : "s"} to this case.`;
  for (const file of files) {
    if (isLegacyPowerPointFile(file)) return `${file.name} is a legacy PowerPoint file. Save it as an unencrypted PPTX before uploading.`;
    if (!normalizedSourceMime(file)) return `${file.name} is not a supported PDF, DOCX, PPTX, TXT, or MD file.`;
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) return `${file.name} must be between 1 byte and 10 MB.`;
  }
  return null;
}

export async function releaseSourceUploadReservation(caseId: string, sourceId: string): Promise<void> {
  try {
    await fetch(`/api/cases/${caseId}/sources/upload-url`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId }),
    });
  } catch {
    // Best effort: preserve the original upload failure shown to the user.
  }
}

export async function uploadSourceFiles(caseId: string, files: readonly File[], options: {
  locale: Locale;
  onProgress?: (message: string) => void;
  onUploaded?: (file: File) => void;
}): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  for (const file of files) {
    const mimeType = normalizedSourceMime(file);
    options.onProgress?.(options.locale === "zh-Hant" ? `正在上傳 ${file.name}⋯` : `Uploading ${file.name}…`);
    const ticketResponse = await fetch(`/api/cases/${caseId}/sources/upload-url`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename: file.name, mimeType, byteSize: file.size }) });
    const ticket = (await ticketResponse.json()) as { sourceId?: string; path?: string; token?: string; error?: string };
    if (!ticketResponse.ok || !ticket.sourceId || !ticket.path || !ticket.token) throw new Error(options.locale === "zh-Hant" ? `未能準備 ${file.name}。` : ticket.error ?? `Could not prepare ${file.name}.`);
    try {
      const { error: uploadError } = await supabase.storage.from("source-documents").uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: mimeType });
      if (uploadError) throw uploadError;
    } catch {
      await releaseSourceUploadReservation(caseId, ticket.sourceId);
      throw new Error(options.locale === "zh-Hant" ? `未能上傳 ${file.name}。` : `Could not upload ${file.name}.`);
    }
    const registerResponse = await fetch(`/api/cases/${caseId}/sources`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId: ticket.sourceId, storagePath: ticket.path, filename: file.name, mimeType, byteSize: file.size }) });
    const registered = (await registerResponse.json()) as { source?: { extractionStatus?: string; errorCode?: string }; error?: string };
    if (!registerResponse.ok || registered.source?.extractionStatus !== "extracted") {
      const copy = caseSupportCopy[options.locale].upload;
      const message = copy.extractionError(file.name, registered.source?.errorCode);
      throw new Error(options.locale === "zh-Hant" ? message : registered.error ?? message);
    }
    options.onUploaded?.(file);
  }
}
