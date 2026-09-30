import {
  ATTRIBUTES_AGILITY_SPREAD_KEY,
  ATTRIBUTES_POWER_SPREAD_KEY,
  ATTRIBUTES_SPEED_SPREAD_KEY,
  BALL_HIGH_THROW_MAX_PLANAR_SPEED_KEY,
  BALL_HIGH_THROW_MAX_VERTICAL_SPEED_KEY,
  BALL_HIGH_THROW_MIN_PLANAR_SPEED_KEY,
  BALL_HIGH_THROW_MIN_VERTICAL_SPEED_KEY,
  BALL_LOW_THROW_MAX_SPEED_KEY,
  BALL_LOW_THROW_MIN_SPEED_KEY,
  MOVEMENT_ACCELERATION_KEY,
  MOVEMENT_BRAKING_KEY,
  MOVEMENT_FACING_RESPONSE_KEY,
  MOVEMENT_MAX_SPEED_KEY,
  MOVEMENT_REVERSAL_RESPONSE_KEY,
  MOVEMENT_TURNING_RESPONSE_KEY,
  type TuningReader
} from './tuning';

/** Stable definition data. Every attribute uses [0, 100]; 50 preserves base tuning. */
export interface PlayerAttributes {
  readonly speed: number;
  readonly agility: number;
  readonly strength: number;
  readonly power: number;
  readonly control: number;
}

export const ATTRIBUTE_MIN = 0;
export const ATTRIBUTE_MAX = 100;
export const ATTRIBUTE_BASELINE = 50;
export const DEFAULT_PLAYER_ATTRIBUTES: PlayerAttributes = Object.freeze({
  speed: ATTRIBUTE_BASELINE,
  agility: ATTRIBUTE_BASELINE,
  strength: ATTRIBUTE_BASELINE,
  power: ATTRIBUTE_BASELINE,
  control: ATTRIBUTE_BASELINE
});

/** Strength affects authored impact/resistance, never equal-mass geometry. */
export function playerStrengthRatio(checker: PlayerAttributes, target: PlayerAttributes, tuning: TuningReader): number {
  const spread = tuning.getNumber('contact.strengthSpread');
  return (1 + spread * (checker.strength - ATTRIBUTE_BASELINE) / ATTRIBUTE_BASELINE) /
    (1 + spread * (target.strength - ATTRIBUTE_BASELINE) / ATTRIBUTE_BASELINE);
}

export function createPlayerAttributes(
  values: Partial<PlayerAttributes> = {}
): PlayerAttributes {
  const attributes = { ...DEFAULT_PLAYER_ATTRIBUTES, ...values };
  for (const [key, value] of Object.entries(attributes)) {
    if (!Number.isFinite(value) || value < ATTRIBUTE_MIN || value > ATTRIBUTE_MAX) {
      throw new RangeError(`Player attribute '${key}' must be finite and in [0, 100].`);
    }
  }
  return Object.freeze(attributes);
}

type MappedAttribute = 'speed' | 'agility' | 'power';

const SPREAD_KEYS: Record<MappedAttribute, string> = {
  speed: ATTRIBUTES_SPEED_SPREAD_KEY,
  agility: ATTRIBUTES_AGILITY_SPREAD_KEY,
  power: ATTRIBUTES_POWER_SPREAD_KEY
};

// Strength and Control deliberately have no effects until contact/receive issues.
const VALUE_ATTRIBUTES: Readonly<Record<string, MappedAttribute>> = {
  [MOVEMENT_MAX_SPEED_KEY]: 'speed',
  [MOVEMENT_ACCELERATION_KEY]: 'agility',
  [MOVEMENT_BRAKING_KEY]: 'agility',
  [MOVEMENT_TURNING_RESPONSE_KEY]: 'agility',
  [MOVEMENT_REVERSAL_RESPONSE_KEY]: 'agility',
  [MOVEMENT_FACING_RESPONSE_KEY]: 'agility',
  [BALL_LOW_THROW_MIN_SPEED_KEY]: 'power',
  [BALL_LOW_THROW_MAX_SPEED_KEY]: 'power',
  [BALL_HIGH_THROW_MIN_PLANAR_SPEED_KEY]: 'power',
  [BALL_HIGH_THROW_MAX_PLANAR_SPEED_KEY]: 'power',
  [BALL_HIGH_THROW_MIN_VERTICAL_SPEED_KEY]: 'power',
  [BALL_HIGH_THROW_MAX_VERTICAL_SPEED_KEY]: 'power'
};

/**
 * Linear, baseline-preserving curve: 1 + spread * (attribute - 50) / 50.
 * At default spreads, Speed/Power span 0.75–1.25 and Agility spans 0.5–1.5.
 * The registry bounds spread below 1, keeping every multiplier positive.
 * Power scales both ends of each launch-speed range, leaving charge in [0, 1]
 * and preserving the distinct low/high family shapes, including vertical speed.
 */
export function playerAttributeMultiplier(
  attribute: MappedAttribute,
  attributes: PlayerAttributes,
  tuning: TuningReader
): number {
  return 1 + tuning.getNumber(SPREAD_KEYS[attribute]) *
    (attributes[attribute] - ATTRIBUTE_BASELINE) / ATTRIBUTE_BASELINE;
}

/** A read-only effective view; never writes global overrides or player data. */
export function createPlayerTuning(
  attributes: PlayerAttributes,
  tuning: TuningReader
): TuningReader {
  return {
    getNumber(key) {
      const baseValue = tuning.getNumber(key);
      const attribute = VALUE_ATTRIBUTES[key];
      return attribute
        ? baseValue * playerAttributeMultiplier(attribute, attributes, tuning)
        : baseValue;
    }
  };
}

export interface PlayerDerivedValue {
  readonly key: string;
  readonly attribute: MappedAttribute;
  readonly attributeValue: number;
  readonly baseValue: number;
  readonly multiplier: number;
  readonly effectiveValue: number;
}

/** Used only for diagnostics; gameplay consumes the same mapping above. */
export function describePlayerDerivedValues(
  attributes: PlayerAttributes,
  tuning: TuningReader
): readonly PlayerDerivedValue[] {
  const effective = createPlayerTuning(attributes, tuning);
  return Object.entries(VALUE_ATTRIBUTES).map(([key, attribute]) => ({
    key,
    attribute,
    attributeValue: attributes[attribute],
    baseValue: tuning.getNumber(key),
    multiplier: playerAttributeMultiplier(attribute, attributes, tuning),
    effectiveValue: effective.getNumber(key)
  }));
}
