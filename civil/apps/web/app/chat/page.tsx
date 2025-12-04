import FeatureScaffold from '../_components/FeatureScaffold'

const CHAT_HIGHLIGHTS = [
  {
    title: 'Threads people can trust',
    description: 'We\'re designing city-level chat threads with verified civic leaders pinned to the top.',
    status: 'soon' as const,
  },
  {
    title: 'Direct messaging',
    description: 'Secure DMs with attachments, civic templates, and message requests are on the roadmap.',
    status: 'soon' as const,
  },
]

const CHAT_ROADMAP = [
  { title: 'City broadcasts', detail: 'One-to-many alerts for emergencies and legislative moments in your city.' },
  { title: 'Moderator tools', detail: 'Escalate chats to trusted hosts with AI-assisted transcripts.' },
]

export default function ChatPage() {
  return (
    <FeatureScaffold
      activeNavKey="chat"
      title="Chat"
      description="Real-time messaging for cities, organizations, and trusted civic groups."
      heroBadge="Concept"
      highlights={CHAT_HIGHLIGHTS}
      roadmap={CHAT_ROADMAP}
    />
  )
}
