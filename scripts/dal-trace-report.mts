import fs from 'node:fs'

interface TraceEntry {
  req: string
  seq: number
  path: string | null
  action: boolean
  client: 'server' | 'service'
  kind: 'rest' | 'rpc' | 'auth' | 'storage'
  target: string
  method: string
  status: number
  ms: number
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 !== 0) {
    return sorted[mid]
  }
  return Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10
}

function loadLogContent(): string {
  const filePath = process.argv[2]
  if (!filePath) {
    console.error('Uso: node --experimental-strip-types scripts/dal-trace-report.mts <archivo.log>')
    process.exit(1)
  }

  if (!fs.existsSync(filePath)) {
    console.error(`Archivo no encontrado: ${filePath}`)
    process.exit(1)
  }

  return fs.readFileSync(filePath, 'utf-8')
}

function parseTraceLines(content: string): TraceEntry[] {
  const lines = content.split(/\r?\n/)
  const entries: TraceEntry[] = []

  for (const line of lines) {
    const idx = line.indexOf('[dal-trace] ')
    if (idx === -1) continue

    const jsonStr = line.slice(idx + '[dal-trace] '.length).trim()
    try {
      const parsed = JSON.parse(jsonStr) as TraceEntry
      entries.push(parsed)
    } catch {
      // Ignorar líneas corruptas o incompletas
    }
  }

  return entries
}

interface GroupStats {
  path: string
  action: boolean
  requestsCount: number
  medianCallsPerReq: number
  authCalls: number
  topRepeatedTargets: string
  medianMs: number
}

function analyzeEntries(entries: TraceEntry[]): GroupStats[] {
  type GroupKey = string
  const groups = new Map<
    GroupKey,
    {
      path: string
      action: boolean
      requests: Map<string, TraceEntry[]>
      allEntries: TraceEntry[]
    }
  >()

  for (const entry of entries) {
    const pathStr = entry.path ?? '(sin-path)'
    const key = `${pathStr}__action_${entry.action}`

    let group = groups.get(key)
    if (!group) {
      group = {
        path: pathStr,
        action: entry.action,
        requests: new Map(),
        allEntries: [],
      }
      groups.set(key, group)
    }

    group.allEntries.push(entry)
    const reqKey = entry.req === 'sin-request' ? `sin-request-${entry.seq}` : entry.req
    let reqList = group.requests.get(reqKey)
    if (!reqList) {
      reqList = []
      group.requests.set(reqKey, reqList)
    }
    reqList.push(entry)
  }

  const results: GroupStats[] = []

  for (const group of groups.values()) {
    const callsPerReq = Array.from(group.requests.values()).map((list) => list.length)
    const medianCalls = calculateMedian(callsPerReq)

    const authCalls = group.allEntries.filter((e) => e.kind === 'auth').length
    const allMs = group.allEntries.map((e) => e.ms)
    const medianMs = calculateMedian(allMs)

    // Targets repetidos dentro de un mismo request
    const repeatedMap = new Map<string, { extraCalls: number; affectedRequests: number }>()
    for (const reqList of group.requests.values()) {
      const counts = new Map<string, number>()
      for (const e of reqList) {
        counts.set(e.target, (counts.get(e.target) ?? 0) + 1)
      }
      for (const [target, count] of counts.entries()) {
        if (count > 1) {
          const prev = repeatedMap.get(target) ?? { extraCalls: 0, affectedRequests: 0 }
          repeatedMap.set(target, {
            extraCalls: prev.extraCalls + (count - 1),
            affectedRequests: prev.affectedRequests + 1,
          })
        }
      }
    }

    const sortedRepeats = Array.from(repeatedMap.entries()).sort(
      (a, b) => b[1].extraCalls - a[1].extraCalls,
    )

    const topRepeatedStr =
      sortedRepeats.length === 0
        ? '-'
        : sortedRepeats
            .slice(0, 3)
            .map(([target, stats]) => `${target} (+${stats.extraCalls} en ${stats.affectedRequests} req)`)
            .join(', ')

    results.push({
      path: group.path,
      action: group.action,
      requestsCount: group.requests.size,
      medianCallsPerReq: medianCalls,
      authCalls,
      topRepeatedTargets: topRepeatedStr,
      medianMs,
    })
  }

  return results.sort((a, b) => a.path.localeCompare(b.path) || (a.action === b.action ? 0 : a.action ? 1 : -1))
}

function main() {
  const content = loadLogContent()
  const entries = parseTraceLines(content)

  if (entries.length === 0) {
    console.log('No se encontraron líneas [dal-trace] en el log proporcionado.')
    return
  }

  const stats = analyzeEntries(entries)

  console.log('REPORTE DE TRAZAS DAL (por path y action)')
  console.log('='.repeat(110))
  console.log(
    'Path'.padEnd(30) +
      'Action'.padEnd(10) +
      'Reqs'.padEnd(8) +
      'Llam/Req (p50)'.padEnd(18) +
      'Auth'.padEnd(8) +
      'ms (p50)'.padEnd(12) +
      'Top targets repetidos (mismo req)',
  )
  console.log('-'.repeat(110))

  for (const s of stats) {
    const actionLabel = s.action ? 'action' : 'page'
    console.log(
      s.path.padEnd(30) +
        actionLabel.padEnd(10) +
        String(s.requestsCount).padEnd(8) +
        String(s.medianCallsPerReq).padEnd(18) +
        String(s.authCalls).padEnd(8) +
        `${s.medianMs} ms`.padEnd(12) +
        s.topRepeatedTargets,
    )
  }
  console.log('='.repeat(110))
  console.log(`Total registros: ${entries.length} | Grupos (path, action): ${stats.length}`)
}

main()
