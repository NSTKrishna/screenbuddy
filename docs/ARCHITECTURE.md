# ScreenBuddy — Architecture

ScreenBuddy is a desktop assistant that floats above other apps. When the user asks, it takes a screenshot, sends it and the question to a vision-capable AI model, and answers with text, speech and on-screen annotations. It can also walk the user through a task step by step and, with approval for each step, drive a separate browser.

It is an independent educational project inspired by HeyClicky. It uses no HeyClicky code, assets, branding or private APIs.

- **Platform:** macOS 14+ on Apple Silicon (arm64). Other platforms are out of scope for the MVP. See [Platform limitations](#9-platform-limitations).
- **Status:** Phases 0–1 are implemented (2026-10-23): hardened scaffold, floating assistant window, global shortcut, tray and mock chat. Phases 2 and 3 are implemented too: screen capture with permissions, preview and upload fallback (D-027 to D-032), the provider-agnostic AI service with streaming, mock mode, secrets and opt-in history (D-033 to D-041), and Phase 5's voice input and spoken answers (D-042 to D-049). Phases 4 and 6 onwards are still design. The repository was empty when this document was first written (2026-10-23).

---

## 1. Design principles

1. **The main process is the trusted core.** All privileged work happens in the Electron main process: screen capture, network calls to the AI provider, secrets, file I/O and browser automation. Renderers are treated as untrusted UI.
2. **Narrow, typed, validated IPC.** Every IPC channel is declared once in `src/shared/ipc`, with a zod schema for its request and response. The preload exposes named functions, never `ipcRenderer` itself.
3. **Nothing happens without the user.** Capture, microphone and automation run only in response to an explicit user action. Nothing runs in the background.
4. **The model proposes, the user decides.** Model output is data: text, annotations, tutorial steps and typed browser actions. It is never code. No model output reaches a shell, `eval` or the file system.
5. **Ephemeral by default.** Screenshots and audio live in memory for the current turn only. Only text is persisted.
6. **Swappable providers.** AI, capture, speech and automation sit behind interfaces, so tests can inject fakes and the user can point the app at any OpenAI-compatible endpoint.

---

## 2. System overview

```
┌──────────────────────────────── Electron main process (trusted) ───────────────────────────────┐
│                                                                                                │
│  App lifecycle ── WindowManager ── ShortcutService ── TrayService                              │
│        │               │                                                                       │
│        │     ┌─────────┴──────────┐                                                            │
│        │     │ IPC router         │  zod-validates every request, checks the sender frame,     │
│        │     │ (shared contract)  │  dispatches to a service                                   │
│        │     └─────────┬──────────┘                                                            │
│        │               │                                                                       │
│  ┌─────┴───────────────┴──────────────────────────────────────────────────────────────────┐    │
│  │ Services                                                                               │    │
│  │  CaptureService      desktopCapturer → in-memory image (never written to disk)         │    │
│  │  AiService           OpenAI-compatible client, streaming, structured output            │    │
│  │  SpeechService       STT via /audio/transcriptions, optional TTS via /audio/speech     │    │
│  │  AnnotationService   validates model annotations → overlay coordinates                 │    │
│  │  TutorialService     step state machine, re-captures to locate the next step           │    │
│  │  AutomationService   Playwright, isolated profile, typed action DSL, approval gate      │    │
│  │  PermissionService   TCC status (screen, microphone), deep links to System Settings    │    │
│  │  SettingsStore       JSON + zod schema + migrations                                    │    │
│  │  ConversationStore   one JSON file per conversation, text only                         │    │
│  │  SecretStore         safeStorage-encrypted API key, never sent to a renderer           │    │
│  └────────────────────────────────────────────────────────────────────────────────────────┘    │
└───────────────┬──────────────────────────────┬───────────────────────────────┬─────────────────┘
                │ contextBridge                │ contextBridge                 │ CDP (Playwright)
   ┌────────────┴────────────┐    ┌────────────┴────────────┐       ┌──────────┴──────────────┐
   │ Assistant renderer      │    │ Overlay renderer        │       │ Automation browser      │
   │ React + Zustand         │    │ (one per display)       │       │ separate Chromium,      │
   │ chat, voice, settings,  │    │ transparent,            │       │ throwaway profile,      │
   │ approvals, privacy      │    │ click-through, draws    │       │ no user cookies         │
   │ preload: assistant.ts   │    │ annotations only        │       │                         │
   │                         │    │ preload: overlay.ts     │       │                         │
   └─────────────────────────┘    └─────────────────────────┘       └─────────────────────────┘
```

---

## 3. Process and window model

| Window | Purpose | Key `BrowserWindow` options |
|---|---|---|
| **Assistant** | Floating chat panel: input, transcript, mic button, capture button, approvals, settings and privacy views. | `frame: false`, `transparent: true`, `alwaysOnTop` at level `floating`, `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`, `type: 'panel'` (macOS), not user-resizable but sized per mode from a bottom-right anchor (D-020), `skipTaskbar`, `setContentProtection(true)` |
| **Overlay** (one per display, created on demand) | Draws pointers, boxes, labels and tutorial highlights over the desktop. | `transparent: true`, `frame: false`, `focusable: false`, `hasShadow: false`, `alwaysOnTop` at level `screen-saver`, `setIgnoreMouseEvents(true, { forward: true })`, bounds = `display.bounds`, `setContentProtection(true)` |
| **Automation browser** | Not an Electron window. Playwright launches a separate Chromium process. | Persistent context in `userData/automation-profile`, wiped on demand. Headed so the user can watch. |

All Electron windows share these `webPreferences`:

```ts
{
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  spellcheck: false,
  preload: <window-specific preload>,
}
```

The app runs as an accessory app. It calls `app.dock.hide()` and lives in the menu bar (Tray), which suits a floating assistant. The user can turn the Dock icon on in settings.

---

## 4. Source layout

The build uses **electron-vite** (see DECISIONS D-001), which supports the main, preload and multiple renderer entries in one config.

```
screenbuddy/
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ build/                     entitlements.mac.plist, icons
├─ src/
│  ├─ shared/                 no Node or DOM imports; used by every process
│  │  ├─ ipc/
│  │  │  ├─ contract.ts       channel table: name → { request schema, response schema }
│  │  │  └─ events.ts         main→renderer event schemas
│  │  ├─ schemas/             zod: Settings, Message, ModelResponse, Annotation, BrowserAction, TutorialPlan
│  │  └─ types.ts             z.infer'd types re-exported
│  ├─ main/
│  │  ├─ index.ts             bootstrap, single-instance lock, security hooks, wiring
│  │  ├─ windows/             assistantWindow.ts, overlayWindow.ts, windowManager.ts
│  │  ├─ ipc/                 router.ts (validation + sender check), handlers/*.ts
│  │  ├─ security/            csp.ts, navigationGuards.ts, permissionHandlers.ts, externalLinks.ts
│  │  ├─ services/
│  │  │  ├─ capture/          CaptureService.ts, imageProcessing.ts
│  │  │  ├─ ai/               AiService.ts, OpenAiCompatibleProvider.ts, prompts.ts, parseResponse.ts
│  │  │  ├─ speech/           SpeechService.ts
│  │  │  ├─ annotations/      AnnotationService.ts, coordinates.ts
│  │  │  ├─ tutorials/        TutorialService.ts, tutorialMachine.ts
│  │  │  ├─ automation/       AutomationService.ts, actionPolicy.ts, executor.ts
│  │  │  ├─ permissions/      PermissionService.ts
│  │  │  └─ storage/          SettingsStore.ts, ConversationStore.ts, SecretStore.ts, atomicJson.ts
│  │  └─ testing/             fake providers, loaded only when SCREENBUDDY_E2E=1
│  ├─ preload/
│  │  ├─ assistant.ts         exposes window.screenBuddy (full UI API)
│  │  └─ overlay.ts           exposes window.screenBuddyOverlay (annotation events only)
│  └─ renderer/
│     ├─ assistant/           index.html, main.tsx, App.tsx, components/, features/, stores/
│     └─ overlay/             index.html, main.tsx, OverlayCanvas.tsx
├─ tests/
│  ├─ unit/                   Vitest (node env for main/shared, jsdom for renderer)
│  ├─ e2e/                    Playwright _electron specs
│  └─ fixtures/               sample screenshots, mock model responses
└─ docs/
```

---

## 5. IPC design

### 5.1 Contract

`src/shared/ipc/contract.ts` is the single source of truth:

```ts
export const ipcContract = {
  'chat:send':        { req: SendMessageReq,   res: SendMessageRes },
  'chat:cancel':      { req: z.object({ turnId: TurnId }), res: z.void() },
  'capture:take':     { req: CaptureReq,       res: CapturePreview },   // returns a downscaled preview only
  'capture:discard':  { req: z.object({ captureId: CaptureId }), res: z.void() },
  'settings:get':     { req: z.void(),         res: PublicSettings },
  'settings:update':  { req: SettingsPatch,    res: PublicSettings },
  'secrets:setApiKey':{ req: z.object({ apiKey: z.string().min(1).max(512) }), res: z.object({ hasKey: z.boolean() }) },
  'automation:decide':{ req: ApprovalDecision, res: z.void() },
  // …
} as const;
```

Main→renderer events (`chat:delta`, `chat:done`, `annotations:show`, `automation:approvalRequested`, `permissions:changed`, …) live in `events.ts` with their own schemas.

### 5.2 Flow and guards

1. The renderer calls `window.screenBuddy.chat.send({...})`. The preload maps that to `ipcRenderer.invoke('chat:send', payload)`. Only channels from the contract can be invoked. The preload never exposes `ipcRenderer`, `on` with arbitrary channels, or Node APIs.
2. The main `router.ts` wraps every `ipcMain.handle`:
   - **Sender check:** `event.senderFrame.url` must match the app's own renderer origin, and the window must be one WindowManager created and allows on this channel. The overlay may only call `overlay:*` channels.
   - **Validation:** `schema.safeParse(payload)`. A failure is rejected with a generic error and logged without the payload.
   - **Response validation:** the response is parsed in dev and test builds to catch drift.
   - **Errors:** a `{ code, message }` shape with no stack traces and no provider error bodies that might echo secrets.
3. Streaming uses `webContents.send` to the requesting window only, never a broadcast.

### 5.3 What the renderer can never get

- The API key. The renderer sees `hasApiKey: boolean`, and `secrets:setApiKey` is write-only.
- Raw full-resolution screenshots. The renderer receives a small JPEG preview (data URL) for the confirm-before-send UI. The full image stays in main memory, keyed by `captureId`.
- File paths outside the app's own data, or any file system API.

---

## 6. Core flows

### 6.1 Summon → ask → answer (with screenshot)

```
User presses global shortcut (default ⌘⇧Space, configurable; D-019)
  → ShortcutService toggles Assistant window (show + focus, positioned on cursor's display)
User types/speaks a question, capture toggle on (default on)
  → renderer: screenBuddy.capture.take({ display: 'cursor' })
  → main: hide overlay windows → desktopCapturer.getSources({ types:['screen'], thumbnailSize: display.size × scaleFactor })
          → pick source by display_id → NativeImage → downscale to ≤1568px long edge → JPEG q≈80
          → keep { captureId, buffer, width, height, displayId, bounds, scaleFactor } in an in-memory LRU (max 3, TTL 10 min)
          → return small preview to renderer
  → renderer shows thumbnail chip ("Screenshot attached — remove"), user sends
  → main: AiService.streamTurn(history, question, captureId)
          → OpenAI-compatible chat.completions (stream: true), image as base64 data URL in content parts
          → text deltas → 'chat:delta' events
          → final message parsed to ModelResponse (see 6.2)
          → annotations → AnnotationService → overlay windows
          → spokenSummary → TTS if voice replies are on
          → ConversationStore persists text and annotation metadata (no image bytes)
```

The assistant window has `setContentProtection(true)` and the overlays are hidden before capture, so ScreenBuddy's own UI doesn't show up in screenshots. As built, the assistant is made fully transparent rather than hidden for the capture (D-028), and a matching screen question attaches the capture for review instead of sending straight away (D-030). On macOS 15+ ScreenCaptureKit may still capture protected windows, so the hide step is the guarantee and content protection is a backup.

### 6.2 Structured model response

The model is asked for a JSON object, validated with zod in main:

```ts
ModelResponse = {
  answer: string,                          // markdown, rendered without raw HTML
  spokenSummary?: string,                  // ≤ 300 chars, for TTS
  annotations?: Array<{
    kind: 'pointer' | 'box' | 'label',
    x: number, y: number,                  // normalized 0..1 relative to the screenshot
    w?: number, h?: number,                // normalized, for 'box'
    text?: string,                         // ≤ 80 chars
  }>,                                      // max 8
  tutorial?: TutorialPlan,                 // see 6.4
  browserActions?: BrowserAction[],        // see 6.5 — proposals only
}
```

Strategy:
1. Use `response_format: { type: 'json_schema', … }` when the provider supports it (a capability flag in settings, auto-detected).
2. Otherwise, use a JSON-only system prompt and a tolerant extractor (the first balanced `{…}` block).
3. If parsing fails, show the raw text as `answer` with no annotations or actions. A malformed response never triggers side effects.

Text streaming happens before validation. While streaming, the UI shows the partial `answer` field extracted from the JSON as it arrives, or plain text when not in JSON mode.

### 6.3 Annotation coordinate mapping

`coordinates.ts` is pure and unit-tested:

```
screen_x = display.bounds.x + x_norm × display.bounds.width      (DIPs)
screen_y = display.bounds.y + y_norm × display.bounds.height
```

Normalized coordinates make the downscale and Retina `scaleFactor` irrelevant to the model. The overlay for `displayId` receives local coordinates (`x_norm × width`, `y_norm × height`). Values are clamped to [0,1]. Out-of-range or NaN annotations are dropped. Annotations fade after 8 s (configurable), on Esc, or when the next turn starts.

### 6.4 Guided tutorials

A tutorial is a `TutorialPlan { title, steps: [{ instruction, expectedOutcome?, target?: Annotation }] }` (max 15 steps) produced by the model when the user asks "show me how to…".

`TutorialService` is a small state machine: `idle → presenting(step i) → awaitingUser → verifying → presenting(i+1) | done | aborted`.

- **Next** (button or shortcut) triggers a fresh capture plus a short model call: "Given step *i* was: … and this new screenshot, is it done, and where is the target for step *i+1*?" That call re-locates the target, because UI positions change.
- **Skip**, **Back** and **Stop** are always available. Each verification capture shows the same capture indicator as a normal capture. There is no background polling.

### 6.5 Approved browser automation

```
Model proposes BrowserAction[] (typed DSL, no code)
  → actionPolicy.classify(action) → { allowed | needsConfirmation | consequential | blocked }
  → main emits 'automation:approvalRequested' with a human-readable summary
  → user approves / edits / rejects each action (or "approve this plan" for low-risk-only plans)
  → executor runs approved actions one at a time in the isolated Playwright browser
  → after each action: page title, URL, short visible-text summary (and optional page screenshot) → back to model
```

The DSL is a closed set:

```ts
BrowserAction =
  | { type: 'navigate', url: HttpUrl }
  | { type: 'click',    target: Locator }
  | { type: 'fill',     target: Locator, value: string, sensitive?: boolean }
  | { type: 'press',    key: AllowedKey }
  | { type: 'scroll',   direction: 'up'|'down', amount: 1..10 }
  | { type: 'waitFor',  target: Locator, timeoutMs: ≤10000 }
  | { type: 'extractText', target?: Locator }
Locator = { role: AriaRole, name: string } | { text: string } | { label: string } | { placeholder: string }
```

There is deliberately no `evaluate`, no raw CSS or XPath selectors from the model, no file upload or download, and no `file:`, `chrome:` or `javascript:` URLs. Locators map to Playwright's `getByRole`, `getByText`, `getByLabel` and `getByPlaceholder`.

The security rules for this flow (consequential-action rules, domain policy, prompt-injection handling) are in SECURITY.md §6.

### 6.6 Voice

- **Input (toggle-to-talk):** a mic button or the voice shortcut starts recording in the assistant renderer with `getUserMedia({ audio: true })` and `MediaRecorder` (webm/opus). The same action stops it, or it stops automatically after 2 s of silence (simple RMS VAD) or a 60 s hard cap. A recording indicator is always visible. The audio blob goes over IPC to main → `SpeechService.transcribe` → OpenAI-compatible `/audio/transcriptions`. The transcript lands in the input box for the user to send, or is sent automatically if "auto-send voice" is on. Tracks are stopped and the blob is dropped right after upload.
- **Output:** the default is the renderer's `speechSynthesis` with macOS system voices (offline, free). Optionally, provider TTS via `/audio/speech` streams audio back to the renderer. Only `spokenSummary` is spoken, never the full markdown. Speech can be stopped with a button or Esc.

### 6.7 Permissions

`PermissionService` wraps `systemPreferences.getMediaAccessStatus('screen' | 'microphone')` and `askForMediaAccess('microphone')`.

macOS has no API that asks for Screen Recording programmatically. The first capture attempt registers the app in the list, and the UI then deep-links to `x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture` with instructions and a "Relaunch ScreenBuddy" button, because macOS requires a restart after granting. Status is re-checked when the window gains focus and pushed via `permissions:changed`.

---

## 7. State management

| State | Owner | Notes |
|---|---|---|
| Settings, conversations, secrets, capture cache, tutorial and automation state | **Main** (source of truth) | Persisted state lives in `app.getPath('userData')` |
| View state: open panel, draft text, streaming buffer, recording flag, pending approvals (mirror) | **Renderer Zustand stores** | `useChatStore`, `useSettingsStore` (mirror of PublicSettings), `useVoiceStore`, `useApprovalStore`, `useUiStore` |

Renderer stores hydrate from IPC on load and update from main events. They never write to disk themselves.

### Persistence (userData)

```
settings.json                 zod-validated, versioned (schemaVersion), atomic write (tmp + rename)
secrets.bin                   safeStorage.encryptString(apiKey) — Keychain-backed encryption key
conversations/<id>.json       { id, title, createdAt, messages: [{ role, text, annotations?, hadScreenshot: true }] }
automation-profile/           Playwright persistent context (deletable from Privacy panel)
logs/main.log                 redacted (no keys, no image data, no transcripts unless debug opt-in)
```

---

## 8. Technology map

| Concern | Choice |
|---|---|
| Shell / build | Electron (latest stable, exact version pinned), electron-vite, TypeScript `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` |
| UI | React, Tailwind CSS v4, Motion (`motion/react`), Lucide icons, `react-markdown` (no `rehype-raw`) |
| UI state | Zustand |
| Validation | zod |
| AI | OpenAI-compatible `/chat/completions` over `net.fetch` with a small SSE parser (D-033), configurable base URL (OpenAI, OpenRouter, Ollama, LM Studio, vLLM, …) |
| Automation | `playwright-core` + Chromium (see D-012) |
| Tests | Vitest (+ Testing Library, jsdom), Playwright `_electron` for E2E |
| Packaging | electron-builder → `dmg` + `zip`, arm64, hardened runtime, `@electron/fuses` |
| Lint / format | ESLint (typescript-eslint, react-hooks), Prettier |

---

## 9. Platform limitations

These are known constraints, and the app is designed around them.

1. **Screen Recording permission (TCC).** It can't be requested programmatically, and it takes effect only after a relaunch. In development the grant belongs to the Electron binary or terminal host, not "ScreenBuddy". Unsigned or ad-hoc-signed builds may lose the grant whenever the code signature changes, so the app has to be re-granted after each rebuild. macOS 15+ also shows periodic "continue to allow screen access" reminders.
2. **Global push-to-talk is not possible with `globalShortcut`.** It fires only on key-down, with no key-up. Real hold-to-talk would need a native keyboard hook (for example `uiohook-napi`) plus the Accessibility permission. The MVP uses toggle-to-talk (D-007).
3. **The Web Speech recognition API doesn't work in Electron.** It depends on Google's service keys. Speech-to-text goes through an OpenAI-compatible transcription endpoint instead (D-008). A local model such as whisper.cpp would be a later option.
4. **Vision models point imprecisely.** Annotations are approximate. Boxes and pulsing pointers forgive small errors, and the user can say "that's not it" to re-ask. A future improvement could snap to UI elements through the macOS Accessibility API.
5. **Overlay limits.** Overlays can't draw above some system UI (the menu bar while a menu is open, Mission Control, the login window, secure input fields). Full-screen apps in their own Space need `visibleOnFullScreen`, and the result can still vary by app.
6. **Content protection is not guaranteed** to exclude windows from ScreenCaptureKit on newer macOS, so the app hides its own windows during capture.
7. **Multi-display.** The MVP captures only the display under the cursor, or one the user picks.
8. **Automation stays in a separate browser.** Playwright can't drive the user's everyday Chrome session, and by design it doesn't. Sites that require login need the user to log in inside the automation browser. Some sites detect automation and block it.
9. **Intel Macs, Windows and Linux** are untested and out of MVP scope. Most of the code is portable, but the permissions, window levels and packaging are macOS-specific.
10. **Notarization** needs a paid Apple Developer account. Unsigned DMGs need right-click → Open (or `xattr -dr com.apple.quarantine`) on first launch.
