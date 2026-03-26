import CauseDraftEditorPageClient from './CauseDraftEditorPageClient'

type PageProps = {
  params: {
    draftId: string
  }
}

export default function CauseDraftEditorPage({ params }: PageProps) {
  return <CauseDraftEditorPageClient draftId={params.draftId} />
}