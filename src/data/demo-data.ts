export type DemoCase = {
  id: string;
  module: "growth" | "operations" | "intelligence";
  title: string;
  status: "awaiting_approval" | "blocked" | "action_pending" | "outcome_pending";
  nextAction: string;
  meta: string;
  accent: "violet" | "cyan" | "amber";
};

export const demoCases: DemoCase[] = [
  {
    id: "growth-offer-launch",
    module: "growth",
    title: "Strategy Sprint · Founding offer",
    status: "awaiting_approval",
    nextAction: "Review outreach draft",
    meta: "Revision 3 · Updated 18 min ago",
    accent: "violet",
  },
  {
    id: "studio-retro",
    module: "operations",
    title: "Studio intelligence review",
    status: "outcome_pending",
    nextAction: "Record what actually moved",
    meta: "Outcome due today",
    accent: "cyan",
  },
  {
    id: "ai-agents-brief",
    module: "intelligence",
    title: "Approval-first AI · PR brief",
    status: "action_pending",
    nextAction: "Approve media and client narratives",
    meta: "Audience variants ready",
    accent: "amber",
  },
  {
    id: "partner-decision",
    module: "operations",
    title: "Partner handoff decisions",
    status: "blocked",
    nextAction: "Confirm one missing owner",
    meta: "Blocked since yesterday",
    accent: "cyan",
  },
];

export const demoTimeline = [
  { label: "Opportunity brief created", detail: "Lead evidence and assumptions separated", time: "09:14" },
  { label: "Demand-to-revenue strategy generated", detail: "Model · Terra · structured output validated", time: "09:18" },
  { label: "Artifact revised", detail: "Revision 2 → 3 · approval invalidated", time: "09:31" },
  { label: "Approval requested", detail: "Outreach payload hash locked", time: "09:33" },
];

export const demoLearnings = [
  {
    module: "Growth & Revenue",
    title: "Lead with the concrete working session",
    body: "Specific transformation language outperformed broad strategy language in two recent conversations.",
    tags: ["offer", "positioning"],
  },
  {
    module: "Business Insights",
    title: "Name one owner before closing a meeting",
    body: "Actions without a named owner were the only items still blocked at the next review.",
    tags: ["meetings", "handoff"],
  },
];

export const demoWorkflowStreams = [
  {
    id: "demo-workflow-growth",
    workspace_id: "demo-workspace",
    group_id: "demo-workflow-growth-group",
    version: 2,
    base_module: "growth" as const,
    name: "Founding offer sprint",
    description: "Move one qualified offer signal to a reviewed outreach draft.",
    goal_mode: "outcome" as const,
    intake_defaults: { successCriteria: "Three qualified conversations", offer: "Strategy Sprint" },
    checklist: [
      { id: "proof", label: "Confirm the proof point", required: true },
      { id: "follow-up", label: "Name the next follow-up", required: true },
    ],
    stage_visibility: { intake: true, artifact: true, approval: true, gmail: false, outcome: true },
    status: "active" as const,
    content_hash: "demo-workflow-growth-hash",
    created_by: "demo-user",
    created_at: "2026-08-20T09:00:00.000Z",
    updated_at: "2026-08-21T09:00:00.000Z",
  },
  {
    id: "demo-workflow-operations",
    workspace_id: "demo-workspace",
    group_id: "demo-workflow-operations-group",
    version: 1,
    base_module: "operations" as const,
    name: "Decision handoff",
    description: "Turn meeting notes into owned decisions and a reviewable record.",
    goal_mode: "decision" as const,
    intake_defaults: { successCriteria: "One named owner and deadline" },
    checklist: [{ id: "owner", label: "Confirm one owner before closing", required: true }],
    stage_visibility: { intake: true, artifact: true, approval: true, gmail: true, outcome: true },
    status: "active" as const,
    content_hash: "demo-workflow-operations-hash",
    created_by: "demo-user",
    created_at: "2026-08-20T09:00:00.000Z",
    updated_at: "2026-08-20T09:00:00.000Z",
  },
] as const;
