import { IntakeSnapshotPanel } from "@/src/components/portal/intake-snapshot-panel";
import type { IntakeSnapshotListItem } from "@/src/lib/server/intake-snapshots";

export function IntakeHistory({ snapshots, locale = "en", focusedCaseId }: { snapshots: IntakeSnapshotListItem[]; locale?: "en" | "zh-Hant"; focusedCaseId?: string }) {
  const zh = locale === "zh-Hant";
  if (!snapshots.length) {
    return <section className="portal-panel intake-history-empty"><strong>{zh ? "還未有初始輸入。" : "No initial inputs yet."}</strong><p>{zh ? "建立第一個個案後，這裡會列出不可修改的輸入快照。" : "After you create a case, its immutable initial input snapshot will appear here."}</p></section>;
  }
  const ordered = focusedCaseId
    ? [...snapshots].sort((left, right) => Number(right.caseId === focusedCaseId) - Number(left.caseId === focusedCaseId))
    : snapshots;
  return <section className="intake-history" aria-label={zh ? "初始輸入歷史" : "Initial input history"}>
    {ordered.map((snapshot) => <IntakeSnapshotPanel key={`${snapshot.caseId}-${snapshot.id ?? "legacy"}`} snapshot={snapshot} locale={locale} caseId={snapshot.caseId} caseTitle={snapshot.caseTitle} createdAt={snapshot.created_at} headingId={`initial-intake-${snapshot.caseId}`} focused={snapshot.caseId === focusedCaseId} />)}
  </section>;
}
