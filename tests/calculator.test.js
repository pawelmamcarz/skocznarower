import { describe, expect, it } from 'vitest';
import '../kalkulator-assets/physics.js';

const { compute, DEFAULTS, LIMITS } = globalThis.Bieznik;
const REFERENCE = {
  mass: 90,
  speed: 36,
  grade: 0,
  wind: 0,
  cda: 0.32,
  crr: 0.005,
  efficiency: 0.97,
  airDensity: 1.225,
};

// Independent numerical reference values, calculated outside the implementation
// from SI units. They distinguish air-relative force from ground-relative power.
describe('constant-speed cycling power', () => {
  it('uses defaults for omitted inputs', () => {
    expect(compute()).toEqual(compute(DEFAULTS));
    expect(compute({ speed: 36 })).toEqual(compute({ ...DEFAULTS, speed: 36 }));
  });

  it('has zero mechanical power at rest, even in wind or on a slope', () => {
    for (const wind of [-100, 0, 100]) {
      for (const grade of [-30, 0, 30]) {
        expect(Object.values(compute({ ...REFERENCE, speed: 0, wind, grade }))).toEqual([0, 0, 0, 0, 0, 0, 0]);
      }
    }
  });

  it('balances rolling resistance, drag and drivetrain loss on a flat road', () => {
    const result = compute(REFERENCE);
    expect(result.rolling).toBeCloseTo(44.129925, 8);
    expect(result.aero).toBeCloseTo(196, 8);
    expect(result.gravity).toBe(0);
    expect(result.netWheel).toBeCloseTo(240.129925, 8);
    expect(result.pedaling).toBeCloseTo(247.556623711, 8);
    expect(result.drivetrain).toBeCloseTo(7.426698711, 8);
    expect(result.braking).toBe(0);
  });

  it('uses ground speed to calculate power against a headwind', () => {
    const result = compute({ ...REFERENCE, wind: 18 });
    expect(result.aero).toBeCloseTo(441, 8);
    expect(result.pedaling).toBeCloseTo(500.133943299, 8);
  });

  it('reduces drag with a tailwind and removes it when wind matches bike speed', () => {
    const slowerWind = compute({ ...REFERENCE, wind: -18 });
    expect(slowerWind.aero).toBeCloseTo(49, 8);
    expect(slowerWind.pedaling).toBeCloseTo(96.010231959, 8);
    const matchingWind = compute({ ...REFERENCE, wind: -36 });
    expect(matchingWind.aero).toBe(0);
    expect(matchingWind.pedaling).toBeCloseTo(45.494768041, 8);
  });

  it('represents a faster tailwind as assistance, without negative pedaling', () => {
    const result = compute({ ...REFERENCE, wind: -54 });
    expect(result.aero).toBeCloseTo(-49, 8);
    expect(result.netWheel).toBeCloseTo(-4.870075, 8);
    expect(result.braking).toBeCloseTo(4.870075, 8);
    expect(result.pedaling).toBe(0);
    expect(result.drivetrain).toBe(0);
  });

  it('uses percent grade and road speed for a five-percent climb', () => {
    const result = compute({ ...REFERENCE, speed: 18, grade: 5 });
    expect(result.rolling).toBeCloseTo(22.037432904, 8);
    expect(result.gravity).toBeCloseTo(220.374329041, 8);
    expect(result.aero).toBeCloseTo(24.5, 8);
    expect(result.pedaling).toBeCloseTo(275.166764892, 8);
    expect(result.braking).toBe(0);
  });

  it('requires braking on a steep descent, but can require pedaling on a shallow one', () => {
    const steep = compute({ ...REFERENCE, grade: -5 });
    expect(steep.rolling).toBeCloseTo(44.074865808, 8);
    expect(steep.gravity).toBeCloseTo(-440.748658083, 8);
    expect(steep.netWheel).toBeCloseTo(-200.673792274, 8);
    expect(steep.braking).toBeCloseTo(200.673792274, 8);
    expect(steep.pedaling).toBe(0);
    expect(steep.drivetrain).toBe(0);
    const shallow = compute({ ...REFERENCE, grade: -1 });
    expect(shallow.pedaling).toBeCloseTo(156.569362197, 8);
    expect(shallow.braking).toBe(0);
  });

  it('preserves the signed energy balance across wind, grade and efficiency', () => {
    for (const wind of [-100, -36, 0, 100]) {
      for (const grade of [-30, 0, 30]) {
        for (const efficiency of [0.5, 0.97, 1]) {
          const result = compute({ ...REFERENCE, wind, grade, efficiency });
          expect(result.pedaling * efficiency - result.braking).toBeCloseTo(result.netWheel, 8);
          expect(result.rolling + result.aero + result.gravity).toBeCloseTo(result.netWheel, 8);
          expect(result.pedaling * result.braking).toBe(0);
          expect(result.drivetrain).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('doubles rolling power and multiplies aerodynamic power by eight at twice the speed in still air', () => {
    const slow = compute({ ...REFERENCE, speed: 18 });
    const fast = compute(REFERENCE);
    expect(fast.rolling).toBeCloseTo(slow.rolling * 2, 8);
    expect(fast.aero).toBeCloseTo(slow.aero * 8, 8);
  });

  it('does not invent an inertial penalty for mass during constant-speed motion', () => {
    const lighter = compute(REFERENCE);
    const heavier = compute({ ...REFERENCE, mass: 100 });
    expect(heavier.aero).toBe(lighter.aero);
    expect(heavier.rolling - lighter.rolling).toBeCloseTo(4.903325, 8);
    expect(heavier.gravity).toBe(0);
  });
});

describe('calculator input validation', () => {
  for (const name of Object.keys(DEFAULTS)) {
    it(`accepts the documented bounds for ${name}`, () => {
      const [min, max] = LIMITS[name];
      expect(() => compute({ [name]: min })).not.toThrow();
      expect(() => compute({ [name]: max })).not.toThrow();
    });
    it(`rejects invalid values for ${name} without coercing strings`, () => {
      const [min, max] = LIMITS[name];
      for (const value of [min - 1, max + 1, NaN, Infinity, -Infinity, '25', '', null, undefined, true, [], {}]) {
        expect(() => compute({ [name]: value })).toThrow(RangeError);
      }
    });
  }
  it('rejects a non-object input', () => {
    for (const input of [null, 25, '25', true, []]) {
      expect(() => compute(input)).toThrow(RangeError);
    }
  });
});
