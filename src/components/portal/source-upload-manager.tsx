"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type ChangeEvent } from "react";
import { useLocale } from "@/src/components/locale-provider";
import { caseSupportCopy } from "@/src/data/case-support-copy";
import { getSupabaseBrowserClient } from "@/src/lib/supabase/client";
import { ACCEPTED_FILE_TYPES, MAX_FILE_BYTES, isLegacyPowerPointFile, normalizedSourceMime, releaseSourceUploadReservation } from "@/src/lib/client/source-upload";

type UploadTicket = {
  sourceId: string;
  path: string;
  token: string;
  mimeType: string;
  byteSize: number;
  error?: string;
};

export function SourceUploadManager({ caseId, currentCount, demo }: { caseId: string; currentCount: number; demo: boolean }) {
  const router = useRouter();
  const { locale } = useLocale();
  const copy = caseSupportCopy[locale].upload;
  const inputId = useId();
  const [state, setState] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const remaining = Math.max(0, 5 - currentCount);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    if (files.length > remaining) {
      setState("error");
      setMessage(copy.tooMany(remaining));
      return;
    }

    for (const file of files) {
      const mimeType = normalizedSourceMime(file);
      if (!mimeType) {
        setState("error");
        setMessage(isLegacyPowerPointFile(file) ? copy.legacyPowerPoint(file.name) : copy.unsupported(file.name));
        return;
      }
      if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
        setState("error");
        setMessage(copy.invalidSize(file.name));
        return;
      }
    }

    if (demo) {
      setState("done");
      setMessage(copy.demo);
      return;
    }

    setState("uploading");
    setMessage(copy.uploading(files.length));
    try {
      const supabase = getSupabaseBrowserClient();
      for (const file of files) {
        const mimeType = normalizedSourceMime(file);
        const ticketResponse = await fetch(`/api/cases/${caseId}/sources/upload-url`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ filename: file.name, mimeType, byteSize: file.size }),
        });
        const ticket = (await ticketResponse.json()) as UploadTicket;
        if (!ticketResponse.ok || !ticket.sourceId || !ticket.path || !ticket.token) throw new Error(locale === "zh-Hant" ? copy.prepareFailed(file.name) : ticket.error ?? copy.prepareFailed(file.name));

        try {
          const { error: uploadError } = await supabase.storage
            .from("source-documents")
            .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: mimeType });
          if (uploadError) throw uploadError;
        } catch {
          await releaseSourceUploadReservation(caseId, ticket.sourceId);
          throw new Error(copy.uploadFailed(file.name));
        }

        const registerResponse = await fetch(`/api/cases/${caseId}/sources`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sourceId: ticket.sourceId, storagePath: ticket.path, filename: file.name, mimeType, byteSize: file.size }),
        });
        const registered = (await registerResponse.json()) as { source?: { extractionStatus?: string; errorCode?: string }; error?: string };
        if (!registerResponse.ok || registered.source?.extractionStatus !== "extracted") {
          const errorCode = registered.source && "errorCode" in registered.source ? registered.source.errorCode : undefined;
          throw new Error(locale === "zh-Hant" ? copy.extractionError(file.name, errorCode) : registered.error ?? copy.extractionError(file.name, errorCode));
        }
      }
      setState("done");
      setMessage(copy.updated);
      router.refresh();
    } catch (reason) {
      setState("error");
      setMessage(reason instanceof Error ? reason.message : copy.genericError);
    }
  }

  return (
    <div className="source-uploader">
      <input
        id={inputId}
        className="visually-hidden"
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        multiple
        disabled={state === "uploading" || remaining === 0}
        onChange={upload}
      />
      <label className={remaining === 0 ? "is-disabled" : ""} htmlFor={inputId}>
        <span aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15.5V20h14v-4.5" /></svg>
        </span>
        <strong>{remaining === 0 ? copy.limitReached : copy.addFiles}</strong>
        <small>{copy.helper(remaining)}</small>
      </label>
      {message ? <p className={state === "error" ? "portal-error" : "source-upload-status"} role="status">{message}</p> : null}
    </div>
  );
}
