import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { SessionEvent } from '../shared/contracts/session.ts'
import { ApprovalDialog } from './components/ApprovalDialog.tsx'
import { Sidebar, TitleBar, type Screen } from './components/Sidebar.tsx'
import { ConversationPage } from './pages/ConversationPage.tsx'
import { GoLivePage } from './pages/GoLivePage.tsx'
import { HistoryPage } from './pages/HistoryPage.tsx'
import { SetupPage } from './pages/SetupPage.tsx'
import { useThemePreference } from './theme.ts'

type Approval = Extract<SessionEvent, { type: 'approval_request' }>

async function outcome(call: Promise<{ ok: boolean; message?: string }> | undefined) {
  try {
    const result = await call
    return { ok: Boolean(result?.ok), message: result?.message ?? '' }
  } catch {
    return { ok: false, message: 'Something went wrong. Please try again.' }
  }
}
type Active = { sessionId: string; storeDomain: string; themeId: number; themeLabel: string }

export function App() {
  const [approval, setApproval] = useState<Approval | null>(null)
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [session, setSession] = useState<Active | null>(null)
  const [screen, setScreen] = useState<Screen>('home')
  const [updateMessage, setUpdateMessage] = useState('')
  const [canRestart, setCanRestart] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [rollbackLabel, setRollbackLabel] = useState<string | null>(null)
  const [retiredThemeId, setRetiredThemeId] = useState<number | null>(null)
  const [theme, setTheme] = useThemePreference()
  const account = useQuery({
    queryKey: ['account'],
    queryFn: () => {
      const bridge = window.shopifyBuilder
      if (!bridge) throw new Error('missing bridge')
      return bridge.credentialStatus()
    },
    enabled: Boolean(window.shopifyBuilder),
  })

  useEffect(() => {
    const bridge = window.shopifyBuilder
    if (!bridge) return
    return bridge.onSessionEvent((event) => {
      if (event.type === 'approval_request') setApproval(event)
      setEvents((current) => [...current, event])
    })
  }, [])

  useEffect(() => {
    const bridge = window.shopifyBuilder
    if (!bridge) return
    const watch = () => {
      void bridge.watchThemes().then((result) => {
        setNotice(result.notice)
        setRollbackLabel(result.rollbackLabel)
        setRetiredThemeId(result.retiredThemeId)
      })
      void bridge.updateStatus().then((result) => {
        setUpdateMessage(result.message)
        setCanRestart(result.canRestart)
      })
    }
    watch()
    window.addEventListener('focus', watch)
    const timer = window.setInterval(watch, 3 * 60 * 1000)
    return () => {
      window.removeEventListener('focus', watch)
      window.clearInterval(timer)
    }
  }, [])

  function decide(decision: 'approve' | 'decline') {
    if (!approval) return
    void window.shopifyBuilder?.decideApproval(approval.requestId, decision)
    setApproval(null)
  }

  function home() {
    setSession(null)
    setEvents([])
    setScreen('home')
  }

  const current: Screen = screen === 'change' && !session ? 'home' : screen

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar
        screen={current}
        onNavigate={setScreen}
        hasChange={Boolean(session)}
        storeDomain={account.data?.storeDomain ?? session?.storeDomain ?? null}
        updateMessage={updateMessage}
        canRestart={canRestart}
        onCheckUpdates={() => {
          void window.shopifyBuilder?.updateStatus().then((result) => {
            setUpdateMessage(result.message)
            setCanRestart(result.canRestart)
          })
        }}
        onRestart={() => {
          if (canRestart) window.location.reload()
        }}
        theme={theme}
        onTheme={setTheme}
      />
      <main className="flex min-w-0 flex-1 flex-col bg-canvas">
        <TitleBar />
        <div className={`min-h-0 flex-1 ${current === 'change' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          {current === 'change' && session ? (
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
                return { message: result?.message ?? '', status: result?.status }
              }}
              onDiscard={async () => {
                await window.shopifyBuilder?.discardSession()
                home()
              }}
              onUndo={() => outcome(window.shopifyBuilder?.undoStep())}
              onStartOver={() => outcome(window.shopifyBuilder?.redoOnLatest())}
              onRetry={() => outcome(window.shopifyBuilder?.retryStep())}
              onUndoChange={async (changeId) => {
                const result = await window.shopifyBuilder?.undoChange(changeId)
                return result?.message ?? ''
              }}
              onAnother={home}
            />
          ) : current === 'history' ? (
            <HistoryPage />
          ) : current === 'golive' ? (
            <GoLivePage
              notice={notice}
              rollbackLabel={rollbackLabel}
              retiredThemeId={retiredThemeId}
              onStartCopy={async (themeId) => {
                const result = await window.shopifyBuilder?.startWorkingCopy(themeId)
                return result?.message ?? ''
              }}
            />
          ) : (
            <SetupPage
              notice={notice}
              onStarted={(started) => {
                setEvents([])
                setSession(started)
                setScreen('change')
              }}
            />
          )}
        </div>
      </main>
      {approval ? (
        <ApprovalDialog files={approval.files} onApprove={() => decide('approve')} onDecline={() => decide('decline')} />
      ) : null}
    </div>
  )
}
