import { restingBranches } from "../simulation/regime";
import { TILT_ANGLE } from "../simulation/types";
import type { TankState } from "../simulation/types";

/** Classify the two resting branches with noise removed and parameters fixed. */
export function describeRegime(tank: TankState): {
  title: string;
  detail: string;
} {
  const { r, k, kappa, H, hReset, a } = tank.params;
  const branches = restingBranches(tank.params);
  const { receiving, unrestrictedPouring, pouring } = branches;
  const tolerance = 1e-10 * Math.max(1, H, receiving, pouring);
  const branchValues = `Without noise: receiving equilibrium ${receiving.toFixed(3)}, pouring equilibrium ${pouring.toFixed(3)}; tipping threshold ${H.toFixed(2)}, return threshold ${hReset.toFixed(2)}.${unrestrictedPouring > pouring ? " Excess inflow spills over the rim at the pouring equilibrium." : ""}`;
  const canTip = r * (1 + a) / k > H + tolerance;
  const canReturn = r * (1 - a) / (k + kappa) < hReset - tolerance;
  if (branches.boundary)
    return {
      title: "Critical boundary",
      detail: `${branchValues} A branch equilibrium lies on its switching threshold. Approaching from within that branch is asymptotic; crossing is not guaranteed.${a > 0 ? " Fluctuations may move the reservoir across a threshold." : ""}`,
    };
  const stableReceiving = branches.stableReceiving;
  const stablePouring = branches.stablePouring;
  if (stableReceiving && stablePouring)
    return {
      title: "Bistable",
      detail: `${branchValues} Both resting states persist at these same fixed parameters.${a === 0 ? " With noise off, small perturbations decay toward the current branch equilibrium." : canTip && canReturn ? " Sufficiently sustained inflow fluctuations can switch in both directions; long residence times are not guaranteed." : canTip ? " The current noise range permits tipping but cannot trigger a return from the pouring equilibrium." : canReturn ? " The current noise range permits a return but cannot trigger tipping from the receiving equilibrium." : " The current bounded noise cannot switch either resting branch by itself."}`,
    };
  if (!stableReceiving && !stablePouring)
    return {
      title: "Self-sustained cycle",
      detail: `${branchValues} Mean inflow crosses the tipping threshold, and pouring reaches the return threshold, so the reservoir cycles without new disturbances.${a > 0 ? " Noise can change the timing of each cycle." : ""}`,
    };
  if (stableReceiving)
    return {
      title: "Monostable · receiving",
      detail: `${branchValues} The only stable resting state receives water below the tipping threshold. A triggered tip is an excursion that returns toward the same equilibrium.${a === 0 ? " Add enough water to trigger one excursion." : canTip ? " Sufficiently sustained noise may trigger an excursion; event times are irregular." : " The current bounded noise cannot reach the tipping threshold by itself."}`,
    };
  return {
    title: "Monostable · pouring",
    detail: `${branchValues} The only stable resting state remains tilted while inflow balances drainage and any rim spill.${a > 0 && canReturn ? " Sufficiently weak inflow can trigger a temporary return before tipping again." : " At fixed mean inflow, the reservoir cannot drain to the return threshold from above."}`,
  };
}

export function describePhase(tank: TankState): string {
  if (tank.phase === "RETURN")
    return tank.opening > 0 ? "Returning · outlet closing" : "Returning · outlet closed";
  if (tank.phase === "DRAIN") {
    if (tank.angle < TILT_ANGLE - 1e-6)
      return tank.opening > 0 ? "Tipping · outlet opening" : "Tipping · outlet closed";
    return "Pouring · tilted";
  }
  const balance = tank.q - tank.params.k * tank.h;
  if (Math.abs(balance) < 0.001) return "Receiving · flow balanced";
  return balance > 0 ? "Receiving · accumulating" : "Receiving · water decreasing";
}

