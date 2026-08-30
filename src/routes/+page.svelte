<script lang="ts">
  import { onMount } from 'svelte';
  import { createArenaRenderer } from '$lib/game/render/arenaRenderer';
  import { createBrowserGameLoop } from '$lib/game/runtime/browserGameLoop';
  import { createFixedStepRuntime } from '$lib/game/runtime/fixedStepRuntime';
  import { createGameState } from '$lib/game/sim/gameState';
  import { stepGame } from '$lib/game/sim/stepGame';

  let canvasHost: HTMLDivElement;

  onMount(() => {
    const renderer = createArenaRenderer(canvasHost);
    const state = createGameState();
    const runtime = createFixedStepRuntime({ state, step: stepGame });
    const loop = createBrowserGameLoop(runtime, (frame) => {
      renderer.render(frame.state, frame.alpha);
    });

    loop.start();

    return () => {
      loop.stop();
      renderer.dispose();
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
