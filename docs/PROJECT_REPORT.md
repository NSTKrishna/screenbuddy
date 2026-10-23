# ScreenBuddy — Project Report

## Abstract

ScreenBuddy is a macOS desktop assistant that floats above other applications and helps with whatever is on the screen. The user summons it with a global shortcut and asks a question by typing or speaking. If they choose, a screenshot of the current display is attached. The question and screenshot go to a configurable, OpenAI-compatible vision model, and the answer streams back as formatted text. It can also be read aloud, and the model can mark parts of the screen with arrows, circles and boxes on a transparent, click-through overlay.

The project emphasises **user control and privacy**:
- The screen is captured only on an explicit action, and always shown for review before it's sent.
- The microphone opens only while a visible recording indicator is on.
- Screenshots and audio are never written to disk.
- The API key is encrypted with the macOS Keychain and is never visible to the user-interface process.

The application is built with Electron, React and TypeScript. It has 301 passing unit tests and 38 end-to-end tests that drive the real application, of which 37 passed in the final full run (see [TEST_REPORT.md](TEST_REPORT.md)).

## 1. Problem statement

Getting help with software usually means describing what is on screen in words, or manually taking a screenshot, switching to a separate chatbot, pasting it in and typing the question. That is slow and breaks concentration. It also encourages over-sharing: whole-screen screenshots, which may show private messages or passwords, are pasted into third-party services without review.

There is a need for an assistant that:
1. is available instantly, from any application, without switching windows;
2. can see the screen, but only when asked, and only after showing the user exactly what will be shared;
3. answers in the form most useful at the time (text, speech, or pointing at the screen);
4. works with the user's choice of AI provider, including a local model, and keeps credentials safe.

## 2. Objectives

| # | Objective | Status |
|---|---|---|
| O1 | An always-on-top floating assistant with a global shortcut and menu-bar presence | Achieved |
| O2 | On-demand, previewed, multi-display screen capture with permission guidance and an upload fallback | Achieved (verified with simulated capture; see Limitations) |
| O3 | Multimodal conversation with any OpenAI-compatible model: streaming, follow-ups, cancellation, robust errors | Achieved (verified against a local mock server) |
| O4 | Secure handling of credentials and user data | Achieved |
| O5 | Voice input and spoken answers, without an always-on microphone | Achieved (verified with a simulated microphone) |
| O6 | On-screen annotations driven by the model | MVP achieved; accuracy with real models not evaluated |
| O7 | A free mock mode so the full app can be used and demonstrated without an API account | Achieved |
| O8 | Automated test coverage of every feature | Achieved (§6) |

## 3. System architecture

ScreenBuddy follows Electron's security model. The **main process** is the trusted core: capture, network, secrets, files and permissions all live there. The **renderer processes** are untrusted UI, sandboxed and without Node.js access.

```
┌──────────────────────────── Electron main process (trusted) ────────────────────────────┐
│  AssistantWindow  ShortcutService  TrayService  MicrophoneGate  AnnotationService       │
│                                                                                          │
│  IPC router: every channel declared once with zod schemas; sender + payload checked      │
│                                                                                          │
│  ScreenCaptureService ─ CaptureStore (in-memory, TTL, zero-filled on delete)             │
│  AiService ─ ChatProvider: OpenAiCompatibleProvider (net.fetch + SSE) | MockProvider     │
│  SpeechToTextService ─ TranscriptionProvider: OpenAI-compatible | Mock                   │
│  TextToSpeechService (provider voice)    PermissionService (TCC)                         │
│  SettingsStore (JSON + zod)  SecretStore (safeStorage/Keychain)  ConversationStore (opt-in) │
└──────────────┬──────────────────────────────────────────────────┬────────────────────────┘
               │ contextBridge (named functions only)             │ events only
   ┌───────────┴─────────────────────────┐            ┌───────────┴───────────────┐
   │ Assistant renderer (React, Zustand) │            │ Overlay renderer (SVG)    │
   │ chat, capture preview, voice,       │            │ transparent, click-through│
   │ settings; mic + system voice here   │            │ draws annotations only    │
   └─────────────────────────────────────┘            └───────────────────────────┘
```

Key design points (each is recorded in [DECISIONS.md](DECISIONS.md)):
- **Narrow, validated IPC.** About 35 named channels. Every request is validated with zod and checked to come from the app's own page. Errors are returned as `{ code, message }` with no internal details.
- **Provider-agnostic AI.** `AiService` handles conversation context, retries, timeouts, cancellation and image lifetime. Providers only translate a wire format. Mock mode is a real provider, so the whole pipeline runs without an account.
- **The model proposes, the user decides.** Model output is data: Markdown text, which is rendered without raw HTML or images, and annotation coordinates, which are validated and clamped. Nothing the model says is executed.

## 4. Implementation

The source is about 9,800 lines of TypeScript and TSX in 97 files under `src/`, plus about 4,800 lines of tests. It was built in phases, each ending with passing checks:

1. **Foundation and floating window.** electron-vite project, strict TypeScript, ESLint and Prettier, and a hardened window configuration: context isolation, sandbox, no Node in renderers, navigation and window-open guards, a deny-by-default permission handler, and a Content Security Policy.
   - The assistant window is a frameless, transparent macOS panel. It's anchored at its bottom-right corner, so the orb stays put while the chat panel grows from it.
   - Position is persisted and clamped to visible displays.
   - The global shortcut, tray menu, and a Dock-less mode.
2. **Screen capture.**
   - `desktopCapturer` at the display's native pixel size, matched by display id, then encoded twice: a JPEG of at most 1568 px for the model, kept in main memory, and a 640 px preview for the UI.
   - The assistant becomes fully transparent during capture.
   - Permission states are handled (denied: no capture attempt; not-asked: one attempt, then re-check).
   - The upload fallback validates PNG/JPEG by magic bytes.
   - Keyword-based detection of screen questions offers a screenshot for review.
3. **Multimodal AI conversation.**
   - An OpenAI-compatible client over Electron's `net.fetch` with a hand-written incremental SSE parser.
   - Retries with jittered backoff, only before the first word so text is never repeated.
   - First-word (60 s), idle (30 s) and total (180 s) timeouts.
   - Error classification into user-facing codes.
   - Compact context: the recent turns that fit a character budget, with only the current question carrying an image.
   - Markdown rendering hardened against untrusted output.
   - API keys are stored with `safeStorage`, with log redaction.
4. **Voice.**
   - Microphone capture with `MediaRecorder`, gated by a main-process permission gate that is armed only by the mic button and expires after 70 s.
   - RMS voice-activity detection: silence is never sent, and recording auto-stops after a pause.
   - Speech-to-text via `/audio/transcriptions`, with live partials where supported.
   - The system voice by default, an optional provider voice, and stop, mute, volume and replay.
   - No feedback loop: listening always stops speech first, and nothing is spoken while the mic is open.
5. **Annotations (MVP).**
   - A transparent, non-focusable, click-through overlay window at screen-saver level.
   - The model is asked for an optional fenced `annotations` JSON block. Main parses and validates it, and maps the normalized coordinates onto the screenshot's display.
   - A manual demo, a Clear button, Esc, and a configurable display time.

## 5. Results

- **Functionality:** every feature listed in the README works in the running app as exercised by the automated tests. On the development machine, the real Screen Recording permission is denied for Electron. The real capture path correctly showed the guidance card without triggering a macOS prompt.
- **Testing:** 301 of 301 unit tests passed. 37 of 38 end-to-end tests passed in the final full run; the one failure was an app-launch timeout in test setup, and that test passed 3 of 3 when re-run alone. Typecheck, lint, format check and the production build all pass, and `npm audit --omit=dev` reports 0 vulnerabilities. See [TEST_REPORT.md](TEST_REPORT.md).
- **Privacy properties checked by tests:**
  - The API key never appears in renderer-visible data or on disk in plain text.
  - Saved history contains no image data.
  - Silent recordings are not transmitted.
  - The microphone can't be opened unless the gate is armed.
  - Capture buffers are zero-filled after use.
- **Not measured:** response latency, model answer quality and annotation accuracy with real AI models. No performance figures are claimed.

## 6. Challenges

| Challenge | How it was handled |
|---|---|
| Resizing a transparent window between orb and panel showed stale frames | The old view animates out *before* main resizes the window, and the window starts fully transparent for about 2 frames on show. |
| macOS Screen Recording permission can't be requested programmatically and needs a relaunch | Explicit status handling, step-by-step guidance, a System Settings link, Relaunch, and the upload fallback. |
| Streaming responses arrive split at arbitrary byte boundaries (even inside `\r\n`) | An incremental SSE parser that buffers partial lines, with unit tests for split chunks. |
| A spoken answer could be picked up by the microphone | Listening always stops speech first, nothing is spoken while recording, there's no auto-listening, and echo cancellation is on. |
| Testing capture and voice without real permissions or hardware | Fake capture backend; Chromium's fake microphone fed generated WAV files; a local OpenAI-compatible mock server; a speech stub. Chromium's sandboxed audio service couldn't read the WAV and produced silence, which was solved by running audio in-process for tests only. |
| Tooling issues | npm 10.9 crashed resolving the dependency tree (worked around with npm 11). `ELECTRON_RUN_AS_NODE` leaked from VS Code made Electron start as plain Node (the dev script now unsets it). |

## 7. Limitations

- **Not verified on real hardware or services:** a successful real screen capture, a real microphone, real AI or speech providers, and real models' annotation accuracy. The automated tests use fakes for all of these.
- macOS on Apple Silicon only. The DMG is ad-hoc signed and not notarized, so Gatekeeper warns on first open. It has no hardened runtime or fuses.
- Annotations appear on one display (the screenshot's display). Uploaded images get none. Accuracy depends entirely on the model.
- Live transcription partials appear while a recording is being transcribed, not while the user is still speaking.
- Only one conversation is remembered (opt-in, text only). There's no conversation list.
- Two full E2E runs each had one intermittent, timing-related failure, in different tests (see TEST_REPORT §4).

## 8. Future improvements

1. Release-grade packaging: Developer ID signing and notarization, the hardened runtime and Electron fuses.
2. An annotation accuracy study with several vision models. One overlay per display, and snapping to UI elements.
3. Guided step-by-step tutorials that re-check the screen at each step.
4. Opt-in browser automation in a separate, isolated browser with approval for every action.
5. On-device speech-to-text and local models for fully offline use.
6. A conversation list and search, a configurable shortcut, a light theme, and a privacy dashboard.
7. More robust E2E runs (longer launch timeouts or per-test retries), and CI on a clean machine.
