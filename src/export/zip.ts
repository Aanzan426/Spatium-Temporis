/**
 * A minimal ZIP writer. About a hundred lines, no dependency, one compression method:
 * none.
 *
 * WHY THIS EXISTS RATHER THAN `npm i jszip`
 * -----------------------------------------
 * An `.xlsx` is a zip of XML. The app has to write one (§11: XLSX is the curation
 * surface) and the app must not depend on a spreadsheet library — `exceljs` is a
 * devDependency used by `tools/`, and SPEC §5 is explicit that the app itself never
 * imports it. Pulling a zip library into the bundle to write six small XML files is a
 * bad trade at this size.
 *
 * STORED, NOT DEFLATED. A zip entry may legally be stored uncompressed (method 0), and
 * every reader accepts it. Deflate would need the whole of `pako` or a
 * `CompressionStream` dance; the files here are a few hundred KB of highly repetitive
 * XML that the filesystem will compress anyway, and the user opens this in Excel once
 * and edits it. If size ever matters, `CompressionStream('deflate-raw')` is the
 * upgrade and it changes method 0 to 8 and nothing else.
 *
 * Deliberately not implemented: Zip64 (needed past 4 GB), encryption, directory
 * entries, and the data-descriptor form. A workbook that needs any of those is a
 * different problem.
 */

export interface ZipEntry {
  name: string
  data: Uint8Array
}

/** CRC-32, table built once. The zip format requires it per entry; there is no skipping it. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]!) & 0xff]!
  }
  return (crc ^ 0xffffffff) >>> 0
}

const encoder = new TextEncoder()
export const utf8 = (s: string): Uint8Array => encoder.encode(s)

/**
 * Build the archive.
 *
 * Every entry is stamped with the same fixed DOS timestamp rather than the clock. The
 * work log's §16.3 correction is the reason: exceljs stamps wall-clock time per entry,
 * which makes two runs of the same generator produce different bytes and cost an
 * afternoon to diagnose. Determinism here is free, so it is taken.
 */
export function zip(entries: readonly ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  // 1980-01-01 00:00:00 in DOS date/time — the epoch of the format itself.
  const DOS_TIME = 0
  const DOS_DATE = 33

  for (const entry of entries) {
    const nameBytes = utf8(entry.name)
    const crc = crc32(entry.data)
    const size = entry.data.length

    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true) // local file header signature
    lv.setUint16(4, 20, true) // version needed
    lv.setUint16(6, 0x0800, true) // flags: UTF-8 names
    lv.setUint16(8, 0, true) // method: stored
    lv.setUint16(10, DOS_TIME, true)
    lv.setUint16(12, DOS_DATE, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true) // compressed size
    lv.setUint32(22, size, true) // uncompressed size
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true) // extra length
    local.set(nameBytes, 30)

    chunks.push(local, entry.data)

    const dir = new Uint8Array(46 + nameBytes.length)
    const dv = new DataView(dir.buffer)
    dv.setUint32(0, 0x02014b50, true) // central directory header signature
    dv.setUint16(4, 20, true) // version made by
    dv.setUint16(6, 20, true) // version needed
    dv.setUint16(8, 0x0800, true)
    dv.setUint16(10, 0, true)
    dv.setUint16(12, DOS_TIME, true)
    dv.setUint16(14, DOS_DATE, true)
    dv.setUint32(16, crc, true)
    dv.setUint32(20, size, true)
    dv.setUint32(24, size, true)
    dv.setUint16(28, nameBytes.length, true)
    dv.setUint32(42, offset, true) // relative offset of local header
    dir.set(nameBytes, 46)
    central.push(dir)

    offset += local.length + size
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true) // end of central directory
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  const total =
    chunks.reduce((n, c) => n + c.length, 0) + centralSize + end.length
  const out = new Uint8Array(total)
  let at = 0
  for (const c of [...chunks, ...central, end]) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/**
 * XML text escaping. Five characters, and every one of them appears in real titles —
 * `R&D`, `<stretch>`, a quoted phrase. A workbook that silently breaks on an ampersand
 * is the classic version of this bug.
 */
export const xmlEscape = (s: string): string =>
  s.replace(/[&<>"']/g, (ch) =>
    ch === '&' ? '&amp;'
    : ch === '<' ? '&lt;'
    : ch === '>' ? '&gt;'
    : ch === '"' ? '&quot;'
    : '&apos;',
  )
