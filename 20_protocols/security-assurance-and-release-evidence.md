---
title: Security Assurance and Release Evidence
status: active
owner: Demo User
updated: 2026-08-21
source_of_truth: true
supersedes: []
tags: [solo-company-os, security, assurance, evidence, release]
---

# Security assurance and release evidence

Security claims must point to an implementation source and a validation result.
The release evidence register is observational (`source_of_truth: false`); the
protocols, migrations, tests, and `AGENTS.md` remain authoritative.

## Evidence tiers

- **Source** — a code, migration, test, or protocol reference exists. This
  proves intent or a tested contract, not deployment.
- **Local** — the named command passed against the isolated local environment.
- **Preview** — the named revision was checked in the preview environment.
- **Live** — the named production revision was checked after deployment.

Never upgrade a tier because a lower tier passed. Record environment,
timestamp, revision, owner, and whether the item blocks deployment.

## Assurance claims

For every claim, record:

1. the exact sentence a user or operator might rely on;
2. one defence status (`Enforced`, `Tested`, `Manually verified`, `Incidental`,
   or `Planned`), never a combined status;
3. the strongest evidence tier actually earned;
4. the source file, test, command, or manual observation;
5. the remaining risk and a concrete next check.

Claims about counsel review, Google verification, backups, accessibility, or
production recovery remain launch gates until their evidence is recorded at the
required tier. This project does not claim Zero Data Retention, autonomous
monitoring, or preview/live verification without a matching register entry.

The vocabulary is exact: **Enforced** means the schema/runtime/policy is
present; **Tested** means a behaviour test exists; **Manually verified** means
named environment/manual evidence exists; **Incidental** means observed but not
relied upon as a defence; **Planned** means incomplete. Evidence references and
tiers state whether a control has tests or environment confirmation; status does
not combine those facts.

## Release gate

The root agent must inspect changed paths, run the proportionate checks, and
report pass/fail counts and blockers. A failed check outside the owned scope is
reported as an unknown or blocker; it is not silently repaired by broadening the
change.
