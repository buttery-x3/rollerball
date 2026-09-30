# Autonomous Rollerball completion run

## Authorization and baseline

The user's 2026-09-30 request authorizes the remaining five-milestone plan on
`astra/rollerball-completion`, issue-scoped commits/pushes, bounded subagents,
and Linear comments/In Review statuses without stopping between issues.
Do not merge main, deploy, force-push, rewrite pushed history, or delete branches.
AGENTS.md and the authoritative Linear design remain unchanged.

Repository: https://github.com/buttery-x3/rollerball. Started from fetched
origin/main `037a460`; integrated receiving commits `4306370`/`39da7cf` and
preserved production hosting. Read AGENTS.md, ARCHITECTURE.md, project/milestones,
full issues/comments/dependencies and all eight referenced design documents.
Specification caches and tuning investigations live outside the repository at
`D:/dev/rollerball-run-context`. Existing attribute/collision worktrees preserved.

`npm ci` passed. Baseline: check clean;118 tests/21 files;production build passed.
The existing client-chunk-over-500kB warning remains non-failing.

## Issue checkpoints

All pushed issues below are Linear **In Review**, not Done. The integration branch
satisfies technical dependencies while awaiting human review.

| Issue | Commit | Implemented scope | Required validation at checkpoint |
|---|---|---|---|
| FLAME-124 | 7f3bb9e | Receiving/one-touch integration | check/build pass;137 tests/22 files |
| FLAME-113 | 19edceb | Goals, scoring, stoppage/restart | check/build pass;144/23 |
| FLAME-114 | b3cf941 | Speed/agility/power/strength/control | check/build pass;153/24 |
| FLAME-115 | db6e7f8 | Swept incidental player contact | check/build pass;162/26 |
| FLAME-125 | 9159cdf | Active checks, stumble, retention/turnover | check/build pass;172/27 |
| FLAME-116 | b448fab | Capability-aware receiving/redirect/retention | check/build pass;185/28 |
| FLAME-126 | 187f08d | Keeper locomotion, catch/parry/commit/recovery | check/build pass;197/29 |
| FLAME-117 | 6b8f34e | Two 5-player teams and control routing | check/build pass;210/30 |
| FLAME-127 | f87fbab | Shared readonly AI world queries/candidates | check/build pass;222/31 |
| FLAME-128 | a57005a | Stable team roles and field positioning | check/build pass;234/32 |
| FLAME-118 | 591b0f5 | Possession-aware AI actions/shared execution | check/build pass;408/33 |
| FLAME-119 | 259f504 | Match clock, full-time, start/rematch | check/build pass;422/34 |
| FLAME-129 | this checkpoint commit | Integrated tuning, workbench, replay/regressions | check/build pass;457 tests/36 files |

Dependency order:124→113;114+115→125;116→126→117→127→128→118→119→129.
All gameplay flows through fixed-step simulation and shared human/AI intents.

## Consequential implementation decisions

- Simulation owns ball, contact, keeper, tactical/action memory and match state.
  AI returns decisions/intents; query snapshots are detached and deeply readonly.
  No gameplay state moved to UI, physics or AI; no new runtime dependencies.
- Existing goal convention retained: ball leading extent reaches the end plane,
  full ball width/top fit the aperture; earlier swept interactions take precedence.
- Check outcomes reuse shared physical impact evaluation; receiving, routing and AI
  reuse common trajectory/reach/capability queries. Severe checks release carriers.
- Normal throws and one-touch redirects share geometric envelope-escape release
  exclusion, preventing cross-body redirects from immediately self-catching.
- Ready/start/rematch commands are recorded outside PlayerIntent. Final active tick
  resolves scoring before full-time; stoppages pause the clock. Rematch clears
  score/transients/tactics/input/history and returns Ready without a page refresh.
- Core subsystem fixtures may omit match rules; the default playable scenario
  enables the complete five-minute human-versus-AI match.

## FLAME-129 integrated evidence

Owning regions:debug/workbench;scenarios/replay;runtime playback speed;config;
bounded AI query/controller fixes. Gameplay phase ordering is unchanged.

Workbench supports exact one/N-tick stepping,0.25/0.5/1/2/4x, stable entity focus,
independent layers, typed event filtering, atomic category resets and override
export. Replay captures actual mapped external inputs, initial simulation state,
live tuning snapshots, interval hashes and final hash. Incremental playback uses
the real runtime, verifies checkpoints, pauses at the final tick and surfaces
configuration/divergence errors. Compact JSON preserves undefined/-0; large JSON
editors default collapsed. Legacy v1 replay transport remains accepted.

Three concrete AI defects found in full-match investigation were repaired:
1. Friendly keeper obstruction was omitted from throw forecasts. It now uses the
   existing swept contact/save envelope and rejects a pass blocked before its receiver.
2. Check approach used arrival braking despite forecasting a committed impact.
   Normal movement now continues through contact; a from-rest turnover regresses it.
3. An unreachable released corner threat made the keeper track the current ball
   instead of its predicted crossing. It now makes the best physical movement
   toward that crossing without forcing a save.

Central overrides were exercised/exported in the actual workbench before promotion:
`ai.minimumPassDistance=2` and `ai.keeperRiskWeight=6`.

| Same deterministic 300-active-second all-AI setup | Releases | Shots | Notes |
|---|---:|---:|---|
| Original defaults | 3716 | — | contact-distance/backward passing loop |
| Physical fixes +2m only | 1185 | 879 | repeated forecast-covered shots |
| Physical fixes +2m/risk6 | 655 | 50 | 605 passes,403 completed;no holder stalls |

The final all-AI run ended25:0 from the repeated symmetric restart setup. This
is evidence of reduced pathological decisions, **not approval of competitive
balance or enjoyment**. All11 original action scenes preserve their physical
outcomes; the900-tick exchange now has release/shot ceilings plus diagnostics-off
replay parity. Movement11m/s was compared against10m/s in the workbench (tick30:
4.583m versus4.250m), then reset; existing movement/throw/receive/contact/keeper
baselines are retained with shared regression coverage.

Nine integrated scoring fixtures demonstrate six real goal approaches at baseline
attributes/default tuning:placed low,power,lob,lateral pass plus immediate shot,
one-touch and board rebound. Centre low/power shots are saved; delaying the lateral
shot allows keeper recovery.21 tests cover these outcomes, stable receiver claims,
control through acquisition and exact mapped-input replay with diagnostics off.
Three AI regression fixtures are also browser-loadable.

Browser evidence on production preview:
- All six scoring approaches produce goals; centre power shot is saved.
- Full five-minute interactive run:keyboard start/switch/throw/lob/movement path,
  real goals/restarts,18000 active ticks,full-time0:2,rematchReady5:00.
- Final-build full match:18000 active ticks,full-time0:1,rematchReady5:00.
  Recorded18603 ticks/10.45MB mapped input; imported and replayed to identical
  `fnv1a32:e9e838e4`, with controls stopped exactly at the final tick.
- Tuned900-tick workbench recording replayed to `fnv1a32:cb00ea53` before promotion.
- Final-build tab console has no errors. Earlier intermediate HMR/manifest and
  oversized-editor tool timeouts were recovered; build/check are run sequentially.
- Screenshot:`D:/dev/rollerball-run-context/rollerball-final-browser.jpg`.
  Download-event capture is unavailable in the in-app browser; JSON export/import
  and full playback are verified, file download requires a normal-browser check.

## Current checkpoint and next action

All thirteen planned implementation issues are complete on the integration branch.
Final `npm run check`:0 errors/warnings. Final `npm run build`:passed.
Final `npm run test`:457 tests/36 files passed (808.65 seconds), including every
registered min/max boundary against every shared scenario; no cases skipped.
FLAME-129 is the commit containing this checkpoint (parent259f504); its commit
subject is `FLAME-129 complete integrated tuning workbench and replay regressions`.
Push this validated checkpoint and record its SHA/validation in Linear In Review.
Then report completion and the human checks below. Do not merge,deploy,delete
branches or mark issues Done. Preview session41423 serves the final build at
http://127.0.0.1:4173/;browser2/tab3 is left Running/Ready for local play.

## Launch and remaining human checks

From `D:/dev/rollerball`: `npm install`, `npm run dev`;open the printed local URL.
Or `npm run build` then `npm run preview` for the production build.
Choose Start match/Enter/controller Menu. Move:WASD/arrows or left stick;
low/check:J orA;lob:K orB;switch:L orX;immediate throw:right stick.
Hold/release throw buttons to charge;use the same buttons for prepared one-touch.
README.md contains full play and workbench instructions.

Physical-controller hardware,subjective feel and competitive balance remain
unverified. Automated input mapping/scenarios and browser keyboard operation do
not establish those human criteria. No external implementation blocker remains.
