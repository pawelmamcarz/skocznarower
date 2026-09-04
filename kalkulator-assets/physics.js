/* Constant-speed power on one straight road segment.
 * Martin et al. (1998), Journal of Applied Biomechanics 14(3), 276-291:
 * https://doi.org/10.1123/jab.14.3.276 (equations 2, 6, 9 and 14).
 * This reduced model omits acceleration, wheel-bearing losses and crosswind.
 * CdA and Crr are inputs, not inferred measurements. The signed aerodynamic
 * term extends the one-dimensional model to a tailwind faster than the bike,
 * assuming the same effective CdA for airflow from either direction.
 */
(function (root) {
  'use strict';

  const GRAVITY = 9.80665;
  const DEFAULTS = Object.freeze({
    mass: 90,
    speed: 25,
    grade: 0,
    wind: 0,
    cda: 0.4,
    crr: 0.006,
    efficiency: 0.97,
    airDensity: 1.225,
  });
  const LIMITS = Object.freeze({
    mass: Object.freeze([1, 300]),
    speed: Object.freeze([0, 100]),
    grade: Object.freeze([-30, 30]),
    wind: Object.freeze([-100, 100]),
    cda: Object.freeze([0.1, 1.2]),
    crr: Object.freeze([0, 0.05]),
    efficiency: Object.freeze([0.5, 1]),
    airDensity: Object.freeze([0.8, 1.5]),
  });

  function compute(input = {}) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new RangeError('Calculator inputs must be an object of finite numbers.');
    }
    const values = {};
    for (const [name, [min, max]] of Object.entries(LIMITS)) {
      const value = Object.hasOwn(input, name) ? input[name] : DEFAULTS[name];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
        throw new RangeError(`Invalid ${name}: expected a finite number from ${min} to ${max}.`);
      }
      values[name] = value;
    }

    // speed and wind are km/h; grade is rise / horizontal run in percent.
    // Positive wind opposes travel. Positive grade is uphill.
    const velocity = values.speed / 3.6;
    if (velocity === 0) {
      return { rolling: 0, aero: 0, gravity: 0, netWheel: 0, pedaling: 0, braking: 0, drivetrain: 0 };
    }
    const relativeAir = velocity + values.wind / 3.6;
    const angle = Math.atan(values.grade / 100);
    const rolling = values.crr * values.mass * GRAVITY * Math.cos(angle) * velocity;
    const aero = 0.5 * values.airDensity * values.cda * relativeAir * Math.abs(relativeAir) * velocity;
    const gravity = values.mass * GRAVITY * Math.sin(angle) * velocity;
    const netWheel = rolling + aero + gravity;
    const propulsion = Math.max(0, netWheel);
    const pedaling = propulsion / values.efficiency;
    const braking = Math.max(0, -netWheel);
    const drivetrain = pedaling - propulsion;

    return { rolling, aero, gravity, netWheel, pedaling, braking, drivetrain };
  }

  root.Bieznik = Object.freeze({ DEFAULTS, LIMITS, compute });
})(typeof window !== 'undefined' ? window : globalThis);
