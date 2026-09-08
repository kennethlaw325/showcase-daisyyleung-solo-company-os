---
title: Solo Company OS Product Design
status: active
owner: Demo User
updated: 2026-08-21
source_of_truth: true
supersedes: []
tags: [solo-company-os, product-design, ux, visual-system, accessibility]
---

# Solo Company OS product design

## Purpose and authority

This document is the design contract for the Solo Company OS public site and private portal. It defines the intended product experience, information hierarchy, visual language, interaction patterns, responsive behaviour, content standards, and accessibility requirements.

When sources differ, use this order:

1. [`AGENTS.md`](AGENTS.md) governs product boundaries, privacy, security, tenancy, approvals, AI behaviour, and validation.
2. This document governs product experience and visual design.
3. [`README.md`](README.md) governs the current product surfaces and operating flow.
4. [`app/globals.css`](app/globals.css), [`app/`](app/), and [`src/components/`](src/components/) show the current implementation.

Do not weaken a safety or approval invariant to improve visual simplicity. If the implementation and this design contract diverge, record the gap and resolve it deliberately rather than silently redefining the design.

## Product definition

Solo Company OS is a bilingual, invite-only operating portal for consultants, creators, and freelancers. It turns scattered context into a traceable next action, pauses before consequential external actions, and converts observed outcomes into user-confirmed reusable learning.

The product promise is:

> Know what’s next. Get it done.

The first release has three modules:

| Module key | User-facing name | Primary job |
| --- | --- | --- |
| `growth` | Growth & Revenue | Move an offer or lead through demand, sales, and conversion. |
| `operations` | Business Intelligence & Operating Memory | Turn meetings, market signals, and cross-functional input into decisions, owners, and operating knowledge. |
| `intelligence` | Brand Communications & PR | Turn source-grounded facts and reputation constraints into audience-specific communications. |

The shared operating loop is:

```text
Context → Draft → Human approval → Optional Gmail draft → Observed outcome → Confirmed learning
```

The portal is not a general workflow builder, autonomous agent console, team collaboration suite, billing product, inbox reader, or email sender.

## Audience and use context

The primary user is a time-constrained solo operator who moves between strategy and execution. They need to recover context quickly, make high-quality decisions, and trust that the system will not act beyond the boundary they approved.

Design for these conditions:

- The user may visit for a focused five-minute decision rather than a long session.
- Source material and generated artifacts may be dense, bilingual, and business-sensitive.
- The most important item is usually a judgement, approval, blocker, or outcome—not the newest notification.
- Confidence comes from visible provenance, revision history, exact action details, and clear recovery paths.
- Mobile supports review and progress; desktop remains the most comfortable surface for source-heavy creation and editing.

## Experience principles

### 1. Judgement before activity

Rank work by what needs the user’s decision. Do not use an infinite activity feed, vanity metrics, or engagement mechanics as the primary dashboard structure.

### 2. One clear next action

Every case, empty state, blocker, success state, and error state should identify the next useful action. A screen should normally have one visually dominant primary action.

### 3. Trust is visible

Show the current revision, source state, approval state, exact action payload, and audit trail where they affect a decision. Technical proof such as a content fingerprint should be explained in plain language and remain secondary to the human-readable content.

### 4. Human control is a product feature

AI prepares; the user approves. Any material edit creates a new revision and invalidates prior approval. Gmail creates a draft only, and interface copy must never imply that Solo Company OS sends email.

### 5. Outcomes close the loop

A case is not complete when content is generated or an action is prepared. Completion requires an observed outcome, a next action, and an explicit learning disposition.

### 6. Calm operational confidence

The interface should feel composed, precise, and quietly capable. Use generous structure, restrained colour, strong typography, and subtle depth. Avoid “AI magic” tropes, neon spectacle, excessive gradients, gamification, anthropomorphic assistants, and decorative dashboards.

### 7. Bilingual parity

Traditional Chinese and English are equally complete product experiences. Neither language is a shortened or secondary version. Layout must tolerate their different line lengths without clipping, forced truncation, or broken hierarchy.

### 8. Privacy by separation

Public routes use public copy and sealed fixtures only. They must never query, embed, preview, or infer tenant content. The authenticated portal must make the current workspace and user context legible without accepting a client-supplied workspace boundary.

## Information architecture

### Public surfaces

| Route | Purpose | Primary action |
| --- | --- | --- |
| `/` | Explain the problem, operating loop, three modules, approval model, and learning loop. | Request founding access. |
| `/request-access` | Qualify founding-pilot applicants and set expectations. | Submit an application. |
| `/login` | Authenticate invited users with email OTP or Magic Link. | Request a sign-in link. |
| `/privacy` and `/terms` | Explain data and service boundaries in readable language. | Return to the product or access flow. |

The public narrative should progress from scattered work, to a judgement-first command centre, to the three modules, to exact approval, to outcome learning, to trust and access. Do not add testimonials, usage claims, logos, pricing, or performance statistics unless verified evidence exists.

### Private portal

| Route | User question | Core content |
| --- | --- | --- |
| `/app` | What deserves my attention today? | Decision counts, priority cases, clear next actions, and useful confirmed learning. |
| `/app/new` | What outcome am I trying to move? | Module selection, outcome definition, module-specific context, learning selection, and sources. |
| `/app/cases/[id]` | What is true, what was produced, and what happens next? | Progress, working context, current revision, evidence, variants, approvals, sources, related learning, and audit timeline. |
| `/app/approvals` | What exact decisions are waiting for me? | Current revision, full content or action payload, edit path, and approval action. |
| `/app/outcomes` | What actually happened, and what should be reused? | Outcome form, next action, learning disposition, confirmation, and evidence. |
| `/app/settings/connections` | What is connected, what can it do, and how do I revoke it? | Gmail identity and scope, reconnect/disconnect controls, language, export, and data controls. |
| `/admin/pilot` | Who requested access and who may be invited? | Pilot applications and invitation controls, visually distinct from tenant work. |

Desktop portal navigation uses a persistent left sidebar. Mobile uses a fixed top bar and a labelled bottom navigation with no more than five top-level destinations. If Connections is not in the bottom navigation, it must remain reachable through a visible account or settings entry; do not silently hide it.

## Primary journey

1. A prospect understands the operating loop and requests access.
2. An invited user authenticates and enters their own workspace.
3. Today surfaces the decisions, blocked items, ready actions, and outcomes that need attention.
4. The user creates a case by choosing a module, defining the desired outcome and success criteria, and adding the minimum useful context and sources.
5. The system prepares a structured work packet and artifact revision.
6. The case workspace presents observations, assumptions, gaps, risks, sources, current revision, and next action in human-readable order.
7. The user edits if needed, then approves the exact artifact revision and, for an external action, the exact recipient, subject, body, and payload.
8. If Gmail is connected, the user explicitly creates the approved draft. Sending remains manual in Gmail.
9. The user records the actual outcome, evidence, confidence, next action, and what worked or failed.
10. The user keeps, adapts, discards, and when appropriate separately confirms the proposed reusable learning.

Preserve context and scroll position when users move between a queue and a case. Deep links should resolve to the relevant case or review surface after authentication.

## Visual direction

### Character

The design language is a quiet command centre: editorial clarity for long-form thinking combined with operational precision for states and actions. Dark mode feels focused and cinematic without becoming glossy or futuristic. Light mode feels airy and professional without becoming generic enterprise software.

Use:

- dark ink and cool paper surfaces;
- navy as the trust and primary-action colour;
- sea green and coral as restrained module and state accents;
- thin borders, soft translucent surfaces, and controlled depth;
- large, tightly set display type on marketing and page introductions;
- compact but legible operational metadata;
- whitespace to separate decisions, evidence, and actions.

Avoid:

- saturated purple/pink “AI” gradients as the core identity;
- glass blur on every card;
- decorative charts or metrics without a user decision;
- emoji as structural icons;
- excessive pills, floating elements, shadows, or animation;
- hiding important state behind hover, tooltips, or colour alone.

### Brand mark and imagery

The four-part geometric brand mark represents separate inputs becoming one operating system. Preserve its proportions, rotation, and cool navy treatment. It may appear in the marketing navigation, portal shell, login, and diagrams.

Product UI is the primary visual evidence. Prefer accurate interface compositions, workflow diagrams, and source-to-outcome structures over generic stock photography. Any screenshot or demo must use sealed fictional data and be labelled when it could be mistaken for a live workspace.

## Colour system

Use semantic tokens in components. The following values describe the current brand system; consolidate implementation aliases over time rather than adding new raw colours.

[`app/globals.css`](app/globals.css) is the runtime token source. Update it and this document together when an approved token changes. New components should consume semantic custom properties instead of repeating hex values. Existing names such as `--violet`, `--cyan`, and `--amber` are compatibility aliases for navy, sea, and coral—not permission to reintroduce a separate purple, cyan, or yellow palette.

### Core palette

| Role | Dark/default | Light | Use |
| --- | --- | --- | --- |
| Canvas | `#09090D` | `#F4F7FB` | Page background. |
| Shell | `#0C0C10` | `#F4F7FB` | Portal working area. |
| Strong surface | `#0A0A0E` | `#FFFFFF` | Sidebar, form, and prominent panel surfaces. |
| Raised surface | `rgba(255,255,255,.025)` | `#FFFFFF` | Cards and grouped controls. |
| Primary navy | `#17324D` | `#17324D` | Primary actions, active trust cues, and brand. |
| Navy highlight | `#91ADC3` | `#365B80` | Active navigation, secondary emphasis, and links. |
| Sea | `#5FA8A2` | `#08717B` | Operations, outcome, focus, and supporting status. |
| Coral | `#C97B68` | `#9B3F32` | Intelligence, action-ready state, and warm emphasis. |
| Success | `#78D5A3` | `#166534` | Confirmed completion or connection. |
| Danger | `#FF7F8F` | `#B42339` | Failure, blocked, destructive action, or destructive focus. |

The primary button may use the existing navy gradient from `#355F88` through `#244B70` to `#173752`. Gradients are accents, not a substitute for hierarchy.

### Text tokens

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| Strong | `#F2EFF6` | `#172033` | Headings, decisive values, and primary labels. |
| Default | `#D4D0DA` | `#263244` | Main artifact and body content. |
| Secondary | `#B8B4C0` | `#344054` | Supporting explanations. |
| Muted | `#9995A1` | `#475467` | Metadata and non-critical labels. |
| Subtle | `#85818D` | `#667085` | Lowest-emphasis text that still passes its required contrast. |

Normal text must meet a 4.5:1 contrast ratio; large text and essential graphical controls must meet at least 3:1. Never rely on colour alone: pair module and status colour with a label, icon, position, or pattern.

### Module and status mapping

| Meaning | Accent | Required companion |
| --- | --- | --- |
| Growth & Revenue | Navy blue, currently `#456F98` in module markers | Module name or `01`. |
| Business Intelligence & Operating Memory | Sea, `#5FA8A2` | Module name or `02`. |
| Brand Communications & PR | Coral, `#C97B68` | Module name or `03`. |
| Awaiting approval | Navy highlight | “Awaiting approval” and the revision number. |
| Ready to execute | Coral | Exact action label such as “Create Gmail draft.” |
| Outcome due | Sea | “Outcome due” and next-action copy. |
| Blocked or failed | Danger | Cause and recovery action. |

## Typography

- Primary family: Manrope for marketing, navigation, forms, and portal content.
- Traditional Chinese fallbacks: `PingFang HK`, then `Microsoft JhengHei`, then system sans-serif.
- Latin/system fallbacks: `Avenir Next`, `SF Pro Display`, then system sans-serif.
- Technical family: Geist Mono for hashes, IDs, fingerprints, and fixed-width evidence only.

Typography should create hierarchy before borders or colour do:

- Marketing display: fluid and editorial, typically `clamp(3.25rem, 5.2vw, 4.9rem)` for the main hero.
- Portal page title: `clamp(2.4rem, 5vw, 4.8rem)` with tight tracking and approximately `1.05` line height.
- Section title: approximately `1.35rem`, with smaller compact variants when the hierarchy is already clear.
- Body and form input: at least `1rem` with `1.5–1.75` line height.
- Metadata and labels: normally `0.75–0.875rem`; do not make essential operational copy smaller than 12 px.

Keep long-form text to roughly 60–75 characters per line on desktop. Prefer wrapping over truncation. Do not encode marketing line breaks that work in one language but fail in the other; use locale-aware copy and responsive wrapping.

## Layout and spacing

Use a 4 px base with an 8 px primary rhythm. Preferred spacing steps are 4, 8, 12, 16, 24, 32, 48, 64, 72, 96, and 120 px.

### Desktop

- Public navigation and core content: maximum width 1180 px.
- Portal sidebar: 236 px, reducing to 200 px on compact desktop/tablet.
- Portal page: maximum width 1180 px with at least 32 px side clearance on standard desktop.
- Dense rows may use a grid, but primary title, state, and next action must remain scannable in that order.
- Long case pages use a main column plus supporting side column; the main artifact always receives more width.

### Mobile

- At 720 px and below, replace the desktop sidebar with a 64 px top bar and 70 px bottom navigation.
- Reserve content padding for both fixed bars and device safe areas.
- Use a 15–22 px page gutter depending on the surface.
- Stack primary and secondary actions at full width when horizontal placement would shrink their targets or labels.
- Convert dense rows and multi-column forms to a single-column reading order.
- Progress indicators may hide repeated text visually only when an accessible label remains available.
- No page-level horizontal scrolling. Wrap, stack, or provide a deliberate local overflow container for truly tabular content.

Validate at 320, 375, 768, 1024, and 1440 px, including mobile landscape.

## Navigation and orientation

- Keep navigation location and ordering stable across portal pages.
- Every navigation icon has a visible text label except the compact create action, which requires an accessible name.
- Highlight the current route with more than colour alone when practical, such as background plus text emphasis.
- Maintain a predictable browser back path and preserve filter, input, and scroll state where safe.
- Move focus to the main content heading after a route change when client navigation would otherwise leave focus in the previous page chrome.
- Add a “Skip to main content” path for keyboard and assistive-technology users.
- Do not use modals as primary navigation.

## Components and interaction patterns

### Buttons and links

- One primary action per decision area.
- Primary buttons are filled navy; secondary buttons are neutral outlined controls; destructive buttons are danger-coloured and spatially separated.
- Use explicit verb-object labels: “Create case,” “Approve exact draft,” “Create Gmail draft,” “Record outcome.”
- Never label an in-product action “Send email.”
- Minimum interactive target is 44 × 44 px with at least 8 px separation from adjacent targets.
- Disabled controls remain semantically disabled and explain the unmet requirement nearby.
- Hover, pressed, focus, loading, success, and error states must be visually distinct without shifting surrounding layout.

### Icons

Use one consistent SVG icon family with a shared stroke weight for structural navigation and controls. Icons supplement labels rather than replace them. The custom brand mark is the only standalone visual system mark. Text glyphs may remain inside sealed demo artwork, but production navigation should migrate away from font-dependent emoji or symbols.

### Cards and panels

- Use cards to group one decision, one object, or one coherent evidence set—not as decoration around every paragraph.
- Standard portal cards use 14–20 px radii, a thin theme-aware border, and subtle surface contrast.
- Elevation is reserved for navigation, overlays, and prominent approval surfaces.
- Keep destructive zones visibly separate from normal case actions.

### Forms

- Every control has a persistent visible label; placeholders provide examples, not identity.
- Mark required fields in text or with an explained asterisk.
- Group related inputs under a descriptive `fieldset` and `legend`.
- Use the correct input type, browser autocomplete, and locale-appropriate examples.
- Validate after a user leaves a field or submits; avoid disruptive errors on every keystroke.
- Place the error beside the affected field, summarize multiple errors at the top, and focus the first invalid field after submit.
- During asynchronous submission, disable duplicate submission and change the button label to a present-progress phrase.
- Preserve recoverable user input after network or validation errors.

The new-case flow uses progressive disclosure: shared outcome fields appear for every module, module-specific fields appear only for the chosen module, and source inputs remain the final step before creation.

### Status and feedback

- Use inline status for durable state and `aria-live="polite"` for non-blocking updates.
- Use `role="alert"` for errors that require attention without moving focus unnecessarily.
- Loading longer than 300 ms should show local progress; content-heavy waits longer than one second should use a skeleton that reserves layout space.
- Empty states explain why the area is empty and what the user can do next.
- Error states state the cause when known and provide a retry, edit, reconnect, or return path.
- Success feedback confirms the completed action and the next state; it does not disappear before the user can understand it.

### Approval surfaces

Approval is a review surface, not a confirmation pop-up. For an external action, show together:

- current artifact revision;
- locked or stale state;
- recipient, Cc, Bcc, and thread where present;
- subject and complete body;
- human-readable explanation of the content and payload fingerprints;
- the exact action that approval enables;
- a clear “Edit and reapprove” path;
- a statement that any edit invalidates the approval;
- a statement that Solo Company OS creates a Gmail draft and never sends it.

Incomplete or stale approvals remain blocked with a specific recovery path. An idempotent retry should look like a continuation of the same action, not a second independent action.

### Outcome and learning surfaces

Outcome review collects the expected and actual result, evidence, confidence, what worked, what failed, blockers, next action, improvements, other angles, follow-up date, and learning disposition. Keep the form readable through grouped sections and progressive disclosure.

Reusable-learning cards show these layers in order: observed result; candidate learning; narrow applicability; evidence with evidence confidence; hypothesis to test (from `other_angles` only); and next step/test action (from `next_action` only). Supporting outcome counts, learning confidence, and validation status may remain in stored records for domain, persistence, or AI context, but they are not displayed in user-facing cards. Tags remain tags and never substitute for applicability. “Keep” creates an AI-proposed candidate with `approved_for_reuse=false`; “adapt” approves the exact user-edited candidate and applicability while leaving validation pending; “discard” records the outcome and creates no learning record. Approval for reuse and evidence validation are separate states, and historical rows remain unassessed rather than being silently rewritten.

## Page-level composition

### Product page

Use a fixed translucent navigation, a large promise-led hero, an accurate Today preview, a visual account of scattered work, a command-centre section, three module narratives, an exact-approval demonstration, an outcome-learning loop, trust boundaries, and a final access call to action. Scroll effects should support the story and never delay access to content.

### Access and login

On wide screens, pair a concise trust-and-pilot introduction with a focused form card. On mobile, stack introduction then form. State invite-only access, human approval, and outcome-led operation before requesting personal information.

### Today

Lead with a time-appropriate personal greeting and a single “New case” action. Show four compact decision counts: approvals, ready actions, outcomes due, and blocked work. Follow with priority cases ordered by judgement need, then confirmed learning that may be useful again. Do not add usage telemetry to the user dashboard.

### New case

Present a numbered sequence: choose a module, define the outcome, add module-specific context, optionally select confirmed learning, add sources, then create. Keep fixed lifecycle guidance visible: context → draft → approval → optional Gmail draft → outcome. File and URL constraints should appear before submission.

### Case workspace

Show lifecycle progress and case identity first. The main column contains working context, the current human-readable artifact, audience variants when relevant, the work packet, and the current approval/action surface. The supporting column contains sources, related learning, audit timeline, and the separated destructive zone. Current content must be visually dominant over historical or technical metadata.

### Approvals

Use a queue of full review panels rather than compact approve buttons. Order the oldest actionable decision first. Show incomplete action data as a blocker with a direct link back to the exact case and missing fields.

### Outcomes

Put the oldest pending outcome first, then show reusable learning. Confirmation is a separate, explicit control. Evidence may collapse into details, but evidence and evidence confidence remain visible at card level. Stored supporting counts, learning confidence, and validation status are deeper metadata rather than card-level display fields. Keep, adapt, and discard copy must explain whether a candidate is proposed, explicitly approved for reuse, or intentionally omitted.

### Connections and data controls

For each connector, show identity, connection state, requested scope, allowed action, prohibited action, and revoke/reconnect controls. Gmail copy always says “create drafts” and “never sends.” Data export and deletion controls are separate from connector controls; destructive actions require exact, local confirmation.

## Motion

- Keep portal interaction transitions between 150 and 250 ms.
- A route crossfade may take 200–300 ms but must not block navigation.
- Animate opacity and transform, not layout dimensions.
- Define shared easing and duration tokens once and reuse them across CSS and any JavaScript animation primitive.
- Gate transform-based hover effects behind `@media (hover: hover) and (pointer: fine)` so touch input never inherits desktop motion assumptions.
- Use one shared reveal primitive for marketing sections rather than page-specific observers or animation variants.
- Use motion to explain cause and effect: opening details, confirming state, or moving through a lifecycle.
- Limit marketing reveals to one or two meaningful elements per viewport section.
- Avoid automatic carousels, decorative parallax, magnetic cursors, and long staged entrances.
- Under `prefers-reduced-motion: reduce`, remove smooth scrolling and non-essential movement while preserving state feedback.

## Themes

Dark and light themes are both first-class. Default to the saved user preference, then the operating-system preference when no saved choice exists. The theme toggle must state the destination theme in the active language and persist locally.

Do not generate light mode by simple colour inversion. Re-evaluate text, border, input, focus, success, warning, and danger contrast in each theme. Modal scrims, disabled states, and data accents must remain distinct in both themes.

## Bilingual content design

- Default product language is Traditional Chinese (`zh-Hant`); English is fully supported.
- Persist the authenticated user’s portal language. Public language preference may remain local to the browser.
- Update the document language exposed to assistive technology when the live interface language changes.
- Artifact content remains in the locale captured when that revision was generated; changing interface chrome must not silently translate or mutate it.
- Use Hong Kong conventions for local date and time presentation where the product is explicitly localised.
- Prefer plain, grounded language. Explain system behaviour before technical implementation.
- Keep safety copy specific: “creates a Gmail draft,” “requires fresh approval,” “source could not be processed.” Avoid “AI-powered,” “smart,” “magic,” and claims of autonomy unless the statement conveys a precise capability.

### Content register

The two languages are equivalent in meaning, but each surface has an
intentional register:

| Surface | Traditional Chinese | English | Content rule |
| --- | --- | --- | --- |
| Marketing and public story | Restrained Hong Kong Cantonese-influenced Traditional Chinese | Clear, warm plain English | Ground the promise in the operating loop; avoid unverified hype, testimonials, pricing, or autonomy claims. |
| Portal and AI output | Clear written Traditional Chinese with Hong Kong terms | Clear written English | Make decisions, approvals, recovery, and outcome recording easy to understand. |
| Privacy and Terms | Formal equivalent written Traditional Chinese | Formal equivalent English | Keep the same scope, limitations, pre-launch label, and counsel-review-pending notice. |
| Errors and security states | Direct written language plus recovery action | Direct written language plus recovery action | Name the blocked state and the next safe action without exposing sensitive content. |

The founding-pilot privacy and terms bundle is versioned in
[`src/lib/legal/pilot-policy.ts`](src/lib/legal/pilot-policy.ts). Changing the
interface locale never silently translates or mutates an artifact revision, and
changing locale in the pilot form invalidates its consent controls.

## Accessibility requirements

Target WCAG 2.2 AA for public and private surfaces.

- All functionality is operable with keyboard alone in a logical visual order.
- Every page has one clear `h1` and a sequential heading hierarchy.
- Focus indicators are always visible, at least 2 px thick, and not clipped by overflow.
- Every icon-only control has an accessible name; decorative marks are hidden from assistive technology.
- Meaningful images have useful alternative text; complex diagrams include a nearby text summary.
- Form labels, descriptions, errors, required state, and invalid state are programmatically associated.
- Route changes, async outcomes, and validation messages are announced without stealing focus unexpectedly.
- Zoom to 200% and browser text scaling must not hide content or actions.
- Colour, location, or motion is never the sole carrier of meaning.
- Light mode, dark mode, high zoom, 320 px width, screen-reader reading order, keyboard operation, and reduced motion are release checks.

## Performance and content integrity

- Reserve dimensions for screenshots, previews, skeletons, and async panels to keep cumulative layout shift below 0.1.
- Optimise non-critical images to responsive AVIF or WebP and lazy-load below-the-fold media.
- Load only the font weights used by the interface; use `font-display: swap` or the framework equivalent.
- Avoid third-party scripts that weaken privacy or block first interaction.
- Carry source identity and the canonical public URL through ingestion, persistence, and presentation. A generated summary or interpretation must remain distinguishable from the source itself.
- Preserve attribution whenever public source material is shown. If a source lacks a field or the system lacks evidence, leave it absent or mark it unknown; never fabricate a helpful-looking replacement.
- Do not put private source text, artifact bodies, prompts, OAuth data, or tenant data into analytics, public previews, or client logs.

## Design boundaries for the MVP

Do not add these without an approved scope change:

- billing or public pricing flows;
- teams, roles, or multi-user collaboration UI;
- autonomous email sending or a send control;
- inbox browsing or general Gmail management;
- a general workflow canvas or automation builder;
- broad autonomous web crawling;
- charts whose data does not support a concrete user decision;
- provider-managed conversation history presented as product memory;
- claims of Zero Data Retention, autonomous monitoring, or silent self-improvement.

## Acceptance checklist

A new or materially changed surface is ready when:

- it advances one of the three MVP modules or the shared operating loop;
- its primary user question and next action are obvious within the first viewport;
- public code cannot query or embed tenant data;
- approval surfaces bind the exact revision and exact action payload;
- Gmail language and controls remain draft-only;
- every loading, empty, error, blocked, success, stale, and disabled state has a recovery path;
- Traditional Chinese and English both fit without clipping or lost meaning;
- light and dark themes meet contrast requirements;
- keyboard, screen reader, 200% zoom, reduced motion, and 320 px checks pass;
- interactive targets are at least 44 × 44 px;
- no essential state relies on colour, hover, animation, or a technical identifier alone;
- the design contract and runtime tokens were updated together for any approved system change;
- the shared copyright notice remains exactly once in the root layout;
- `npm run check` passes before implementation is reported complete.

## Comparative reference: AIGRO

The public [AIGRO repository](https://github.com/ekcheungAI/aigro) was reviewed on 2026-08-16 as a non-authoritative reference because it also serves a Hong Kong audience across AI, growth, and business intelligence. Its product and brand are separate from Solo Company OS.

Transfer these ideas:

- Treat brand and interaction rules as testable constraints rather than mood-board suggestions.
- Keep a concise design contract, implementation map, and release checklist close to the code.
- Bind semantic colour, type, and motion decisions to runtime tokens and shared primitives.
- Gate hover motion to fine pointers and provide a deliberately gentler reduced-motion path.
- Carry attribution and canonical links in the data model, and leave unavailable analysis empty rather than inventing it.
- Use editorial hierarchy to make dense evidence readable while keeping the operational action layer restrained.

Do not transfer these elements:

- AIGRO’s lime accent, serif publication identity, stripe motifs, or logo rules;
- intelligence feeds, daily digests, expert profiles or avatars, chat personas, quotas, pricing, bookings, or an MCP marketplace;
- broad scheduled ingestion or public-content crawling;
- frontend snapshot patterns for tenant data;
- roadmap claims or mocked capabilities that are not implemented and verified in Solo Company OS.

The relevant external references are AIGRO’s [design system](https://github.com/ekcheungAI/aigro/blob/main/docs/design-system.md), [motion and interaction rules](https://github.com/ekcheungAI/aigro/blob/main/docs/taste-rules.md), [portable design contract](https://github.com/ekcheungAI/aigro/blob/main/public/design.md), and [architecture map](https://github.com/ekcheungAI/aigro/blob/main/docs/ARCHITECTURE.md).

## Implementation references

- Product and operating model: [`README.md`](README.md)
- Product constraints and validation: [`AGENTS.md`](AGENTS.md)
- Theme, layout, and current tokens: [`app/globals.css`](app/globals.css)
- Root typography and metadata: [`app/layout.tsx`](app/layout.tsx)
- Public product composition: [`src/components/marketing/product-page.tsx`](src/components/marketing/product-page.tsx)
- Portal navigation: [`src/components/portal/portal-shell.tsx`](src/components/portal/portal-shell.tsx)
- Dashboard hierarchy: [`src/components/portal/today-dashboard.tsx`](src/components/portal/today-dashboard.tsx)
- New-case interaction: [`src/components/portal/new-case-form.tsx`](src/components/portal/new-case-form.tsx)
- Bilingual portal terminology: [`src/lib/i18n/portal-copy.ts`](src/lib/i18n/portal-copy.ts)
