import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionDraftEditor } from "@/src/components/portal/action-draft-editor";
import { ArtifactRevisionEditor } from "@/src/components/portal/artifact-revision-editor";
import { ApprovalPanel } from "@/src/components/portal/approval-panel";
import { CaseSupportPanels } from "@/src/components/portal/case-support-panels";
import { ArtifactApprovalPanel } from "@/src/components/portal/artifact-approval-panel";
import { HumanReadableContent } from "@/src/components/portal/human-readable-content";
import { demoCases, demoTimeline } from "@/src/data/demo-data";
import { isSafeDemoMode } from "@/src/demo-mode";
import { requirePortalContext } from "@/src/lib/supabase/auth";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import { parseLocale, type Locale } from "@/src/lib/i18n/locale";
import { getPortalCopy } from "@/src/lib/i18n/portal-copy";
import { Localized } from "@/src/components/locale-provider";
import { CaseWorkPacket, type CaseWorkPacketLearningApplication } from "@/src/components/portal/case-work-packet";
import { CaseDeleteControl } from "@/src/components/portal/case-delete-control";
import { localizeAudiencePreset, localizeAudienceProfileValue } from "@/src/lib/presentation/audience-variant";
import { formatHongKongTime } from "@/src/lib/i18n/hong-kong-time";
import { presentSourceSummary } from "@/src/lib/presentation/source-summary";
import { loadRelatedLearnings } from "@/src/lib/server/case-work-packets";
import { streamAllowsGmailDraft } from "@/src/lib/domain/workflow-stream";
import { IntakeSnapshotPanel } from "@/src/components/portal/intake-snapshot-panel";
import { ReanalysisPanel } from "@/src/components/portal/reanalysis-panel";
import { StyleSignalPanel } from "@/src/components/portal/style-signal-panel";
import { buildLegacyIntakeSnapshotPayload } from "@/src/lib/server/intake-snapshots";

export const metadata: Metadata = { title: "Case workspace", robots: { index: false, follow: false } };

type ArtifactContent = { title: string; summary: string; body: string; next_action: string };
type ActionPayload = { to: string; cc?: string[]; bcc?: string[]; subject: string; body: string; thread_id?: string };
type ActionStatus = "pending" | "executing" | "executed" | "failed" | "cancelled";
type WorkPacketEvidence = { observations?: string[]; assumptions?: string[]; gaps?: string[]; risks?: string[] };
type WorkPacketPlan = Record<string, string | string[]>;
type WorkPacketState = "current" | "inherited" | "absent" | "incomplete";
type BoundWorkflowStream = { id: string; name: string; version: number; content_hash: string; checklist: Array<{ id: string; label: string; required: boolean }>; stage_visibility: { gmail?: boolean } };
type IntakeSnapshot = { payload: Record<string, unknown>; snapshot_status: "exact" | "partial_legacy"; semantic_payload_hash?: string | null };
type ReanalysisRequest = { id: string; status: string; trigger_type: string; result_delta?: { newFacts?: string[]; changedInterpretation?: string[]; contradictions?: string[]; unresolvedGaps?: string[]; recommendedNextAction?: string } | null };
type StyleSignal = { id: string; status: string; structural_metadata?: { changedFields?: string[] } };

export function generateStaticParams() {
  return demoCases.map((item) => ({ id: item.id }));
}

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const demo = isSafeDemoMode();
  let locale: Locale = demo ? parseLocale(undefined) : "zh-Hant";
  let moduleLabels = getPortalCopy(locale).case.module;
  let statusLabels = getPortalCopy(locale).case.status;
  let caseRecord = {
    id,
    module: "growth" as keyof typeof moduleLabels,
    template_version: 2,
    title: "Strategy Sprint · Founding offer",
    brief: "Turn the existing service into one focused offer and an approved first outreach draft.",
    status: "awaiting_approval" as keyof typeof statusLabels,
    current_revision: 3,
    workflow_stream_id: null as string | null,
    workflow_stream_version: null as number | null,
    workflow_stream_hash: null as string | null,
    deletion_request_id: null as string | null,
    deletion_requested_at: null as string | null,
    deletion_requested_by: null as string | null,
  };
  let artifact = {
    id: "demo-artifact-003",
    revision: 3,
    content_hash: "8f2c1b9770d385d3ad9bf0b496459f3fb6905ef6c088723054255794cb0b71ab",
    content_locale: "zh-Hant" as Locale,
    content: {
      title: "Demand-to-revenue strategy",
      summary: "Position the Strategy Sprint as a five-day decision product and map the path from qualified lead to sale.",
      body: "Qualify prospects around a delayed launch, lead with the concrete decision artifacts, nurture interest with proof, and move sales follow-up toward one clear conversion event.",
      next_action: "Review the nurture and sales follow-up draft",
    } satisfies ArtifactContent,
  };
  let hasArtifact = demo;
  let action: { id: string; payload_hash: string; idempotency_key: string; payload: ActionPayload; status?: ActionStatus } | null = {
    id: "00000000-0000-4000-8000-000000000014",
    payload_hash: "8f2c1b9770d385d3ad9bf0b496459f3fb6905ef6c088723054255794cb0b71ab",
    idempotency_key: "demo-growth-draft-000014",
    payload: {
      to: "alex@northstar.studio",
      subject: "A focused route from demand to conversion",
      body: "Hi Alex,\n\nI’ve shaped the Strategy Sprint around one outcome: moving the offer from qualified demand into a sales path your team can measure and follow.\n\nThe working session sharpens the buyer signal, tests the positioning, maps the nurture sequence, and prepares the first approved sales follow-up. If that sounds useful, I can share the one-page outline.\n\nDemo User",
    },
  };
  let sources = [
    { id: "demo-text", kind: "TXT", label: "Offer notes", meta: "4.2 KB · extracted", extracted: true },
    { id: "demo-url", kind: "URL", label: "Current service page", meta: "Public HTTPS · captured", extracted: true },
    { id: "demo-md", kind: "MD", label: "Discovery patterns", meta: "2.8 KB · extracted", extracted: true },
  ];
  let uploadCount = 2;
  let audienceVariants: Array<{ id: string; preset: string; title: string; summary: string; body: string; stale: boolean; audience_profile?: { tone?: string; format?: string } }> = [];
  let relatedLearnings: Array<{ id: string; note: string; tags: string[] }> = [{ id: "demo-learning", note: "Short approval cycles work best when the requested decision is explicit.", tags: ["growth", "approval"] }];
  let workPacketEvidence: WorkPacketEvidence | null = { observations: ["The supplied sources point to one explicit decision boundary."], assumptions: ["The current offer can be tested with the available audience."], gaps: ["No measured conversion baseline is recorded."], risks: ["A broad message could weaken approval clarity."] };
  let workPacketPlan: WorkPacketPlan | null = { opportunity: "Make the next decision explicit.", hypothesis: "A bounded offer with a clear proof point will improve qualified follow-up.", conversionPath: "Signal → proof → approved outreach.", proof: ["Confirm the buyer signal before outreach."], measures: ["Qualified replies", "Approval cycle time"] };
  let workPacketApplications: CaseWorkPacketLearningApplication[] = [{ id: "demo-application", learningId: "demo-learning", disposition: "partially_applied", rationale: "Used the explicit-decision boundary while keeping source facts primary.", note: "Short approval cycles work best when the requested decision is explicit.", tags: ["growth", "approval"], evidence: "Two reviewed cases had faster approval when the requested decision was explicit.", confidence: "medium", nextAction: "Test the same boundary in the next approved outreach." }];
  let workPacketState: WorkPacketState = "current";
  let workPacketSourceRevision: number | null = artifact.revision;
  let timeline = demoTimeline;
  let workflowStream: BoundWorkflowStream | null = null;
  let intakeSnapshot: IntakeSnapshot = { payload: { title: caseRecord.title, objective: caseRecord.brief, module: caseRecord.module }, snapshot_status: "partial_legacy" };
  let reanalysisRequests: ReanalysisRequest[] = [];
  let styleSignal: StyleSignal | null = null;
  let styleProfileActive = false;

  if (demo && id === "studio-retro") {
    caseRecord = { ...caseRecord, module: "operations", template_version: 2, title: "Studio intelligence review", brief: "Connect meeting decisions, market shifts, customer feedback, and cross-functional insight to owners and action.", current_revision: 2 };
    artifact = { ...artifact, revision: 2, content: { title: "Market and operating insight register", summary: "Two market signals, three team insights, four owned actions, and one blocker need confirmation.", body: "Market signal: smaller fixed-scope offers are converting faster. Sales insight: prospects need proof before a call. Product and finance actions now have named owners and dates. Blocker: the proof asset still needs an owner.", next_action: "Review the cross-functional follow-up email" } };
    action = { id: "00000000-0000-4000-8000-000000000024", payload_hash: artifact.content_hash, idempotency_key: "demo-operations-draft-000024", payload: { to: "sam@example.com", subject: "Decisions and next actions from today", body: "Hi Sam,\n\nHere are the decisions and owners we agreed today. Please reply if any owner or deadline is incorrect.\n\nDemo User" } };
    sources = [{ id: "demo-meeting", kind: "MD", label: "Meeting notes", meta: "6.1 KB · extracted", extracted: true }, { id: "demo-trends", kind: "URL", label: "Market signal roundup", meta: "Public HTTPS · captured", extracted: true }, { id: "demo-teams", kind: "TXT", label: "Sales and product feedback", meta: "3.4 KB · extracted", extracted: true }];
    uploadCount = 2;
  }

  if (demo && id === "ai-agents-brief") {
    caseRecord = { ...caseRecord, module: "intelligence", template_version: 1, title: "Approval-first AI · PR brief", brief: "Create one source-grounded reputation view, then shape the narrative for media, clients, and the public.", current_revision: 2 };
    artifact = { ...artifact, revision: 2, content: { title: "Approval-first AI: reputation narrative", summary: "The strongest near-term story is useful preparation with human approval at consequential boundaries.", body: "Across the supplied sources, credibility concentrates where the system preserves provenance and pauses before external action. Claims of fully autonomous operations carry avoidable reputation risk because the evidence remains limited and context-dependent.", next_action: "Approve the core PR narrative and audience boundaries" } };
    action = null;
    sources = [{ id: "demo-report", kind: "PDF", label: "Industry report", meta: "1.8 MB · extracted", extracted: true }, { id: "demo-article", kind: "URL", label: "Research article", meta: "Public HTTPS · captured", extracted: true }];
    uploadCount = 1;
    audienceVariants = [
      { id: "demo-self", preset: "self", title: "Decision note", summary: "Test approval-first preparation before adding autonomy.", body: "Decision: pilot one bounded preparation task and measure time-to-approval, revision rate, and observed outcome.", stale: false, audience_profile: { tone: "direct and reflective", format: "working note" } },
      { id: "demo-client", preset: "client", title: "Client brief", summary: "Approval-first agents can reduce preparation time while preserving accountability.", body: "Recommendation: begin with a traceable preparation workflow. Keep external actions behind exact approval and review results before expanding scope.", stale: false, audience_profile: { tone: "clear and collaborative", format: "client-ready brief" } },
      { id: "demo-public", preset: "public", title: "Public explainer", summary: "Useful AI agents prepare work and pause before important actions.", body: "A practical agent does not need to run everything by itself. It can gather the supplied information, prepare the next step, and let a person check it before anything consequential happens.", stale: false, audience_profile: { tone: "plain and approachable", format: "public explainer" } },
    ];
  }

  if (!demo) {
    const context = await requirePortalContext();
    locale = context.locale;
    moduleLabels = getPortalCopy(locale).case.module;
    statusLabels = getPortalCopy(locale).case.status;
    const supabase = await createServerSupabaseClient();
    const { data: liveCase } = await supabase.from("cases").select("id,module,template_version,title,brief,intake_context,status,current_revision,deletion_request_id,deletion_requested_at,deletion_requested_by,workflow_stream_id,workflow_stream_version,workflow_stream_hash").eq("id", id).eq("workspace_id", context.workspace.id).maybeSingle();
    if (!liveCase) notFound();
    caseRecord = liveCase as typeof caseRecord;
    if (liveCase.workflow_stream_id) {
      const { data: boundStream } = await supabase.from("workflow_streams").select("id,name,version,content_hash,checklist,stage_visibility").eq("id", liveCase.workflow_stream_id).eq("workspace_id", context.workspace.id).maybeSingle();
      workflowStream = boundStream as BoundWorkflowStream | null;
    }
    if (caseRecord.deletion_request_id) {
      return (
        <main className="portal-page case-page case-deletion-pending-page">
          <CaseDeleteControl caseId={id} title={caseRecord.title} deletionPending deletionRequestId={caseRecord.deletion_request_id} />
        </main>
      );
    }
    const [artifactResult, actionResult, sourceResult, auditResult, variantResult, learningApplicationResult] = await Promise.all([
        supabase.from("case_artifacts").select("id,revision,content_hash,content,content_locale,work_packet_source_artifact_id").eq("case_id", id).eq("workspace_id", context.workspace.id).eq("revision", liveCase.current_revision).maybeSingle(),
      supabase.from("case_actions").select("id,payload_hash,idempotency_key,payload,status").eq("case_id", id).eq("workspace_id", context.workspace.id).eq("artifact_revision", liveCase.current_revision).maybeSingle(),
      supabase.from("source_items").select("id,source_kind,filename,mime_type,byte_size,source_url,extraction_status").eq("case_id", id).eq("workspace_id", context.workspace.id).order("created_at", { ascending: true }),
      supabase.from("audit_events").select("id,event_type,metadata,created_at").eq("entity_id", id).eq("workspace_id", context.workspace.id).order("created_at", { ascending: false }).limit(8),
      supabase.from("case_audience_variants").select("id,preset,title,summary,body,stale,audience_profile").eq("case_id", id).eq("workspace_id", context.workspace.id).eq("artifact_revision", liveCase.current_revision).order("created_at", { ascending: true }),
      supabase.from("case_learning_applications").select("id,learning_id,disposition,rationale,learning_note_snapshot,learning_tags_snapshot,applicability_snapshot,evidence_snapshot,confidence_snapshot,supporting_outcome_count_snapshot,learning_confidence_snapshot,validation_status_snapshot,next_action_snapshot,improvements_snapshot,other_angles_snapshot").eq("case_id", id).eq("workspace_id", context.workspace.id).eq("artifact_revision", liveCase.current_revision).order("applied_at", { ascending: true }),
    ]);
    if (artifactResult.data) {
      artifact = artifactResult.data as typeof artifact;
      hasArtifact = true;
    } else {
      hasArtifact = false;
    }
    action = actionResult.data ? actionResult.data as typeof action : null;
    sources = (sourceResult.data ?? []).map((item) => {
      const summary = presentSourceSummary({ sourceKind: item.source_kind, filename: item.filename, sourceUrl: item.source_url, extractionStatus: item.extraction_status, locale });
      return {
        id: item.id,
        ...summary,
      };
    });
    uploadCount = (sourceResult.data ?? []).filter((item) => item.source_kind === "private_upload" && item.extraction_status !== "failed").length;
    timeline = (auditResult.data ?? []).map((event) => ({
      label: event.event_type.replaceAll(".", " "),
      detail: typeof event.metadata === "object" && event.metadata ? Object.keys(event.metadata).slice(0, 2).join(" · ") || "Recorded" : "Recorded",
      time: formatHongKongTime(new Date(event.created_at)),
    }));
    audienceVariants = (variantResult.data ?? []) as typeof audienceVariants;
    const packetSourceArtifactId = artifactResult.data?.work_packet_source_artifact_id ?? null;
    const [stageOutputResult, packetSourceArtifactResult] = packetSourceArtifactId
      ? await Promise.all([
        supabase.from("case_stage_outputs").select("artifact_id,stage_key,output").eq("case_id", id).eq("workspace_id", context.workspace.id).eq("artifact_id", packetSourceArtifactId),
        supabase.from("case_artifacts").select("revision").eq("case_id", id).eq("workspace_id", context.workspace.id).eq("id", packetSourceArtifactId).maybeSingle(),
      ])
      : [{ data: [] }, { data: null }];
    const packetOutputs = (stageOutputResult.data ?? []).filter((output) => packetSourceArtifactId !== null && output.artifact_id === packetSourceArtifactId) as Array<{ artifact_id: string; stage_key: string; output: WorkPacketEvidence | WorkPacketPlan }>;
    workPacketEvidence = (packetOutputs.find((output) => output.stage_key === "evidence")?.output as WorkPacketEvidence | undefined) ?? null;
    workPacketPlan = (packetOutputs.find((output) => output.stage_key === "plan")?.output as WorkPacketPlan | undefined) ?? null;
    workPacketState = packetSourceArtifactId === null
      ? "absent"
      : workPacketEvidence && workPacketPlan
        ? packetSourceArtifactId === artifactResult.data?.id ? "current" : "inherited"
        : "incomplete";
    workPacketSourceRevision = packetSourceArtifactResult.data?.revision ?? null;
    workPacketApplications = (learningApplicationResult.data ?? []).map((application) => ({
      id: application.id,
      learningId: application.learning_id,
      disposition: application.disposition,
      rationale: application.rationale,
      note: application.learning_note_snapshot,
      tags: application.learning_tags_snapshot ?? [],
      applicability: application.applicability_snapshot,
      evidence: application.evidence_snapshot,
      confidence: application.confidence_snapshot,
      supportingOutcomeCount: application.supporting_outcome_count_snapshot,
      learningConfidence: application.learning_confidence_snapshot,
      validationStatus: application.validation_status_snapshot,
      nextAction: application.next_action_snapshot,
      improvements: application.improvements_snapshot,
      otherAngles: application.other_angles_snapshot,
    })) as CaseWorkPacketLearningApplication[];
    relatedLearnings = await loadRelatedLearnings({ supabase, workspaceId: context.workspace.id, module: liveCase.module, query: `${liveCase.title} ${liveCase.brief}`, limit: 3 });
    const [{ data: snapshot }, { data: reanalysis }] = await Promise.all([
      supabase.from("case_intake_snapshots").select("payload,snapshot_status,semantic_payload_hash").eq("workspace_id", context.workspace.id).eq("case_id", id).maybeSingle(),
      supabase.from("case_reanalysis_requests").select("id,status,trigger_type,result_delta").eq("workspace_id", context.workspace.id).eq("case_id", id).order("created_at", { ascending: false }).limit(5),
    ]);
    if (snapshot) intakeSnapshot = snapshot as IntakeSnapshot;
    else {
      const legacyPayload = buildLegacyIntakeSnapshotPayload({ title: liveCase.title, brief: liveCase.brief, module: liveCase.module, intake_context: liveCase.intake_context });
      const { data: reconstructed } = await supabase.rpc("record_case_intake_snapshot", { p_case_id: id, p_actor_id: context.user.id, p_payload: legacyPayload, p_snapshot_status: "partial_legacy" });
      intakeSnapshot = (reconstructed ?? { payload: legacyPayload, snapshot_status: "partial_legacy", semantic_payload_hash: null }) as IntakeSnapshot;
    }
    reanalysisRequests = (reanalysis ?? []) as ReanalysisRequest[];
    const { data: pendingSignal } = await supabase.from("artifact_edit_signals").select("id,status,structural_metadata").eq("workspace_id", context.workspace.id).eq("case_id", id).eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle();
    styleSignal = pendingSignal as StyleSignal | null;
    const { data: styleProfile } = await supabase.from("writing_style_profiles").select("active").eq("workspace_id", context.workspace.id).maybeSingle();
    styleProfileActive = styleProfile?.active === true;
  }

  const artifactContent = artifact.content as ArtifactContent;
  const moduleLabel = moduleLabels[caseRecord.module];
  const statusLabel = statusLabels[caseRecord.status];
  const gmailDraftEnabled = streamAllowsGmailDraft(workflowStream);
  const regenerationClosed = ["completed", "cancelled", "outcome_pending"].includes(caseRecord.status);
  const regenerationMissingSource = caseRecord.current_revision > 0 && !sources.some((source) => source.extracted);
  if (!hasArtifact) {
    return (
      <main className="portal-page case-page">
        <header className="case-header"><div><p className="portal-kicker">{moduleLabel} · <Localized zh={<>工作 {id.slice(0, 8).toUpperCase()}</>} en={<>Case {id.slice(0, 8).toUpperCase()}</>} /></p><h1>{caseRecord.title}</h1><p>{caseRecord.brief}</p></div><span className={`case-status status-${caseRecord.status}`}><i />{statusLabel}</span></header>
        <div className="case-layout">
          <div className="case-main-column"><IntakeSnapshotPanel snapshot={intakeSnapshot} locale={locale} /><ReanalysisPanel caseId={id} initialRequests={reanalysisRequests} locale={locale} demo={demo} /><section className="portal-panel no-outcome-card"><Localized zh={<><strong>工作資料已安全保留。</strong><p>完成任何未上傳的來源，然後產生第一份修訂稿。現時沒有內容可供審批或建立行動。</p></>} en={<><strong>Your case intake is safely retained.</strong><p>Finish any remaining source upload, then generate the first draft. There is no artifact to approve or act on yet.</p></>} /></section></div>
          <aside className="case-side-column"><CaseSupportPanels caseId={id} sources={sources} uploadCount={uploadCount} relatedLearnings={relatedLearnings} demo={demo} currentRevision={caseRecord.current_revision} regenerationDisabled={false} /><CaseDeleteControl caseId={id} title={caseRecord.title} demo={demo} /></aside>
        </div>
      </main>
    );
  }
  return (
    <main className="portal-page case-page">
      <header className="case-header"><div><p className="portal-kicker">{moduleLabel} · <Localized zh={<>工作 {demo ? "SC-014" : id.slice(0, 8).toUpperCase()}</>} en={<>Case {demo ? "SC-014" : id.slice(0, 8).toUpperCase()}</>} /></p><h1>{caseRecord.title}</h1><p>{caseRecord.brief}</p></div><span className={`case-status status-${caseRecord.status}`}><i />{statusLabel}</span></header>
      <div className="case-progress" aria-label={getPortalCopy(locale).case.progress}><span className="is-complete"><i>✓</i>{getPortalCopy(locale).case.intakeStep}</span><span className="is-complete"><i>✓</i>{getPortalCopy(locale).case.artifactStep}</span><span className={caseRecord.status === "awaiting_approval" ? "is-current" : "is-complete"}><i>{caseRecord.status === "awaiting_approval" ? "3" : "✓"}</i>{getPortalCopy(locale).case.approvalStep}</span>{gmailDraftEnabled ? <span className={caseRecord.status === "action_pending" || caseRecord.status === "approved" ? "is-current" : caseRecord.status === "outcome_pending" || caseRecord.status === "completed" ? "is-complete" : ""}><i>4</i>{getPortalCopy(locale).case.gmailStep}</span> : null}<span className={caseRecord.status === "outcome_pending" ? "is-current" : caseRecord.status === "completed" ? "is-complete" : ""}><i>{gmailDraftEnabled ? "5" : "4"}</i>{getPortalCopy(locale).case.outcomeStep}</span></div>
      <div className="case-layout">
        <div className="case-main-column">
          <IntakeSnapshotPanel snapshot={intakeSnapshot} locale={locale} /><ReanalysisPanel caseId={id} initialRequests={reanalysisRequests} locale={locale} demo={demo} /><StyleSignalPanel signal={styleSignal} profileActive={styleProfileActive} locale={locale} /><section className="portal-panel case-brief"><div className="artifact-heading"><div><p className="portal-kicker">{getPortalCopy(locale).case.workingContext}</p><h2>{moduleLabel} {getPortalCopy(locale).case.intake}</h2></div><span>{getPortalCopy(locale).case.revisionLabel(caseRecord.current_revision)}</span></div><div className="brief-grid"><div><span>{locale === "zh-Hant" ? "目標" : "Objective"}</span><strong>{caseRecord.brief}</strong></div><div><span>{getPortalCopy(locale).case.nextAction}</span><strong>{artifactContent.next_action}</strong></div><div><span>{getPortalCopy(locale).case.sourceStatus}</span><strong>{getPortalCopy(locale).case.registeredSource(sources.length)}</strong></div><div><span>{getPortalCopy(locale).case.template}</span><strong>{getPortalCopy(locale).case.templateVersion(caseRecord.template_version)}</strong></div></div>{workflowStream ? <div className="case-workflow-binding"><p className="portal-kicker">{locale === "zh-Hant" ? "我的工作流" : "My Workflow"}</p><strong>{workflowStream.name} · {locale === "zh-Hant" ? `第 ${workflowStream.version} 版` : `Version ${workflowStream.version}`}</strong><small>{locale === "zh-Hant" ? "此工作保留建立時的工作流版本。" : "This case keeps the exact workflow version selected at intake."}</small></div> : null}</section>
          {workflowStream?.checklist.length ? <section className="portal-panel case-workflow-checklist"><div className="artifact-heading"><div><p className="portal-kicker">{locale === "zh-Hant" ? "工作流檢查清單" : "Workflow checklist"}</p><h2>{locale === "zh-Hant" ? `第 ${workflowStream.version} 版` : `Version ${workflowStream.version}`}</h2></div></div><ul>{workflowStream.checklist.map((item) => <li key={item.id}><span aria-hidden="true">□</span><span>{item.label}{item.required ? " *" : ""}</span></li>)}</ul></section> : null}
          <ArtifactRevisionEditor demo={demo} caseId={id} revision={artifact.revision} title={artifactContent.title} summary={artifactContent.summary} body={artifactContent.body} nextAction={artifactContent.next_action} contentLocale={artifact.content_locale === "zh-Hant" ? "zh-Hant" : "en"} module={caseRecord.module} caseStatus={caseRecord.status} actionStatus={action?.status} action={action?.payload ?? null} />
          <CaseWorkPacket module={caseRecord.module} evidence={workPacketEvidence} plan={workPacketPlan} applications={workPacketApplications} packetState={workPacketState} packetSourceRevision={workPacketSourceRevision} />
          {caseRecord.module === "intelligence" ? <section className="portal-panel audience-variants-panel"><div className="artifact-heading"><div><p className="portal-kicker">{getPortalCopy(locale).case.audience}</p><h2>{getPortalCopy(locale).case.oneSynthesis}</h2></div><span>{getPortalCopy(locale).case.variants(audienceVariants.length || 3)}</span></div>{audienceVariants.length ? <div className="audience-variant-grid">{audienceVariants.map((variant) => {
            const preset = variant.preset.trim().toLowerCase();
            const status = variant.stale ? getPortalCopy(locale).case.outOfDate : preset === "custom" ? (locale === "zh-Hant" ? "你的自訂設定" : "Your custom settings") : null;
            const profileSummary = [variant.audience_profile?.tone, variant.audience_profile?.format].map((value) => localizeAudienceProfileValue(value, locale)).filter(Boolean).join(" · ");
            return <article className={variant.stale ? "is-stale" : ""} key={variant.id}><header><span>{localizeAudiencePreset(variant.preset, locale)}</span>{status ? <i>{status}</i> : null}</header><h3>{variant.title}</h3><HumanReadableContent content={variant.summary} locale={locale} /><details><summary>{getPortalCopy(locale).case.readVariant}</summary><HumanReadableContent content={variant.body} locale={locale} /></details>{profileSummary ? <small>{profileSummary}</small> : null}</article>;
          })}</div> : <p className="empty-side-note">{getPortalCopy(locale).case.emptyVariants}</p>}</section> : null}
          {action && gmailDraftEnabled ? <ApprovalPanel demo={demo} caseId={id} artifactRevision={artifact.revision} artifactHash={artifact.content_hash} actionPayloadHash={action.payload_hash} actionId={action.id} idempotencyKey={action.idempotency_key} to={action.payload.to} cc={action.payload.cc} bcc={action.payload.bcc} threadId={action.payload.thread_id} subject={action.payload.subject} body={action.payload.body} artifactTitle={artifactContent.title} artifactSummary={artifactContent.summary} artifactBody={artifactContent.body} artifactNextAction={artifactContent.next_action} contentLocale={artifact.content_locale === "zh-Hant" ? "zh-Hant" : "en"} module={caseRecord.module} caseStatus={caseRecord.status} actionStatus={action.status} /> : caseRecord.module === "intelligence" || !gmailDraftEnabled ? <ArtifactApprovalPanel caseId={id} revision={artifact.revision} artifactHash={artifact.content_hash} title={artifactContent.title} summary={artifactContent.summary} body={artifactContent.body} nextAction={artifactContent.next_action} contentLocale={artifact.content_locale === "zh-Hant" ? "zh-Hant" : "en"} caseStatus={caseRecord.status} demo={demo} /> : <ActionDraftEditor demo={demo} caseId={id} expectedRevision={artifact.revision} title={artifactContent.title} summary={artifactContent.summary} body={artifactContent.body} nextAction={artifactContent.next_action} contentLocale={artifact.content_locale === "zh-Hant" ? "zh-Hant" : "en"} module={caseRecord.module} caseStatus={caseRecord.status} />}
        </div>
        <aside className="case-side-column">
          <CaseSupportPanels caseId={id} sources={sources} uploadCount={uploadCount} relatedLearnings={relatedLearnings} demo={demo} currentRevision={caseRecord.current_revision} regenerationDisabled={regenerationClosed || regenerationMissingSource} regenerationDisabledReason={regenerationClosed ? "closed" : regenerationMissingSource ? "missingSource" : undefined} />
          <CaseDeleteControl caseId={id} title={caseRecord.title} demo={demo} />
          <section className="portal-panel timeline-panel"><div className="artifact-heading"><div><p className="portal-kicker">{getPortalCopy(locale).case.audit}</p><h2>{getPortalCopy(locale).case.trace}</h2></div></div>{timeline.length ? timeline.map((event, index) => <div className="timeline-item" key={`${event.label}-${index}`}><i /><div><strong>{event.label}</strong><span>{event.detail}</span></div><time>{event.time}</time></div>) : <p className="empty-side-note">{getPortalCopy(locale).case.noEvents}</p>}</section>
        </aside>
      </div>
    </main>
  );
}
