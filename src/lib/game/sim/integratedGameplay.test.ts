import { describe, expect, it } from 'vitest';
import { createControlRouter } from '../control/controlRouter';
import type { ControlStepResult, SimulationInput } from '../control/types';
import { createArenaDefinition } from '../physics/arena';
import { stepControlledGame } from '../runtime/stepControlledGame';
import { inputSnapshot } from '../scenarios/controlScenario';
import {
  INTEGRATED_SCORING_SCENARIOS, integratedPlacedLowScenario, integratedPowerShotScenario,
  integratedLobScenario, integratedLateralPassScenario, integratedOneTouchScenario,
  integratedReboundScenario, integratedCentreLowScenario, integratedCentrePowerScenario,
  integratedDelayedShotScenario
} from '../scenarios/integratedScoringScenario';
import { createReplayRecorder, replayScenario, type ReplayRecorder } from '../scenarios/replay';
import { createScenarioRun, runScenario, type ScenarioDefinition } from '../scenarios/scenario';
import type { DiagnosticRecord } from './diagnostics';
import type { GameState } from './gameState';

type ScoringScenario = ScenarioDefinition<GameState, SimulationInput>;
function sample(definition: ScoringScenario) {
  const run = createScenarioRun({ definition, step: stepControlledGame, getArena: createArenaDefinition });
  const records: (DiagnosticRecord & { tick: number })[] = [];
  const states: GameState[] = [];
  run.runtime.pause();
  for (let index = 0; index < definition.automatedRunTicks; index++) {
    run.runtime.stepOnce();
    states.push(structuredClone(run.state));
    records.push(...run.diagnostics!.getFrame().records.map(record => ({ ...record, tick: run.state.tick })));
  }
  const interactions = records.filter(record => record.entityId === 'receive-interaction');
  const releases = records.filter(record => record.source === 'throwRelease');
  return { run, states, records, interactions, releases };
}

describe('integrated scoring and control regressions', () => {
  it.each([
    integratedPlacedLowScenario, integratedPowerShotScenario, integratedLobScenario,
    integratedLateralPassScenario, integratedOneTouchScenario, integratedReboundScenario
  ])('$name scores through external actions against a live keeper at committed defaults', definition => {
    const result = sample(definition);
    expect(result.run.state.match!.score.human, JSON.stringify(result.interactions.map(record => record.data))).toBe(1);
    expect(result.releases.length).toBeGreaterThan(0);
    expect(result.run.tuning.list().some(entry => entry.overrideValue !== undefined)).toBe(false);
    expect(result.run.state.players.every(player => Object.values(player.definition.attributes).every(value => value === 50))).toBe(true);
    expect(result.releases[0].tick).toBeLessThan(result.run.state.match!.lastGoal!.tick);
  });

  it('distinguishes placement, power and a lob that clears the keeper below the crossbar', () => {
    const placed = sample(integratedPlacedLowScenario);
    const power = sample(integratedPowerShotScenario);
    const lob = sample(integratedLobScenario);
    expect(placed.releases[0].data).toMatchObject({ source: 'low-button', strength: 0.2, family: 'low' });
    expect(power.releases[0].data).toMatchObject({ source: 'right-stick', strength: 1, family: 'low' });
    expect(lob.releases[0].data).toMatchObject({ source: 'high-button', family: 'high' });
    expect(lob.run.state.match!.lastGoal!.crossing.height).toBeGreaterThan(lob.run.tuning.getNumber('keeper.ordinaryHeight'));
    expect(lob.run.state.match!.lastGoal!.crossing.height + 2 * lob.run.tuning.getNumber('ball.radius'))
      .toBeLessThanOrEqual(lob.run.tuning.getNumber('arena.crossbarHeight'));
    expect(lob.interactions.some(record => record.data?.playerId === 'opponent-keeper')).toBe(false);
  });

  it('requires a real lateral reception and rewards shooting before the keeper recovers', () => {
    const immediate = sample(integratedLateralPassScenario);
    const delayed = sample(integratedDelayedShotScenario);
    const receive = immediate.interactions.find(record => record.data?.outcome === 'possession' && record.data?.playerId === 'player-2')!;
    expect(receive).toBeDefined();
    expect(immediate.releases.map(record => record.data?.playerId)).toEqual(['player-1', 'player-2']);
    expect(receive.tick).toBeLessThan(immediate.releases[1].tick);
    expect(immediate.run.state.match!.score.human).toBe(1);
    expect(delayed.run.state.match!.score.human).toBe(0);
    expect(delayed.interactions.some(record => record.data?.outcome === 'keeper-parry')).toBe(true);
  });

  it('executes the one-touch without intermediate possession and banks the rebound off a physical board', () => {
    const redirect = sample(integratedOneTouchScenario);
    expect(redirect.interactions.some(record => record.data?.outcome === 'one-touch' && record.data?.playerId === 'player-2')).toBe(true);
    expect(redirect.states.some(state => state.ball.mode === 'possessed' && state.ball.holderId === 'player-2')).toBe(false);
    const rebound = sample(integratedReboundScenario);
    const wallContact = rebound.records.find(record => record.source === 'ballSweep' && record.entityId?.startsWith('ball-sweep-'));
    expect(wallContact).toBeDefined();
    expect(wallContact!.tick).toBeLessThan(rebound.run.state.match!.lastGoal!.tick);
    expect(rebound.states.some(state => state.ball.mode === 'loose' && state.ball.velocity.x > 0)).toBe(true);
    expect(rebound.states.some(state => state.ball.mode === 'loose' && state.ball.velocity.x < 0)).toBe(true);
  });

  it.each([integratedCentreLowScenario, integratedCentrePowerScenario])('$name prevents trivial direct scoring', definition => {
    const result = sample(definition);
    expect(result.run.state.match!.score.human).toBe(0);
    expect(result.interactions.some(record => ['keeper-catch', 'keeper-parry'].includes(String(record.data?.outcome)))).toBe(true);
  });

  it.each(INTEGRATED_SCORING_SCENARIOS)('$id has identical gameplay with diagnostics disabled', definition => {
    const enabled = sample(definition);
    const disabled = runScenario({ definition, step: stepControlledGame, getArena: createArenaDefinition,
      diagnosticsEnabled: false, ticks: definition.automatedRunTicks });
    expect(disabled.state).toEqual(enabled.run.state);
  });

  it('keeps the real lateral receiver claimed through possession and replays every mapped control input', () => {
    const definition: ScoringScenario = { ...integratedLateralPassScenario, scriptedInputs: undefined };
    let router: ReturnType<typeof createControlRouter>;
    let recorder: ReplayRecorder<GameState, SimulationInput>;
    const controls: { tick: number; result: ControlStepResult; ball: GameState['ball'] }[] = [];
    let shotCaptureTicks = 0;
    const run = createScenarioRun({ definition, step: stepControlledGame, getArena: createArenaDefinition,
      inputProvider(tick, context) {
        const receiverHasBall = run.state.ball.mode === 'possessed' && run.state.ball.holderId === 'player-2';
        const shoot = receiverHasBall && shotCaptureTicks++ < 3;
        const result = router.consumeTick(inputSnapshot({ low: tick <= 4,
          rightStick: shoot ? { x: 0.103, y: 0.793 } : { x: 0, y: 0 } }), undefined,
        { state: run.state, arena: context.arena!, diagnostics: context.diagnostics });
        controls.push({ tick, result: structuredClone(result), ball: structuredClone(run.state.ball) });
        return result.routedIntent;
      },
      onStep(state, tick, input) { recorder.recordStep(tick, input, state); }
    });
    router = createControlRouter({ tuning: run.tuning, initialPlayerId: 'player-1', humanTeamId: 'human' });
    recorder = createReplayRecorder({ scenarioId: definition.id, initialState: run.state,
      tuning: run.tuning, checkpointIntervalTicks: 1 });
    run.runtime.pause();
    for (let tick = 0; tick < 90; tick++) run.runtime.stepOnce();
    const claim = controls.find(control => control.result.assignment?.reason === 'receiver' && control.result.assignment.playerId === 'player-2')!;
    const possession = controls.find(control => control.ball.mode === 'possessed' && control.ball.holderId === 'player-2')!;
    expect(claim).toBeDefined(); expect(possession).toBeDefined();
    expect(claim.tick).toBeLessThan(possession.tick);
    expect(controls.filter(control => control.tick >= claim.tick && control.tick <= possession.tick)
      .every(control => control.result.assignment?.playerId === 'player-2')).toBe(true);
    expect(run.state.match!.score.human).toBe(1);
    const replay = replayScenario({ scenario: definition, step: stepControlledGame, getArena: createArenaDefinition,
      replay: recorder.finish(run.state), diagnosticsEnabled: false });
    expect(replay.run.state).toEqual(run.state);
  });
});
