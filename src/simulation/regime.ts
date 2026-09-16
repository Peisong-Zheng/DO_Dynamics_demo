import { rimCapacity } from "./chamber";
import { TILT_ANGLE } from "./types";
import type { TankParams } from "./types";

export interface RestingBranches {
  /** Noise-free equilibrium while receiving, r / k. */
  receiving: number;
  /** r / (k + kappa), before the retaining rim caps it. */
  unrestrictedPouring: number;
  /** Reachable pouring equilibrium, limited by the rim's retained volume. */
  pouring: number;
  /** A branch equilibrium sits exactly on its switching threshold. */
  boundary: boolean;
  stableReceiving: boolean;
  stablePouring: boolean;
}

/** Classify the two noise-free resting branches from parameters alone. */
export function restingBranches({ r, k, kappa, H, hReset }: TankParams): RestingBranches {
  const receiving = r / k;
  const unrestrictedPouring = r / (k + kappa);
  const pouring = Math.min(unrestrictedPouring, rimCapacity(TILT_ANGLE));
  const tolerance = 1e-10 * Math.max(1, H, receiving, pouring);
  return {
    receiving,
    unrestrictedPouring,
    pouring,
    boundary: Math.abs(receiving - H) <= tolerance || Math.abs(pouring - hReset) <= tolerance,
    stableReceiving: receiving < H,
    stablePouring: pouring > hReset,
  };
}

/** Outlet coefficient below which the controlled outlet counts as throttled. */
export const THROTTLED_OUTLET_LIMIT = 4;

/** The retaining baffle and its throttled outlet are one apparatus fitting, so
 * they follow the outlet setting rather than the current resting branches: a
 * threshold or inflow change must never make the vessel lose its baffle. */
export function isBaffleFitted({ kappa }: TankParams): boolean {
  return kappa < THROTTLED_OUTLET_LIMIT;
}
