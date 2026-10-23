const MAC_SYMBOLS: Record<string, string> = {
  commandorcontrol: '⌘',
  cmdorctrl: '⌘',
  command: '⌘',
  cmd: '⌘',
  control: '⌃',
  ctrl: '⌃',
  alt: '⌥',
  option: '⌥',
  shift: '⇧',
  super: '⌘',
  meta: '⌘',
}

const OTHER_NAMES: Record<string, string> = {
  commandorcontrol: 'Ctrl',
  cmdorctrl: 'Ctrl',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
}

/** Turns an Electron accelerator into display keycaps, e.g. ['⌘', '⇧', 'Space']. */
export function acceleratorKeys(accelerator: string, platform: string): string[] {
  const names = platform === 'darwin' ? MAC_SYMBOLS : OTHER_NAMES
  return accelerator
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => names[part.toLowerCase()] ?? (part.length === 1 ? part.toUpperCase() : part))
}
