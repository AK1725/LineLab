# 0001. Record architecture decisions

- Status: accepted
- Date: 2026-11-23

## Context

LineLab is built over many sessions and phases, by people and by Claude Code. Decisions that depart from `docs/BLUEPRINT.md` need to be written down, or the next session will either undo them or repeat the investigation.

## Decision

Every deviation from the blueprint, and every significant technology choice, gets an ADR in `docs/adr/NNNN-short-title.md` with: Status, Date, Context, Decision, Consequences. ADRs are never edited after acceptance except to mark them superseded by a newer ADR.

## Consequences

- `CLAUDE.md` tells every session to read the ADRs along with the blueprint.
- The blueprint stays a vision document. When it and an ADR disagree, the ADR wins.
