/**
 * Local-date-in-a-named-zone → UTC epoch ms. The whole of SPEC §3.2 in one file.
 *
 * THE BUG THIS EXISTS TO PREVENT
 * ------------------------------
 * `new Date('2026-08-01')` parses as midnight **UTC**. In any negative-offset zone that
 * is the 31st of July. The symptom is a scattering of rows on the wrong day, which
 * looks exactly like corruption and is therefore usually blamed on something else. It
 * is the same class of bug as `occurrences.date_ms` being local midnight rather than a
 * UTC instant (DESIGN §5.7).
 *
 * WHY Intl AND NOT A LIBRARY
 * --------------------------
 * The zone here is `_meta.tz` — an arbitrary IANA name from the workbook, not the
 * machine's own zone — so `date-fns` alone cannot do it (that needs `date-fns-tz`) and
 * the machine's offset is the wrong answer by definition. `Intl.DateTimeFormat` has the
 * full tz database built in and is already in Node, so the conversion below is
 * dependency-free and uses the same rules the OS does.
 *
 * The app's own `src/core/time.ts` still uses date-fns for everything: it renders in
 * the machine's local zone, where date-fns is correct and simpler. This file exists
 * only because a *workbook* carries its own zone with it.
 */

/**
 * The offset of `tz` at a given UTC instant, in ms. Positive east of Greenwich.
 *
 * Works by asking Intl what the local wall-clock reads at that instant, re-assembling
 * that reading as if it were UTC, and taking the difference. There is no API that
 * returns an offset directly.
 */
export function zoneOffsetMs(tz: string, utcMs: number): number {
  const parts = formatterFor(tz).formatToParts(new Date(utcMs))
  const get = (type: string): number => {
    const found = parts.find((p) => p.type === type)
    return found ? Number(found.value) : 0
  }
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return asUtc - utcMs
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      // `hourCycle: 'h23'` and not `hour12: false`: the latter yields hour "24" for
      // midnight in several Node versions, and 24 quietly becomes the next day.
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(tz, f)
  }
  return f
}

/**
 * `YYYY-MM-DD` + `HH:MM` in `tz` → UTC epoch ms.
 *
 * The two-pass structure is not redundancy. The offset depends on the instant, and the
 * instant is what is being solved for, so the first pass uses the offset at the naive
 * guess and the second re-checks it at the answer. They differ only within an hour or
 * two of a DST transition — which is precisely where a single-pass version is wrong,
 * twice a year, for exactly the rows a reader would least expect to be wrong.
 */
export function zonedToUtcMs(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const [hh, mm] = (time || '00:00').split(':').map(Number) as [number, number]
  const naive = Date.UTC(y, m - 1, d, hh, mm)

  const firstOffset = zoneOffsetMs(tz, naive)
  const firstGuess = naive - firstOffset
  const secondOffset = zoneOffsetMs(tz, firstGuess)
  return secondOffset === firstOffset ? firstGuess : naive - secondOffset
}

/** ISO 8601 with the zone's real offset, for humans reading the JSONL. */
export function toIsoInZone(utcMs: number, tz: string): string {
  const offset = zoneOffsetMs(tz, utcMs)
  const local = new Date(utcMs + offset)
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(abs / 3_600_000))}:${pad(Math.floor((abs % 3_600_000) / 60_000))}`
  )
}
