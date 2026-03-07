import { spawn } from 'node:child_process'
import { existsSync, readdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(scriptDir, '..')
const nextDir = path.join(appDir, '.next')
const nextBinCandidates = [
  path.join(appDir, 'node_modules', 'next', 'dist', 'bin', 'next'),
  path.resolve(appDir, '..', '..', 'node_modules', 'next', 'dist', 'bin', 'next'),
]

function hasArg(args, flags) {
  return args.some((arg, index) => {
    if (flags.includes(arg)) return true
    if (index === 0) return false
    return flags.some((flag) => arg.startsWith(`${flag}=`))
  })
}

function clearStaleNextOutput() {
  if (process.env.CIVIL_SKIP_NEXT_CLEAN === '1' || !existsSync(nextDir)) return

  try {
    for (const entry of readdirSync(nextDir)) {
      rmSync(path.join(nextDir, entry), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    }
    process.stdout.write('[civil/web] cleared .next contents before dev startup\n')
    return
  } catch (removeError) {
    const staleName = `.next.stale-${Date.now()}`
    const stalePath = path.join(appDir, staleName)

    try {
      renameSync(nextDir, stalePath)
      process.stdout.write(`[civil/web] moved stale .next to ${staleName}\n`)
      return
    } catch (renameError) {
      const detail = renameError instanceof Error ? renameError.message : String(renameError)
      const removeDetail = removeError instanceof Error ? removeError.message : String(removeError)
      process.stderr.write(`[civil/web] failed to reset .next (${removeDetail}; ${detail})\n`)
      process.exit(1)
    }
  }
}

const forwardedArgs = process.argv.slice(2)
const nextArgs = ['dev']

if (!hasArg(forwardedArgs, ['-H', '--hostname'])) {
  nextArgs.push('-H', '0.0.0.0')
}

if (!hasArg(forwardedArgs, ['-p', '--port'])) {
  nextArgs.push('-p', process.env.CIVIL_WEB_PORT || '3001')
}

nextArgs.push(...forwardedArgs)

clearStaleNextOutput()

const nextBin = nextBinCandidates.find((candidate) => existsSync(candidate))

if (!nextBin) {
  process.stderr.write('[civil/web] unable to locate the Next.js CLI in workspace or app node_modules\n')
  process.exit(1)
}

const child = spawn(process.execPath, [nextBin, ...nextArgs], {
  cwd: appDir,
  env: process.env,
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
