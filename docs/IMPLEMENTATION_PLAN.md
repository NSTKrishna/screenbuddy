# ScreenBuddy — Implementation Plan

The work is split into incremental phases. Each phase ends with working software, passing tests, and a short report covering changes, test results and open issues. No phase starts until the previous phase's exit criteria are met.

Conventions for every phase:

- **Inspect first.** Read the code a phase touches before editing it.
- **Strict TypeScript.** No `any` without a commented justification, and no `@ts-ignore`.
- **Tests with the code.** Unit tests for logic, and at least one E2E check per user-visible feature.
- **Security checklist** (SECURITY.md §9) at the end of each phase.
- **Docs updated:** ARCHITECTURE.md if a design changes, DECISIONS.md for every new decision, platform limitations as they're found.
- **Commands** that must pass to close a phase: `npm run typecheck && npm run lint && npm test && npm run test:e2e`.

E2E tests run the real app with `SCREENBUDDY_E2E=1`. That swaps in a **fake AI provider** (a local HTTP mock that returns canned OpenAI-compatible streams), a **fake capture provider** (fixture PNGs), and a **fake STT**. CI therefore needs no TCC permissions and no API key.

---

## Phase 0 — Scaffold, tooling and security baseline

**Goal:** an empty but correctly hardened Electron app that builds, launches and runs its tests.

Deliverables:
- `git init` and a `.gitignore` covering `node_modules`, `out`, `dist`, `.env*` and `coverage`.
- electron-vite project with entries for `main`, `preload/assistant`, `preload/overlay`, `renderer/assistant` and `renderer/overlay`.
- TypeScript strict configs: `tsconfig.node.json` for main and preload, `tsconfig.web.json` for renderers, and a `shared` path alias.
- Tailwind v4, Motion, Lucide, Zustand, zod and react-markdown installed. Exact versions pinned.
- ESLint (typescript-eslint, react-hooks, `no-restricted-imports` for `child_process`/`vm`) and Prettier.
- Security baseline in `src/main/security/`: webPreferences factory, CSP, navigation and window-open guards, a deny-all permission handler, and the `web-contents-created` guard.
- IPC framework: the `contract.ts` pattern, `router.ts` with validation and sender checks, and a typed preload bridge generator. The first channel is `app:getVersion`.
- Vitest configured with node and jsdom projects. Playwright configured for `_electron`.
- npm scripts: `dev`, `build`, `typecheck`, `lint`, `test`, `test:e2e`, `package`.

Tests:
- Unit: the router rejects invalid payloads and unknown senders, and the webPreferences factory returns the hardened flags.
- E2E: the app launches, the window shows the version, `window.require` is undefined, and `window.screenBuddy` exposes only the expected keys.

Exit: `npm run dev` opens a placeholder window, and all four commands pass.

**Status (2026-10-23): done, together with Phase 1.** Deferred to the phase that first needs them: the overlay preload and renderer entries (Phase 4), react-markdown (Phase 2) and the `package` script (Phase 9). The first channel is `app:getInfo` rather than `app:getVersion`. The preload exposes hand-written named functions instead of a generated bridge, which keeps the sandboxed preload to type-only imports.

---

## Phase 1 — Floating assistant shell, shortcut, tray, settings

**Goal:** the floating window can be summoned, and it remembers its settings.

Deliverables:
- `assistantWindow.ts`: frameless, translucent, always-on-top `panel` window. Drag region, remembered position (clamped to visible displays), opens on the cursor's display.
- `ShortcutService`: registers the configurable global shortcut (default `Alt+Shift+Space`). Registration failures (for example, a conflict) are reported to the UI, and shortcuts are unregistered on quit.
- Tray icon and menu: Show/Hide, New chat, Settings, Quit. `app.dock.hide()` with a setting to show the Dock icon.
- `SettingsStore` with a zod schema, defaults, `schemaVersion`, migrations and atomic writes. IPC `settings:get` and `settings:update`.
- UI: a chat shell (empty state, input, message list with placeholder messages) and a Settings view (shortcut recorder, theme, window behavior). Motion is used for show/hide.
- Esc hides the window, and clicking outside optionally hides it too.

Tests:
- Unit: settings schema defaults, migration, atomic write recovery after a corrupt file, accelerator validation, and the position-clamping math.
- E2E: toggling via the IPC test hook shows and hides the window, and a changed setting survives a relaunch.
- Manual (documented): the real global shortcut works from another app and over a full-screen app.

**Status (2026-10-23): done.** Differences from the list above:
- The default shortcut is `CommandOrControl+Shift+Space` (D-019).
- The window opens at its saved position, or the bottom-right of the primary display, rather than on the cursor's display.
- The Settings view shows the shortcut and whether it registered, the Dock-icon switch, a position reset and Quit. The shortcut recorder and theme picker aren't built yet, and neither is click-outside-to-hide.
- Minimize collapses to the orb, and close hides (D-022).
- Voice is a visual preview only (D-024).

The automated tests cover settings defaults, migration, corrupt-file recovery and debounced flush; the position math on multiple displays; the router's sender and payload checks; and shortcut conflicts. E2E covers launch, sandboxing, expand and collapse, the mock stream and error retry, toggle and Esc, the tray menu, drag and persistence across a relaunch, and a clean quit. Still manual: the physical shortcut from another app and over a full-screen app, the native header drag, and the real orb drag with the OS cursor.

---

## Phase 2 — AI provider, secrets and text chat

**Goal:** the user can chat with any OpenAI-compatible model, with streaming responses and saved history.

Deliverables:
- `SecretStore` (safeStorage), with write-only IPC `secrets:setApiKey`/`secrets:clear` and `hasApiKey` in PublicSettings.
- Provider settings: base URL (validated https or localhost), model name, optional capability flags (`supportsVision`, `supportsJsonSchema`) and a "Test connection" button.
- `AiService` + `OpenAiCompatibleProvider` (the `openai` SDK in main): streaming, cancellation (`AbortController`), timeouts, retries with backoff for 429/5xx, and error mapping.
- System prompt v1, plus `ModelResponse` schema and `parseResponse.ts` with JSON-schema mode, the tolerant fallback, and a plain-text fallback.
- `ConversationStore`: create, list, load, rename and delete. History windowing (the last N turns, token-budget estimate).
- UI: streaming markdown answers, stop button, conversation list, and an error banner with retry.
- Redacting logger.

Tests:
- Unit: `parseResponse` on valid, partial, malformed and injection-laden fixtures. Redaction. Base-URL validation. Conversation store round-trip.
- E2E (fake provider): send → streamed answer → persisted → visible after relaunch. Cancel mid-stream. A 401 shows a friendly error. The renderer never receives the key (assert on the IPC payloads).

**Status (2026-10-23): done.** Built:
- `SecretStore` (write-only IPC, `••••last4` status);
- provider settings with presets, base-URL validation and Test connection;
- `AiService` with `OpenAiCompatibleProvider` and `MockProvider`: streaming, cancellation, timeouts, retries with backoff and error mapping (D-033 to D-035);
- system prompt v1 (D-039);
- compact context (D-036);
- the redacting logger;
- streaming Markdown answers with a stop button and error cards with Retry, Send without screenshot and Open Settings.

Differences from the list above:
- History is one opt-in conversation rather than a browsable list (D-038).
- `parseResponse` and the JSON `ModelResponse` wait for Phase 4, because answers are plain Markdown for now.
- The `openai` SDK isn't used (D-033).
- The image half of Phase 3 (`AiService` attaches the image when `supportsVision` is on, otherwise warns) is done here too (D-037).

Tests: unit tests cover SSE parsing, request shape, error classification, context windowing, retry and no-retry-after-output, timeouts, cancel (including during backoff), reset, vision handling, history opt-in, secrets and redaction, base-URL rules and Markdown safety. E2E uses a local OpenAI-compatible server and covers a text-only question, a screenshot question with a follow-up, provider unavailable, invalid key, no-vision model (both paths), cancel, streaming, the key never reaching the renderer or disk, Test connection, and history only after opt-in.

---

## Phase 3 — Screen capture, permissions and multimodal chat

**Goal:** "What am I looking at?" works with a real screenshot.

Deliverables:
- `PermissionService`: screen and mic status, deep links to System Settings, re-check on focus, and a guided onboarding card with relaunch.
- `CaptureService`: hides the overlays and the assistant (if configured), captures the cursor's display via `desktopCapturer`, downscales and JPEG-encodes, keeps the in-memory LRU with TTL, and returns a preview.
- Capture toggle and "review before sending" (default on), a thumbnail chip with remove, and a capture flash indicator.
- `AiService` attaches the image as a content part when `supportsVision` is on, and otherwise warns.
- The cache clears on hide, new chat and quit. Conversation JSON records `hadScreenshot` only.

Tests:
- Unit: downscale math, LRU and TTL eviction, the "no scheduler" assertion, and that persisted messages contain no image data (scan for base64 signatures).
- E2E (fake capture + fake provider): capture → preview → send → the request to the mock includes an image part → the answer renders. Removing the chip sends no image.
- Manual: a real capture on a Retina display and on an external display, the first-run permission flow, and that the app's own windows are absent from the screenshot.

**Status (2026-10-23): capture half done, ahead of Phase 2.** The brief for this step asked for screen capture without the AI model, so the parts that need a provider wait for Phase 2. Done:
- `PermissionService`, with status, the System Settings deep link, re-check on focus, guidance and Relaunch;
- `ScreenCaptureService`, with the display picker, multiple displays, native-resolution capture and the in-memory LRU with TTL;
- the review-before-send preview, with retake and remove;
- the capture flash;
- clearing on hide, new chat and quit;
- the upload fallback (D-031);
- auto-capture for screen questions (D-030).

Not done yet: attaching the image to a real provider request (`AiService`, `supportsVision`), and persisting `hadScreenshot` in conversation files (there's no `ConversationStore` yet; messages keep only metadata in memory). Tests: unit tests cover permission denied, not-determined and restricted, no displays, multiple displays, high-DPI and fractional scaling, cancel, success, busy, uploads and cleanup (zeroing, TTL, LRU), and that construction schedules nothing. E2E covers each of those through the UI with the fake backend. Still manual: a real capture once Screen Recording is granted, an external display, and confirming the assistant is absent from a real screenshot.

---

## Phase 4 — Annotation overlay

**Goal:** the model can point at things on screen.

Deliverables:
- `overlayWindow.ts`: one transparent, click-through window per display, created lazily and kept off-screen or hidden when idle, using the overlay preload.
- `coordinates.ts`: normalized→display mapping, clamping, and dropping invalid values.
- Overlay renderer: animated pointer (pulse), box and label components in Motion and Tailwind. Auto-fade, Esc to clear, and a "clear annotations" button.
- The system prompt is extended with annotation instructions and examples.
- Annotations are saved in conversation history and can be replayed with "Show again", which works only while the screen layout is unchanged.

Tests:
- Unit: coordinate mapping on multiple displays (negative origins, mixed scale factors) and schema limits (max 8, text length).
- E2E: the fake provider returns annotations → the overlay window gets the events → DOM elements appear at the expected positions → they clear on timeout.
- Manual: accuracy spot-check with 2–3 real models, recorded in DECISIONS or the limitations section.

---

## Phase 5 — Voice input and spoken responses

**Goal:** the user can talk to ScreenBuddy and hear the answers.

Deliverables:
- Mic flow in the renderer: permission check via main, `MediaRecorder`, RMS-based silence auto-stop, a 60 s cap, a visible recording indicator, and tracks stopped on every exit path.
- The permission handler allows audio only during an active user-started recording.
- `SpeechService.transcribe` via `/audio/transcriptions` (configurable model, for example `whisper-1` or `gpt-4o-mini-transcribe`), with a payload size cap.
- An optional voice shortcut (toggle). Auto-send transcript setting.
- TTS: `speechSynthesis` by default, with voice and rate settings. Optional provider TTS. Only `spokenSummary` is spoken. Stop/Esc.

Tests:
- Unit: the VAD/auto-stop logic with synthetic buffers, and the recording state machine (no path leaves a live track).
- E2E: a fake media stream (Chromium `--use-fake-device-for-media-stream` and `--use-fake-ui-for-media-stream`) → fake STT → transcript in the input. TTS is called with `spokenSummary` (`speechSynthesis` is stubbed).
- Manual: the macOS mic indicator (orange dot) turns off as soon as recording stops.

**Status (2026-10-23): done (built before Phase 4, at the brief's request).** Built:
- the mic flow, with the permission check via main, `MediaRecorder`, RMS voice activity (auto-stop after quiet, no-speech give-up, 60 s cap), the recording indicator with level waveform and timer, and tracks stopped on every path;
- the `MicrophoneGate`-backed permission handler (D-043);
- `SpeechToTextService` with OpenAI-compatible and mock providers, live partials and a payload cap (D-045);
- the optional voice shortcut ⌥⇧Space (D-042);
- auto-send as a setting (D-046);
- TTS with the system voice by default and an optional provider voice with fallback: voice, speed and volume, plus stop, replay and mute (D-047);
- voice-or-text mode (D-048).

Difference: instead of a structured `spokenSummary`, a cleaned and shortened version of the Markdown answer is spoken, because answers aren't structured yet (D-033).

Tests: unit tests cover voice activity (silence, short utterance, clicks, cap), spoken-text cleaning, the mic gate, mic permission, multipart, the transcription provider (streaming, JSON, whisper fallback, missing endpoint, offline), the STT service (mock routing, not configured, retry, no-retry, cancel, timeout, busy, wiping) and TTS. Voice-store flows cover permission denied, mic unavailable, silence, auto-send, network failure with Retry, cancel while listening or transcribing, interruption and several questions in a row. E2E with the fake microphone covers each of these through the real UI.

Still manual: a real microphone, both the first-use macOS prompt and the orange indicator turning off; a real transcription provider; and provider TTS.

---

## Phase 6 — Guided tutorials

**Goal:** "Show me how to…" becomes a step-by-step walkthrough with highlights.

Deliverables:
- `TutorialPlan` schema and prompt.
- `tutorialMachine.ts`: a pure reducer with the states from ARCHITECTURE §6.4.
- `TutorialService`: on **Next**, capture plus a verification call; it updates the target annotation and handles "step not done yet".
- UI: a compact step card with progress, Next/Back/Skip/Stop and the current instruction (spoken if voice is on).

Tests:
- Unit: every state transition, including abort during verification and model failure during verification.
- E2E: a three-step fake tutorial runs to completion, the overlay updates each step, and Stop clears everything.

---

## Phase 7 — Approved browser automation

**Goal:** with step-by-step approval, ScreenBuddy can operate a website in a separate browser.

Deliverables:
- Install `playwright-core`. The browser strategy follows D-012: check for installed Chrome (`channel: 'chrome'`), otherwise offer a one-time download of Playwright Chromium. Check whether the hardened runtime and entitlements allow the launch, and record the result.
- `BrowserAction` DSL schema, `actionPolicy.ts` (classification and domain policy), and `executor.ts` (locator mapping, timeouts, per-run caps).
- Approval UI: action cards with a plain-language description, approve/edit/reject, separate confirmation for consequential actions, and a kill switch.
- An observation loop: summaries after each action are fed back to the model, wrapped as untrusted content.
- Privacy panel: clear automation profile.

Tests:
- Unit: policy classification table tests (submit, purchase names, password fields, cross-domain navigation, blocked schemes), DSL validation rejects unknown or extra fields, and caps.
- E2E: a local fixture website (static server), with the fake provider proposing actions. Assert nothing runs before approval, that rejection stops execution, and that a consequential action always prompts even under plan approval.
- Manual: a real simple task, such as searching a public docs site.

---

## Phase 8 — Privacy dashboard and permission management

**Goal:** the user can see and control everything the app can access and store.

Deliverables:
- A Privacy panel with live permission states and fix-it links. Capture, voice and automation master switches. Delete all conversations, forget API key, clear automation data, and an opt-in thumbnail setting.
- A first-run onboarding flow: what is sent where, permissions, and provider setup.
- A capture and recording activity log for the session only, in memory: "Screenshot sent at 14:02 to api.openai.com".

Tests:
- Unit: the deletion functions remove all the files they should, and nothing else.
- E2E: the onboarding path works, master switches disable the corresponding UI and IPC (IPC returns `FEATURE_DISABLED`), and deletion empties the store.

---

## Phase 9 — Packaging, hardening and final documentation

**Goal:** an installable arm64 DMG and a final report.

Deliverables:
- `electron-builder.yml`: `mac.target` dmg+zip, `arch: arm64`, hardened runtime, entitlements, `NSMicrophoneUsageDescription`, app icon, and `asarUnpack` for anything Playwright needs.
- `@electron/fuses` applied in an `afterPack` hook. DevTools are disabled in production.
- A smoke E2E against the packaged app.
- A README with setup, provider configuration examples (OpenAI, OpenRouter, Ollama), the permissions guide and a limitations summary.
- Final pass over SECURITY.md and the limitations list. Known-issues list.

Tests:
- Full suite against the packaged build, and fuse verification (`npx @electron/fuses read`).
- Manual: install on a clean user account, grant permissions, and run every core feature once.

---

## Feature → phase map

| Core feature | Phase |
|---|---|
| 1. Always-on-top floating assistant | 1 |
| 2. Global keyboard shortcut | 1 |
| 3. On-demand screenshot capture | 3 |
| 4. Multimodal AI conversation | 2 (text), 3 (vision) |
| 5. Voice input and spoken responses | 5 |
| 6. Desktop annotation overlay | 4 |
| 7. Guided tutorials | 6 |
| 8. Approved browser automation | 7 |
| 9. Privacy and permission management | 3 (permissions), 8 (dashboard) |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| TCC permission churn during development (rebuilds reset grants) | Use fake capture for E2E. Document the dev workflow. Use a stable ad-hoc signing identity for local builds. |
| Model doesn't follow the JSON schema | Fall back in layers (§6.2). Show which model is used. Keep a fixture suite of real malformed outputs. |
| Annotation inaccuracy | Forgiving visuals. A "wrong spot" re-ask. Manual evaluation in Phase 4. |
| Playwright browser bundle size and signing | Prefer system Chrome, with a download-on-demand fallback. Decide in Phase 7. |
| Scope creep for a college timeline | Phases 0–5 are the minimum demoable MVP. Phases 6–7 are stretch goals that build on it. |
