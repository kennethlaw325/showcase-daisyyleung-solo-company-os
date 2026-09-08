import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { approvalError } from "../src/lib/server/approval-errors";
import { errorResponse } from "../src/lib/server/route-utils";

const approvalsPage = fs.readFileSync(path.join(process.cwd(), "app/app/approvals/page.tsx"), "utf8");

describe("approval error contract", () => {
  it("classifies approved conflict and authorization errors without exposing database failures", async () => {
    const conflict = errorResponse(approvalError({ message: "stale artifact" }));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "stale artifact" });

    const forbidden = errorResponse(approvalError({ message: "not authorized" }));
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "not authorized" });

    const postgresMessage = "duplicate key constraint private_case_approvals";
    const internal = errorResponse(approvalError({ message: postgresMessage }));
    expect(internal.status).toBe(500);
    const body = await internal.json();
    expect(body).toEqual({ error: "Internal server error" });
    expect(JSON.stringify(body)).not.toContain(postgresMessage);
  });
});

describe("approval blocker guidance", () => {
  it("shows the case name and a plain numbered approval checklist", () => {
    expect(approvalsPage).toContain("「{caseRecord.title}」還差 4 項資料，先可以審批。");
    expect(approvalsPage).toContain('<ol className="required-action-data">');
    expect(approvalsPage).toContain("收件人：");
    expect(approvalsPage).toContain("主旨：");
    expect(approvalsPage).toContain("內文：");
    expect(approvalsPage).toContain("批准：");
    expect(approvalsPage).toContain("這次審批的內容：");
    expect(approvalsPage).toContain("批准後只會在 Gmail 建立草稿，不會自動寄出。");
    expect(approvalsPage).not.toContain("{caseRecord.brief.slice(0, 160)}");
    expect(approvalsPage).toContain("去「{caseRecord.title}」補完資料 →");
    expect(approvalsPage).not.toContain("Gmail draft payload");
    expect(approvalsPage).not.toContain("在工作內加入已核實收件人、主旨及完整草稿，然後再審批。");
  });

  it("renders every pending case as its own full approval or blocker card", () => {
    expect(approvalsPage).toContain("items.map(({ caseRecord, artifact, action })");
    expect(approvalsPage).toContain("key={caseRecord.id}");
    expect(approvalsPage).not.toContain("approvals[0] && firstAction");
    expect(approvalsPage).not.toContain("approvals.slice(1)");
  });

  it("explains the edit-to-new-draft approval path", () => {
    const editor = fs.readFileSync(path.join(process.cwd(), "src/components/portal/action-draft-editor.tsx"), "utf8");
    const panel = fs.readFileSync(path.join(process.cwd(), "src/components/portal/approval-panel.tsx"), "utf8");
    const artifactPanel = fs.readFileSync(path.join(process.cwd(), "src/components/portal/artifact-approval-panel.tsx"), "utf8");
    const artifactEditor = fs.readFileSync(path.join(process.cwd(), "src/components/portal/artifact-revision-editor.tsx"), "utf8");
    const styles = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    const approvalRoute = fs.readFileSync(path.join(process.cwd(), "app/api/cases/[id]/approval/route.ts"), "utf8");
    const revisionRoute = fs.readFileSync(path.join(process.cwd(), "app/api/cases/[id]/revision/route.ts"), "utf8");
    const casesServer = fs.readFileSync(path.join(process.cwd(), "src/lib/server/cases.ts"), "utf8");
    const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202608150002_revision_edit_approval_hardening.sql"), "utf8");
    expect(editor).toContain("expectedRevision");
    expect(editor).toContain("copy.submit");
    expect(fs.readFileSync(path.join(process.cwd(), "src/lib/i18n/portal-copy.ts"), "utf8")).toContain("Save as a new draft");
    expect(migration).toContain("create_case_revision");
    expect(migration).toContain("for update");
    expect(migration).toContain("no changes to save");
    expect(editor).toContain("thread_id");
    expect(editor).toContain("cc");
    expect(editor).toContain("bcc");
    expect(panel).toContain("copy.cc");
    expect(panel).toContain("copy.bcc");
    expect(panel).toContain("copy.thread");
    expect(panel).toContain("artifactTitle || copy.outreach");
    expect(panel).toContain('className="portal-secondary-button"');
    expect(artifactPanel).toContain('className="portal-secondary-button"');
    expect(artifactEditor).toContain('className="portal-secondary-button artifact-edit-button"');
    expect(panel).toContain("copy.editApproved");
    expect(artifactPanel).toContain("copy.editApproved");
    expect(panel).not.toContain("copy.editAndReapprove");
    expect(artifactPanel).not.toContain("copy.editAndReapprove");
    expect(panel).toContain("router.refresh()");
    expect(panel).toContain('className={`case-status status-${statusKey}`}');
    expect(artifactPanel).toContain('className={`case-status status-${statusKey}`}');
    expect(panel).not.toContain('className="case-status status-awaiting_approval"');
    expect(artifactPanel).not.toContain('className="case-status status-awaiting_approval"');
    expect(editor).toContain('className="action-draft-proof"');
    expect(styles).toMatch(/\.action-draft-proof\s*\{\s*white-space:\s*nowrap;/);
    expect(styles).toMatch(/\.portal-primary-button,\s*\.portal-secondary-button\s*\{\s*font-size:\s*0\.875rem;/);
    const copy = fs.readFileSync(path.join(process.cwd(), "src/lib/i18n/portal-copy.ts"), "utf8");
    expect(copy).toContain('editApproved: "修改已審批內容"');
    expect(copy).toContain('editApproved: "Edit approved content"');
    expect(fs.readFileSync(path.join(process.cwd(), "src/lib/i18n/portal-copy.ts"), "utf8")).toContain("確認內容與審批時一致");
    expect(styles).toContain(".payload-proof > small { grid-column: 1 / -1;");
    expect(styles).toContain(".artifact-heading .artifact-edit-button");
    expect(approvalRoute).not.toContain("audit_events");
    expect(approvalRoute).not.toContain("createSupabaseAdminClient");
    expect(revisionRoute).toContain("recoverIntelligenceVariants");
    expect(revisionRoute).toContain('"stale case revision"');
    expect(casesServer).toContain(".upsert(");
    expect(casesServer).toContain("case_id,artifact_revision,preset");
  });
});
