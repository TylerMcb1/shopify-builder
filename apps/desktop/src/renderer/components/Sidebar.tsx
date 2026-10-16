import type { ReactNode } from 'react'
import { History, House, MessageSquare, Monitor, Moon, Rocket, ShoppingBag, Sun } from 'lucide-react'
import { isMac, type ThemePreference } from '../theme.ts'
import { Button } from './Button.tsx'
import { Segmented } from './Segmented.tsx'

export type Screen = 'home' | 'change' | 'history' | 'golive'

export function Sidebar({
  screen,
  onNavigate,
  hasChange,
  storeDomain,
  updateMessage,
  canRestart,
  onCheckUpdates,
  onRestart,
  theme,
  onTheme,
}: {
  screen: Screen
  onNavigate: (screen: Screen) => void
  hasChange: boolean
  storeDomain: string | null
  updateMessage: string
  canRestart: boolean
  onCheckUpdates: () => void
  onRestart: () => void
  theme: ThemePreference
  onTheme: (theme: ThemePreference) => void
}) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-sidebar">
      <div className={`app-drag ${isMac ? 'h-12' : 'h-3'}`} />
      <div className="flex items-center gap-2.5 px-4 pb-4">
        <span className="flex size-8 items-center justify-center rounded-[9px] bg-primary text-on-primary shadow-button">
          <ShoppingBag className="size-[17px]" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">Shopify Builder</p>
          <p className="truncate text-[11.5px] text-muted">{storeDomain ?? 'No store connected'}</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-2.5" aria-label="Main">
        <NavItem icon={<House />} label="Home" active={screen === 'home'} onClick={() => onNavigate('home')} />
        {hasChange ? (
          <NavItem
            icon={<MessageSquare />}
            label="Current change"
            active={screen === 'change'}
            onClick={() => onNavigate('change')}
            dot
          />
        ) : null}
        <NavItem icon={<History />} label="History" active={screen === 'history'} onClick={() => onNavigate('history')} />
        <NavItem
          icon={<Rocket />}
          label="Get ready to go live"
          active={screen === 'golive'}
          onClick={() => onNavigate('golive')}
        />
      </nav>

      <div className="space-y-4 border-t border-line px-4 py-4">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">Updates</p>
          <p className="text-[12.5px] leading-5 text-muted">{updateMessage || "You're up to date."}</p>
          <div className="flex gap-1.5">
            <Button size="sm" variant="secondary" onClick={onCheckUpdates}>
              Check for updates
            </Button>
            {canRestart ? (
              <Button size="sm" onClick={onRestart}>
                Restart to update
              </Button>
            ) : null}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">Appearance</p>
          <Segmented
            full
            label="Appearance"
            value={theme}
            onChange={onTheme}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'System' },
            ]}
          />
          <p className="flex items-center gap-1.5 text-[11.5px] text-faint">
            {theme === 'light' ? <Sun className="size-3.5" aria-hidden="true" /> : null}
            {theme === 'dark' ? <Moon className="size-3.5" aria-hidden="true" /> : null}
            {theme === 'system' ? <Monitor className="size-3.5" aria-hidden="true" /> : null}
            {theme === 'system' ? 'Matches your computer' : theme === 'dark' ? 'Always dark' : 'Always light'}
          </p>
        </div>
      </div>
    </aside>
  )
}

function NavItem({
  icon,
  label,
  active,
  onClick,
  dot = false,
}: {
  icon: ReactNode
  label: string
  active: boolean
  onClick: () => void
  dot?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] font-medium transition-colors duration-100 [&>svg]:size-4 ${
        active ? 'bg-surface text-ink shadow-button' : 'text-muted hover:bg-control hover:text-ink'
      }`}
    >
      <span className={`flex [&>svg]:size-4 ${active ? 'text-primary' : ''}`} aria-hidden="true">
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {dot ? <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" /> : null}
    </button>
  )
}

/** Empty strip that lets the window be dragged on macOS, where the title bar is hidden. */
export function TitleBar({ children }: { children?: ReactNode }) {
  return (
    <div className={`app-drag flex shrink-0 items-center px-8 ${isMac ? 'h-12' : 'h-4'}`}>
      {children ? <div className="app-no-drag ml-auto flex items-center gap-2">{children}</div> : null}
    </div>
  )
}
