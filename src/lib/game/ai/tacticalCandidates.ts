import { PLAYER_RADIUS_KEY, type TuningReader } from '../config/tuning';
import type { ArenaDefinition } from '../physics/arena';
import { isCircleWithinBounds, type Vec2 } from '../physics/geometry';
import type { DiagnosticSink } from '../sim/diagnostics';
import { createWorldQueries, type LaneQuery, type ReadonlyGameState } from './worldQueries';

export interface SpatialCandidate {
  readonly id: string;
  readonly position: Vec2;
}

export interface SpatialCandidateOptions {
  readonly candidates?: readonly SpatialCandidate[];
  readonly previousId?: string;
  readonly origin?: Vec2;
}

export interface CandidateEvaluation extends SpatialCandidate {
  readonly rejectedReason?: 'outside-bounds' | 'spacing' | 'unreachable' | 'shortlisted-out' | 'blocked-lane';
  /** Weighted contributions; their sum is the final score. */
  readonly factors: {
    readonly progression: number;
    readonly spacing: number;
    readonly reach: number;
    readonly lane: number;
  };
  readonly cheapScore: number;
  readonly score: number;
  readonly laneTested: boolean;
  readonly lane?: LaneQuery;
}

export interface SpatialEvaluation {
  readonly playerId: string;
  readonly candidates: readonly CandidateEvaluation[];
  readonly selected?: SpatialCandidate;
  readonly previousId?: string;
  readonly retained: boolean;
  readonly reason: 'hysteresis-retained' | 'best-score' | 'no-valid-candidate';
  readonly expensiveTests: number;
}

function compareCandidates(first: CandidateEvaluation, second: CandidateEvaluation): number {
  return second.score - first.score || (first.id < second.id ? -1 : first.id > second.id ? 1 : 0);
}

function generateCandidates(origin: Vec2, tuning: TuningReader): readonly SpatialCandidate[] {
  const spacing = tuning.getNumber('ai.candidateSpacing');
  const count = Math.floor(tuning.getNumber('ai.candidateRadius') / spacing);
  const candidates: SpatialCandidate[] = [];
  for (let x = -count; x <= count; x += 1) {
    for (let y = -count; y <= count; y += 1) {
      candidates.push({ id: `grid:${x}:${y}`, position: { x: origin.x + x * spacing, y: origin.y + y * spacing } });
    }
  }
  return candidates;
}

/** The common Rollerball spatial pipeline; no tactical state is stored here. */
export function evaluateSpatialCandidates(
  state: ReadonlyGameState,
  playerId: string,
  options: SpatialCandidateOptions,
  arena: ArenaDefinition,
  tuning: TuningReader,
  diagnostics?: DiagnosticSink
): SpatialEvaluation {
  const world = createWorldQueries(state, arena, tuning);
  const player = world.player(playerId);
  if (!player) throw new Error(`Cannot evaluate spatial candidates for missing player '${playerId}'.`);
  const bounds = world.movementBounds(playerId);
  const origin = options.origin ?? world.ballPosition();
  const candidates = options.candidates ?? generateCandidates(origin, tuning);
  if (new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length) {
    throw new Error('Spatial candidate IDs must be unique.');
  }
  const attackSign = world.goal(player.definition.teamId).end === 'positiveY' ? 1 : -1;
  const scores: CandidateEvaluation[] = candidates.map((candidate) => {
    const base = { id: candidate.id, position: { ...candidate.position },
      factors: { progression: 0, spacing: 0, reach: 0, lane: 0 },
      cheapScore: 0, score: 0, laneTested: false };
    if (!Number.isFinite(candidate.position.x) || !Number.isFinite(candidate.position.y) ||
        !isCircleWithinBounds(candidate.position, tuning.getNumber(PLAYER_RADIUS_KEY), bounds)) {
      return { ...base, rejectedReason: 'outside-bounds' };
    }
    const density = world.density(candidate.position, undefined, playerId);
    if (density.nearestDistance !== undefined && density.nearestDistance < tuning.getNumber('ai.minSpacing')) {
      return { ...base, rejectedReason: 'spacing' };
    }
    const reach = world.reachSeconds(playerId, candidate.position);
    if (!Number.isFinite(reach)) return { ...base, rejectedReason: 'unreachable' };
    const factors = {
      progression: (candidate.position.y - player.position.y) * attackSign /
        Math.max(1, tuning.getNumber('ai.candidateRadius')) * tuning.getNumber('ai.progressionWeight'),
      spacing: -density.weightedDensity * tuning.getNumber('ai.spacingWeight'),
      reach: -reach * tuning.getNumber('ai.reachWeight'),
      lane: 0
    };
    const cheapScore = factors.progression + factors.spacing + factors.reach;
    return { ...base, factors, cheapScore, score: cheapScore };
  });

  // Cheap rejection and scoring happen before any hypothetical ball forecast.
  const valid = scores.filter((candidate) => !candidate.rejectedReason).sort(compareCandidates);
  const limit = tuning.getNumber('ai.expensiveCandidateLimit');
  const shortlist = valid.slice(0, limit);
  const previous = valid.find((candidate) => candidate.id === options.previousId);
  const margin = tuning.getNumber('ai.hysteresisMargin');
  if (previous && !shortlist.includes(previous) && shortlist.length > 0 &&
      (limit > 1 || shortlist[0].score - previous.score <= margin)) {
    // Preserve a chance to retain the prior target within the same hard budget.
    shortlist[shortlist.length - 1] = previous;
  }
  const shortlistedIds = new Set(shortlist.map((candidate) => candidate.id));
  let expensiveTests = 0;
  for (let index = 0; index < scores.length; index += 1) {
    const candidate = scores[index];
    if (candidate.rejectedReason) continue;
    if (!shortlistedIds.has(candidate.id)) {
      scores[index] = { ...candidate, rejectedReason: 'shortlisted-out' };
      continue;
    }
    const ball = state.ball;
    const lane = world.lane(world.ballPosition(), candidate.position, player.definition.teamId,
      { sourcePlayerId: ball.mode === 'possessed' ? ball.holderId : undefined });
    expensiveTests += 1;
    const laneScore = (lane.clear ? 1 : -1) * tuning.getNumber('ai.laneWeight');
    scores[index] = { ...candidate, lane, laneTested: true,
      factors: { ...candidate.factors, lane: laneScore }, score: candidate.cheapScore + laneScore,
      rejectedReason: lane.clear ? undefined : 'blocked-lane' };
  }
  const survivors = scores.filter((candidate) => !candidate.rejectedReason).sort(compareCandidates);
  const best = survivors[0];
  const prior = survivors.find((candidate) => candidate.id === options.previousId);
  const retained = !!(prior && best && best.score - prior.score <= margin);
  const selected = retained ? prior : best;
  const result: SpatialEvaluation = {
    playerId, candidates: scores,
    selected: selected ? { id: selected.id, position: { ...selected.position } } : undefined,
    previousId: options.previousId, retained,
    reason: !selected ? 'no-valid-candidate' : retained ? 'hysteresis-retained' : 'best-score',
    expensiveTests
  };

  if (diagnostics?.isLayerEnabled('ai')) {
    diagnostics.publish({ layer: 'ai', source: 'spatialCandidates', entityId: 'ai-candidates',
      primitive: { type: 'label', position: player.position, text: `${playerId} · ${result.reason}` },
      data: { tick: state.tick, ...result } });
    for (const candidate of scores) {
      diagnostics.publish({ layer: 'ai', source: 'spatialCandidates', entityId: `${playerId}-${candidate.id}`,
        primitive: { type: 'circle', center: candidate.position, radius: candidate.id === selected?.id ? 0.4 : 0.2,
          color: candidate.id === selected?.id ? '#f6c177' : candidate.rejectedReason ? '#eb6f92' : '#9ccfd8' },
        data: { playerId, tick: state.tick, ...candidate, selected: candidate.id === selected?.id } });
    }
    if (selected) diagnostics.publish({ layer: 'ai', source: 'spatialCandidates', entityId: `${playerId}-target`,
      primitive: { type: 'line', start: player.position, end: selected.position, color: '#f6c177' },
      data: { playerId, selectedId: selected.id, retained } });
  }
  if (diagnostics?.isLayerEnabled('aiScores')) {
    diagnostics.publish({ layer: 'aiScores', source: 'spatialCandidates', entityId: `${playerId}-score-field`,
      primitive: { type: 'scalarGrid', cellSize: tuning.getNumber('ai.candidateSpacing'),
        cells: scores.filter((candidate) => candidate.rejectedReason !== 'outside-bounds' &&
          candidate.rejectedReason !== 'spacing' && candidate.rejectedReason !== 'unreachable')
          .map((candidate) => ({ center: candidate.position, value: candidate.cheapScore })) },
      data: { playerId, tick: state.tick, field: 'cheap-score-before-lane-tests' } });
  }
  return result;
}
