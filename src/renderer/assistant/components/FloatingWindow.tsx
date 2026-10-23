import { useEffect, useLayoutEffect } from 'react'
import { AnimatePresence } from 'motion/react'
import { bridge } from '../lib/bridge'
import { useAnnotationStore } from '../stores/useAnnotationStore'
import { useCaptureStore } from '../stores/useCaptureStore'
import { useChatStore } from '../stores/useChatStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useUiStore } from '../stores/useUiStore'
import { speakAnswersToSpokenQuestions, useVoiceStore } from '../stores/useVoiceStore'
import { AssistantOrb } from './AssistantOrb'
import { ChatPanel } from './ChatPanel'

/**
 * The transparent window's root. It shows either the orb or the panel, keeps
 * renderer state in sync with main, and owns window-level keyboard handling.
 */
export function FloatingWindow() {
  const presentation = useUiStore((s) => s.presentation)
  const finishTransition = useUiStore((s) => s.finishTransition)

  // Subscribe during the first commit so no event from main is missed.
  useLayoutEffect(() => {
    const api = bridge()
    const ui = useUiStore.getState
    const chat = useChatStore.getState
    const capture = useCaptureStore.getState
    const voice = useVoiceStore.getState

    const offVisibility = api.events.onVisibility(({ visible, mode, focusInput }) => {
      if (!visible) {
        // Nothing listens while hidden, and main has already dropped every
        // pending image, so forget the references too (SECURITY.md §7).
        voice().onHidden()
        capture().cancel()
        capture().forget()
      }
      ui().applyVisibility(visible, mode, focusInput)
    })
    const offChat = api.events.onChatEvent((event) => {
      chat().handleEvent(event)
    })
    const offAnnotations = api.events.onAnnotationState(({ visible }) => {
      useAnnotationStore.setState({ visible })
    })
    const offVoice = api.events.onVoiceEvent((event) => {
      voice().handlePartial(event.requestId, event.text)
    })
    const offSpeaking = speakAnswersToSpokenQuestions()
    const offPermission = api.events.onScreenPermission((info) => {
      capture().setPermission(info)
    })
    const offCommand = api.events.onCommand(({ command }) => {
      if (command === 'newChat') {
        chat().newChat()
        ui().setView('chat')
        ui().requestFocus()
      } else if (command === 'toggleVoice') {
        ui().setView('chat')
        voice().toggleListening()
      } else {
        ui().setView('settings')
      }
    })

    void useSettingsStore.getState().load()
    // Restores the saved conversation, if the user opted in (main returns none otherwise).
    void chat().loadHistory()
    void capture().refreshPermission()

    // After a dev reload main sends nothing, so ask where things stand.
    void api.app.getInfo().then(({ mode }) => {
      if (ui().presentation === 'hidden') ui().applyVisibility(true, mode, false)
    })

    return () => {
      offVisibility()
      offCommand()
      offPermission()
      offChat()
      offVoice()
      offSpeaking()
      offAnnotations()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const ui = useUiStore.getState()
      const chat = useChatStore.getState()
      const capture = useCaptureStore.getState()
      const voice = useVoiceStore.getState()
      if (e.key === 'Escape') {
        e.preventDefault()
        // Undo the innermost thing first; hide only when nothing else is open.
        if (capture.previewOpen) capture.setPreviewOpen(false)
        else if (capture.status === 'capturing') capture.cancel()
        else if (ui.presentation === 'panel' && ui.view === 'settings') ui.setView('chat')
        // Listening, transcribing or speaking: Esc interrupts it (nothing is sent).
        else if (voice.phase !== 'idle') voice.cancel()
        else if (chat.status === 'thinking' || chat.status === 'responding') chat.stop()
        else if (useAnnotationStore.getState().visible) void bridge().annotations.clear()
        else void bridge().window.hide()
      } else if (e.key === ',' && e.metaKey && ui.presentation === 'panel') {
        e.preventDefault()
        ui.setView(ui.view === 'settings' ? 'chat' : 'settings')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <main className="relative h-full w-full">
      <AnimatePresence onExitComplete={() => void finishTransition()}>
        {presentation === 'orb' && <AssistantOrb key="orb" />}
        {presentation === 'panel' && <ChatPanel key="panel" />}
      </AnimatePresence>
    </main>
  )
}
