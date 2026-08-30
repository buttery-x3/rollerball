<script lang="ts">
  import { onMount } from 'svelte';
  import Workbench from '$lib/game/debug/Workbench.svelte';
  import { createArenaDefinition } from '$lib/game/physics/arena';
  import { createArenaRenderer } from '$lib/game/render/arenaRenderer';
  import {
    createBrowserGameLoop,
    type BrowserGameLoop
  } from '$lib/game/runtime/browserGameLoop';
  import type {
    FixedStepFrame,
    FixedStepStepContext
  } from '$lib/game/runtime/fixedStepRuntime';
  import { DEFAULT_SCENARIOS, getScenario } from '$lib/game/scenarios/defaultScenarios';
  import {
    createScenarioRun,
    type ScenarioRun
  } from '$lib/game/scenarios/scenario';
  import { stepGame } from '$lib/game/sim/stepGame';
  import { ARENA_DIAGNOSTIC_LAYER } from '$lib/game/sim/diagnostics';
  import type { GameState } from '$lib/game/sim/gameState';
  import type { ArenaRenderer } from '$lib/game/render/arenaRenderer';

  let canvasHost: HTMLDivElement;
  const scenarioStep = (
    state: GameState,
    fixedStepSeconds: number,
    context: FixedStepStepContext,
    _input: unknown | undefined
  ): void => {
    stepGame(state, fixedStepSeconds, context);
  };

  function createRun(id: string): ScenarioRun<GameState, unknown> {
    return createScenarioRun({
      definition: getScenario(id),
      step: scenarioStep,
      getArena: (currentTuning) => createArenaDefinition(currentTuning)
    });
  }

  let activeRun = createRun(DEFAULT_SCENARIOS[0].id);
  let state = activeRun.state;
  let tuning = activeRun.tuning;
  let diagnostics = activeRun.diagnostics;
  let runtime = activeRun.runtime;
  let activeScenarioId = activeRun.definition.id;
  let scenarioError: string | undefined;

  let renderer: ArenaRenderer | undefined;
  let loop: BrowserGameLoop | undefined;
  let tick = state.tick;
  let paused = runtime.isPaused;

  function renderFrame(frame: FixedStepFrame<GameState>): void {
    tick = frame.state.tick;
    const arena = activeRun.getArena?.();
    if (arena) {
      renderer?.setArena(arena);
    }
    renderer?.render(
      frame.state,
      frame.alpha,
      diagnostics.getFrame(),
      diagnostics.isLayerEnabled(ARENA_DIAGNOSTIC_LAYER)
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

    renderFrame(runtime.stepOnce());
    paused = runtime.isPaused;
  }

  function loadScenario(id: string): void {
    const wasPaused = runtime.isPaused;
    let nextRun: ScenarioRun<GameState, unknown>;

    try {
      nextRun = createRun(id);
    } catch (error) {
      scenarioError = error instanceof Error ? error.message : String(error);
      return;
    }

    if (wasPaused) {
      nextRun.runtime.pause();
    }

    loop?.stop();
    activeRun = nextRun;
    state = activeRun.state;
    tuning = activeRun.tuning;
    diagnostics = activeRun.diagnostics;
    runtime = activeRun.runtime;
    activeScenarioId = activeRun.definition.id;
    scenarioError = undefined;
    tick = state.tick;
    paused = runtime.isPaused;

    renderFrame(runtime.advance(0));

    if (loop) {
      loop = createBrowserGameLoop(runtime, renderFrame);
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

    renderer = createArenaRenderer(canvasHost, arena);
    loop = createBrowserGameLoop(runtime, renderFrame);

    loop.start();

    return () => {
      loop?.stop();
      loop = undefined;
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
  </section>
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
</main>

<style>
  :global(html),
  :global(body) {
    min-height: 100%;
    margin: 0;
  }

  :global(body) {
    background: #080b14;
    color: #e7ecff;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
      sans-serif;
  }

  .page-shell {
    box-sizing: border-box;
    display: grid;
    gap: 18px;
    min-height: 100vh;
    padding: 24px;
    place-items: center;
  }

  .game-panel {
    width: min(920px, 100%);
    min-height: 360px;
    aspect-ratio: 3 / 2;
    overflow: hidden;
    border: 1px solid #2c3d68;
    border-radius: 16px;
    background: #0b1020;
    box-shadow: 0 24px 80px rgb(0 0 0 / 35%);
  }

  .arena-viewport {
    width: 100%;
    height: 100%;
  }
</style>
