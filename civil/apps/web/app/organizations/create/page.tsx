'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DashboardShell from '../../_components/DashboardShell'
import { useViewerStore } from '../../_lib/viewerStore'
import OrganizationCreateButton from '../../com/_components/OrganizationCreateButton'
import { RightRail } from '../../_components/RightRail'
import OrganizationsAdminCreatePanel from '../_components/OrganizationsAdminCreatePanel'
import {
  loadViewerCommunityOptions,
  type CommunityOption,
} from '../_components/communityOptions'

export default function CreateOrganizationPage() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'unauthorized' | 'error'>('loading')
  const [options, setOptions] = useState<CommunityOption[]>([])
  const [selectedKey, setSelectedKey] = useState<string>('')
  const selectedKeyRef = useRef('')
  const cachedMe = useViewerStore((s) => s.me)

  const token = useMemo(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem('token')
  }, [])

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const result = await loadViewerCommunityOptions({ token, cachedMe, preferredKey: selectedKeyRef.current })
      setOptions(result.options)
      setSelectedKey((prev) => prev || result.selectedKey)
      setStatus(result.status)
    } catch (err) {
      console.error('Unable to load create organization page', err)
      setStatus('error')
    }
  }, [cachedMe, token])

  useEffect(() => {
    selectedKeyRef.current = selectedKey
  }, [selectedKey])

  useEffect(() => {
    void load()
  }, [load])

  const selected = useMemo(() => {
    const [provinceCode, communitySlug] = selectedKey.split(':')
    if (!provinceCode || !communitySlug) return null
    return { provinceCode, communitySlug }
  }, [selectedKey])

  return (
    <DashboardShell
      rightRail={<RightRail mode="organizations" />}
      className="bg-slate-50"
      mainClassName="space-y-6"
    >
      <OrganizationsAdminCreatePanel
        title="Create an organization"
        description="Choose a community, then create an organization tied to it."
        status={status}
        options={options}
        selectedKey={selectedKey}
        onSelectedKeyChange={setSelectedKey}
        emptyMessage="Follow a community first to create an organization."
        errorMessage="Unable to load your communities right now."
      >
        {selected ? <OrganizationCreateButton province={selected.provinceCode} municipality={selected.communitySlug} /> : null}
        {selected ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            A draft organization opens in settings first, where you can set its name, URL, type, and visibility before publishing.
          </div>
        ) : null}
      </OrganizationsAdminCreatePanel>
    </DashboardShell>
  )
}
