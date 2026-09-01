<script lang="ts">
  import type { ThrowChargeState } from '$lib/game/sim/gameState';

  export let visible = false;
  export let charge: ThrowChargeState | undefined;

  $: progress = Math.min(1, Math.max(0, charge?.progress ?? 0));
  $: familyLabel = charge?.family
    ? `${charge.family === 'low' ? 'Low' : 'High'} throw`
    : 'Throw';
</script>

{#if visible}
  <div class="charge-hud" aria-label="Throw charge">
    <div class="charge-heading">
      <span>{familyLabel}</span>
      <span>{Math.round(progress * 100)}%</span>
    </div>
    <div class="charge-track" aria-hidden="true">
      <div class="charge-fill" style={`width: ${progress * 100}%`}></div>
    </div>
  </div>
{/if}

<style>
  .charge-hud {
    position: absolute;
    left: 18px;
    bottom: 18px;
    display: grid;
    gap: 6px;
    width: min(260px, calc(100% - 36px));
    padding: 10px 12px;
    border: 1px solid #2c3d68;
    border-radius: 10px;
    background: rgb(16 24 45 / 88%);
    box-shadow: 0 8px 24px rgb(0 0 0 / 24%);
    color: #e7ecff;
    font-size: 0.78rem;
  }

  .charge-heading {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }

  .charge-heading span:last-child {
    color: #a5b3d6;
    font-variant-numeric: tabular-nums;
  }

  .charge-track {
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: #263b66;
  }

  .charge-fill {
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #9ccfd8, #f6c177);
  }
</style>
