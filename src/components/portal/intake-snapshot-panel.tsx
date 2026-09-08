import Link from "next/link";
import { formatHongKongDateTime, isValidDateTime } from "@/src/lib/i18n/hong-kong-time";

export function IntakeSnapshotPanel({ snapshot, locale = "en", caseId, caseTitle, createdAt, headingId = "original-intake-title", focused = false }: { snapshot: { payload: Record<string, unknown>; snapshot_status: "exact" | "partial_legacy"; semantic_payload_hash?: string | null }; locale?: "en" | "zh-Hant"; caseId?: string; caseTitle?: string; createdAt?: string | null; headingId?: string; focused?: boolean }) {
  const zh = locale === "zh-Hant";
  const title = caseTitle || (typeof snapshot.payload.title === "string" && snapshot.payload.title.trim() ? snapshot.payload.title : (zh ? "未命名工作" : "Untitled case"));
  const statusLabel = snapshot.snapshot_status === "exact" ? (zh ? "完整快照" : "Exact snapshot") : (zh ? "舊資料重建" : "Legacy reconstruction");
  const readableCreatedAt = formatHongKongDateTime(createdAt, locale);
  const validCreatedAt = Boolean(readableCreatedAt && isValidDateTime(createdAt));
  return <section className={`portal-panel intake-snapshot-panel${focused ? " is-focused" : ""}`} aria-labelledby={headingId}>
    <div className="intake-snapshot-content">
      <div className="artifact-heading"><div><p className="portal-kicker">{zh ? "原始輸入" : "Original intake"}</p><h2 id={headingId}>{title}</h2><span className="snapshot-status-chip" aria-label={statusLabel}>{statusLabel}</span></div><span className="version-chip" aria-hidden="true">{snapshot.snapshot_status === "exact" ? "✓" : "~"}</span></div>
      {focused ? <p className="intake-focused-note">{zh ? "這是你剛才建立的個案輸入。" : "This is the intake for the case you just created."}</p> : null}
      <p>{snapshot.snapshot_status === "exact" ? (zh ? "這份資料在建立個案時固定保存，之後不會被修改。" : "Captured at case creation and immutable thereafter.") : (zh ? "部分欄位只來自現有個案資料；缺失的受眾及學習選擇沒有被補造。" : "Derived only from persisted case fields; missing audience and learning selections were not fabricated.")}</p>
      {validCreatedAt ? <time dateTime={new Date(createdAt as string).toISOString()}>{readableCreatedAt}</time> : null}
    </div>
    {caseId ? <Link className="portal-secondary-button case-open-button" href={`/app/cases/${caseId}`}>{zh ? "開啟個案" : "Open case"}</Link> : null}
  </section>;
}
