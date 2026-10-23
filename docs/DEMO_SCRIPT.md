# ScreenBuddy — 3-Minute Live Demo Script

> **Read this first.** The parts using a real screen capture, a real microphone and a real AI provider have only been tested with simulated equivalents (see [TEST_REPORT.md](TEST_REPORT.md) §4). **Rehearse the full script on the demo machine at least once beforehand.** If any step fails, switch to the matching backup in §4. Every backup uses paths that *are* covered by the automated tests.

## 1. Preparation (do this 30+ minutes before)

1. **Install and start:** `npm install` (once), then `npm run dev`. The orb appears bottom-right, with an icon in the menu bar.
2. **Grant Screen Recording:** System Settings → Privacy & Security → Screen & System Audio Recording → turn on **Electron**. Quit ScreenBuddy (menu-bar icon → Quit) and run `npm run dev` again. macOS applies the grant only after a relaunch.
3. **Grant the microphone:** click the 🎤 in ScreenBuddy once. macOS asks for **Electron**; click Allow. Click 🎤 again to stop.
4. **Connect the AI provider:** Settings (⚙) → AI → **AI provider** → preset **OpenAI** (model `gpt-4o-mini`). Paste the API key and press Enter. Click **Test connection** and check it says "Connected."
5. **Voice settings:** Settings → Voice. Leave **Voice and text** selected and **Read answers aloud** on. Keep "Send transcripts automatically" **off**, so you control when things are sent. Check the Mac's volume is up.
6. **Prepare VS Code:** open VS Code with a new file `user.ts` containing:

   ```ts
   interface User {
     name: string
     age: number
   }

   const user: User = { name: 'Asha', age: '21' }
   ```

   VS Code underlines `age` with error **TS2322** (*Type 'string' is not assignable to type 'number'*). Hover the red line once so the error popup is visible, then leave VS Code in front.
7. **Rehearse** §2 once, then click **New chat** (✎) in ScreenBuddy and hide it (Esc).

Applications open at demo time: **VS Code** (with `user.ts`) and **ScreenBuddy** (`npm run dev` in a terminal, minimized). Nothing else.

## 2. The demo (about 3 minutes)

| Time | Do | Say | Expected on screen |
|---|---|---|---|
| **0:00–0:20** | With VS Code in front, press **⌘⇧Space**. Drag the panel header a little. | "ScreenBuddy floats over any app. One shortcut, and it remembers where I put it." | The chat panel opens over VS Code. |
| **0:20–0:50** | Click **Capture screen**, then click the thumbnail to enlarge it. Click **Keep**. | "It only looks at the screen when I ask, and I review exactly what will be sent first." | A white flash, then a preview card: "Screenshot of Built-in Retina Display", the pixel size, and "Not sent yet. Sending shares this image with api.openai.com." ScreenBuddy itself is **not** in the screenshot. |
| **0:50–1:20** | Type **"Why am I getting this error?"** and press Enter. | "The question and screenshot go to a vision model, and the answer streams back." | A "Looking at your screenshot…" status, then a streamed answer. *The exact text depends on the model*; it should mention that `age` is declared as a `number` but given the string `'21'`, and suggest using `21`. |
| **1:20–1:50** | Click **🎤**, say **"How do I fix it?"**, and stop talking. When the text appears in the box, press **Enter**. | "I can also just talk to it. It understood the follow-up from the conversation." | A red recording indicator with a moving level meter, then "Transcribing…", then your words in the box. After Enter, an answer about changing `'21'` to `21` is **read aloud**, with a "Speaking" bar. |
| **1:50–2:00** | While it speaks, click **Stop** on the Speaking bar. | "Spoken answers can be interrupted any time." | Speech stops immediately. |
| **2:00–2:30** | Click **Capture screen**, type **"Where is the error in this window? Point at it."**, press Enter. If no shapes appear within about 10 s, open Settings (⚙) → Annotations → **Demo**. | "It can point at things on screen. The overlay is click-through, so I can keep working." | **If the model returns coordinates:** a purple circle, arrow or box near the error, for 8 s. **If not, or after Demo:** an arrow at the centre, a circle top-left and a box bottom-right. Click in VS Code through the overlay to show it's click-through, then click **Clear annotations**. |
| **2:30–2:50** | Open Settings (⚙) and scroll to AI and Screen. | "The API key is encrypted in the macOS Keychain; the app only ever shows the last four characters. Screenshots and audio are never saved to disk." | API key ••••XXXX; Screen Recording: Allowed. |
| **2:50–3:00** | Close Settings. | "It's tested end to end: 301 unit tests, and 38 E2E tests that drive the real app." | — |

**Annotation honesty:** say "the model *can* point" rather than "always points". Real-model annotation accuracy hasn't been measured.

## 3. Mock-mode reference outputs (exact text)

These are what ScreenBuddy shows in **mock mode** (Settings → AI → **Mock (free, offline)**), useful for the backups:

| You do | Exact result |
|---|---|
| Click the suggestion **What can you do?** | "I can look at your screen when you ask (and only when you ask), explain what you're seeing, and walk you through tasks step by step. Right now I'm in mock mode, so every reply is simulated. Choose a provider in Settings for real answers." |
| Capture or upload an image and send anything | Starts with "I received a screenshot (W×H). Mock mode doesn't analyse images…" (W×H is the image size, such as 1568×1018 on a MacBook Air display). |
| Send `/fail` (or the **Preview the error state** suggestion) | An error card: "Can't reach the provider", "Couldn't reach the assistant. This was a simulated error.", and a **Retry** button. |
| Talk with mock transcription | The transcript is **simulated**, whatever you say: first "What's on my screen right now?", then "How do I fix this?", then "Can you explain that more simply?". |

## 4. Backups

**A. AI provider fails** (no network, quota, Test connection fails). Settings → AI → **Mock (free, offline)**. Re-run §2, but explain: "In mock mode the answers are simulated so the app can be shown without an account."
- 0:50: the answer is the mock "I received a screenshot…" text.
- 1:20: with mock transcription, the voice step shows "What's on my screen right now?" as the transcript, whatever you said. Say exactly that phrase so it matches.
- 2:00: use **Settings → Annotations → Demo** directly.

**B. Screen Recording doesn't work** (shows "Screen Recording is off"). Show the card: this is the permission guidance feature. Click **Upload an image instead** and pick a screenshot you prepared beforehand (⌘⇧4 in VS Code, saved as PNG on the Desktop). Continue the demo with the uploaded image.

**C. Microphone doesn't work** ("Microphone access is off" or "No microphone was found"). Show the card as the guidance feature, then type the follow-up question instead. Show spoken output with **Read aloud** under any answer.

**D. The app won't start.**
- Open the README's Screenshots section, which shows real screenshots of each state.
- Run the tests live:
  ```sh
  npm test                                                  # about 2 s: 301 unit tests
  npx electron-vite build && npx playwright test tests/e2e/annotations.spec.ts   # about 20–30 s
  ```

## 5. If asked

- **"Does it record my screen continuously?"** No. A capture happens only on Capture screen, retake, or a screen question, and is always shown for review before it's sent. The microphone opens only while the red indicator is on, and silent recordings are never sent.
- **"Which AI does it use?"** Any OpenAI-compatible API: OpenAI, OpenRouter, or local models through Ollama or LM Studio. There's also a free mock mode.
- **"What isn't finished?"** Packaging as a signed app, measuring annotation accuracy, guided tutorials and browser automation. See the README's Future scope.
