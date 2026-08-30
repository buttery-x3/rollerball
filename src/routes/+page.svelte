<script lang="ts">
  import { onMount } from 'svelte';
  import Workbench from '$lib/game/debug/Workbench.svelte';
  import { createDiagnosticStore } from '$lib/game/debug/diagnosticStore';
  import { createTuningRegistry } from '$lib/game/config/tuning';
  import { createArenaRenderer } from '$lib/game/render/arenaRenderer';
  import { createBrowserGameLoop } from '$lib/game/runtime/browserGameLoop';
  import {
    createFixedStepRuntime,
    type FixedStepFrame,
    type FixedStepRuntime
  } from '$lib/game/runtime/fixedStepRuntime';
  import { createGameState } from '$lib/game/sim/gameState';
  import { stepGame } from '$lib/game/sim/stepGame';
  import type { GameState } from '$lib/game/sim/gameState';
  import type { ArenaRenderer } from '$lib/game/render/arenaRenderer';

  let canvasHost: HTMLDivElement;
  const state = createGameState();
  const tuning = createTuningRegistry();
  const diagnostics = createDiagnosticStore();
  const runtime: FixedStepRuntime<GameState> = createFixedStepRuntime({
    state,
    step: stepGame,
    tuning,
    diagnostics
  });

  let renderer: ArenaRenderer | undefined;
  let tick = state.tick;
  let paused = runtime.isPaused;

  function renderFrame(frame: FixedStepFrame<GameState>): void {
    tick = frame.state.tick;
    renderer?.render(frame.state, frame.alpha, diagnostics.getFrame());
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

  onMount(() => {
    renderer = createArenaRenderer(canvasHost);
    const loop = createBrowserGameLoop(runtime, renderFrame);

    loop.start();

    return () => {
      loop.stop();
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
    onPause={pauseSimulation}
    onResume={resumeSimulation}
    onStepOnce={stepSimulationOnce}
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
