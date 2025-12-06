/// <reference types="node" />
/* eslint-disable no-console */
import path from 'path'
import { spawn } from 'child_process'
import fs from 'fs/promises'
import process from 'process'
import { prisma } from '@civil/db'

const workspaceRoot = process.cwd()
const repoRoot = path.resolve(workspaceRoot, '..')
const geodataDir = path.join(repoRoot, '_geodata')

const DATASET_FILES: Array<{ env: string; filename: string }> = [
  { env: 'STATSCAN_CD_ZIP', filename: 'lcd_000b21a_e.zip' },
  { env: 'STATSCAN_CSD_ZIP', filename: 'lcsd000b21a_e.zip' },
  { env: 'STATSCAN_FSA_ZIP', filename: 'lfsa000b21a_e.zip' },
]

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function resolveDatasetEnv(): Promise<Record<string, string>> {
  const extraEnv: Record<string, string> = {}
  await Promise.all(
    DATASET_FILES.map(async ({ env, filename }) => {
      if (process.env[env]) return
      const candidate = path.join(geodataDir, filename)
      if (await fileExists(candidate)) {
        extraEnv[env] = candidate
      }
    }),
  )
  return extraEnv
}

async function runPnpm(subcommand: string, extraEnv: Record<string, string>): Promise<void> {
  const env = { ...process.env, ...extraEnv }
  const args = ['--filter', '@civil/api', subcommand]
  await new Promise<void>((resolve, reject) => {
    const child = spawn('pnpm', args, {
      cwd: workspaceRoot,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`pnpm ${subcommand} exited with code ${code}`))
      }
    })
    child.on('error', (error: Error) => {
      reject(error)
    })
  })
}

async function needsAdminSeed(): Promise<{ divisions: number; subdivisions: number; fsas: number }> {
  const [divisions, subdivisions, fsas] = await Promise.all([
    prisma.censusDivision.count(),
    prisma.censusSubdivision.count(),
    prisma.forwardSortationArea.count(),
  ])
  return { divisions, subdivisions, fsas }
}

async function main() {
  const counts = await needsAdminSeed()
  if (counts.divisions > 0 && counts.subdivisions > 0 && counts.fsas > 0) {
    console.log('Admin tables already populated; skipping seed.')
    return
  }

  console.log(
    `Admin bootstrap needed (divisions=${counts.divisions}, subdivisions=${counts.subdivisions}, fsas=${counts.fsas}).`,
  )
  const datasetEnv = await resolveDatasetEnv()
  if (!datasetEnv.STATSCAN_FSA_ZIP) {
    console.warn('STATSCAN_FSA_ZIP not set and fallback archive missing. Geolocation seeding may fail.')
  }

  console.log('Running pnpm --filter @civil/api seed:admin ...')
  await runPnpm('seed:admin', datasetEnv)

  console.log('Running pnpm --filter @civil/api link:cities-subdivisions ...')
  await runPnpm('link:cities-subdivisions', datasetEnv)

  const refreshed = await needsAdminSeed()
  if (refreshed.divisions === 0 || refreshed.subdivisions === 0 || refreshed.fsas === 0) {
    throw new Error('Bootstrap completed but tables are still empty.')
  }
  console.log('Admin bootstrap finished successfully.')
}

main()
  .catch((error) => {
    console.error('Admin bootstrap failed:', error)
    process.exitCode = 1
  })
  .finally(() => {
    prisma.$disconnect().catch(() => {
      /* noop */
    })
  })
