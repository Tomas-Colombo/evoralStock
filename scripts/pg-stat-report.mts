import { execSync } from 'node:child_process'

function runQuery(sql: string) {
  const cmd = `docker exec -i supabase_db_utopia psql -U postgres -d postgres -c "${sql.replace(/"/g, '\\"')}"`
  return execSync(cmd, { encoding: 'utf-8' })
}

const topCallsSql = `
SELECT calls, round(total_exec_time::numeric, 2) as total_ms, round(mean_exec_time::numeric, 2) as mean_ms, rows, left(regexp_replace(query, '\\s+', ' ', 'g'), 80) as query
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat_statements%' AND query NOT LIKE '%pg_proc%'
ORDER BY calls DESC
LIMIT 20;
`

const topTimeSql = `
SELECT calls, round(total_exec_time::numeric, 2) as total_ms, round(mean_exec_time::numeric, 2) as mean_ms, rows, left(regexp_replace(query, '\\s+', ' ', 'g'), 80) as query
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat_statements%' AND query NOT LIKE '%pg_proc%'
ORDER BY total_exec_time DESC
LIMIT 20;
`

console.log('=== TOP 20 POR CALLS ===')
console.log(runQuery(topCallsSql))

console.log('=== TOP 20 POR TOTAL_EXEC_TIME ===')
console.log(runQuery(topTimeSql))
