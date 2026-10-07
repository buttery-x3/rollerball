<script lang="ts">
  import { onMount } from 'svelte';
  import Workbench from '$lib/game/debug/Workbench.svelte';
  import ReplayWorkbench from '$lib/game/debug/ReplayWorkbench.svelte';
  import ThrowChargeHud from '$lib/game/debug/ThrowChargeHud.svelte';
  import { createArenaDefinition } from '$lib/game/physics/arena';
  import { createArenaRenderer } from '$lib/game/render/arenaRenderer';
  import {
    BALL_RADIUS_KEY,
    PLAYER_RADIUS_KEY
  } from '$lib/game/config/tuning';
  import {
    createBrowserInputSource,
    createNeutralInputSnapshot,
    type BrowserInputSource
  } from '$lib/game/control/browserInput';
  import { createControlRouter, type ControlRouter } from '$lib/game/control/controlRouter';
  import type {
    ControlActionContext,
    MatchAction,
    SimulationInput
  } from '$lib/game/control/types';
  import { routedInputs } from '$lib/game/control/types';
  import { matchTimeRemaining } from '$lib/game/sim/match';
  import { publishControlDiagnostics } from '$lib/game/control/diagnostics';
  import {
    createBrowserGameLoop,
    type BrowserGameLoop
  } from '$lib/game/runtime/browserGameLoop';
  import type {
    FixedStepFrame,
    FixedStepStepContext
  } from '$lib/game/runtime/fixedStepRuntime';
  import {
    DEFAULT_SCENARIOS,
    getScenario
  } from '$lib/game/scenarios/defaultScenarios';
  import { fullMatchScenario } from '$lib/game/scenarios/matchFlowScenario';
  import { getCandidatePreviewRequest } from '$lib/game/scenarios/aiCandidateScenario';
  import { evaluateSpatialCandidates } from '$lib/game/ai/tacticalCandidates';
  import {
    createScenarioRun,
    type ScenarioRun
  } from '$lib/game/scenarios/scenario';
  import { stepControlledGame } from '$lib/game/runtime/stepControlledGame';
  import {
    createReplayRecorder, serializeReplay, parseReplay, prepareReplayRun,
    type ReplayRecorder, type PreparedReplayRun
  } from '$lib/game/scenarios/replay';
  import { ARENA_DIAGNOSTIC_LAYER, type DiagnosticFrame } from '$lib/game/sim/diagnostics';
  import type {
    GameState,
    ThrowChargeState
  } from '$lib/game/sim/gameState';
  import type { ArenaRenderer } from '$lib/game/render/arenaRenderer';

  let canvasHost: HTMLDivElement;

  const scenarioStep = (
    state: GameState,
    fixedStepSeconds: number,
    context: FixedStepStepContext,
    input: SimulationInput | undefined
  ): void => {
    stepControlledGame(state, fixedStepSeconds, context, input);
  };

  interface ControlScenarioRun {
    readonly run: ScenarioRun<GameState, SimulationInput>;
    readonly control: ControlRouter;
  }

  let browserInput: BrowserInputSource | undefined;
  let focusedPlayerId = 'player-1';
  let pendingMatchAction: MatchAction | undefined;
  let recorder: ReplayRecorder<GameState, SimulationInput> | undefined;
  let unsubscribeRecordingTuning: (() => void) | undefined;
  let recording = false;
  let replaying = false;
  let replayFinished = false;
  let replayStatus = 'Record the current run, including inputs and live tuning edits.';
  let replayJson = '';
  let playback: PreparedReplayRun<GameState, SimulationInput> | undefined;

  function createRun(id: string): ControlScenarioRun {
    const definition = getScenario(id);
    let control: ControlRouter | undefined;
    let scenarioState: GameState | undefined;
    let previousMatchPhase: string | undefined;
    let previousRestartCount = 0;
    const previewSelections = new Map<string, string>();
    const scriptedInputs = new Map(definition.scriptedInputs?.map(frame => [frame.tick, frame.input]));
    const synchronizeMatchControl = (current: GameState): void => {
      const match = current.match;
      if (match && (match.phase !== previousMatchPhase || match.restartCount !== previousRestartCount)) {
        control?.reset();
        browserInput?.reset();
        previousMatchPhase = match.phase;
        previousRestartCount = match.restartCount;
      }
    };
    const run = createScenarioRun<GameState, SimulationInput>({
      definition: { ...definition, scriptedInputs: undefined },
      step: (state, seconds, context, input) => {
        scenarioStep(state, seconds, context, input);
        synchronizeMatchControl(state);
        // A development query uses the same tactical scorer as gameplay. It
        // stores only inspection history and cannot drive simulation outcomes.
        if (!state.tactics && focusedPlayerId !== 'ball' && context.tuning && context.arena &&
            (context.diagnostics?.isLayerEnabled('ai') || context.diagnostics?.isLayerEnabled('aiScores'))) {
          const request = getCandidatePreviewRequest(definition.id);
          const playerId = request?.playerId ?? state.players.find(player =>
            player.definition.id === focusedPlayerId && player.definition.role === 'field')?.definition.id ??
            state.players.find(player => player.definition.role === 'field')?.definition.id;
          if (playerId) {
            const result = evaluateSpatialCandidates(state, playerId, {
              ...request?.options,
              previousId: previewSelections.get(playerId) ?? request?.options.previousId
            }, context.arena, context.tuning, context.diagnostics);
            if (result.selected) previewSelections.set(playerId, result.selected.id);
            else previewSelections.delete(playerId);
          }
        }
      },
      inputProvider: (tick, context) => {
              const match = scenarioState?.match;
              if (scenarioState) synchronizeMatchControl(scenarioState);
              if (browserInput?.consumeMatchRequest()) {
                if (match?.phase === 'ready') pendingMatchAction = 'start';
                else if (match?.phase === 'full-time') pendingMatchAction = 'rematch';
              }
              const command = pendingMatchAction;
              pendingMatchAction = undefined;
              if (definition.scriptedInputs !== undefined) {
                const scripted = scriptedInputs.get(tick);
                return command ? { playerIntents: routedInputs(scripted), matchAction: command } : scripted;
              }
              const actionContext: ControlActionContext =
                scenarioState?.ball.mode === 'possessed' &&
                control?.assignment?.playerId === scenarioState.ball.holderId
                  ? 'possessed'
                  : definition.interactiveActionContext ?? 'neutral';
              const result = control?.consumeTick(
                browserInput?.getSnapshot() ?? createNeutralInputSnapshot(),
                actionContext,
                scenarioState?.teams && context.arena ? { state: scenarioState, arena: context.arena, diagnostics: context.diagnostics } : undefined
              );
              if (result) {
                publishControlDiagnostics(tick, result, context.diagnostics);
              }

              return command ? { playerIntents: routedInputs(result?.routedIntent), matchAction: command } : result?.routedIntent;
            },
      getArena: (currentTuning) => createArenaDefinition(currentTuning),
      diagnosticsEnabled: true,
      onStep: (current, tick, input) => recorder?.recordStep(tick, input, current)
    });
    scenarioState = run.state;
    previousMatchPhase = scenarioState.match?.phase;
    previousRestartCount = scenarioState.match?.restartCount ?? 0;

    control = createControlRouter({
      tuning: run.tuning,
      initialPlayerId: 'player-1'
    });

    return { run, control };
  }

  let activeSession = createRun(fullMatchScenario.id);
  let activeRun = activeSession.run;
  let activeControl = activeSession.control;
  let state = activeRun.state;
  let tuning = activeRun.tuning;
  let diagnostics = activeRun.diagnostics;
  let runtime = activeRun.runtime;
  let activeScenarioId = activeRun.definition.id;
  let scenarioError: string | undefined;
  let chargeHudVisible = false;
  let chargeHud: ThrowChargeState | undefined;
  let matchHud = state.match;
  let controlledPlayerId = activeControl.assignment?.playerId;

  let renderer: ArenaRenderer | undefined;
  let loop: BrowserGameLoop | undefined;
  let tick = state.tick;
  let paused = runtime.isPaused;
  let timeScale = runtime.timeScale;
  let diagnosticSourceFrame: DiagnosticFrame | undefined;
  let focusedDiagnosticFrame: DiagnosticFrame | undefined;
  let diagnosticFocus = '';

  function updateChargeHud(): void {
    controlledPlayerId = activeControl.assignment?.playerId;
    const controlledPlayer = state.players.find(
      (player) => player.definition.id === controlledPlayerId
    );
    chargeHudVisible =
      state.ball.mode === 'possessed' &&
      state.ball.holderId === controlledPlayerId;
    chargeHud = chargeHudVisible ? controlledPlayer?.throwCharge : undefined;
  }

  function renderFrame(frame: FixedStepFrame<GameState>): void {
    tick = frame.state.tick;
    paused = runtime.isPaused;
    matchHud = frame.state.match ? { ...frame.state.match } : undefined;
    updateChargeHud();
    const arena = activeRun.getArena?.();
    if (arena) {
      renderer?.setArena(arena);
    }
    const source = diagnostics?.getFrame();
    const focus = focusedPlayerId || controlledPlayerId || '';
    if (source !== diagnosticSourceFrame || focus !== diagnosticFocus) {
      diagnosticSourceFrame = source;
      diagnosticFocus = focus;
      focusedDiagnosticFrame = source ? { ...source, records: source.records.filter(record =>
        !['ai', 'aiScores'].includes(record.layer) || !record.data?.playerId || record.data.playerId === focus)
      } : undefined;
    }
    renderer?.render(
      frame.state,
      frame.alpha,
      focusedDiagnosticFrame,
      diagnostics?.isLayerEnabled(ARENA_DIAGNOSTIC_LAYER) ?? false,
      tuning.getNumber(PLAYER_RADIUS_KEY),
      tuning.getNumber(BALL_RADIUS_KEY),
      activeControl.assignment?.playerId
    );
  }

  function pauseSimulation(): void {
    runtime.pause();
    paused = runtime.isPaused;
  }

  function resumeSimulation(): void {
    if (replayFinished) return;
    runtime.resume();
    paused = runtime.isPaused;
  }

  function stepSimulationOnce(): void {
    if (replayFinished) return;
    if (!runtime.isPaused) {
      runtime.pause();
    }

    browserInput?.poll();
    try { renderFrame(runtime.stepOnce()); }
    catch (error) { reportRuntimeError(error); }
    paused = runtime.isPaused;
  }

  function stepSimulationMany(count: number): void {
    if (replayFinished || !Number.isInteger(count) || count < 1 || count > 600) return;
    runtime.pause();
    browserInput?.poll();
    try {
      for (let index = 0; index < count && !replayFinished; index++) runtime.stepOnce();
    } catch (error) { reportRuntimeError(error); }
    renderFrame(runtime.advance(0));
    paused = true;
  }

  function setTimeScale(scale: number): void {
    runtime.setTimeScale(scale);
    timeScale = runtime.timeScale;
  }

  function loadScenario(id: string): void {
    const wasPaused = runtime.isPaused;
    let nextSession: ControlScenarioRun;

    try {
      nextSession = createRun(id);
    } catch (error) {
      scenarioError = error instanceof Error ? error.message : String(error);
      return;
    }

    if (wasPaused) {
      nextSession.run.runtime.pause();
    }
    if (recording) stopRecording();
    playback = undefined;
    replaying = false;
    replayFinished = false;
    installSession(nextSession);
  }

  function installSession(nextSession: ControlScenarioRun): void {
    nextSession.run.runtime.setTimeScale(timeScale);

    const hadBrowserInput = browserInput !== undefined;
    browserInput?.dispose();
    loop?.stop();
    activeSession = nextSession;
    activeRun = activeSession.run;
    activeControl = activeSession.control;
    state = activeRun.state;
    tuning = activeRun.tuning;
    diagnostics = activeRun.diagnostics;
    runtime = activeRun.runtime;
    activeScenarioId = activeRun.definition.id;
    pendingMatchAction = undefined;
    focusedPlayerId = getCandidatePreviewRequest(activeScenarioId)?.playerId ?? 'player-1';
    scenarioError = undefined;
    tick = state.tick;
    paused = runtime.isPaused;

    if (hadBrowserInput) {
      browserInput = createBrowserInputSource(tuning, {
        onReset: () => activeControl.resetInput()
      });
    }

    renderFrame(runtime.advance(0));

    if (loop) {
      loop = createBrowserGameLoop(runtime, renderFrame, {
        beforeAdvance: () => browserInput?.poll(),
        onError: reportRuntimeError
      });
      loop.start();
    }
  }

  function resetScenario(): void {
    loadScenario(activeScenarioId);
  }

  function requestMatchAction(action: MatchAction): void {
    if (replaying) return;
    pendingMatchAction = action;
    if (runtime.isPaused) stepSimulationOnce();
  }

  function formatTime(seconds: number): string {
    const total = Math.max(0, Math.ceil(seconds - 1e-9));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  function reportRuntimeError(error: unknown): void {
    runtime.pause();
    paused = true;
    const message = error instanceof Error ? error.message : String(error);
    if (replaying) {
      replayFinished = true;
      replayStatus = message;
    } else scenarioError = message;
  }

  function startRecording(): void {
    if (replaying || recording) return;
    recorder = createReplayRecorder<GameState, SimulationInput>({
      scenarioId: activeScenarioId, initialState: state, tuning,
      checkpointIntervalTicks: 60, includeInitialState: true
    });
    unsubscribeRecordingTuning = tuning.subscribe(() => recorder?.recordTuningChange(
      state.tick + 1,
      tuning.list().filter(entry => entry.overrideValue !== undefined)
        .map(entry => ({ key: entry.key, value: entry.overrideValue! }))
    ));
    recording = true;
    replayStatus = `Recording from tick ${state.tick}.`;
  }

  function stopRecording(): void {
    if (!recorder) return;
    unsubscribeRecordingTuning?.();
    unsubscribeRecordingTuning = undefined;
    const record = recorder.finish(state);
    replayJson = serializeReplay(record);
    replayStatus = `Recorded ticks ${record.initialTick}–${record.finalTick}; final ${record.finalStateHash}.`;
    recorder = undefined;
    recording = false;
  }

  function importReplay(json: string): void {
    try {
      const replay = parseReplay<SimulationInput>(json);
      const prepared = prepareReplayRun<GameState, SimulationInput>({
        scenario: getScenario(replay.scenarioId), replay, step: scenarioStep,
        getArena: createArenaDefinition, diagnosticsEnabled: true,
        onStep: (_current, _tick, input) => {
          const playerId = routedInputs(input)[0]?.playerId;
          if (playerId) activeControl.assignPlayer(playerId);
          else activeControl.clearAssignment();
          if (playback?.complete) {
            replayFinished = true;
            replayStatus = `Verified through tick ${replay.finalTick}: ${playback.verifyFinal()}.`;
          }
        }
      });
      if (recording) stopRecording();
      playback = prepared;
      replaying = true;
      replayFinished = prepared.complete;
      replayJson = json;
      replayStatus = prepared.complete ? `Verified: ${prepared.verifyFinal()}.`
        : `Replay loaded at tick ${replay.initialTick}; resume or step to ${replay.finalTick}.`;
      installSession({ run: prepared.run, control: createControlRouter({ tuning: prepared.run.tuning }) });
    } catch (error) {
      replayStatus = error instanceof Error ? error.message : String(error);
    }
  }

  onMount(() => {
    const arena = activeRun.getArena?.();
    if (!arena) {
      throw new Error('The active scenario must provide an arena definition.');
    }

    browserInput = createBrowserInputSource(tuning, {
      onReset: () => activeControl.resetInput()
    });
    renderer = createArenaRenderer(canvasHost, arena);
    loop = createBrowserGameLoop(runtime, renderFrame, {
      beforeAdvance: () => browserInput?.poll(),
      onError: reportRuntimeError
    });

    loop.start();

    return () => {
      unsubscribeRecordingTuning?.();
      loop?.stop();
      loop = undefined;
      browserInput?.dispose();
      browserInput = undefined;
      renderer?.dispose();
      renderer = undefined;
    };
  });
</script>

<svelte:head>
  <title>Rollerball</title>
  <meta name="description" content="Rollerball fixed-step simulation shell" />
</svelte:head>

<main class="page-shell">
  <section class="game-panel" aria-label="Rollerball arena">
    <div class="arena-viewport" bind:this={canvasHost}></div>
    <ThrowChargeHud visible={chargeHudVisible} charge={chargeHud} />
    {#if matchHud}
      <div class="match-hud" aria-label="Score">
        <strong>Human {matchHud.score.human ?? 0} : {matchHud.score.opponent ?? 0} Opponent</strong>
        <strong aria-label="Match clock">{formatTime(matchTimeRemaining(matchHud))}</strong>
        <span>{matchHud.phase === 'goal-stoppage' ? 'Goal — restarting' : matchHud.phase === 'ready' ? 'Ready' : matchHud.phase === 'full-time' ? 'Full time' : 'Playing'}</span>
        {#if matchHud.phase === 'ready'}
          <button type="button" disabled={replaying} onclick={() => requestMatchAction('start')}>Start match</button>
          <small>Enter / controller Menu</small>
        {:else if matchHud.phase === 'full-time'}
          <span>{matchHud.score.human === matchHud.score.opponent ? 'Draw' : matchHud.score.human > matchHud.score.opponent ? 'Human wins' : 'Opponent wins'}</span>
          <button type="button" disabled={replaying} onclick={() => requestMatchAction('rematch')}>Rematch</button>
          <small>Enter / controller Menu</small>
        {/if}
      </div>
    {/if}
    <div class="control-hud" aria-label="Player controls">
      <strong>Gold: Human ↑ · Pink: Opponent ↓ · White ring: {controlledPlayerId ?? 'no player'}</strong>
      <span>Left stick / WASD: move · A / J: low throw or check · B / K: lob · X / L: switch</span>
      <span>Right stick: immediate low throw · Hold then release a throw button to charge</span>
    </div>
  </section>
  {#if diagnostics}
    <Workbench
      {diagnostics}
      {paused}
      {tick}
      {timeScale}
      {tuning}
      {activeScenarioId}
      {scenarioError}
      {replayFinished}
      readonlyTuning={replaying}
      bind:focusedPlayerId
      playerIds={state.players.map(player => player.definition.id)}
      scenarios={DEFAULT_SCENARIOS}
      onPause={pauseSimulation}
      onResume={resumeSimulation}
      onStepOnce={stepSimulationOnce}
      onStepMany={stepSimulationMany}
      onTimeScale={setTimeScale}
      onLoadScenario={loadScenario}
      onResetScenario={resetScenario}
    >
      <ReplayWorkbench {recording} {replaying} status={replayStatus} json={replayJson}
        onStart={startRecording} onStop={stopRecording} onImport={importReplay} />
    </Workbench>
  {/if}
</main>

<style>
  :global(html),
  :global(body) {
    height: 100%;
    min-height: 100%;
    margin: 0;
  }

  :global(body) {
    background: #080b14;
    color: #e7ecff;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
      sans-serif;
    overflow: hidden;
  }

  .page-shell {
    box-sizing: border-box;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
    gap: 18px;
    height: 100dvh;
    min-height: 0;
    padding: 18px;
    align-items: stretch;
  }

  .game-panel {
    position: relative;
    width: auto;
    min-width: 0;
    min-height: 0;
    height: 100%;
    overflow: hidden;
    border: 1px solid #2c3d68;
    border-radius: 16px;
    background: #0b1020;
    box-shadow: 0 24px 80px rgb(0 0 0 / 35%);
  }

  .arena-viewport {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }

  .match-hud {
    position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
    display: grid; gap: 4px; text-align: center; background: #10182de6;
    border: 1px solid #2c3d68; padding: 10px 18px; border-radius: 10px;
    white-space: nowrap;
  }
  .match-hud span { font-size: 0.8rem; color: #a5b3d6; }
  .match-hud button { color: #e7ecff; background: #263d6d; border: 1px solid #5573ad; border-radius: 6px; padding: 8px 16px; cursor: pointer; }
  .match-hud small { color: #a5b3d6; }
  .control-hud { position: absolute; bottom: 12px; left: 12px; right: 12px; display: grid; gap: 3px; font-size: .7rem; color: #b8c5df; pointer-events: none; }

  @media (max-width: 860px) {
    :global(body) {
      overflow: auto;
    }

    .page-shell {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(360px, 55dvh) auto;
      height: auto;
      min-height: 100dvh;
      overflow: visible;
      padding: 16px;
    }

    .game-panel {
      width: 100%;
      height: auto;
      min-height: 360px;
      aspect-ratio: 3 / 2;
    }
  }
</style>
