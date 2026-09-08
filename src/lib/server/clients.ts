import type { SupabaseClient } from "@supabase/supabase-js";

export const CLIENT_SELECT = "id,workspace_id,name,company,status,notes,contact_metadata,created_by,updated_by,created_at,updated_at";
export const CLIENT_CASE_SELECT = "id,title,module,status,client_id,updated_at,workflow_stream_id";

export async function listClients(supabase: SupabaseClient, workspaceId: string, includeArchived = false) {
  let query = supabase.from("clients").select(CLIENT_SELECT).eq("workspace_id", workspaceId).order("updated_at", { ascending: false });
  if (!includeArchived) query = query.eq("status", "active");
  const { data, error } = await query;
  if (error) throw new Error("Clients unavailable");
  return data ?? [];
}

/**
 * Lists the case-directory fields only, scoped to the verified workspace.
 * Client grouping and filtering stay in the portal UI; no tenant data is
 * inferred from a client-supplied workspace identifier.
 */
export async function listClientCases(supabase: SupabaseClient, workspaceId: string) {
  const { data, error } = await supabase
    .from("cases")
    .select(CLIENT_CASE_SELECT)
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error("Cases unavailable");
  const cases = data ?? [];
  const workflowStreamIds = [...new Set(cases.map((item) => item.workflow_stream_id).filter((id): id is string => Boolean(id)))];
  if (!workflowStreamIds.length) return cases.map((item) => ({ ...item, workflow_stream_name: null, workflow_stream_group_id: null }));

  const { data: workflowStreams, error: workflowError } = await supabase
    .from("workflow_streams")
    .select("id,group_id,name")
    .eq("workspace_id", workspaceId)
    .in("id", workflowStreamIds);
  if (workflowError) throw new Error("Case categories unavailable");
  const workflowsById = new Map((workflowStreams ?? []).map((stream) => [stream.id, stream]));
  return cases.map((item) => {
    const workflow = item.workflow_stream_id ? workflowsById.get(item.workflow_stream_id) : null;
    return { ...item, workflow_stream_name: workflow?.name ?? null, workflow_stream_group_id: workflow?.group_id ?? null };
  });
}

export async function loadClientSnapshot(input: { supabase: SupabaseClient; workspaceId: string; clientId: string }) {
  const [{ data: client, error: clientError }, { data: cases, error: caseError }] = await Promise.all([
    input.supabase.from("clients").select(CLIENT_SELECT).eq("workspace_id", input.workspaceId).eq("id", input.clientId).maybeSingle(),
    input.supabase.from("cases").select("id,title,module,status,current_revision,updated_at,created_at").eq("workspace_id", input.workspaceId).eq("client_id", input.clientId).order("updated_at", { ascending: false }),
  ]);
  if (clientError || caseError || !client) throw new Error("Client unavailable");
  const caseIds = (cases ?? []).map((item) => item.id);
  const [{ data: outcomes }, { data: sources }, { data: auditRows }] = await Promise.all([
    caseIds.length ? input.supabase.from("case_outcomes").select("case_id,next_action,blockers,actual_result,follow_up_date,reviewed_at").eq("workspace_id", input.workspaceId).in("case_id", caseIds) : Promise.resolve({ data: [] }),
    caseIds.length ? input.supabase.from("source_items").select("case_id,id").eq("workspace_id", input.workspaceId).in("case_id", caseIds) : Promise.resolve({ data: [] }),
    input.supabase.from("audit_events").select("id,event_type,entity_type,entity_id,created_at,metadata").eq("workspace_id", input.workspaceId).order("created_at", { ascending: false }).limit(50),
  ]);
  const audit = (auditRows ?? []).filter((event) => event.entity_id === input.clientId || caseIds.includes(event.entity_id ?? "")).slice(0, 20);
  return { client, cases: cases ?? [], outcomes: outcomes ?? [], sources: sources ?? [], audit };
}
