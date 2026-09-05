<script lang="ts">
  import { onMount } from 'svelte';
  import Workbench from '$lib/game/debug/Workbench.svelte';
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
    RoutedPlayerIntent
  } from '$lib/game/control/types';
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
  import { MOVEMENT_FREE_PLAY_SCENARIO_ID } from '$lib/game/scenarios/playerMovementScenario';
  import {
    createScenarioRun,
    type ScenarioRun
  } from '$lib/game/scenarios/scenario';
  import { stepGame } from '$lib/game/sim/stepGame';
  import { ARENA_DIAGNOSTIC_LAYER } from '$lib/game/sim/diagnostics';
  import type {
    GameState,
    ThrowChargeState
  } from '$lib/game/sim/gameState';
  import type { ArenaRenderer } from '$lib/game/render/arenaRenderer';

  let canvasHost: HTMLDivElement;
  const developmentMode = import.meta.env.DEV;

  const scenarioStep = (
    state: GameState,
    fixedStepSeconds: number,
    context: FixedStepStepContext,
    input: RoutedPlayerIntent | undefined
  ): void => {
    stepGame(state, fixedStepSeconds, context, input);
  };

  interface ControlScenarioRun {
    readonly run: ScenarioRun<GameState, RoutedPlayerIntent>;
    readonly control: ControlRouter;
  }

  let browserInput: BrowserInputSource | undefined;

  function createRun(id: string): ControlScenarioRun {
    const definition = getScenario(id);
    let control: ControlRouter | undefined;
    let scenarioState: GameState | undefined;
    const run = createScenarioRun({
      definition,
      step: scenarioStep,
      inputProvider:
        definition.scriptedInputs === undefined
          ? (tick, context) => {
              const actionContext: ControlActionContext =
                scenarioState?.ball.mode === 'possessed' &&
                control?.assignment?.playerId === scenarioState.ball.holderId
                  ? 'possessed'
                  : developmentMode
                    ? definition.interactiveActionContext ?? 'neutral'
                    : 'neutral';
              const result = control?.consumeTick(
                browserInput?.getSnapshot() ?? createNeutralInputSnapshot(),
                actionContext
              );
              if (result) {
                publishControlDiagnostics(tick, result, context.diagnostics);
              }

              return result?.routedIntent;
            }
          : undefined,
      getArena: (currentTuning) => createArenaDefinition(currentTuning),
      diagnosticsEnabled: developmentMode
    });
    scenarioState = run.state;

    control = createControlRouter({
      tuning: run.tuning,
      initialPlayerId: 'player-1'
    });

    return { run, control };
  }

  let activeSession = createRun(MOVEMENT_FREE_PLAY_SCENARIO_ID);
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

  let renderer: ArenaRenderer | undefined;
  let loop: BrowserGameLoop | undefined;
  let tick = state.tick;
  let paused = runtime.isPaused;

  function updateChargeHud(): void {
    const controlledPlayerId = activeControl.assignment?.playerId;
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
    updateChargeHud();
    const arena = activeRun.getArena?.();
    if (arena) {
      renderer?.setArena(arena);
    }
    renderer?.render(
      frame.state,
      frame.alpha,
      diagnostics?.getFrame(),
      diagnostics?.isLayerEnabled(ARENA_DIAGNOSTIC_LAYER) ?? false,
      tuning.getNumber(PLAYER_RADIUS_KEY),
      tuning.getNumber(BALL_RADIUS_KEY)
    );
  }

  function pauseSimulation(): void {
    runtime.pause();
    paused = runtime.isPaused;
  }

  function resumeSimulation(): void {
    runtime.resume();
    paused = runtime.isPaused;
  }

  function stepSimulationOnce(): void {
    if (!runtime.isPaused) {
      runtime.pause();
    }

    browserInput?.poll();
    renderFrame(runtime.stepOnce());
    paused = runtime.isPaused;
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
        beforeAdvance: () => browserInput?.poll()
      });
      loop.start();
    }
  }

  function resetScenario(): void {
    loadScenario(activeScenarioId);
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
      beforeAdvance: () => browserInput?.poll()
    });

    loop.start();

    return () => {
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
  </section>
  {#if developmentMode && diagnostics}
    <Workbench
      {diagnostics}
      {paused}
      {tick}
      {tuning}
      {activeScenarioId}
      {scenarioError}
      scenarios={DEFAULT_SCENARIOS}
      onPause={pauseSimulation}
      onResume={resumeSimulation}
      onStepOnce={stepSimulationOnce}
      onLoadScenario={loadScenario}
      onResetScenario={resetScenario}
    />
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
