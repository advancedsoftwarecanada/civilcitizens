import DashboardShell from './_components/DashboardShell'

export default function Loading() {
  return (
    <DashboardShell
      mainClassName="space-y-6"
      rightRail={
        <div className="space-y-6">
          <div className="surface-card h-48 animate-pulse p-5" />
          <div className="surface-card h-48 animate-pulse p-5" />
        </div>
      }
    >
      <div className="surface-card h-32 animate-pulse px-6 py-5 shadow-subtle" />
      <div className="surface-card h-64 animate-pulse px-6 py-5 shadow-subtle" />
      <div className="surface-card h-64 animate-pulse px-6 py-5 shadow-subtle" />
    </DashboardShell>
  )
}
