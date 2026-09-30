import { describe, expect, it } from 'vitest';
import { SCORING_SCENARIOS } from '../scenarios/scoringScenario';
import { createScenarioRun, runScenario } from '../scenarios/scenario';
import { createArenaDefinition } from '../physics/arena';
import { stepGame } from './stepGame';
import { createFieldPlayerState } from './gameState';

function setup(id: string, diagnosticsEnabled = true) {
  return { definition: SCORING_SCENARIOS.find(s => s.id === id)!, step: stepGame, getArena: createArenaDefinition, diagnosticsEnabled };
}

describe('goals and restart ownership', () => {
  it.each([['goal-positive', 'human'], ['goal-negative', 'opponent']])('scores one fast crossing for %s', (id, team) => {
    const run = createScenarioRun(setup(id));
    run.runtime.pause();
    run.runtime.stepOnce();
    expect(run.state.match?.score[team]).toBe(1);
    expect(run.state.match?.phase).toBe('goal-stoppage');
    expect(run.state.match?.lastGoal).toMatchObject({ type: 'GoalScored', teamId: team, tick: 1 });
    for (let i = 0; i < 89; i++) run.runtime.stepOnce();
    expect(run.state.match?.phase).toBe('goal-stoppage');
    expect(run.state.match?.score[team]).toBe(1);
    run.runtime.stepOnce();
    expect(run.state.match?.phase).toBe('playing');
    expect(run.state.match?.restartCount).toBe(1);
    expect(run.state.ball).toMatchObject({ mode: 'loose', position: { x: 0, y: 0 }, release: undefined });
    expect(run.state.players[0].position).toEqual({ x: -3, y: -4 });
  });

  it.each(['goal-over-crossbar', 'goal-outside-post'])('rebounds without scoring for %s', id => {
    const run = runScenario({ ...setup(id), ticks: 1 });
    expect(run.state.match?.score).toEqual({ human: 0, opponent: 0 });
    expect(run.state.ball.mode).toBe('loose');
    if (run.state.ball.mode === 'loose') expect(run.state.ball.velocity.y).toBeLessThan(0);
  });

  it('honours a receive before crossing', () => {
    const before = createScenarioRun(setup('goal-positive'));
    before.runtime.pause();
    before.state.players.push(createFieldPlayerState({ id: 'blocker', position: { x: 0, y: 14 } }));
    before.runtime.stepOnce();
    expect(before.state.match?.score.human).toBe(0);
    expect(before.state.ball).toEqual({ mode: 'possessed', holderId: 'blocker' });
  });

  it('clears transient charge, buffered input and release state and preserves identity', () => {
    const run = createScenarioRun(setup('goal-positive'));
    run.runtime.pause();
    const definition = run.state.players[0].definition;
    run.runtime.stepOnce();
    run.state.players[0].throwCharge.family = 'high';
    run.state.players[0].oneTouch.buffer = { direction: { x: 1, y: 0 }, magnitude: 1, ticksRemaining: 4 };
    for (let i = 0; i < 90; i++) run.runtime.stepOnce();
    expect(run.state.players[0].definition).toBe(definition);
    expect(run.state.players[0].throwCharge.family).toBeUndefined();
    expect(run.state.players[0].oneTouch.buffer).toBeUndefined();
    expect(run.state.players[0].velocity).toEqual({ x: 0, y: 0 });
  });

  it('matches diagnostics on/off and 30/120 Hz execution', () => {
    const slow = createScenarioRun(setup('goal-positive', true));
    const fast = createScenarioRun(setup('goal-positive', false));
    for (let i = 0; i < 60; i++) slow.runtime.advance(1 / 30);
    for (let i = 0; i < 240; i++) fast.runtime.advance(1 / 120);
    expect(slow.state).toEqual(fast.state);
  });
});
