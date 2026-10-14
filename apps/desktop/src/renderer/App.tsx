import { useEffect, useState } from 'react'
import type { SessionEvent } from '../shared/contracts/session.ts'
import { ApprovalDialog } from './components/ApprovalDialog.tsx'
import { ConversationPage } from './pages/ConversationPage.tsx'
import { SetupPage } from './pages/SetupPage.tsx'

type Approval = Extract<SessionEvent, { type: 'approval_request' }>
type Active = { sessionId: string; storeDomain: string; themeId: number; themeLabel: string }

export function App() {
  const [approval, setApproval] = useState<Approval | null>(null)
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [session, setSession] = useState<Active | null>(null)

  useEffect(() => {
    const bridge = window.shopifyBuilder
    if (!bridge) return
    return bridge.onSessionEvent((event) => {
      if (event.type === 'approval_request') setApproval(event)
      setEvents((current) => [...current, event])
    })
  }, [])

  function decide(decision: 'approve' | 'decline') {
    if (!approval) return
    void window.shopifyBuilder?.decideApproval(approval.requestId, decision)
    setApproval(null)
  }

  return (
    <>
      {session ? (
        <ConversationPage
          themeLabel={session.themeLabel}
          storeDomain={session.storeDomain}
          themeId={session.themeId}
          events={events}
          onSend={async (text) => {
            const result = await window.shopifyBuilder?.sendMessage(text)
            return result?.message ?? ''
          }}
          onAnswer={async (requestId, text) => {
            await window.shopifyBuilder?.answerQuestion(requestId, text)
          }}
          onSave={async () => {
            const result = await window.shopifyBuilder?.saveSession()
            return result?.message ?? ''
          }}
          onDiscard={async () => {
            await window.shopifyBuilder?.discardSession()
            setSession(null)
            setEvents([])
          }}
          onUndo={async () => {
            await window.shopifyBuilder?.undoStep()
          }}
          onRedo={async () => {
            await window.shopifyBuilder?.redoOnLatest()
          }}
        />
      ) : (
        <SetupPage
          onStarted={(started) => {
            setEvents([])
            setSession(started)
          }}
        />
      )}
      {approval ? (
        <ApprovalDialog files={approval.files} onApprove={() => decide('approve')} onDecline={() => decide('decline')} />
      ) : null}
    </>
  )
}
