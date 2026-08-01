/**
 * Main page — answers WHEN.
 *
 * A continuous time axis, one-off spans, zoom across scales. A projection over the
 * store; it owns no tables of its own (§8).
 *
 * Magnitude is the zoom filter (§4): micro+kilo at day scale, mega at month, tera at
 * decade. This is what keeps the view legible once there are thousands of nodes, which
 * there will be within a year.
 */
export function MainPage() {
  return <main>main page</main>
}
