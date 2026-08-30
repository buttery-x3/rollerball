# AGENTS.md — Rollerball

Applies to the entire repository.

Authoritative design:

- Project: https://linear.app/flamehorn-games/project/rollerball-1bb5e3fa1016/overview
- Architecture hub: https://linear.app/flamehorn-games/document/rollerball-architecture-and-simulation-a5909f5b8287
- Repository ownership map: `ARCHITECTURE.md`

Referenced Linear design documents are part of the issue specification.

## Issue workflow

For every Linear implementation issue:

1. Read:
   - this file;
   - `ARCHITECTURE.md`;
   - the full Linear issue;
   - every design document referenced by the issue.
2. Inspect only the code/tests required to understand the affected subsystem.
3. Check out or create the issue branch. Never implement on `main`.
4. Before editing, identify:
   - owning subsystem;
   - state/interfaces changed;
   - simulation phases changed;
   - required diagnostics;
   - required tests/scenarios.
5. Apply the architecture hard-stop rules below.
6. If no hard stop applies, implement the issue only.
7. Run the required validation.
8. Commit with the Linear identifier in the subject.
9. Push the issue branch.
10. Report the commit and validation results.
11. STOP for approval.

Do not merge, delete the branch, or mark the Linear issue Done before explicit approval.

## Architecture hard stop

STOP BEFORE IMPLEMENTATION if the issue requires any of the following:

- changing subsystem ownership;
- changing dependency direction;
- moving or duplicating authoritative gameplay state;
- changing fixed-step simulation phase ordering;
- changing a documented state machine or invariant;
- changing a shared cross-subsystem contract;
- bypassing a documented shared intent, trajectory, receiver, arena, tuning, diagnostics, scenario, or replay path;
- adding a framework, runtime dependency, or new architectural layer;
- weakening deterministic/headless execution;
- contradicting the issue or a referenced design document;
- materially increasing issue scope to satisfy acceptance criteria.

When a hard stop applies:

1. Do not implement the conflicting change.
2. State the required architecture change.
3. Identify the affected design document(s).
4. STOP for approval.

After approval, update the authoritative design before implementing the changed contract.

## Implementation rules

- Simulation owns authoritative gameplay state.
- Simulation/physics MUST NOT depend on Svelte, Three.js, DOM, Gamepad, or browser-specific APIs.
- Simulation MUST use project-owned gameplay math types, not Three.js math types.
- Gameplay MUST advance through the fixed simulation step.
- Gameplay MUST NOT depend on render FPS or wall-clock timing.
- Discrete input MUST execute exactly once.
- Human and AI control MUST use the same gameplay action path.
- AI MUST NOT directly force gameplay outcomes.
- Player switching belongs to control routing, not `PlayerIntent`.
- Collision/sweep code MUST NOT contain authored check, stumble, turnover, catch, or save rules.
- Core simulation systems MUST NOT communicate through a general event bus.
- Shared gameplay/world calculations MUST NOT be duplicated.
- Meaningful gameplay tuning values MUST use the central tuning/config system.
- Required diagnostics MUST use the structured diagnostics system.
- Required gameplay regressions MUST use the shared deterministic scenario/replay system.
- Do not add later-milestone features.
- Do not add speculative frameworks, managers, abstractions, classes, or empty scaffolding.
- Do not perform unrelated refactors or cleanup.

## Git and Linear

- Never commit directly to `main`.
- One Linear issue per branch unless explicitly instructed otherwise.
- Include the Linear identifier in each commit subject.
- Push committed issue-branch work.
- Do not force-push or rewrite pushed history unless explicitly instructed.
- After implementation, validation, commit, and push: STOP for approval.
- After explicit approval:
  1. merge the approved branch into `main`;
  2. push `main`;
  3. confirm the approved commit is on `main`;
  4. delete the issue branch;
  5. mark the Linear issue Done.

Do not mark an issue Done while its implementation exists only on an issue branch.

## Validation

Before committing:

- run all repository validation commands listed below;
- run all tests/scenarios required by the Linear issue;
- verify every acceptance criterion that can be mechanically or directly verified.

If a required check fails, fix the issue before committing.

If a required check cannot be run, report that explicitly and do not claim it passed.

Do not add extra validation, refactoring, cleanup, or review work not required by the issue or these instructions.

## Ownership map

Use `ARCHITECTURE.md` for details.

- `runtime` — fixed-step orchestration
- `sim` — authoritative gameplay state/systems
- `physics` — planar collision/sweep/trajectory math
- `control` — input, intent, player routing
- `ai` — queries, planning, AI intent
- `config` — tuning/defaults/derived values
- `render` — Three.js presentation
- `debug` — diagnostics/workbench
- `scenarios` — deterministic scenarios/replays

Do not create empty structure solely to match this map.

## Validation commands

Repository not yet bootstrapped.

FLAME-108 MUST replace this section with the actual required commands.