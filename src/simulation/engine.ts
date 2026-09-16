import { openingForAngle, rimCapacity } from "./chamber";
import { createBackground, createPresetTanks } from "./presets";
import { mulberry32, normal01 } from "./random";
import {
  CAPACITY, DEFAULT_SEED, DT, PULSE_HEADROOM, PULSE_VOLUME, TAU,
  REST_ANGLE, TILT_ANGLE, TILT_DURATION,
} from "./types";
import type {
  AdjustableParam, BackgroundRamp, DrainEvent, PresetId, PulseEvent,
  StabilityMode, TankIndex, TankState,
} from "./types";

const MAX_LOG_ENTRIES = 2048;
const OU_DECAY = Math.exp(-DT / TAU);
const OU_INNOVATION = Math.sqrt(1 - OU_DECAY * OU_DECAY);
const PARAM_LIMITS = {
  r: [0.06, 0.3], H: [0.55, 1.65], a: [0, 0.95], kappa: [0.4, 8],
} as const;
const ANGULAR_SPEED = TILT_ANGLE / TILT_DURATION;

export interface IntegrationOptions {
  /** Subdivide rotations for convergence checks; OU still updates once per DT. */
  integrationStep?: number;
}
interface WaterIncrement {
  volume: number;
  input: number;
  slowLeak: number;
  fastDrain: number;
  overflow: number;
}

/** One hybrid volume/angle model, driven entirely by the fixed physical clock. */
export class DynamicsEngine {
  time = 0;
  z = 0;
  seed: number;
  tanks: [TankState, TankState];
  events: DrainEvent[] = [];
  pulses: PulseEvent[] = [];
  background: BackgroundRamp | null = null;
  presetId: PresetId;
  private tick = 0;
  private random: () => number;
  private readonly integrationStep: number;

  constructor(preset: PresetId = "B", seed = DEFAULT_SEED, options: IntegrationOptions = {}) {
    this.integrationStep = options.integrationStep ?? DT / 4;
    if (!Number.isFinite(this.integrationStep) || this.integrationStep <= 0 || this.integrationStep > DT) {
      throw new RangeError("integrationStep must be positive and no greater than DT");
    }
    this.presetId = preset;
    this.seed = seed >>> 0;
    this.random = mulberry32(this.seed);
    this.tanks = createPresetTanks(preset);
    this.reset(preset, seed);
  }

  reset(preset: PresetId = "B", seed: number = this.seed): void {
    this.seed = seed >>> 0;
    this.presetId = preset;
    this.tick = 0;
    this.time = 0;
    this.random = mulberry32(this.seed);
    this.z = normal01(this.random);
    this.tanks = createPresetTanks(preset);
    this.background = createBackground(preset);
    this.events.length = 0;
    this.pulses.length = 0;
    this.updateFlows();
  }

  setParam(index: TankIndex, key: AdjustableParam, value: number): void {
    const [minimum, maximum] = PARAM_LIMITS[key];
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      throw new RangeError(`${key} must be between ${minimum} and ${maximum}`);
    }
    const tank = this.tanks[index];
    tank.params[key] = value;
    if (key === "a" && value > 0) tank.noiseMemory = value;
    if (this.background?.active && this.background.tank === index && this.background.param === key) {
      this.background.active = false;
    }
    // Parameter edits never advance volume, angle, OU, time or phase.
  }

  setStabilityMode(mode: StabilityMode): void {
    if (mode !== "monostable" && mode !== "bistable") {
      throw new RangeError("Unknown stability mode");
    }
    Object.assign(this.tanks[1].params, {
      r: 0.144, H: 1, kappa: mode === "bistable" ? 0.8 : 8,
    });
    if (this.background?.tank === 1) this.background.active = false;
  }

  setNoiseEnabled(index: TankIndex, enabled: boolean): void {
    const tank = this.tanks[index];
    if (!enabled && tank.params.a > 0) tank.noiseMemory = tank.params.a;
    tank.params.a = enabled ? tank.noiseMemory : 0;
  }

  disableNoise(): void {
    this.setNoiseEnabled(0, false);
    this.setNoiseEnabled(1, false);
  }

  freezeBackground(): void {
    if (this.background) this.background.active = false;
  }

  canPulse(index: TankIndex): boolean {
    const tank = this.tanks[index];
    return !tank.pulsePending && tank.h + PULSE_VOLUME <= CAPACITY - PULSE_HEADROOM;
  }

  /** UI also disables this action when paused; physics executes it next step. */
  requestPulse(index: TankIndex): boolean {
    if (!this.canPulse(index)) return false;
    this.tanks[index].pulsePending = true;
    return true;
  }

  step(): void {
    const nextTime = (this.tick + 1) * DT;
    this.updateBackground(nextTime);
    // Exactly one normal sample per global physical step, even with zero noise.
    this.z = OU_DECAY * this.z + OU_INNOVATION * normal01(this.random);
    this.updateFlows();
    for (const index of [0, 1] as const) {
      const tank = this.tanks[index];
      if (tank.pulsePending) {
        tank.pulsePending = false;
        // Recheck the reserve without truncating the requested water volume.
        if (this.canPulse(index)) {
          tank.h += PULSE_VOLUME;
          tank.ledger.manual += PULSE_VOLUME;
          this.pulses.push({ tank: index, time: this.time, amount: PULSE_VOLUME });
          if (this.pulses.length > MAX_LOG_ENTRIES) this.pulses.shift();
        }
      }
      const overflowBefore = tank.ledger.overflow;
      this.advanceTank(index);
      tank.spillRate = (tank.ledger.overflow - overflowBefore) / DT;
    }
    this.tick += 1;
    this.time = nextTime;
  }

  private updateBackground(time: number): void {
    const ramp = this.background;
    if (!ramp?.active) return;
    const fraction = Math.max(0, Math.min(1, (time - ramp.start) / ramp.duration));
    this.tanks[ramp.tank].params[ramp.param] =
      fraction === 1 ? ramp.to : ramp.from + (ramp.to - ramp.from) * fraction;
    if (fraction === 1) ramp.active = false;
  }

  private updateFlows(): void {
    const fluctuation = Math.tanh(this.z);
    for (const tank of this.tanks) {
      tank.q = tank.params.r * (1 + tank.params.a * fluctuation);
    }
  }

  private beginTipping(index: TankIndex, elapsed: number): void {
    const tank = this.tanks[index];
    tank.phase = "DRAIN";
    tank.eventCount += 1;
    this.events.push({ tank: index, time: this.time + elapsed, h: tank.h, params: { ...tank.params } });
    if (this.events.length > MAX_LOG_ENTRIES) this.events.shift();
  }

  /** Analytic solution while angle, inlet and outlet coefficients are constant. */
  private constantIncrement(tank: TankState, duration: number): WaterIncrement {
    const { k, kappa } = tank.params;
    const fastCoefficient = kappa * tank.opening;
    const lambda = k + fastCoefficient;
    const equilibrium = tank.q / lambda;
    const capacity = rimCapacity(tank.angle);
    const initial = Math.min(tank.h, capacity);
    const initialSpill = Math.max(0, tank.h - capacity);
    let freeDuration = duration;
    if (equilibrium > capacity && initial < capacity) {
      const crossing = -Math.log((equilibrium - capacity) / (equilibrium - initial)) / lambda;
      freeDuration = Math.min(duration, Math.max(0, crossing));
    } else if (equilibrium > capacity && initial >= capacity) freeDuration = 0;
    const oneMinusDecay = -Math.expm1(-lambda * freeDuration);
    const freeIntegral = equilibrium * freeDuration + ((initial - equilibrium) * oneMinusDecay) / lambda;
    const heldDuration = duration - freeDuration;
    const integralV = freeIntegral + capacity * heldDuration;
    return {
      volume: heldDuration > 0 ? capacity : initial + (equilibrium - initial) * oneMinusDecay,
      input: tank.q * duration,
      slowLeak: k * integralV,
      fastDrain: fastCoefficient * integralV,
      overflow: initialSpill + Math.max(0, tank.q - lambda * capacity) * heldDuration,
    };
  }

  /** RK4 for the short linear-angle rotation; every stage uses its true opening.
   * The same quadrature accounts for V, slow leak and fast drain, so their
   * increments conserve water algebraically, without clamping or deleting V.
   */
  private rotatingIncrement(tank: TankState, duration: number, angularVelocity: number): WaterIncrement {
    const { k, kappa } = tank.params;
    const opening0 = openingForAngle(tank.angle);
    const openingMid = openingForAngle(tank.angle + angularVelocity * duration / 2);
    const openingEnd = openingForAngle(tank.angle + angularVelocity * duration);
    const rate = (v: number, opening: number) => tank.q - (k + kappa * opening) * v;
    const capStart = rimCapacity(tank.angle);
    const capMid = rimCapacity(tank.angle + angularVelocity * duration / 2);
    const capEnd = rimCapacity(tank.angle + angularVelocity * duration);
    const v1 = Math.min(tank.h, capStart);
    const d1 = rate(v1, opening0);
    const v2 = Math.min(v1 + duration * d1 / 2, capMid);
    const d2 = rate(v2, openingMid);
    const v3 = Math.min(v1 + duration * d2 / 2, capMid);
    const d3 = rate(v3, openingMid);
    const v4 = Math.min(v1 + duration * d3, capEnd);
    const input = tank.q * duration;
    const slowLeak = k * duration * (v1 + 2 * v2 + 2 * v3 + v4) / 6;
    const fastDrain = kappa * duration *
      (opening0 * v1 + 2 * openingMid * (v2 + v3) + openingEnd * v4) / 6;
    return { volume: tank.h + input - slowLeak - fastDrain, input, slowLeak, fastDrain, overflow: 0 };
  }

  private integrate(tank: TankState, duration: number, angularVelocity = 0): void {
    if (duration === 0) return;
    const increment = angularVelocity === 0
      ? this.constantIncrement(tank, duration)
      : this.rotatingIncrement(tank, duration, angularVelocity);
    tank.h = increment.volume;
    tank.ledger.input += increment.input;
    tank.ledger.slowLeak += increment.slowLeak;
    tank.ledger.fastDrain += increment.fastDrain;
    tank.ledger.overflow += increment.overflow;
    tank.angle += angularVelocity * duration;
    tank.opening = openingForAngle(tank.angle);
    const rim = rimCapacity(tank.angle);
    if (tank.h > rim) {
      // The changing open mouth physically spills the excess. The exact amount
      // enters the ledger and visible spillRate; it is never silently clipped.
      tank.ledger.overflow += tank.h - rim;
      tank.h = rim;
    }
  }

  private constantCrossing(tank: TankState, target: number, ascending: boolean, available: number): number {
    const lambda = tank.params.k + tank.params.kappa * tank.opening;
    const equilibrium = tank.q / lambda;
    const tolerance = 8 * Number.EPSILON * Math.max(1, Math.abs(target), Math.abs(equilibrium));
    if (ascending ? equilibrium <= target + tolerance : equilibrium >= target - tolerance) return Infinity;
    const change = (target - tank.h) / (tank.h - equilibrium);
    if (change <= -1 || change > 0) return Infinity;
    const candidate = -Math.log1p(change) / lambda;
    const timeTolerance = 16 * Number.EPSILON * Math.max(DT, candidate);
    return candidate >= 0 && candidate <= available + timeTolerance ? Math.min(candidate, available) : Infinity;
  }

  private advanceTank(index: TankIndex): void {
    const tank = this.tanks[index];
    let remaining = DT;
    let elapsed = 0;
    let transitions = 0;
    while (remaining > 0) {
      const { H, hReset } = tank.params;
      if (tank.phase === "FILL" && tank.h >= H) {
        this.beginTipping(index, elapsed);
        if (++transitions > 8) throw new Error("Too many phase transitions in one fixed step");
        continue;
      }
      if (tank.phase === "DRAIN" && tank.h <= hReset) {
        tank.phase = "RETURN";
        if (++transitions > 8) throw new Error("Too many phase transitions in one fixed step");
        continue;
      }
      if (tank.phase === "RETURN" && tank.angle <= 0) {
        tank.angle = 0;
        tank.opening = 0;
        tank.phase = "FILL";
        if (++transitions > 8) throw new Error("Too many phase transitions in one fixed step");
        continue;
      }
      const angularVelocity = tank.phase === "RETURN" ? -ANGULAR_SPEED
        : tank.phase === "DRAIN" && tank.angle < TILT_ANGLE ? ANGULAR_SPEED : 0;
      if (angularVelocity === 0) {
        const ascending = tank.phase === "FILL";
        const target = ascending ? H : hReset;
        const crossing = this.constantCrossing(tank, target, ascending, remaining);
        if (!Number.isFinite(crossing)) {
          this.integrate(tank, remaining);
          break;
        }
        this.integrate(tank, crossing);
        // The analytic endpoint is the threshold, not a prescribed reset volume.
        tank.h = target;
        elapsed += crossing;
        remaining -= crossing;
        if (ascending) this.beginTipping(index, elapsed);
        else tank.phase = "RETURN";
        if (++transitions > 8) throw new Error("Too many phase transitions in one fixed step");
        continue;
      }
      const angleTarget = angularVelocity > 0
        ? tank.angle < REST_ANGLE ? REST_ANGLE : TILT_ANGLE
        : tank.angle > REST_ANGLE ? REST_ANGLE : 0;
      const untilAngleTarget = (angleTarget - tank.angle) / angularVelocity;
      let duration = Math.min(remaining, this.integrationStep, untilAngleTarget);
      const reachesAngleTarget = duration === untilAngleTarget;
      const end = this.rotatingIncrement(tank, duration, angularVelocity);
      if (tank.phase === "DRAIN" && end.volume <= hReset) {
        // During tipping, opening increases, so V can rise then fall but cannot
        // fall through the return line and recover within this segment.
        let low = 0;
        let high = duration;
        for (let iteration = 0; iteration < 44; iteration++) {
          const middle = (low + high) / 2;
          if (this.rotatingIncrement(tank, middle, angularVelocity).volume > hReset) low = middle;
          else high = middle;
        }
        duration = high;
        this.integrate(tank, duration, angularVelocity);
        tank.phase = "RETURN";
        if (++transitions > 8) throw new Error("Too many phase transitions in one fixed step");
      } else {
        this.integrate(tank, duration, angularVelocity);
        if (reachesAngleTarget) {
          // Snap only to the exact angular endpoint to avoid floating-point
          // slivers. Stored water is never reset when the apparatus returns.
          tank.angle = angleTarget;
          tank.opening = openingForAngle(angleTarget);
          if (tank.phase === "RETURN" && angleTarget === 0) {
            tank.phase = "FILL";
            if (++transitions > 8) throw new Error("Too many phase transitions in one fixed step");
          }
        }
      }
      elapsed += duration;
      remaining -= duration;
    }
  }
}
