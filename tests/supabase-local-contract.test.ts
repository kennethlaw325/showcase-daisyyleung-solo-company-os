import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");
const config = readFileSync(resolve(projectRoot, "supabase/config.toml"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8")) as { scripts: Record<string, string>; devDependencies: Record<string, string> };
const workflow = readFileSync(resolve(projectRoot, ".github/workflows/ci.yml"), "utf8");
const databaseTests = readdirSync(resolve(projectRoot, "supabase/tests")).filter((name) => name.endsWith(".sql")).sort();

describe("local Supabase verification contract", () => {
  it("pins the project CLI and keeps the full database gate explicit", () => {
    expect(packageJson.devDependencies.supabase).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.scripts["check:app"]).toContain("npm run build");
    expect(packageJson.scripts["check:db"]).toContain("npm run db:test");
    expect(packageJson.scripts.check).toBe("npm run check:app && npm run check:db");
    expect(workflow).toContain("npx supabase start");
    expect(workflow).toContain("npm run check");
  });

  it("keeps local Auth invite-only and private source Storage bounded", () => {
    expect(config.match(/enable_signup = false/g)).toHaveLength(3);
    expect(config).toContain('site_url = "http://localhost:3000"');
    expect(config).toContain('additional_redirect_urls = ["http://localhost:3000/auth/callback"]');
    expect(config).toContain('[storage.buckets."source-documents"]');
    expect(config).toContain('file_size_limit = "10MiB"');
    expect(config).toContain("application/pdf");
    expect(config).toContain("application/vnd.openxmlformats-officedocument.presentationml.presentation");
  });

  it("retains executable database tests for tenancy, approvals, locale, quota, outcomes, upload authority, and security boundaries", () => {
    expect(databaseTests).toEqual(["001_tenancy_rls.test.sql", "002_approval_reconciliation.test.sql", "003_outcome_quota.test.sql", "004_case_work_packets.test.sql", "004_locale_rls.test.sql", "005_source_upload_authority.test.sql", "006_revision_edit_approval.test.sql", "007_per_user_google_oauth.test.sql", "008_case_deletion.test.sql", "009_module_intake_context.test.sql", "010_security_remediation.test.sql", "011_quota_security_boundary.test.sql", "012_learning_deletion.test.sql", "013_learning_epistemic_layers.test.sql", "014_pilot_consent_contract.test.sql", "015_service_role_runtime_capabilities.test.sql", "016_my_workflow_streams.test.sql", "017_next_phase_capabilities.test.sql", "018_idempotent_intake_kernel.test.sql"]);
    const sql = databaseTests.map((name) => readFileSync(resolve(projectRoot, "supabase/tests", name), "utf8")).join("\n");
    expect(sql).toContain("Tenant A cannot read Tenant B case by id");
    expect(sql).toContain("a repeated claim cannot start a second provider action");
    expect(sql).toContain("the eleventh daily reservation is rejected before a provider call");
    expect(sql).toContain("an outcome without a next action cannot complete the case");
    expect(sql).toContain("ordinary authenticated clients cannot bypass signed upload tickets");
    expect(sql).toContain("a valid packet finalizes atomically");
    expect(sql).toContain("a stale revision is rejected under the case lock");
    expect(sql).toContain("editing an approved draft creates the next immutable revision");
    expect(sql).toContain("a same-workspace user cannot read another user connection");
    expect(sql).toContain("disconnect refuses while the connection has an executing action");
    expect(sql).toContain("a workspace admin can begin deletion");
    expect(sql).toContain("own and cross-case learning applications cascade");
    expect(sql).toContain("cross-workspace members cannot read another workspace case context");
    expect(sql).toContain("legacy browser quota mutations are inaccessible");
    expect(sql).toContain("the reservation owner can complete their own usage");
    expect(sql).toContain("an authorized repeated delete is idempotent");
    expect(sql).toContain("cross-workspace learning deletion is opaque");
    expect(sql).toContain("an exact retry returns the existing application before rate limiting");
    expect(sql).toContain("a reused submission id with changed data fails closed");
    expect(sql).toContain("only authenticated can execute the atomic outcome review RPC");
    expect(sql).toContain("service role preserves learning select/update without insert/delete/truncate");
  });
});
