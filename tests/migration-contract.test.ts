import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(import.meta.dirname, "../supabase/migrations");
const migrationSources = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(resolve(migrationsDirectory, name), "utf8"));

function readDollarTag(sql: string, offset: number) {
  return sql.slice(offset).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0] ?? null;
}

function stripCommentsAndSplitStatements(sql: string) {
  const statements: string[] = [];
  const dollarTags: string[] = [];
  let statement = "";
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < sql.length;) {
    const character = sql[index];
    const nextCharacter = sql[index + 1];

    if (quote) {
      statement += character;
      index += 1;
      if (character !== quote) continue;
      if (sql[index] === quote) {
        statement += sql[index];
        index += 1;
      } else {
        quote = null;
      }
      continue;
    }

    if (character === "-" && nextCharacter === "-") {
      index += 2;
      while (index < sql.length && sql[index] !== "\n") index += 1;
      statement += "\n";
      index += Number(sql[index] === "\n");
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      let depth = 1;
      index += 2;
      while (index < sql.length && depth > 0) {
        if (sql[index] === "/" && sql[index + 1] === "*") {
          depth += 1;
          index += 2;
        } else if (sql[index] === "*" && sql[index + 1] === "/") {
          depth -= 1;
          index += 2;
        } else {
          statement += sql[index] === "\n" ? "\n" : "";
          index += 1;
        }
      }
      statement += " ";
      continue;
    }

    const dollarTag = character === "$" ? readDollarTag(sql, index) : null;
    if (dollarTag) {
      const currentDollarTag = dollarTags.at(-1);
      if (currentDollarTag === dollarTag) {
        dollarTags.pop();
      } else {
        dollarTags.push(dollarTag);
      }
      statement += dollarTag;
      index += dollarTag.length;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      statement += character;
      index += 1;
      continue;
    }

    if (character === ";" && dollarTags.length === 0) {
      if (statement.trim()) statements.push(statement.trim());
      statement = "";
      index += 1;
      continue;
    }

    statement += character;
    index += 1;
  }

  if (statement.trim()) statements.push(statement.trim());
  return statements;
}

function normalizeSqlIdentifier(value: string) {
  return value.trim().replace(/^group\s+/i, "").replace(/^"(.*)"$/, "$1").toLowerCase();
}

function normalizeFunctionSignature(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*([(),.])\s*/g, "$1")
    .toLowerCase();
}

function splitTopLevelList(value: string) {
  const parts: string[] = [];
  let part = "";
  let parenthesisDepth = 0;

  for (const character of value) {
    if (character === "(") parenthesisDepth += 1;
    if (character === ")") parenthesisDepth -= 1;
    if (character === "," && parenthesisDepth === 0) {
      parts.push(part.trim());
      part = "";
    } else {
      part += character;
    }
  }

  if (part.trim()) parts.push(part.trim());
  return parts;
}

type FunctionGrantState = Map<string, Map<string, boolean>>;

function foldFunctionGrantState(statements: string[]) {
  const state: FunctionGrantState = new Map();
  const privilegeStatement = /^(grant|revoke)\s+(?:all(?:\s+privileges)?|execute)\s+on\s+function\s+(.+?)\s+(?:to|from)\s+(.+)$/is;
  const schemaPrivilegeStatement = /^(grant|revoke)\s+(?:all(?:\s+privileges)?|execute)\s+on\s+all\s+functions\s+in\s+schema\s+(.+?)\s+(?:to|from)\s+(.+)$/is;
  const dropFunctionStatement = /^drop\s+function\s+(?:if\s+exists\s+)?(.+)$/is;

  for (const statement of statements) {
    const dropMatch = statement.match(dropFunctionStatement);
    if (dropMatch) {
      for (const rawSignature of splitTopLevelList(dropMatch[1])) {
        state.delete(normalizeFunctionSignature(rawSignature));
      }
      continue;
    }

    const schemaMatch = statement.match(schemaPrivilegeStatement);
    if (schemaMatch) {
      const granted = schemaMatch[1].toLowerCase() === "grant";
      const schemas = splitTopLevelList(schemaMatch[2]).map(normalizeSqlIdentifier);
      const roles = splitTopLevelList(schemaMatch[3].replace(/\s+with\s+grant\s+option\s*$/i, ""));
      for (const [signature, roleState] of state) {
        if (!schemas.some((schema) => signature.startsWith(`${schema}.`))) continue;
        for (const rawRole of roles) {
          roleState.set(normalizeSqlIdentifier(rawRole), granted);
        }
      }
      continue;
    }

    const match = statement.match(privilegeStatement);
    if (!match) continue;
    const granted = match[1].toLowerCase() === "grant";
    const signatures = splitTopLevelList(match[2]);
    const roles = splitTopLevelList(match[3].replace(/\s+with\s+grant\s+option\s*$/i, ""));

    for (const rawSignature of signatures) {
      const signature = normalizeFunctionSignature(rawSignature);
      const roleState = state.get(signature) ?? new Map<string, boolean>();
      for (const rawRole of roles) {
        roleState.set(normalizeSqlIdentifier(rawRole), granted);
      }
      state.set(signature, roleState);
    }
  }

  return state;
}

const migrationStatements = migrationSources.flatMap(stripCommentsAndSplitStatements);
const migration = migrationStatements.join("\n");
const functionGrantState = foldFunctionGrantState(migrationStatements);
const droppedFunctionSignatures = new Set(
  migrationStatements.flatMap((statement) => {
    const match = statement.match(/^drop\s+function\s+(?:if\s+exists\s+)?(.+)$/is);
    return match ? splitTopLevelList(match[1]).map(normalizeFunctionSignature) : [];
  }),
);

function expectStatementToMatch(pattern: RegExp) {
  expect(migrationStatements.some((statement) => pattern.test(statement)), `Expected one SQL statement to match ${pattern}`).toBe(true);
}

function expectFunctionPrivilege(
  signature: string,
  role: string,
  granted: boolean,
  state = functionGrantState,
) {
  const roleState = state.get(normalizeFunctionSignature(signature));
  const normalizedRole = normalizeSqlIdentifier(role);
  const directState = roleState?.get(normalizedRole);
  const publicState = roleState?.get("public");
  const effectiveState = normalizedRole === "public"
    ? directState
    : directState === true || publicState === true
      ? true
      : directState === false && publicState === false
        ? false
        : undefined;

  expect(effectiveState).toBe(granted);
}

describe("database security contract", () => {
  it("keeps lifecycle tables read-only to browser roles", () => {
    expect(migration).not.toMatch(/create policy .* on public\.(cases|case_artifacts|case_actions|case_approvals|case_outcomes|usage_events) for all/i);
    for (const table of ["cases", "case_artifacts", "case_actions", "case_approvals", "case_outcomes", "usage_events"]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it("binds child rows to the same workspace as their case", () => {
    for (const constraint of ["artifacts_workspace_case_fk", "variants_workspace_case_fk", "actions_workspace_case_fk", "approvals_workspace_case_fk", "actions_workspace_artifact_revision_fk", "approvals_workspace_artifact_revision_fk", "outcomes_workspace_case_fk", "sources_workspace_case_fk", "executions_workspace_case_fk"]) {
      expect(migration).toContain(`constraint ${constraint}`);
    }
  });

  it("keeps Vault plaintext service-role only", () => {
    const currentReadSignature = "public.read_oauth_connection_secret(uuid, uuid, uuid)";
    for (const role of ["public", "anon", "authenticated"]) {
      expectFunctionPrivilege(currentReadSignature, role, false);
    }
    expectFunctionPrivilege(currentReadSignature, "service_role", true);

    for (const signature of [
      "public.revoke_case_approvals(uuid, integer)",
      "public.store_oauth_secret(uuid, text, text)",
      "public.read_oauth_secret(uuid, uuid)",
      "public.update_oauth_secret(uuid, uuid, text)",
      "public.delete_oauth_secret(uuid, uuid)",
    ]) {
      for (const role of ["public", "anon", "authenticated", "service_role"]) {
        expectFunctionPrivilege(signature, role, false);
      }
    }
    for (const signature of [
      "public.revoke_case_approvals(uuid, integer)",
      "public.store_oauth_secret(uuid, text, text)",
      "public.read_oauth_secret(uuid, uuid)",
      "public.update_oauth_secret(uuid, uuid, text)",
      "public.delete_oauth_secret(uuid, uuid)",
      "public.consume_workspace_quota(uuid, integer)",
    ]) {
      expect(droppedFunctionSignatures.has(normalizeFunctionSignature(signature))).toBe(false);
    }
  });

  it("serializes quota and Gmail action claims", () => {
    expectStatementToMatch(/reserve_workspace_ai_quota.*returns bigint/is);
    expectStatementToMatch(/reserve_workspace_ai_quota.*pg_advisory_xact_lock/is);
    expectStatementToMatch(/reserve_workspace_ai_quota.*p_actor_id uuid.*workspace_members/is);
    expectStatementToMatch(/reserve_workspace_ai_quota.*normalized_provider.*gemini.*openai/is);
    expectStatementToMatch(/alter table public\.usage_events.*alter column provider drop default/is);
    expectStatementToMatch(/insert into public\.usage_events\(workspace_id, user_id, units, provider, model.*normalized_provider/is);
    expectStatementToMatch(/complete_workspace_usage.*reservation_owner is distinct from p_actor_id/is);
    expectStatementToMatch(/touch_updated_at.*set search_path = public/is);
    expectStatementToMatch(/storage_source_object_is_valid.*set search_path = public/is);
    expectStatementToMatch(/reject_audit_mutation.*set search_path = public/is);
    expectStatementToMatch(/^revoke all on function public\.consume_workspace_quota\(uuid,\s*integer\)\s+from public, anon, authenticated, service_role$/i);
    expectStatementToMatch(/revoke all privileges on table public\.platform_admins, public\.public_rate_limits, public\.workspace_ai_quota_overrides.*from public, anon, authenticated/is);
    expectStatementToMatch(/claim_case_action.*for update/is);
    expect(migration).toMatch(/set status = 'executing'/i);

    expectFunctionPrivilege("public.reserve_workspace_ai_quota(uuid, uuid, text, text, numeric, integer)", "service_role", true);
    expectFunctionPrivilege("public.complete_workspace_usage(bigint, uuid, integer, integer, integer, numeric)", "service_role", true);
    for (const signature of [
      "public.reserve_workspace_ai_quota(uuid, text, numeric, integer)",
      "public.reserve_workspace_ai_quota(uuid, uuid, text, numeric, integer)",
      "public.complete_workspace_usage(bigint, integer, integer, integer, numeric)",
    ]) {
      for (const role of ["public", "anon", "authenticated", "service_role"]) {
        expectFunctionPrivilege(signature, role, false);
      }
    }
    for (const signature of [
      "public.create_profile_for_auth_user()",
      "public.invalidate_approvals_on_new_artifact()",
    ]) {
      for (const role of ["public", "anon", "authenticated"]) {
        expectFunctionPrivilege(signature, role, false);
      }
    }
    expectFunctionPrivilege("public.is_workspace_member(uuid)", "public", false);
    expectFunctionPrivilege("public.is_workspace_member(uuid)", "anon", false);
    expectFunctionPrivilege("public.is_workspace_member(uuid)", "authenticated", true);
  });

  it("binds Gmail provider reconciliation to a durable execution attempt and exact approval", () => {
    expect(migration).toContain("execution_attempt_id uuid");
    expect(migration).toContain("execution_approval_id uuid references public.case_approvals(id)");
    expect(migration).toContain("provider_message_id text");
    expectStatementToMatch(/claim_case_action_attempt.*for update/is);
    expectStatementToMatch(/claim_case_action_attempt.*execution_approval_id = approval_id/is);
    expectStatementToMatch(/mark_case_action_executed_attempt.*execution_attempt_id is distinct from p_execution_attempt_id/is);
    expectStatementToMatch(/record_case_action_reconciliation_check.*reconciliation_checked_at = now\(\)/is);
    expectFunctionPrivilege("public.claim_case_action(uuid, text)", "authenticated", false);
  });

  it("uses explicit least-privilege Data API grants instead of auto-exposure", () => {
    expect(migration).toMatch(/revoke all privileges on all tables in schema public from anon, authenticated/i);
    expect(migration).toMatch(/revoke insert on table public\.pilot_applications from anon, authenticated/i);
    expect(migration).toMatch(/create policy pilot_anon_insert on public\.pilot_applications/i);
    expectStatementToMatch(/submit_pilot_application.*consume_public_rate_limit.*status\)/is);
    expectStatementToMatch(/grant select on table.*public\.cases.*public\.audit_events.*to authenticated/is);
    expect(migration).toMatch(/grant update \(display_name, locale\) on table public\.profiles to authenticated/i);
    expectFunctionPrivilege(
      "public.submit_pilot_application(text, text, text, text, text, text, text, text, uuid, boolean, text, text)",
      "service_role",
      true,
    );
    for (const role of ["public", "anon", "authenticated", "service_role"]) {
      expectFunctionPrivilege(
        "public.submit_pilot_application(text, text, text, text, text, text, text, text)",
        role,
        false,
      );
    }
  });

  it("serializes pilot consent idempotency by submission UUID", () => {
    expectStatementToMatch(/submit_pilot_application.*pg_catalog\.pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(p_submission_id::text, 0\)\)/is);
  });

  it("keeps work-packet finalization server-only with complete immutable learning snapshots", () => {
    expect(migration).toContain("create table public.case_stage_outputs");
    expect(migration).toContain("create table public.case_learning_applications");
    expect(migration).toContain("evidence_snapshot text");
    expect(migration).toContain("other_angles_snapshot text");
    const signature = "public.finalize_case_work_packet(uuid, uuid, integer, uuid, jsonb, text, jsonb, jsonb, uuid[], jsonb)";
    for (const role of ["public", "anon", "authenticated"]) {
      expectFunctionPrivilege(signature, role, false);
    }
    expectFunctionPrivilege(signature, "service_role", true);
  });

  it("keeps packet lineage and epistemic learning layers additive and tenant-bound", () => {
    expect(migration).toContain("work_packet_source_artifact_id uuid");
    expect(migration).toContain("artifacts_workspace_case_lineage_fk");
    expect(migration).toContain("case_artifacts_work_packet_lineage_immutable");
    expectStatementToMatch(/candidate\.revision <= artifact\.revision.*stage_key = 'evidence'.*stage_key = 'plan'.*set work_packet_source_artifact_id = packet_sources\.packet_source_artifact_id/is);
    expectStatementToMatch(/learning_records.*applicability text.*supporting_outcome_count integer.*learning_confidence text.*validation_status text/is);
    expect(migration).toContain("supporting_outcome_count_snapshot");
    expect(migration).toContain("learning_confidence_snapshot");
    expect(migration).toContain("validation_status_snapshot");
    expectStatementToMatch(/p_learning_disposition <> 'discard'.*learning_confidence, validation_status/is);
    expectStatementToMatch(/work_packet_source_artifact_id,.*artifact_id,.*p_content/is);
    expect(migration).toMatch(/packet_source_artifact_id := previous_artifact\.work_packet_source_artifact_id/i);
  });

  it("strictly binds editable payload keys and records approval audits in the locked RPCs", () => {
    expectStatementToMatch(/create_case_revision.*jsonb_object_keys\(p_content\)/is);
    expect(migration).toMatch(/action_key not in \('to', 'cc', 'bcc', 'subject', 'body', 'thread_id'\)/i);
    expect(migration).toMatch(/jsonb_array_elements_text\(action_payload->'cc'\)/i);
    expect(migration).toMatch(/jsonb_array_elements_text\(action_payload->'bcc'\)/i);
    expectStatementToMatch(/approve_case_action.*audit_events.*artifact_approved/is);
    expectStatementToMatch(/approve_case_artifact.*audit_events.*artifact_approved/is);
  });

  it("keeps Google OAuth per-user, Vault-backed, and service-role lifecycle controlled", () => {
    expect(migration).toContain("owner_user_id uuid");
    expect(migration).toContain("provider_account_email text");
    expect(migration).toContain("mailbox_email text");
    expect(migration).toContain("oauth_connection_status as enum ('active', 'reauthorization_required', 'disconnecting')");
    expectStatementToMatch(/oauth_owner_member_select.*owner_user_id = auth\.uid\(\)/is);
    expectStatementToMatch(/connect_google_oauth.*vault\.create_secret.*vault\.update_secret/is);
    expectStatementToMatch(/read_oauth_connection_secret.*decrypted_secrets/is);
    expectStatementToMatch(/begin_oauth_connection_refresh.*for update.*refresh_lease_token/is);
    expectStatementToMatch(/finish_oauth_disconnect.*delete from vault\.secrets/is);
    expectStatementToMatch(/claim_case_action_attempt\(.*p_connection_id uuid/is);
    expect(migration).toContain("execution_actor_id uuid");
    expect(migration).toContain("execution_connection_version integer");
    expect(migration).toContain("execution_connection_email text");
    expectStatementToMatch(/mark_case_action_executed_attempt.*revoked_at is null/is);
    expectStatementToMatch(/raise exception 'oauth connection owner conflict: % duplicate owner groups'/is);
    expectStatementToMatch(/create unique index if not exists oauth_connections_workspace_owner_unique/is);
    expectStatementToMatch(/connect_google_oauth.*connection has executing action/is);
    expectStatementToMatch(/claim_case_action_attempt\(.*p_actor_id uuid.*workspace_members/is);

    const connectSignature = "public.connect_google_oauth(uuid, uuid, text, text, text, boolean, text[], text)";
    for (const role of ["public", "anon", "authenticated"]) {
      expectFunctionPrivilege(connectSignature, role, false);
    }
    expectFunctionPrivilege(connectSignature, "service_role", true);

    for (const signature of [
      "public.claim_case_action_attempt(uuid, text, text, uuid)",
      "public.claim_case_action(uuid, text)",
      "public.mark_case_action_executed(uuid, text)",
    ]) {
      for (const role of ["public", "anon", "authenticated", "service_role"]) {
        expectFunctionPrivilege(signature, role, false);
      }
    }
    for (const signature of [
      "public.claim_case_action_attempt(uuid, text, text, uuid, uuid)",
      "public.mark_case_action_executed_attempt(uuid, uuid, text, text, uuid, boolean)",
      "public.record_case_action_reconciliation_check(uuid, uuid, uuid)",
    ]) {
      expectFunctionPrivilege(signature, "service_role", true);
    }
  });

  it("keeps case deletion two-phase, tenant-bound, and retryable", () => {
    expect(migration).toContain("deletion_request_id uuid");
    expect(migration).toContain("cases_deletion_fields_consistent");
    expectStatementToMatch(/begin_case_deletion.*from public\.cases.*for update/is);
    expectStatementToMatch(/begin_case_deletion.*case_actions.*status = 'executing'/is);
    expectStatementToMatch(/begin_case_deletion.*execution_runs.*status = 'started'/is);
    expect(migration).toMatch(/created_at >= now\(\) - interval '10 minutes'/i);
    expectStatementToMatch(/start_case_execution_run.*for update/is);
    expectStatementToMatch(/finalize_case_deletion.*case\.deleted/is);
    expectStatementToMatch(/reject_case_work_packet_mutation.*tg_op = 'UPDATE'.*return old/is);
    expectStatementToMatch(/applications_workspace_learning_fk.*on delete cascade/is);
    expectStatementToMatch(/applications_workspace_source_outcome_fk.*on delete cascade/is);

    const signature = "public.begin_case_deletion(uuid, uuid, uuid, text, uuid)";
    for (const role of ["public", "anon", "authenticated"]) {
      expectFunctionPrivilege(signature, role, false);
    }
    expectFunctionPrivilege(signature, "service_role", true);
  });

  it("keeps structured intake bounded, module-authoritative, and immutable", () => {
    expect(migration).toContain("intake_context jsonb not null default '{}'::jsonb");
    expectStatementToMatch(/cases_intake_context_valid.*jsonb_typeof\(intake_context\) = 'object'/is);
    expectStatementToMatch(/cases_intake_context_valid.*octet_length\(intake_context::text\) <= 200000/is);
    expectStatementToMatch(/cases_intake_context_valid.*not \(intake_context \? 'module'\)/is);
    expectStatementToMatch(/cases_intake_context_valid.*not public\.jsonb_has_key_recursive\(intake_context, 'module'\)/is);
    expectStatementToMatch(/reject_case_intake_context_mutation.*case intake context is immutable/is);
    expectStatementToMatch(/reject_case_intake_context_mutation.*case template provenance is immutable/is);
    expect(migration).toContain("cases_intake_context_immutable");
  });

  it("exposes only the release-candidate service-role table capabilities", () => {
    for (const [table, privileges] of [
      ["platform_admins", "select"],
      ["pilot_applications", "select, update"],
      ["workspaces", "select, insert"],
      ["invitations", "select, insert, update"],
      ["profiles", "select, update"],
      ["audit_events", "insert"],
      ["cases", "select, insert"],
      ["source_items", "select, insert, update"],
      ["execution_runs", "select, insert, update"],
      ["case_audience_variants", "select, insert, update"],
      ["learning_records", "select, update"],
    ] as const) {
      expect(migration).toMatch(new RegExp(`grant\\s+${privileges}\\s+on\\s+table\\s+public\\.${table}\\s+to\\s+service_role`, "i"));
      expect(migration).not.toMatch(new RegExp(`grant\\s+(?:[^;]*,\\s*)?(?:delete|truncate)(?:\\s*,[^;]*)?\\s+on\\s+table\\s+public\\.${table}\\s+to\\s+service_role`, "i"));
    }
    expectFunctionPrivilege(
      "public.record_case_outcome_review(uuid, text, text, text, text, text, text, text, text, text, text, date, public.learning_disposition, text, text, boolean)",
      "authenticated",
      true,
    );
    for (const role of ["public", "anon", "service_role"]) {
      expectFunctionPrivilege(
        "public.record_case_outcome_review(uuid, text, text, text, text, text, text, text, text, text, text, date, public.learning_disposition, text, text, boolean)",
        role,
        false,
      );
    }
    expectFunctionPrivilege(
      "public.record_case_outcome(uuid, text, text, text, text, text, text, text, text, text, text, date, public.learning_disposition, text)",
      "authenticated",
      true,
    );
    for (const role of ["public", "anon", "service_role"]) {
      expectFunctionPrivilege(
        "public.record_case_outcome(uuid, text, text, text, text, text, text, text, text, text, text, date, public.learning_disposition, text)",
        role,
        false,
      );
    }
    expectStatementToMatch(/record_case_outcome_review\(.*p_case_id uuid.*p_learning_applicability text.*p_approve_adapted_learning boolean/is);
    expectStatementToMatch(/record_case_outcome_review.*for update.*outcome_pending/is);
    expectStatementToMatch(/record_case_outcome_review.*audit_events.*status = 'completed'/is);
    expectStatementToMatch(/record_case_outcome\(.*p_learning_disposition public\.learning_disposition.*legacy outcome adaptation requires upgraded client.*record_case_outcome_review/is);
  });

  it("fails the revoke contract when a later migration re-grants execute", () => {
    const signature = "public.connect_google_oauth(uuid, uuid, text, text, text, boolean, text[], text)";
    for (const regrant of [
      `grant execute on function ${signature} to authenticated;`,
      `grant execute on function ${signature} to public;`,
      `grant all privileges on function ${signature} to authenticated;`,
      `grant execute on function ${signature} to authenticated with grant option;`,
      `grant execute on function ${signature} to group authenticated;`,
      "grant execute on all functions in schema public to authenticated;",
    ]) {
      const tamperedState = foldFunctionGrantState([
        ...migrationStatements,
        ...stripCommentsAndSplitStatements(regrant),
      ]);

      expect(() => expectFunctionPrivilege(signature, "authenticated", false, tamperedState)).toThrow();
    }
  });
});
