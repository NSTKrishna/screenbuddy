import { Settings } from 'lucide-react'
import { useUiStore } from '../stores/useUiStore'
import { IconButton } from './IconButton'

export function SettingsButton() {
  const view = useUiStore((s) => s.view)
  const setView = useUiStore((s) => s.setView)
  const open = view === 'settings'

  return (
    <IconButton
      label={open ? 'Close settings' : 'Settings'}
      shortcutHint="⌘,"
      active={open}
      aria-pressed={open}
      onClick={() => setView(open ? 'chat' : 'settings')}
    >
      <Settings className="size-[15px]" strokeWidth={2} />
    </IconButton>
  )
}
