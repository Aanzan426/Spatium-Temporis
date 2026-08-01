/**
 * Click a day -> every span crossing it appears as a horizontal lane -> select one to
 * act on, or none.
 *
 * This is also the seed of layers 2 and 3 (§10). The interaction pattern is meant to
 * stay consistent when it grows, so keep lane selection generic over "things crossing
 * a point in time" rather than special-casing tasks.
 */
export function DayLanes() {
  return <div>day lanes</div>
}
