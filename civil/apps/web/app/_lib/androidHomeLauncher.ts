'use client'

type HomeLauncherPluginStatus = {
  active?: boolean
}

type HomeLauncherPlugin = {
  setAsLauncher?: () => Promise<void>
  getLauncherStatus?: () => Promise<HomeLauncherPluginStatus>
}

type CapacitorBridge = {
  getPlatform?: () => string
  Plugins?: {
    HomeLauncher?: HomeLauncherPlugin
  }
}

function getCapacitorBridge(): CapacitorBridge | null {
  if (typeof window === 'undefined') return null
  const candidate = (window as Window & { Capacitor?: CapacitorBridge }).Capacitor
  if (!candidate || typeof candidate !== 'object') return null
  return candidate
}

function getHomeLauncherPlugin(): HomeLauncherPlugin | null {
  const bridge = getCapacitorBridge()
  if (!bridge || bridge.getPlatform?.() !== 'android') return null
  const plugin = bridge.Plugins?.HomeLauncher
  if (!plugin || typeof plugin !== 'object') return null
  return plugin
}

export function isAndroidHomeLauncherSupported(): boolean {
  return typeof getHomeLauncherPlugin()?.setAsLauncher === 'function'
}

export async function isCivilHomeLauncherActive(): Promise<boolean> {
  const plugin = getHomeLauncherPlugin()
  if (!plugin || typeof plugin.getLauncherStatus !== 'function') return false

  try {
    const result = await plugin.getLauncherStatus()
    return Boolean(result?.active)
  } catch {
    return false
  }
}

export async function setCivilAsLauncher(): Promise<void> {
  const plugin = getHomeLauncherPlugin()
  if (!plugin || typeof plugin.setAsLauncher !== 'function') {
    throw new Error('android_home_launcher_unavailable')
  }

  await plugin.setAsLauncher()
}