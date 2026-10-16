import { useEffect, useState, type ReactNode } from 'react'
import { ChevronRight, Clock, MessageSquare, RefreshCw, Sparkles, Trash2, Undo2, X } from 'lucide-react'
import type { ChatOpen, HistoryView } from '../../shared/contracts/account.ts'
import { Button } from '../components/Button.tsx'
import { Card, Note, PageHeader } from '../components/Card.tsx'
import { Markdown } from '../components/Markdown.tsx'

export function HistoryPage() {
  const bridge = window.shopifyBuilder
  const [view, setView] = useState<HistoryView | null>(null)
  const [chat, setChat] = useState<(ChatOpen & { chatId: string }) | null>(null)
  const [note, setNote] = useState('')

  async function load() {
    if (!bridge) return
    setView(await bridge.listHistory())
  }

  useEffect(() => {
    if (!bridge) return
    let cancel = false
    void bridge.listHistory().then((loaded) => {
      if (!cancel) setView(loaded)
    })
    return () => {
      cancel = true
    }
  }, [bridge])

  const chats = view?.chats ?? []
  const changes = view?.changes ?? []

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-8 pb-12">
      <PageHeader
        title="History"
        description="Chats are kept for 30 days. Saved changes stay, so you can undo them later."
        actions={
          <Button variant="secondary" icon={<RefreshCw aria-hidden="true" />} onClick={() => void load()}>
            Refresh
          </Button>
        }
      />
      {view?.notice ? <Note tone="warning">{view.notice}</Note> : null}
      {note ? <Note>{note}</Note> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Chats" icon={<MessageSquare />} description={`${chats.length} in the last 30 days`}>
          {chats.length === 0 ? (
            <Empty icon={<MessageSquare />} text="No chats yet." />
          ) : (
            <ul className="-mx-2 space-y-0.5">
              {chats.map((item) => (
                <li key={item.chatId} className="group flex items-center gap-1 rounded-lg hover:bg-hover">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left"
                    onClick={() => {
                      if (!bridge) return
                      void bridge.openChat(item.chatId).then((opened) => setChat({ ...opened, chatId: item.chatId }))
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-ink">{item.title}</span>
                      <span className="mt-0.5 flex items-center gap-1 text-[12px] text-muted">
                        <Clock className="size-3" aria-hidden="true" />
                        {item.activeDay}
                      </span>
                    </span>
                    <ChevronRight className="size-4 text-faint" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete chat"
                    className="mr-1 flex size-7 items-center justify-center rounded-md text-faint opacity-0 transition hover:bg-danger-subtle hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() => {
                      if (!bridge) return
                      void bridge.deleteChat(item.chatId).then(async (result) => {
                        setNote(result.message ?? '')
                        setChat(null)
                        await load()
                      })
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Saved changes" icon={<Sparkles />} description="Undo any saved change. Later changes to the same files are named first.">
          {changes.length === 0 ? (
            <Empty icon={<Sparkles />} text="No saved changes yet." />
          ) : (
            <ul className="divide-y divide-line">
              {changes.map((change) => (
                <li key={change.changeId} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-medium text-ink">{change.title}</span>
                    <span className="text-[12px] text-muted">Theme {change.themeId}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Undo2 aria-hidden="true" />}
                    onClick={() => {
                      if (!bridge) return
                      void bridge.undoChange(change.changeId).then((result) => setNote(result.message ?? ''))
                    }}
                  >
                    Undo this change
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {chat ? (
        <Card
          title={chat.title}
          icon={<MessageSquare />}
          action={
            <button
              type="button"
              aria-label="Close chat"
              className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-control hover:text-ink"
              onClick={() => setChat(null)}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          }
        >
          <div className="space-y-3">
            {chat.messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : ''}`}>
                {message.role === 'user' ? (
                  <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[13.5px] leading-6 text-on-primary">
                    {message.text}
                  </p>
                ) : (
                  <div className="min-w-0 max-w-[80%] rounded-2xl rounded-tl-md bg-control px-3.5 py-2 text-[13.5px] leading-6 text-ink">
                    <Markdown>{message.text}</Markdown>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  )
}

function Empty({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line py-8 text-center">
      <span className="text-faint [&>svg]:size-5">{icon}</span>
      <p className="text-[13px] text-muted">{text}</p>
    </div>
  )
}
