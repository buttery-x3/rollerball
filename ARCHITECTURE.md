# Rollerball Architecture

This file is the repository-level ownership and dependency map.

Detailed gameplay and subsystem contracts are authoritative in Linear:

- Project: https://linear.app/flamehorn-games/project/rollerball-1bb5e3fa1016/overview
- Architecture hub: https://linear.app/flamehorn-games/document/rollerball-architecture-and-simulation-a5909f5b8287

Use this file to answer:

- which subsystem owns this state or behaviour?
- which dependencies are allowed?
- where should shared calculations live?
- which existing path should a new implementation extend?

Do not duplicate detailed gameplay rules here. If this map and Linear disagree, resolve the design conflict before implementation.

## System model

Rollerball is a deterministic arcade sports simulation rendered in 3D but played primarily on a 2D arena plane.

- Players move and collide on the planar arena.
- The loose ball additionally has height and vertical velocity, enabling lob trajectories without full 3D player physics.
- Simulation state is authoritative.
- Human and AI control both produce the same gameplay-facing intent/actions.
- Rendering, UI and diagnostics observe simulation state; they do not own it.

Broad dependency flow:

```text
Browser input
     │
     ▼
Human control ─────┐
                   │
GameState ──► AI ──┤
(read-only queries)│
                   ▼
              PlayerIntent
                   │
                   ▼
            Fixed-step simulation
                   │
                   ▼
                GameState
              /     |      \
             /      |       \
         Rendering  UI    Diagnostics
```

`GameRuntime` coordinates these pieces and owns fixed-step execution, but gameplay rules and authoritative gameplay state belong to simulation.

The simulation must not depend on the source of an intent.

## Expected ownership regions

Create these regions only when implementation requires them:

```text
src/lib/game/
  runtime/
  sim/
  physics/
  control/
  ai/
  config/
  render/
  debug/
  scenarios/
```

Svelte components may host the game canvas, HUD and development workbench outside these regions, but must not become gameplay state owners.

### `runtime`

Owns execution/orchestration:

- fixed-step accumulator;
- 60 Hz simulation scheduling;
- bounded catch-up;
- render interpolation timing;
- pause/step/time-scale development execution;
- connecting input/control, simulation, rendering and diagnostics.

Runtime does not own gameplay rules.

### `sim`

Owns authoritative gameplay state and ordered gameplay systems.

Conceptually:

```ts
interface GameState {
  tick: number;
  players: PlayerState[];
  ball: BallState;
  teams: TeamState[];
  match: MatchState;
}
```

Expected responsibilities include:

- player runtime state;
- ball state and possession transitions;
- locomotion/action state;
- contact consequences;
- receiving and one-touch resolution;
- goalkeeper gameplay state;
- scoring/rules;
- match state;
- semantic gameplay events.

Simulation must be executable headlessly without Svelte, Three.js, DOM, canvas or physical controller hardware.

### `physics`

Owns reusable deterministic geometry/motion calculations:

- project-owned vector/math types;
- circle contact and overlap geometry;
- arena constraints;
- static-boundary sweep calculations;
- ball trajectory integration/prediction;
- wall/goal crossing geometry;
- reusable reach/intersection calculations where physically defined.

Physics determines geometry and motion.

It does not decide authored sporting consequences such as check effectiveness, stumble, turnover, catch versus parry or tactical decisions.

### `control`

Owns human input semantics and controller-to-player assignment.

Expected responsibilities include:

- device mapping and deadzones;
- continuous input snapshots;
- exactly-once discrete input edges/pulses;
- gameplay-facing `PlayerIntent`;
- button charge/action input state;
- right-stick throw capture;
- manual player switching;
- possession-driven automatic switching;
- predicted-receiver control routing;
- defensive auto-switch selection.

Player switching is not `PlayerIntent`.

Device-specific input details must not leak into simulation.

### `ai`

Owns computer decision-making, not gameplay outcomes.

AI flow:

```text
authoritative GameState
        │
        ▼
read-only world queries
        │
        ▼
team tactical planner
        │
        ▼
dynamic assignments / targets
        │
        ▼
individual controller
        │
        ▼
PlayerIntent
        │
        ▼
ordinary simulation
```

AI may inspect authoritative state through read-only query surfaces but must never directly mutate it.

Team and individual tactical reconsideration initially run at approximately 10 Hz, with deterministic event-triggered reconsideration where required. Movement/action execution still occurs through the normal 60 Hz simulation path.

Spatial decisions use the shared pattern:

```text
generate candidates
      ↓
cheap validity filters
      ↓
weighted scoring
      ↓
expensive tests for survivors
      ↓
stable selection / hysteresis
```

Do not create unrelated positioning frameworks for different AI behaviours.

### `config`

Owns committed gameplay defaults, tuning metadata and derived-value mappings.

Domains eventually include:

- runtime;
- arena;
- movement;
- ball/trajectory;
- controls/charging;
- receiving;
- contact/checking;
- goalkeeper;
- AI;
- match.

Keep these concepts distinct:

```text
committed default
development override
stat/role-derived effective value
```

Gameplay systems consume effective configuration; meaningful tuning constants should not be embedded independently inside systems.

### `render`

Owns Three.js presentation:

- scene/camera;
- arena visuals;
- player/ball presentation;
- simulation-to-render coordinate mapping;
- interpolation;
- presentation-only effects.

Three.js transforms are not gameplay state.

Simulation must not import from `render`.

### `debug`

Owns development observability and workbench presentation:

- structured diagnostic transport;
- debug layer rendering;
- entity-focused inspection;
- event/decision inspection;
- tuning controls;
- pause/step/time-scale UI;
- scenario loading;
- replay inspection.

Simulation and AI publish structured diagnostic data. `debug` translates that data into Three.js/UI presentation.

Expensive diagnostic calculations may be disabled outside development use.

### `scenarios`

Owns deterministic executable gameplay situations and replay fixtures.

A scenario may define:

- initial simulation state/setup;
- controlled player/team;
- tuning overrides;
- scripted external intents;
- expected invariants;
- development debug defaults.

The same scenario definition should support:

```text
headless automated execution
            +
interactive workbench execution
```

Recorded replays preserve simulation-facing external inputs/configuration so real problematic runs can be executed again through the actual simulation.

## Core state boundaries

### Definitions versus runtime state

Stable data must remain separate from mutable simulation state.

Stable data includes:

- player identity;
- team identity;
- player attributes;
- field-player versus goalkeeper structural role;
- arena definition;
- restart positions;
- committed tuning/configuration.

Runtime state includes:

- position and velocity;
- facing;
- charge/buffer/action state;
- check/stumble/recovery state;
- possession;
- goalkeeper commitment/recovery;
- tactical assignments;
- match state and clock.

Changing human control must never recreate player identity or runtime state.

### Ball

The ball has exactly one authoritative mode:

```text
Loose
  planar position
  planar velocity
  height
  vertical velocity
  release/interaction metadata

or

Possessed
  holderId
```

A possessed ball is not also simulated as loose physics attached to a player.

The ball cannot have multiple owners.

### Teams

Each team contains:

```text
4 field players
1 goalkeeper
```

Team membership is stable data.

Field-player tactical roles are dynamic assignments, not permanent player classes.

Goalkeeper is the one intentional structural role because it has different movement constraints and save behaviour.

### Match

Match flow owns:

- match phase;
- score;
- active-play clock;
- goal stoppage;
- restart/reset procedure;
- full-time;
- rematch reset.

Goal geometry detects a valid score.

It does not teleport/reset players or own match progression.

UI displays match state but does not transition it.

## Coordinates and presentation

Simulation arena coordinates:

```text
               +Y
       human attack direction
                ↑

-X  ←        (0,0)        → +X

                ↓
               -Y
```

- X runs across the arena and goal mouth.
- Y runs goal-to-goal.
- Human play is presented attacking upward / `+Y`.
- Camera orientation is fixed and never rotates during play.
- Rendering maps simulation `(x, y)` onto the Three.js ground plane.
- Ball height is a separate scalar.

## Player and goalkeeper physics

Field players are circles on the simulation plane.

Their locomotion is inertia-aware:

- input expresses desired movement/facing;
- velocity changes through acceleration/braking;
- facing may change faster than velocity;
- hard reversal is not instantaneous.

Goalkeepers use the same broad player infrastructure but a different locomotion profile:

- confined to a rectangular crease;
- slower sustained movement;
- lower inertia;
- quicker stopping/reversal;
- responsive lateral and short forward/backward movement.

Goalkeeper save reach/commitment is specialised gameplay behaviour layered over this shared physical model.

Field players are not automatically forbidden from entering the keeper crease.

## Ball and arena physics

The arena is a bounded rectangle with:

- side/end boards;
- centred goal apertures;
- explicit goal width;
- explicit crossbar height;
- configured goalkeeper creases.

The loose ball is a planar circle plus independent vertical state.

Ball physics includes:

- planar movement/damping;
- gravity;
- ground bounce/damping;
- wall rebound;
- swept collision/crossing where discrete 60 Hz checks could tunnel.

Arena boards remain vertically blocking: a lob may pass over players but not leave over the wall.

High and low throws are distinct trajectory families.

Goal detection uses the same authoritative arena/ball geometry and must support fast swept crossings.

## Shared gameplay queries

Calculations that multiple systems depend on must have one authoritative implementation.

In particular, shared ball/arena query surfaces should support:

- predicted planar trajectory;
- height over time;
- landing time/position;
- wall/goal crossing;
- receive/intercept opportunities;
- ball reachability.

These calculations are reused by:

```text
gameplay resolution
receiver claims
goalkeeper behaviour
AI
diagnostics
tests/scenarios
```

Do not implement independent forecasts for each consumer.

AI may build additional read-only world queries from authoritative state, including:

- time/reach estimates;
- passing-lane obstruction;
- spacing/density;
- goal-side relationships;
- shot threat;
- effective player capability.

Queries do not mutate `GameState`.

## Control and receiving boundary

Human control is routed separately from player intent.

Control may change because of:

- established possession;
- a strong predicted receiver claim;
- opponent possession/defensive transition;
- manual Switch;
- goalkeeper possession.

Receiver claims are derived from actual ball trajectory and reachable receive opportunities rather than an invisible mandatory pass target.

Claims use stability/hysteresis so control does not oscillate between near-equal candidates.

A controlled expected receiver may provide throw input before contact. The simulation resolves whether that becomes an ordinary receive or valid one-touch action.

## Simulation order

The canonical phase relationship is defined in Linear. Preserve an explicit deterministic order broadly equivalent to:

```text
control routing / external input consumption
                ↓
PlayerIntent production
                ↓
charge / buffered action / check state
                ↓
discrete action starts/releases
                ↓
player locomotion and facing
                ↓
player ↔ arena constraints
                ↓
player ↔ player physical contact
                ↓
loose-ball planar/vertical integration
                ↓
ball ↔ arena sweeps / ground response
                ↓
ball ↔ player interactions
receive / one-touch / possession / keeper save
                ↓
goal + match rules
                ↓
semantic events + diagnostics
```

If implementation requires changing a documented phase relationship, that is an architecture change rather than a private refactor.

## Events

Semantic gameplay events are outputs such as:

```text
GoalScored
PossessionChanged
BallReleased
ReceiverClaimChanged
PlayerChecked
SaveMade
```

They may feed presentation, audio, diagnostics, logs or development tooling.

Core simulation progression remains an explicit ordered update over authoritative state and must not depend on arbitrary event-subscriber ordering.

## Diagnostics and tuning

Observability is part of the architecture.

Gameplay/AI systems expose structured data sufficient to inspect relevant behaviour, including where applicable:

- vectors/paths/regions;
- collision/sweep information;
- trajectory/height;
- receive/receiver state;
- control-switch reason;
- check/contact outcome factors;
- keeper target/reach/save reasoning;
- AI candidates/rejections/score components;
- match transitions.

The workbench reads the same central tuning configuration used by gameplay.

The workbench may alter development overrides but never becomes authoritative gameplay state.

## Determinism and replay

Initial simulation rate is **60 Hz fixed step**.

Given the same:

```text
initial state
configuration/tuning
external input sequence
random seed/state, if ever introduced
```

the simulation should produce the same result.

Rendering frequency must not alter gameplay results.

Recorded replay should preserve simulation-facing external inputs rather than merely semantic output events so replay executes the real simulation again.

## Repository status

At FLAME-120 the repository is intentionally not yet bootstrapped.

The ownership regions described above are architectural boundaries, not a requirement to create every directory/interface immediately.

FLAME-108 establishes the initial runtime/simulation/render structure. Later issues create additional ownership regions only when they have real responsibilities.

Update this file when approved implementation materially changes repository ownership or dependency direction.

Do not use it as a changelog or duplicate detailed Linear subsystem specifications.