import fs from 'node:fs/promises'
import path from 'node:path'

type Options = {
  logPath: string
  intervalMinutes: number
  maxStaleIntervals: number
  tailLines: number
}

const DEFAULT_INTERVAL_MINUTES = 5
const DEFAULT_MAX_STALE_INTERVALS = 2 // 2 x 5 minutes = 10 minutes of silence
const DEFAULT_TAIL_LINES = 10

async function main() {
  const options = parseArgs()
  console.log(
    `Watching ${options.logPath} (every ${options.intervalMinutes} min, max silent windows ${options.maxStaleIntervals})`,
  )

  let stats = await waitForLog(options.logPath)
  let lastSize = stats.size
  let lastMtime = stats.mtimeMs
  let staleWindows = 0

  while (true) {
    await sleep(options.intervalMinutes * 60 * 1000)
    try {
      stats = await fs.stat(options.logPath)
    } catch (error) {
      console.error(`[${ts()}] Failed to stat log: ${(error as Error).message}`)
      staleWindows++
      if (staleWindows >= options.maxStaleIntervals) {
        console.error(
          `[${ts()}] Unable to read log for ${options.intervalMinutes * options.maxStaleIntervals} minutes; assuming the process hung`,
        )
        process.exit(1)
      }
      continue
    }

    if (stats.size > lastSize || stats.mtimeMs > lastMtime) {
      const delta = stats.size - lastSize
      console.log(`[${ts()}] New log data detected (+${delta} bytes)`)
      staleWindows = 0
      lastSize = stats.size
      lastMtime = stats.mtimeMs
      const tail = await readTail(options.logPath, options.tailLines)
      if (tail) {
        console.log(`──── recent log lines ────\n${tail}\n────────────────────────`)
      }
    } else {
      staleWindows += 1
      const waited = staleWindows * options.intervalMinutes
      console.warn(
        `[${ts()}] No log growth for ${waited} minutes (${staleWindows}/${options.maxStaleIntervals}); still watching`,
      )
      if (staleWindows >= options.maxStaleIntervals) {
        console.error(
          `[${ts()}] No log progress for ${options.intervalMinutes * options.maxStaleIntervals} minutes; assuming the job hung`,
        )
        process.exit(1)
      }
    }
  }
}

function parseArgs(): Options {
  const args = process.argv.slice(2)
  const config: Options = {
    logPath: path.resolve(process.env.SEED_LOG_PATH ?? path.join(process.cwd(), '../../..', 'seed.log')),
    intervalMinutes: Number.parseInt(process.env.SEED_LOG_INTERVAL_MIN ?? '', 10) || DEFAULT_INTERVAL_MINUTES,
    maxStaleIntervals:
      Number.parseInt(process.env.SEED_LOG_MAX_STALE ?? '', 10) || DEFAULT_MAX_STALE_INTERVALS,
    tailLines: Number.parseInt(process.env.SEED_LOG_TAIL_LINES ?? '', 10) || DEFAULT_TAIL_LINES,
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (!arg.startsWith('--')) {
      config.logPath = path.resolve(arg)
      continue
    }
    const next = args[i + 1]
    switch (arg) {
      case '--interval-min':
        config.intervalMinutes = Number.parseFloat(next ?? '') || config.intervalMinutes
        i += 1
        break
      case '--max-stale':
        config.maxStaleIntervals = Number.parseInt(next ?? '', 10) || config.maxStaleIntervals
        i += 1
        break
      case '--tail-lines':
        config.tailLines = Number.parseInt(next ?? '', 10) || config.tailLines
        i += 1
        break
      default:
        console.warn(`Unknown option '${arg}' ignored`)
        break
    }
  }

  return config
}

async function waitForLog(logPath: string) {
  // Wait until the log file exists and has initial stats.
  while (true) {
    try {
      const stats = await fs.stat(logPath)
      console.log(`[${ts()}] Found log at ${logPath}`)
      return stats
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code !== 'ENOENT') {
        console.warn(`[${ts()}] Unable to stat log (${err.message}); retrying in 30s`)
      } else {
        console.log(`[${ts()}] Waiting for log file at ${logPath} (retrying in 30s) ...`)
      }
      await sleep(30_000)
    }
  }
}

async function readTail(logPath: string, lines: number) {
  try {
    const handle = await fs.open(logPath, 'r')
    try {
      const stats = await handle.stat()
      const chunkSize = 64 * 1024
      const length = stats.size
      const start = length > chunkSize ? length - chunkSize : 0
      const size = length - start
      const buffer = Buffer.alloc(Math.max(size, 0))
      await handle.read(buffer, 0, size, start)
      return buffer
        .toString('utf8')
        .trim()
        .split(/\r?\n/)
        .slice(-lines)
        .join('\n')
    } finally {
      await handle.close()
    }
  } catch (error) {
    console.warn(`[${ts()}] Unable to read log tail: ${(error as Error).message}`)
    return ''
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function ts() {
  return new Date().toISOString()
}

main().catch((error) => {
  console.error('watch-seed-log failed:', error)
  process.exitCode = 1
})