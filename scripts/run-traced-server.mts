import { spawn } from 'node:child_process'
import fs from 'node:fs'

const logFile = process.argv[2]
if (!logFile) {
  console.error('Uso: node --experimental-strip-types scripts/run-traced-server.mts <logFile>')
  process.exit(1)
}

if (fs.existsSync(logFile)) {
  fs.unlinkSync(logFile)
}

const child = spawn('npx', ['next', 'start', '-p', '3000'], {
  env: { ...process.env, DAL_TRACE: '1', PORT: '3000' },
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})

child.stdout.on('data', (data) => {
  fs.appendFileSync(logFile, data)
  process.stdout.write(data)
})

child.stderr.on('data', (data) => {
  fs.appendFileSync(logFile, data)
  process.stderr.write(data)
})

child.on('exit', (code) => {
  console.log(`[server] Proceso finalizado con código ${code}`)
  process.exit(code ?? 0)
})

process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
