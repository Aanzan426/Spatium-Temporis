/**
 * Side-by-side revision comparison, the way phone or car models are compared.
 *
 *   columns = revisions      rows = slots      cells = contents
 *
 * Unchanged rows dim; changed cells are emphasised. Horizontal scroll past ~7 columns.
 * "Mon 6am: gym / gym / — / run" reads straight across.
 *
 * A spec sheet beats small multiples here because a schedule is discrete and
 * enumerable rather than continuous.
 *
 * DO NOT overlay colored schedules on one grid: readable at 2, mushy at 3, noise at 7,
 * and hue is already spent on category. Columns differentiate by position, which costs
 * no color budget (§9).
 *
 * The 2-way diff (green/amber/red, a palette reserved and never used for categories)
 * is a fast follow on this same table.
 */
export function CompareTable() {
  return <div>compare</div>
}
