import type { AudiencePreset, AudienceProfile, AudienceVariant, ModuleKey, TemplateVersion } from "./types";
import type { Locale } from "../i18n/locale";

const commonOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    body: { type: "string" },
    next_action: { type: "string" },
  },
  required: ["title", "summary", "body", "next_action"],
} as const;

export const HUMAN_READABLE_OUTPUT_INSTRUCTIONS =
  "Format every text field as human-readable plain text. Use short sections separated by blank lines and optional '- ' bullets for lists. Do not put JSON, code fences, Markdown '#' heading markers, or '**' bold markers inside text fields.";

const growthV1: TemplateVersion = {
  key: "growth",
  version: 1,
  label: "Growth and revenue conversion",
  description: "Move a qualified opportunity through positioning, nurture, sales follow-up, and an observable conversion outcome.",
  requiredInputs: ["source", "audience", "desired_outcome"],
  outputSchema: commonOutputSchema,
  prompt:
    `Extract the strongest growth signal, state the hypothesis, and draft one concrete next action. Keep claims grounded in the supplied source. ${HUMAN_READABLE_OUTPUT_INSTRUCTIONS}`,
};

const growthV2: TemplateVersion = {
  key: "growth",
  version: 2,
  label: "Growth and revenue conversion",
  description: "Turn a defined offer, lead profile, pipeline, campaign, and conversion target into a testable path from demand to revenue.",
  requiredInputs: ["source", "offer", "lead_profile", "conversion_target"],
  outputSchema: commonOutputSchema,
  prompt:
    `Prioritize the offer, lead/customer profile, pipeline, campaign/channel context, and conversion target. Map them into a concrete opportunity, testable hypothesis, conversion path, proof requirements, and observable measures. Keep source-grounded facts distinct from assumptions and do not invent funnel evidence. ${HUMAN_READABLE_OUTPUT_INSTRUCTIONS}`,
};

const operationsV1: TemplateVersion = {
  key: "operations",
  version: 1,
  label: "Business insights",
  description: "Connect meetings, market signals, customer feedback, and cross-functional insight to decisions and owner action.",
  requiredInputs: ["source", "constraint", "desired_outcome"],
  outputSchema: commonOutputSchema,
  prompt:
    `Identify the bottleneck, propose the smallest reversible action, and make dependencies explicit. Do not assume authority the user has not supplied. ${HUMAN_READABLE_OUTPUT_INSTRUCTIONS}`,
};

const operationsV2: TemplateVersion = {
  key: "operations",
  version: 2,
  label: "Business insights",
  description: "Turn decisions, owners, deadlines, SOPs, blockers, and cross-functional signals into accountable operating movement.",
  requiredInputs: ["source", "decisions_needed", "desired_outcome"],
  outputSchema: commonOutputSchema,
  prompt:
    `Prioritize decisions needed, named owners, deadlines, SOP or process context, blockers, and cross-functional signals. Map them into the operating bottleneck, smallest decision, accountable owners, dependencies, and observable measures. Treat missing fields as gaps; never invent an owner, deadline, process, or signal. ${HUMAN_READABLE_OUTPUT_INSTRUCTIONS}`,
};

const operationsV3: TemplateVersion = {
  key: "operations",
  version: 3,
  label: "Business insights",
  description: "Audit dates, dependencies, constraints, cross-functional claims, decisions, owners, contradictions, and deadline collisions before proposing accountable operating movement.",
  requiredInputs: ["source", "decisions_needed", "desired_outcome"],
  outputSchema: commonOutputSchema,
  prompt:
    `Before making recommendations, audit every supplied date, dependency, deadline, and cross-functional or source claim. Compare dates chronologically and identify decisions made after earlier cost or change cutoffs, deadline collisions, and the consequences that are actually supported. When a proposed decision falls after an earlier cutoff, restructure the plan so a reversible or provisional decision happens before the cutoff and a later step only confirms scope, unless the evidence requires a different sequence. Classify each constraint as perceived, contractual, or proposed: vendor or contract evidence can establish a contractual constraint, while internal "locked" language alone is only a perception. Distinguish supplied decisions and owners from AI-introduced proposed decisions and owners, and label every proposal. Never invent an owner, deadline, consequence, baseline, denominator, or KPI; do not introduce unsupported absolute KPIs such as 100%. Use absolute targets only when supplied; otherwise label a target as a proposal and state the missing evidence. Keep source-grounded facts distinct from assumptions and gaps. ${HUMAN_READABLE_OUTPUT_INSTRUCTIONS}`,
};

const intelligenceV1: TemplateVersion = {
  key: "intelligence",
  version: 1,
  label: "Brand communications and public relations",
  description: "Synthesize bounded source material into a reputation-aware narrative and audience-specific public relations action.",
  requiredInputs: ["source", "question", "audience"],
  outputSchema: commonOutputSchema,
  prompt:
    `Separate evidence from interpretation, call out uncertainty, and end with a testable next action. Never invent citations or facts. ${HUMAN_READABLE_OUTPUT_INSTRUCTIONS}`,
};

/** Full prompt provenance, including superseded versions retained for revisions. */
export const TEMPLATE_HISTORY: Readonly<Record<ModuleKey, readonly TemplateVersion[]>> = {
  growth: [growthV1, growthV2],
  operations: [operationsV1, operationsV2, operationsV3],
  intelligence: [intelligenceV1],
};

/** Latest versions used by newly created cases. */
export const TEMPLATE_VERSIONS: Readonly<Record<ModuleKey, TemplateVersion>> = {
  growth: growthV2,
  operations: operationsV3,
  intelligence: intelligenceV1,
};

const AUDIENCE_PRESET_DEFAULTS: Readonly<Record<AudiencePreset, Omit<AudienceProfile, "preset">>> = {
  self: {
    knowledgeLevel: "expert",
    goal: "Use the same requested deliverable to make a clear decision while keeping the working context private.",
    tone: "direct and reflective",
    format: "the same requested deliverable, adapted for internal use",
    disclosureBoundaries: ["private workspace context", "unpublished source material"],
  },
  client: {
    knowledgeLevel: "intermediate",
    goal: "Use the same requested deliverable to help the client make a useful, informed decision.",
    tone: "clear and collaborative",
    format: "the same requested deliverable, adapted for client use",
    disclosureBoundaries: ["exclude private workspace notes", "exclude confidential third-party details"],
  },
  public: {
    knowledgeLevel: "beginner",
    goal: "Share the same requested deliverable in useful public language without exposing private context.",
    tone: "plain and approachable",
    format: "the same requested deliverable, adapted for public use",
    disclosureBoundaries: ["remove personal data", "remove client-identifying details", "remove unpublished strategy"],
  },
  custom: {
    knowledgeLevel: "intermediate",
    goal: "Adapt the same requested deliverable for a specified audience goal.",
    tone: "clear and audience-appropriate",
    format: "the same requested deliverable, adapted for the custom audience",
    disclosureBoundaries: ["share only explicitly approved material"],
  },
};

export function audienceProfileForPreset(preset: AudiencePreset, overrides: Partial<Omit<AudienceProfile, "preset">> = {}): AudienceProfile {
  return { preset, ...AUDIENCE_PRESET_DEFAULTS[preset], ...overrides };
}

export function normalizeAudienceProfile(input: AudienceProfile | AudiencePreset, customAudience?: string): AudienceProfile {
  if (typeof input === "string") {
    return input === "custom" && customAudience
      ? audienceProfileForPreset("custom", { goal: customAudience.trim() })
      : audienceProfileForPreset(input);
  }
  return input;
}

export function getTemplateVersion(module: ModuleKey, version?: number): TemplateVersion {
  const history = TEMPLATE_HISTORY[module];
  const template = version === undefined
    ? TEMPLATE_VERSIONS[module]
    : history?.find((candidate) => candidate.version === version);
  if (!template) {
    throw new Error(`Unsupported template version: ${module}@${version ?? "latest"}`);
  }
  return template;
}

function variantLabel(audience: AudienceProfile, customAudience?: string): string {
  return audience.preset === "custom" ? customAudience?.trim() || audience.goal : audience.preset;
}

/**
 * Build deterministic audience variants from one core synthesis. Variants carry the
 * source core hash so a later core edit can invalidate them without mutating history.
 */
export function buildAudienceVariants(input: {
  coreRevision: number;
  coreHash: string;
  core: { title: string; summary: string; body: string };
  audiences?: readonly (AudienceProfile | { audience: AudiencePreset; customAudience?: string })[];
  contentLocale?: Locale;
  now?: string;
}): AudienceVariant[] {
  const audiences: readonly { profile: AudienceProfile; customAudience?: string }[] = input.audiences?.length
    ? input.audiences.map((entry) =>
        "audience" in entry
          ? { profile: normalizeAudienceProfile(entry.audience, entry.customAudience), customAudience: entry.customAudience }
          : { profile: entry },
      )
    : (["self", "client", "public"] as AudiencePreset[]).map((preset) => ({ profile: audienceProfileForPreset(preset) }));
  const now = input.now ?? new Date().toISOString();
  const contentLocale = input.contentLocale ?? "en";
  return audiences.map(({ profile, customAudience }) => {
    const label = variantLabel(profile, customAudience);
    const prefix = contentLocale === "zh-Hant"
      ? profile.preset === "self" ? "內部筆記" : profile.preset === "client" ? "客戶簡報" : profile.preset === "public" ? "公開簡介" : "自訂簡介"
      : profile.preset === "self" ? "Internal note" : profile.preset === "client" ? "Client brief" : profile.preset === "public" ? "Public brief" : "Custom brief";
    const body = profile.preset === "self"
      ? input.core.body
      : contentLocale === "zh-Hant" ? `${label}\n\n${input.core.body}` : `${label}\n\n${input.core.body}`;
    return {
      id: `${input.coreRevision}-${profile.preset}-${input.coreHash.slice(0, 12)}`,
      core_revision: input.coreRevision,
      audience: profile,
      preset: profile.preset,
      custom_audience: profile.preset === "custom" ? customAudience?.trim() : undefined,
      title: `${prefix}: ${input.core.title}`,
      summary: input.core.summary,
      body,
      core_hash: input.coreHash,
      stale: false,
      created_at: now,
      content_locale: contentLocale,
    };
  });
}

export function markStaleVariants(variants: readonly AudienceVariant[], currentCoreHash: string): AudienceVariant[] {
  return variants.map((variant) => ({ ...variant, stale: variant.core_hash !== currentCoreHash }));
}
