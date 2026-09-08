import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionPayload } from "../domain/types";
import type { AudienceVariant } from "../domain/types";
import type { Locale } from "../i18n/locale";
import { hashJson } from "../security/hash";

export const generatedCaseSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(20_000),
  body: z.string().trim().min(1).max(100_000),
  next_action: z.string().trim().min(1).max(2_000),
});

export async function loadCase(supabase: SupabaseClient, caseId: string, workspaceId: string) {
  const { data, error } = await supabase.from("cases").select("*").eq("id", caseId).eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw new Error("Case unavailable");
  if (!data) throw Object.assign(new Error("Case not found"), { status: 404 });
  return data as Record<string, unknown> & {
    id: string;
    status: string;
    module: string;
    current_revision: number;
    workspace_id: string;
    title: string;
    brief: string;
    template_version: number;
    intake_context: unknown;
    deletion_request_id: string | null;
    deletion_requested_at: string | null;
    deletion_requested_by: string | null;
  };
}

type CreateArtifactInput = {
  supabase: SupabaseClient;
  workspaceId: string;
  caseId: string;
  userId: string;
  module: "growth" | "operations" | "intelligence";
  templateVersion: number;
  revision: number;
  contentLocale: Locale;
  content: z.infer<typeof generatedCaseSchema>;
};

export function createArtifact(input: CreateArtifactInput): Promise<{ data: unknown; contentHash: string }>;
/** @deprecated Archived source snapshots omit provenance; live routes must pass the exact version. */
export function createArtifact(input: Omit<CreateArtifactInput, "templateVersion">): Promise<{ data: unknown; contentHash: string }>;
export async function createArtifact(input: CreateArtifactInput | Omit<CreateArtifactInput, "templateVersion">) {
  if (!("templateVersion" in input)) throw new Error("Artifact template version required");
  const contentHash = hashJson(input.content);
  const { data, error } = await input.supabase
    .from("case_artifacts")
    .insert({
      workspace_id: input.workspaceId,
      case_id: input.caseId,
      revision: input.revision,
      kind: "synthesis",
      content: input.content,
      content_hash: contentHash,
      template_key: input.module,
      template_version: input.templateVersion,
      content_locale: input.contentLocale,
      created_by: input.userId,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error("Artifact unavailable");
  return { data, contentHash };
}

export async function createAction(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  caseId: string;
  userId: string;
  revision: number;
  payload: ActionPayload;
  idempotencyKey?: string;
}) {
  const payloadHash = hashJson(input.payload);
  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
  const { data, error } = await input.supabase
    .from("case_actions")
    .insert({
      workspace_id: input.workspaceId,
      case_id: input.caseId,
      artifact_revision: input.revision,
      action_type: "gmail.create_draft",
      payload: input.payload,
      payload_hash: payloadHash,
      idempotency_key: idempotencyKey,
      created_by: input.userId,
    })
    .select("*")
    .single();
  if (error || !data) {
    if (error?.code === "23505") throw Object.assign(new Error("Duplicate idempotency key"), { status: 409 });
    throw new Error("Action unavailable");
  }
  return { data, payloadHash, idempotencyKey };
}

export async function createAudienceVariantRecords(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  caseId: string;
  userId: string;
  variants: readonly AudienceVariant[];
}) {
  if (!input.variants.length) return [];
  const { error } = await input.supabase
    .from("case_audience_variants")
    .upsert(
      input.variants.map((variant) => ({
        workspace_id: input.workspaceId,
        case_id: input.caseId,
        artifact_revision: variant.core_revision,
        preset: variant.preset,
        audience_profile: variant.audience,
        title: variant.title,
        summary: variant.summary,
        body: variant.body,
        core_hash: variant.core_hash,
        stale: variant.stale,
        created_by: input.userId,
      })),
      { onConflict: "case_id,artifact_revision,preset", ignoreDuplicates: true },
    );
  if (error) throw new Error("Audience variants unavailable");
  const first = input.variants[0];
  const { data, error: loadError } = await input.supabase
    .from("case_audience_variants")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("case_id", input.caseId)
    .eq("artifact_revision", first.core_revision)
    .order("created_at", { ascending: true });
  if (loadError) throw new Error("Audience variants unavailable");
  return data ?? [];
}
