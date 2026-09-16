# Authentic shishi-odoshi refinement

The user approved implementation of the following refinements on 15 September 2026. This supplements the earlier tipping-reservoir redesign; the current README describes the implemented model.

## Interface

- Retain Random inflow as the single case. Remove the experiment selector, global Noise off action and automatic-background controls.
- Put one vertical tipping-threshold range beside each apparatus. Moving upward raises H.
- Make the visible counterweight draggable and keyboard accessible. Both interactions update the same physical H, preserve water and phase, and immediately synchronize their positions and readouts.
- Preserve the B Monostable / Bistable configuration buttons and the Notes drawer with author, contacts, implementation credit and references. Keep detailed parameters collapsed.

## Apparatus and physics

- Use a bamboo tail and a transparent cylindrical reservoir with a diagonal open mouth. The receiving pose slopes upward toward the mouth; the tipping pose slopes downward.
- Feed the open mouth from a fixed bamboo spout with a vertical falling stream. Eliminate the pivot-feed plumbing.
- Calculate water as a world-horizontal volume clipped by the real cylinder and mouth. Use the same geometry for 3D, SVG, inlet capture and counterweight torque.
- Retain a visible transparent lip and controlled outlet so the conceptual apparatus can support a tilted equilibrium. Explain this modification in Notes; an ordinary emptying bamboo tube cannot demonstrate that branch.
- Keep the front outlet closed while it is above the wetted part of the reservoir. Account explicitly for rim overflow when the available volume shrinks during tipping, including its visible outflow.
- Recalibrate the counterweight mapping for receiving-pose water torque and verify its inverse over the entire H range.

## References and verification

The form was informed by real product photos and the description at [Bamboo Accents](https://www.bambooaccents.com/products/12-rocking-fountain), the [North American Japanese Garden Association basin guide](https://najga.org/japanese-garden-basins/), and an inspected [Bamboo Dicks photograph](https://bamboodicks.com/products/tiki-bamboo-fountain-shishi-odoshi-or-deer-scare-fountain). No remote images are loaded by the running app.

Verify conservation including overflow, angle-dependent aperture capture and retained capacity, threshold/weight inversion, actual bistable behavior and seeded replay. In the browser verify both directions of weight/slider synchronization, keyboard and touch operation, vertical inflow and angled poses, desktop/mobile layout, Notes and working SVG fallback. Inspect screenshots before delivery.
