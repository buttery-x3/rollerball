<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    NumericTuningEntry,
    TuningRegistry
  } from '$lib/game/config/tuning';
  import type {
    DiagnosticLayerState
  } from '$lib/game/sim/diagnostics';
  import type { GameState } from '$lib/game/sim/gameState';
  import type { ScenarioDefinition } from '$lib/game/scenarios/scenario';
  import type { DiagnosticStore } from './diagnosticStore';

  export let diagnostics: DiagnosticStore;
  export let onPause: () => void;
  export let onResume: () => void;
  export let onStepOnce: () => void;
  export let onLoadScenario: (id: string) => void;
  export let onResetScenario: () => void;
  export let paused: boolean;
  export let activeScenarioId: string;
  export let scenarioError: string | undefined;
  export let scenarios: readonly ScenarioDefinition<GameState, unknown>[];
  export let tick: number;
  export let tuning: TuningRegistry;

  let tuningEntries: readonly NumericTuningEntry[] = tuning.list();
  let layerEntries: readonly DiagnosticLayerState[] = diagnostics.listLayers();
  let unsubscribeTuning: (() => void) | undefined;
  let unsubscribeDiagnostics: (() => void) | undefined;
  let subscribedTuning: TuningRegistry | undefined;
  let subscribedDiagnostics: DiagnosticStore | undefined;
  let mounted = false;

  const refreshTuning = (): void => {
    tuningEntries = tuning.list();
  };

  const refreshLayers = (): void => {
    layerEntries = diagnostics.listLayers();
  };

  function bindStores(): void {
    if (!mounted || (subscribedTuning === tuning && subscribedDiagnostics === diagnostics)) {
      return;
    }

    unsubscribeTuning?.();
    unsubscribeDiagnostics?.();

    subscribedTuning = tuning;
    subscribedDiagnostics = diagnostics;
    refreshTuning();
    refreshLayers();
    unsubscribeTuning = tuning.subscribe(refreshTuning);
    unsubscribeDiagnostics = diagnostics.subscribe(refreshLayers);
  }

  onMount(() => {
    mounted = true;
    bindStores();

    return () => {
      mounted = false;
      unsubscribeTuning?.();
      unsubscribeDiagnostics?.();
      unsubscribeTuning = undefined;
      unsubscribeDiagnostics = undefined;
      subscribedTuning = undefined;
      subscribedDiagnostics = undefined;
    };
  });

  $: if (mounted && (subscribedTuning !== tuning || subscribedDiagnostics !== diagnostics)) {
    bindStores();
  }

  function updateTuning(key: string, event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    if (!input.value.trim()) {
      return;
    }

    const value = Number(input.value);
    if (!Number.isFinite(value)) {
      return;
    }

    try {
      tuning.setOverride(key, value);
    } catch {
      input.value = String(tuning.getNumber(key));
    }
  }

  function resetTuning(key: string): void {
    tuning.resetOverride(key);
  }

  function updateLayer(key: string, event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    diagnostics.setLayerEnabled(key, input.checked);
  }

  function loadScenario(event: Event): void {
    const input = event.currentTarget as HTMLSelectElement;
    onLoadScenario(input.value);
  }
</script>

<aside class="workbench" aria-label="Development workbench">
  <div class="workbench-heading">
    <div>
      <p class="eyebrow">Development</p>
      <h1>Workbench</h1>
    </div>
    <span class:paused class="status">{paused ? 'Paused' : 'Running'}</span>
  </div>

  <div class="controls" aria-label="Simulation controls">
    {#if paused}
      <button type="button" onclick={onResume}>Resume</button>
    {:else}
      <button type="button" onclick={onPause}>Pause</button>
    {/if}
    <button type="button" onclick={onStepOnce} disabled={!paused}>Step one tick</button>
    <span class="tick">Tick {tick}</span>
  </div>

  <section class="workbench-section" aria-labelledby="scenario-heading">
    <div class="section-heading">
      <h2 id="scenario-heading">Scenario</h2>
      <button type="button" class="subtle-button" onclick={onResetScenario}>Reset</button>
    </div>
    <div class="scenario-controls">
      <label for="scenario-select">Loaded scenario</label>
      <select id="scenario-select" value={activeScenarioId} onchange={loadScenario}>
        {#each scenarios as scenario (scenario.id)}
          <option value={scenario.id}>{scenario.name}</option>
        {/each}
      </select>
    </div>
    {#if scenarioError}
      <p class="scenario-error" role="alert">{scenarioError}</p>
    {/if}
  </section>

  <section class="workbench-section" aria-labelledby="tuning-heading">
    <div class="section-heading">
      <h2 id="tuning-heading">Tuning</h2>
      <button type="button" class="subtle-button" onclick={() => tuning.resetAllOverrides()}>
        Reset all
      </button>
    </div>

    {#each tuningEntries as entry (entry.key)}
      <div class="tuning-entry">
        <div class="tuning-label">
          <label for={entry.key}>{entry.label}</label>
          <span>{entry.domain}</span>
        </div>
        <div class="tuning-controls">
          <input
            id={entry.key}
            type="range"
            min={entry.min}
            max={entry.max}
            step={entry.step}
            value={entry.effectiveValue}
            oninput={(event) => updateTuning(entry.key, event)}
          />
          <input
            aria-label={`${entry.label} value`}
            type="number"
            min={entry.min}
            max={entry.max}
            step={entry.step}
            value={entry.effectiveValue}
            oninput={(event) => updateTuning(entry.key, event)}
          />
          <button
            type="button"
            class="subtle-button"
            onclick={() => resetTuning(entry.key)}
            disabled={entry.overrideValue === undefined}
          >
            Reset
          </button>
        </div>
        <small>
          Effective: {entry.effectiveValue}
          {entry.overrideValue === undefined ? ' · default' : ' · override'}
        </small>
      </div>
    {/each}
  </section>

  <section class="workbench-section" aria-labelledby="layers-heading">
    <div class="section-heading">
      <h2 id="layers-heading">Debug layers</h2>
    </div>
    {#each layerEntries as layer (layer.key)}
      <label class="layer-entry">
        <input
          type="checkbox"
          checked={layer.enabled}
          onchange={(event) => updateLayer(layer.key, event)}
        />
        <span>{layer.label}</span>
      </label>
    {/each}
  </section>
</aside>

<style>
  .workbench {
    box-sizing: border-box;
    display: grid;
    gap: 18px;
    width: min(920px, 100%);
    padding: 18px 20px;
    border: 1px solid #2c3d68;
    border-radius: 16px;
    background: #10182d;
  }

  .workbench-heading,
  .section-heading,
  .controls,
  .tuning-controls {
    display: flex;
    align-items: center;
  }

  .workbench-heading,
  .section-heading {
    justify-content: space-between;
    gap: 16px;
  }

  .eyebrow {
    margin: 0 0 2px;
    color: #9ccfd8;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  h1,
  h2,
  p {
    margin-top: 0;
  }

  h1 {
    margin-bottom: 0;
    font-size: 1.2rem;
  }

  h2 {
    margin-bottom: 0;
    font-size: 0.95rem;
  }

  .status,
  .tick,
  small,
  .tuning-label span {
    color: #a5b3d6;
    font-size: 0.78rem;
  }

  .status {
    padding: 4px 8px;
    border: 1px solid #39608c;
    border-radius: 999px;
  }

  .status.paused {
    border-color: #f6c177;
    color: #f6c177;
  }

  .controls {
    flex-wrap: wrap;
    gap: 8px;
  }

  button {
    border: 1px solid #5573ad;
    border-radius: 6px;
    padding: 7px 10px;
    background: #1b2b50;
    color: #e7ecff;
    cursor: pointer;
    font: inherit;
    font-size: 0.8rem;
  }

  button:hover:not(:disabled) {
    background: #263d6d;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .subtle-button {
    border-color: transparent;
    padding: 3px 6px;
    background: transparent;
    color: #9ccfd8;
  }

  .workbench-section {
    display: grid;
    gap: 12px;
  }

  .tuning-entry {
    display: grid;
    gap: 5px;
  }

  .tuning-label {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 0.82rem;
  }

  .tuning-controls {
    gap: 8px;
  }

  .scenario-controls {
    display: grid;
    gap: 6px;
  }

  .scenario-controls label {
    color: #a5b3d6;
    font-size: 0.78rem;
  }

  .scenario-controls select {
    box-sizing: border-box;
    width: 100%;
    border: 1px solid #394e7a;
    border-radius: 5px;
    padding: 7px;
    background: #0b1020;
    color: #e7ecff;
    font: inherit;
    font-size: 0.8rem;
  }

  .scenario-error {
    margin: 0;
    color: #eb6f92;
    font-size: 0.78rem;
  }

  .tuning-controls input[type='range'] {
    flex: 1;
    min-width: 120px;
  }

  .tuning-controls input[type='number'] {
    width: 72px;
    box-sizing: border-box;
    border: 1px solid #394e7a;
    border-radius: 5px;
    padding: 5px;
    background: #0b1020;
    color: #e7ecff;
  }

  .layer-entry {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #d5def8;
    font-size: 0.82rem;
  }
</style>
