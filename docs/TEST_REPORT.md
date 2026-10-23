# ScreenBuddy — Test Report

**Test run:** 2026-10-23, on the development machine: macOS 26.6.2, Apple Silicon (arm64), Node 22.23.2, Electron 44.9.3.
All results below come from commands actually run on that date. Nothing here is estimated.

## 1. Summary

| Check | Command | Result |
|---|---|---|
| TypeScript (main, preload, renderer, E2E projects) | `npm run typecheck` | **Pass** (0 errors) |
| Lint (ESLint, strict type-checked rules, `--max-warnings 0`) | `npm run lint` | **Pass** (0 problems) |
| Formatting | `npm run format:check` | **Pass** |
| Unit tests (Vitest) | `npm test` | **Pass: 301 of 301 tests in 16 files** |
| End-to-end tests (Playwright driving the real Electron app) | `npm run test:e2e` | **37 of 38 passed** in the final full run. The one failure was a startup timeout; see §4. |
| Production build | `electron-vite build` (part of `test:e2e`) | **Pass** |
| Dependency audit (runtime dependencies) | `npm audit --omit=dev` | **0 vulnerabilities** |
| Dangerous APIs (`child_process`, `eval`, `new Function`, `shell.openPath`) | grep over `src/` | **None found** |

## 2. How the tests run

- **Unit tests** run in Node (main-process code) and jsdom (UI code). External systems are replaced by fakes: Electron's capture API, `safeStorage`, `fetch`, the microphone recorder and the speech engines.
- **End-to-end tests** launch the real built app with `SCREENBUDDY_E2E=1`. In that mode:
  - **Screen capture** uses a fake backend that produces solid-colour images for configurable "displays".
  - **macOS permissions** (Screen Recording, Microphone) are simulated, and can be set to granted, denied or not-asked.
  - **The microphone** is Chromium's fake audio device, fed a generated WAV file: a tone for "speech", digital silence for "silence".
  - **The AI provider** is either ScreenBuddy's mock mode, or a local OpenAI-compatible HTTP server (`tests/e2e/mockOpenAi.ts`) that streams real SSE responses and can simulate a rejected key, a text-only model and dropped connections.
  - **System speech** is replaced with a stub, so the Mac never speaks during tests.
  - **The Keychain** is Chromium's mock keychain, so the real Keychain is never touched.

So the E2E tests exercise the real UI, IPC, security checks, storage and the real HTTP client code. They do **not** exercise real screen pixels, a real microphone, or a real AI model (see §5).

## 3. Tests performed

### 3.1 Unit tests (301, all passing)

| File | Tests | What it covers |
|---|---|---|
| `main/ai.test.ts` | 68 | The SSE stream parser (split chunks, CRLF, comments); the OpenAI request shape including image parts; error classification (401, 404, 429 with quota, vision refusal, context length, 5xx); Retry-After; base-URL rules. Context building and windowing. The mock provider. AiService: text and screenshot questions, follow-ups, provider unavailable (retries), invalid key (no retry), model without vision (both paths), expired image, cancellation (also during backoff), first-word and idle timeouts, no retry after words have streamed, new chat mid-stream, history opt-in (text only, no image data), Test connection. |
| `main/capture.test.ts` | 38 | Image maths; PNG/JPEG detection by content; file-name cleaning. Capture: success, the assistant hidden during capture and restored even on error, no image data in logs, no timers. High-DPI and fractional scaling. Multiple displays (pick by id, unplugged display). No displays. Permission denied, restricted and not-asked. Cancel, busy. Upload validation. Cleanup: zero-filling buffers, TTL expiry, keeping at most 3. |
| `main/router.test.ts` | 36 | The IPC router: only contract channels are registered, untrusted senders are rejected, about 25 invalid payloads are rejected (bad URLs, keys, IDs, oversized text and audio, unknown fields), handler errors are hidden, response drift is caught. |
| `main/geometry.test.ts` | 18 | Window placement: the default corner, clamping on screen edges and negative-origin displays, fallback when a display is unplugged. |
| `main/voice.test.ts` | 18 | The microphone gate (arm, disarm, expiry); asking for the mic only when not yet asked; multipart encoding; the transcription provider (streaming partials, JSON, whisper-1 fallback, missing endpoint, offline, body wiped after use). The speech-to-text service (mock routing, not configured, one retry, no retry on a bad key, cancel, timeout, busy, audio wiped). Text-to-speech (success, mock, offline, non-audio reply). |
| `main/SettingsStore.test.ts` | 14 | Defaults, migration, corrupt-file recovery, debounced and synchronous saves, merging nested AI and voice settings. |
| `main/services.test.ts` | 10 | Hardened window settings, renderer origin checks, global shortcut registration and conflicts. |
| `main/secrets.test.ts` | 9 | The API key is stored encrypted with mode 0600, never returned, kept in memory only when encryption is unavailable, cleared fully. The log redaction of keys, bearer tokens and base64. |
| `main/annotations.test.ts` | 7 | Normalized→pixel mapping on a 1512×982 display, clamping, dropping NaN and Infinity, the 8-shape cap, the demo set fitting on screen, parsing the `annotations` block (valid, missing, malformed, invalid items). |
| `renderer/voice.test.ts` | 28 | Voice activity detection: silence, short utterance, clicks ignored, the 60 s cap. Spoken-text cleaning. The voice store: permission denied, mic unavailable, silence not sent, empty transcript, auto-stop, network failure with Retry, cancel while listening or transcribing, live partials, text-only mode, hiding stops recording. Spoken answers only for spoken questions; mute; interruption by the mic and by Esc; three consecutive questions. |
| `renderer/screenIntent.test.ts` | 21 | Which messages count as screen questions (10 positive, 11 negative cases). |
| `renderer/chatStore.test.ts` | 19 | Streaming events, stale events ignored, stop, retry with and without the image, attachments described only, auto-capture review flow, voice-originated turns. |
| `renderer/markdown.test.tsx` | 6 | Model output safety: raw HTML dropped, images never loaded, links not clickable, list numbering kept, Copy on code blocks. |
| `renderer/captureStore.test.ts` | 5 | Attaching and replacing captures, silent cancel, permission guidance, upload pre-checks. |
| `renderer/annotationText.test.ts` | 2 | The annotations block is hidden from chat and never read aloud. |
| `renderer/accelerator.test.ts` | 2 | Shortcut display (⌘⇧Space). |

### 3.2 End-to-end tests (38)

Results from the final full run (`npm run test:e2e`, 3.2 minutes):

| # | Spec › test | Result |
|---|---|---|
| 1 | annotations › manual demo: a click-through, always-on-top overlay with mapped shapes, and Clear | ✅ Pass |
| 2 | annotations › annotations clear themselves after the configured time, or with Esc | ✅ Pass |
| 3 | annotations › an AI answer about a screenshot draws what it points at | ✅ Pass |
| 4 | app › launches as a sandboxed floating orb in the bottom-right corner | ✅ Pass |
| 5 | app › expands to chat, streams a mock reply, and shows the error state | ✅ Pass |
| 6 | app › the toggle (shortcut handler) and Esc show and hide the assistant | ✅ Pass |
| 7 | app › the tray menu toggles, opens settings and starts a new chat | ✅ Pass |
| 8 | app › dragging moves the window and the position survives a relaunch | ✅ Pass |
| 9 | app › quits cleanly from the tray menu | ✅ Pass |
| 10 | capture › captures the screen, previews it, and sends it with a message | ✅ Pass |
| 11 | capture › retake replaces the screenshot and remove frees it | ✅ Pass |
| 12 | capture › a screen question captures for review and waits for a second Send | ✅ Pass |
| 13 | capture › lists multiple displays and captures the chosen one at its own scale | ✅ Pass |
| 14 | capture › permission denied shows guidance, and an uploaded image works instead | ✅ Pass |
| 15 | capture › a file that is not really an image is refused | ✅ Pass |
| 16 | capture › reports when there are no displays | ✅ Pass |
| 17 | capture › a capture can be canceled before anything is attached | ✅ Pass |
| 18 | capture › hiding the window clears a pending screenshot | ✅ Pass |
| 19 | chat › text-only question: streams the answer word by word | ✅ Pass |
| 20 | chat › screenshot question, then a follow-up in the same conversation | ✅ Pass |
| 21 | chat › provider unavailable: retries, then explains and offers Retry | ✅ Pass |
| 22 | chat › invalid API key: says so and links to Settings | ✅ Pass |
| 23 | chat › model without vision support: offers to send without the screenshot | ✅ Pass |
| 24 | chat › a model marked text-only never receives the screenshot | ✅ Pass |
| 25 | chat › request cancellation: Stop ends the stream and the connection | ✅ Pass |
| 26 | chat › the API key never reaches the renderer or the disk in plain text | ✅ Pass |
| 27 | chat › history is kept only after opting in, as text only | ❌ **Failed in the full run** (app launch timed out in `beforeEach`); ✅ passed 3 of 3 when re-run alone. See §4. |
| 28 | voice › speak a question about the screen and get a spoken answer | ✅ Pass |
| 29 | voice › typed questions are answered in text only | ✅ Pass |
| 30 | voice › permission denied: explains how to allow it and never opens the mic | ✅ Pass |
| 31 | voice › first use asks macOS once; refusing it is handled | ✅ Pass |
| 32 | voice › silence: nothing is transmitted | ✅ Pass |
| 33 | voice › short utterance: still transcribed | ✅ Pass |
| 34 | voice › microphone unavailable: says so | ✅ Pass |
| 35 | voice › network disconnect: transcription fails clearly and can be retried | ✅ Pass in this run (failed once in an earlier full run; see §4) |
| 36 | voice › speech interruption: Stop, and the mic button, both cut speech off | ✅ Pass |
| 37 | voice › multiple consecutive questions | ✅ Pass |
| 38 | voice › text-only mode removes the microphone | ✅ Pass |

### 3.3 Manual checks performed on the real machine

These are the only checks done *outside* the fakes:

| Check | Result |
|---|---|
| `npm run dev` launches the app; SIGTERM quits it cleanly | ✅ Done several times during development |
| The real macOS Screen Recording status for Electron | It is `denied` on the development machine. Clicking Capture with the **real** capture backend showed the permission guidance card, and no macOS prompt appeared (screenshot `docs/screenshots/04-screen-permission-denied.png`). |
| Renderer console during dev and production loads | No errors or CSP violations (also asserted by E2E test 4) |
| Logs during a full E2E run | 22 app log lines, none containing an API key, `Bearer` token or base64 image or audio data |

## 4. Known issues

1. **Intermittent single E2E failures in full-suite runs.** Two different full runs each had exactly one failure, in a different test each time:
   - "history is kept only after opting in": `Test timeout of 30000ms exceeded while running "beforeEach"`. The app took more than 30 s to *launch*, so the test body never ran. Re-run alone: 3 of 3 passes.
   - "voice › network disconnect" (an earlier run): the page was blank when the assertion ran. Re-run alone: 3 of 3 passes.

   Both look like load or timing flakiness: 38 sequential Electron launches on one machine. They don't point to a product bug, but the root cause has **not** been fixed. A larger launch timeout or one retry per test would likely mask it.
2. **Real hardware and providers not verified.** The following work only in automated tests with fakes:
   - **Screen capture:** a successful real screen capture, because Screen Recording isn't granted on the dev machine.
   - **Microphone:** real input, the first-use macOS prompt, and the orange mic indicator turning off after recording.
   - **Providers:** real OpenAI, OpenRouter or Ollama chat; real speech-to-text; real provider text-to-speech; the real macOS system voice.
   - **Annotation accuracy:** how accurately a real vision model returns coordinates. That is unverified, and the mock server's coordinates are scripted.
3. **npm 10.9 crash on fresh dependency resolution** (`Cannot read properties of null (reading 'edgesOut')`). Installing from the committed lockfile works with npm 10. Adding packages needs `npx npm@11`.
4. **`ELECTRON_RUN_AS_NODE`.** When run from a shell that inherits it (for example VS Code's extension host), Electron starts as plain Node. The `dev` and `preview` scripts unset it, but running `electron` directly from such a shell won't work.
5. **No packaged build.** There is no `.app` or DMG, code signing or notarization. The app runs via `npm run dev`.
6. **Single annotation overlay.** Annotations are drawn on the one display the screenshot came from. Uploaded images (which have no display) get no annotations.
