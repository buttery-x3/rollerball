<script lang="ts">
  export let recording: boolean;
  export let replaying: boolean;
  export let status: string;
  export let json: string;
  export let onStart: () => void;
  export let onStop: () => void;
  export let onImport: (json: string) => void;

  let draft = json;
  let lastJson = json;
  let fileError = '';
  let showJson = false;

  $: hasDraft = draft.trim().length > 0;
  $: sizeLabel = `${draft.length.toLocaleString()} characters`;

  $: if (json !== lastJson) {
    draft = json;
    lastJson = json;
    showJson = false;
  }

  async function loadFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      draft = await file.text();
      fileError = '';
      showJson = false;
    } catch (error) {
      fileError = error instanceof Error ? error.message : String(error);
    }
    input.value = '';
  }

  function download(): void {
    const url = URL.createObjectURL(new Blob([draft], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'rollerball-replay.json';
    link.click();
    URL.revokeObjectURL(url);
  }
</script>

<section class="replay-workbench" aria-label="Replay workbench">
  <h2>Record and replay</h2>
  <p>Record from the current tick, including inputs and tuning edits. Imported replays use the playback controls above.</p>
  <div class="buttons">
    <button on:click={onStart} disabled={recording || replaying}>Start recording</button>
    <button on:click={onStop} disabled={!recording}>Stop and export</button>
  </div>
  <p class="status" role="status">{status || (recording ? 'Recording this run.' : 'Ready to record.')}</p>
  <div class="buttons">
    <button on:click={() => { showJson = !showJson; }} aria-expanded={showJson} aria-controls="replay-json-editor">{showJson ? 'Hide JSON' : 'Show JSON'}</button>
    <span class="size">{sizeLabel}</span>
  </div>
  {#if showJson}
    <div id="replay-json-editor">
      <label for="replay-json">Replay JSON</label>
      <textarea id="replay-json" bind:value={draft} rows="5" spellcheck="false" placeholder="Export a recording or paste a replay here." disabled={recording || replaying}></textarea>
    </div>
  {/if}
  <div class="buttons">
    <button on:click={() => onImport(draft)} disabled={recording || replaying || !hasDraft}>Import and replay</button>
    <button on:click={download} disabled={!hasDraft}>Download JSON</button>
  </div>
  <label class="file-label">Load replay file
    <input type="file" accept="application/json,.json" on:change={loadFile} disabled={recording || replaying} />
  </label>
  {#if fileError}<p class="error" role="alert">{fileError}</p>{/if}
</section>

<style>
  .replay-workbench { margin-top: 0.8rem; padding: 0.85rem; border: 1px solid #334155; border-radius: 0.5rem; background: #0f172a; color: #e2e8f0; font-size: 0.8rem; }
  h2 { margin: 0 0 0.5rem; font-size: 1rem; }
  p { margin: 0.5rem 0; line-height: 1.4; }
  .status { color: #cbd5e1; }
  .size { align-self: center; color: #94a3b8; }
  .buttons { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.5rem 0; }
  button { padding: 0.4rem 0.6rem; border: 1px solid #475569; border-radius: 0.3rem; background: #1e293b; color: inherit; cursor: pointer; }
  button:disabled { opacity: 0.45; cursor: default; }
  label { display: block; margin-top: 0.5rem; }
  textarea { display: block; box-sizing: border-box; width: 100%; margin-top: 0.3rem; padding: 0.45rem; resize: vertical; border: 1px solid #475569; border-radius: 0.3rem; background: #020617; color: #e2e8f0; font: 0.7rem monospace; }
  input { display: block; max-width: 100%; margin-top: 0.4rem; }
  .error { color: #fda4af; }
</style>
