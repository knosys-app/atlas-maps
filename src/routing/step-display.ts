/**
 * Step instruction + icon formatters.
 *
 * Maps the internal `RouteStep` (from the parsed Valhalla response)
 * to the `StepsTab`-facing shape with a human-readable instruction
 * string + Lucide icon hint. Kept separate from `steps-tab.tsx` so
 * the sheet stays pure presentation and the routing-side concerns
 * stay near the parser.
 *
 * Instruction reconstruction mirrors SpeedDeck's phraseology (which
 * is itself derived from OSRM v5). Valhalla's response carries a
 * pre-built `instruction` string in each maneuver, but our parser
 * dropped it because the OSRM-shaped `RouteStep` doesn't carry it
 * — see `route-parser.ts`. We reconstruct from `type` + `modifier`
 * + `name` here, which keeps the parser output minimal.
 *
 * If the v3.1 turn-by-turn slice wants more nuanced phrasing (e.g.
 * "Use the right two lanes to turn right onto …"), the right move
 * is to extend the parser to keep Valhalla's `instruction` string
 * and switch this function to passthrough.
 */

import type { RouteStep as InternalRouteStep } from './types'
import type { RouteStep as DisplayRouteStep } from '@/sheet/steps-tab'

/** Build a tap-able row for the Steps tab from an internal route step. */
export function toDisplayStep(
  step: InternalRouteStep,
  index: number,
  formatDistance: (m: number) => string,
  formatDuration: (s: number) => string,
): DisplayRouteStep {
  return {
    index,
    instruction: describeStep(step),
    distanceLabel: formatDistance(step.distance),
    durationLabel: formatDuration(step.duration),
    iconName: iconForManeuver(step.maneuver.type, step.maneuver.modifier),
  }
}

/** Compose the natural-language instruction from a maneuver + street
 *  name. Branches cover the maneuver types the parser actually emits
 *  today; anything not handled falls back to the street name (or
 *  "Continue" if no name). */
function describeStep(step: InternalRouteStep): string {
  const { type, modifier } = step.maneuver
  const name = step.name?.trim() ?? ''
  switch (type) {
    case 'depart':
      return name ? `Head out on ${name}` : 'Start your trip'
    case 'arrive':
      return 'Arrive at destination'
    case 'turn': {
      const direction = modifier ?? ''
      const turn = direction ? `Turn ${direction}` : 'Turn'
      return name ? `${turn} onto ${name}` : turn
    }
    case 'continue':
      return name ? `Continue on ${name}` : 'Continue straight'
    case 'merge':
      return name ? `Merge onto ${name}` : 'Merge'
    case 'fork': {
      const direction = modifier ?? 'straight'
      return name ? `Keep ${direction} onto ${name}` : `Keep ${direction}`
    }
    case 'roundabout':
      return name ? `Take the roundabout to ${name}` : 'Take the roundabout'
    default:
      return name || 'Continue'
  }
}

/** Lucide icon name for a maneuver. Falls back to `ArrowUp` (continue
 *  straight) when no direction-specific icon applies; the steps-tab
 *  StepIcon component resolves the actual component via
 *  `Shared.lucideIcons`. */
function iconForManeuver(type: string, modifier?: string): string {
  if (type === 'arrive') return 'MapPin'
  if (type === 'depart') return 'Navigation'
  if (type === 'roundabout') return 'RotateCw'
  if (type === 'merge') return 'Merge'
  if (modifier) {
    if (modifier.includes('left') && modifier.includes('sharp')) return 'CornerDownLeft'
    if (modifier.includes('right') && modifier.includes('sharp')) return 'CornerDownRight'
    if (modifier.includes('left') && modifier.includes('slight')) return 'ArrowUpLeft'
    if (modifier.includes('right') && modifier.includes('slight')) return 'ArrowUpRight'
    if (modifier.includes('left')) return 'ArrowLeft'
    if (modifier.includes('right')) return 'ArrowRight'
    if (modifier.includes('uturn')) return 'RotateCcw'
    // `'straight'` is a valid OSRM/Valhalla modifier — without an
    // explicit branch it would fall through to the diagonal `ArrowUpRight`
    // default, which reads as a fork rather than a continue.
    if (modifier.includes('straight')) return 'ArrowUp'
  }
  // Default is the upward arrow (continue straight) rather than the
  // diagonal ArrowUpRight — diagonal implied "fork right" which isn't
  // what an unmodified continue / unknown step should look like.
  return 'ArrowUp'
}
