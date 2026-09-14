# AI Execution Policy

## Purpose

Minimize student-side labor while preserving traceability, code quality, and explicit release gates.

## Chat

Primary responsibilities:

- project management and gate ownership;
- requirements and architecture decisions;
- scope control;
- acceptance criteria;
- review of evidence from Codex/Work;
- final go/no-go decisions.

Default reasoning level: High for architecture, release gates, failure triage, and security decisions. Medium is sufficient for routine status interpretation and small documentation decisions.

## Codex

Primary responsibilities:

- repository implementation;
- running commands and tests;
- debugging build/type/lint/test failures;
- creating bounded patches;
- reviewing diffs and regressions;
- producing exact command/output evidence for gate closure.

Use the strongest available coding model for implementation-critical work. Prefer High reasoning for new subsystems, difficult failures, networking, simulation, deployment defects, and release hardening. Medium is preferred for small isolated changes once the contract is already fixed.

Codex must not silently redesign frozen architecture. Any material architecture change returns to Chat for approval.

## Work

Primary responsibilities:

- long multi-step tasks spanning browser/cloud services/files;
- deployment/setup workflows where graphical web interaction is necessary;
- structured evidence collection;
- finished operational or CAS documentation when multiple sources need to be combined.

Use High reasoning for multi-service setup, deployment, release verification, and substantial research. Medium is adequate for bounded evidence collection or document production with a fixed template.

Work must not receive browser credentials or tokens in prompts unless the product's secure credential mechanism explicitly requires them. Prefer entering credentials directly into the provider UI or local environment.

## Resource routing rule

1. Chat defines the contract and exit criteria.
2. Codex performs repository work and command-driven verification.
3. Work is used only where browser/cloud/file orchestration materially reduces manual effort.
4. Results return to Chat for gate adjudication.

Avoid duplicating the same implementation task simultaneously across Chat, Codex, and Work.

## Repository authority

GitHub is the source of truth for code and committed project documentation.

Gate status is evidence-based. A task is not marked PASS because an agent states that it succeeded; command output, deployed behavior, or other directly inspectable evidence is required.
