# Voice Transcriber

A purely client-side React app that transcribes meeting audio using your own AI provider API key. No backend server — your key never leaves your browser.

## Features

- **Upload or record** — drag-drop an audio/video file, or record live mic + system audio
- **Multi-provider** — choose from Google Gemini, OpenAI, or Groq; switch any time in Settings
- **BYOK (Bring Your Own Key)** — API key stored only in `localStorage`, sent directly to the provider, never touches any intermediate server
- **Dual-track speaker identification** — mic and system audio are recorded as separate tracks; Gemini receives them as two explicitly labelled audio parts, making host attribution 100% certain and participant attribution dramatically more accurate
- **Timestamped output** — every speaker turn is timestamped `[HH:MM:SS]`
- **Export** — copy to clipboard, download as `.txt`, or download as `.md`
- **Audio download fallback** — if transcription ever fails, your recording is always available to download so it is never lost
- **Render-ready** — deploys as a static site with zero server cost

## Supported providers

| Provider | Best for | Speaker ID | Max file | Free tier |
|----------|----------|-----------|----------|-----------|
| **Google Gemini** | Long meetings, best quality | Full (names) | 2 GB | Yes |
| **OpenAI** (GPT-4o Audio) | Existing OpenAI users, full speaker ID | Full (names) | 25 MB | No |
| **OpenAI** (Whisper-1) | Speed, cost; chunked for large files | Plain transcript | 500 MB* | No |
| **Groq** (Whisper) | Fast, free, English meetings; chunked for large files | Names as spelling hint | 500 MB* | Yes |

### Getting an API key

| Provider | URL | Notes |
|----------|-----|-------|
| Google Gemini | `aistudio.google.com/apikey` | Free tier available, key starts with `AIza` |
| OpenAI | `platform.openai.com/api-keys` | Key starts with `sk-` |
| Groq | `console.groq.com/keys` | Free tier, no credit card needed, key starts with `gsk_` |

## Supported file formats

MP3 · WAV · WebM · OGG · M4A · AAC · FLAC · MP4 · MOV · AVI — up to **500 MB** (Gemini supports up to 2 GB via its File API; OpenAI and Groq chunk files above 25 MB automatically)

> **Note for live recordings:** The recorder captures at 48 kbps Opus stereo, so a 10-minute meeting is ~3.6 MB — well within every provider's limit. A 2-hour meeting is ~43 MB (routes through Gemini's File API automatically).

## How to run locally

**Prerequisites:** Node.js 18+ (Node 20+ recommended)

```bash
cd voice-transcriber
npm install
npm run dev
```

Open `http://localhost:5173`. On first load you'll be prompted to choose a provider and enter your API key.

### Other commands

```bash
npm run build      # production build → dist/
npm run preview    # serve the dist/ build locally
npm test           # run the full test suite (Vitest)
npm run test:watch # watch mode
```

## Deploying to Render

The project includes a `render.yaml` for one-click deployment.

1. Push this folder (or the full repo) to GitHub
2. In the Render dashboard → **New → Static Site**
3. Connect your repository, point to the `voice-transcriber/` directory
4. Render auto-detects `render.yaml` — build command and publish directory are pre-configured
5. Deploy — done

The `render.yaml` configures:
- Build: `npm install && npm run build`
- Publish: `dist/`
- SPA rewrite: all routes → `index.html`
- Security headers: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`
- Cache: `index.html` is never cached; hashed JS/CSS assets are cached for 1 year

## Security model

- The API key is validated by calling the provider's API **directly from the browser** — no intermediate server is involved
- The key is persisted in **`localStorage` only** — it never leaves the device unless the user's own browser sends it to the provider
- No analytics, no telemetry, no server-side logging
- No `.env` files — there are no server-side secrets to protect

## Speaker identification

### How it works — dual-track recording

The previous approach sent one mixed audio file to the AI and asked it to guess who was speaking. This failed when voices were similar, accents matched, or conversations were technical.

The current approach eliminates the guessing entirely by recording three parallel streams:

| Stream | Contents | Used by |
|--------|----------|---------|
| **Merged** (stereo WebM) | Mic + system audio combined | Groq, OpenAI Whisper |
| **Mic-only** | Host's microphone in isolation | Gemini (Track 1) |
| **System-only** | All remote participants in isolation | Gemini (Track 2) |

Gemini receives both separate tracks in a single request with explicit labels:

- **Track 1** — *"Every word here is [HostName]. No exceptions."*
- **Track 2** — *"These are the remote participants: [names]."*

Gemini's job changes from **guess + transcribe** to **transcribe + time-align**. Host attribution is 100% certain. Participant attribution is dramatically improved because Gemini hears isolated participant voices, not a mix with the host.

### Three transcription modes (automatic, no user action needed)

| Mode | When it activates | Quality |
|------|-------------------|---------|
| **Dual-track** | Live recording + screen share with audio | ✅ Best — host guaranteed, participants isolated |
| **Mic-only** | Live recording without screen share | ✅ Good — host guaranteed, participants faint |
| **Single-track** | Uploaded file | ⚠️ Heuristic — channel signal + name mentions + voice consistency |

The UI shows a green **"Dual-track mode"** badge when both tracks are captured, or an amber **"Mic-only mode"** badge to prompt the user to share their screen next time.

### For best results

1. Enter your name in the **Your name** field before recording — this is used as the Track 1 label
2. Add all participant names — Gemini matches isolated voices in Track 2 to these names
3. When the screen-share prompt appears, click **Share** and tick **Share audio** — this captures the system audio as a separate track

### Provider notes

- **Gemini** — full dual-track speaker identification; host attribution 100% certain
- **Groq / OpenAI Whisper** — mic and system tracks transcribed separately and merged by timestamp; host label guaranteed, participant label is "Participant" (Whisper cannot identify individual voices)
- **OpenAI GPT-4o Audio** — single-track only (25 MB limit); uses name mentions and voice consistency heuristics

## Project structure

```
voice-transcriber/
├── src/
│   ├── components/
│   │   ├── ApiKeySetup.tsx       # First-run: choose provider → enter key → pick model
│   │   ├── AudioInput.tsx        # Upload tab + Record Live tab + participant names
│   │   ├── ProcessingState.tsx   # Animated progress during transcription
│   │   ├── SettingsPanel.tsx     # Change provider/model at any time
│   │   └── TranscriptView.tsx    # Display, copy, and export transcript
│   ├── hooks/
│   │   └── useAudioRecorder.ts   # 3 parallel recorders: merged + mic-only + system-only (48 kbps)
│   ├── services/
│   │   ├── config.ts             # localStorage read/write for stored config
│   │   └── transcription/
│   │       ├── index.ts          # Provider-agnostic router; threads AudioTracks to each provider
│   │       ├── gemini.ts         # Gemini — dual-track (Path A), mic-only (Path B), single (Path C)
│   │       ├── openai.ts         # OpenAI — GPT-4o Audio + Whisper-1 (dual-track + chunking >25 MB)
│   │       └── groq.ts           # Groq — Whisper (dual-track + chunking >25 MB)
│   ├── types.ts                  # Shared TypeScript types incl. AudioTracks interface
│   ├── App.tsx                   # Root state machine (idle → processing → success/error)
│   └── main.tsx                  # React entry point
├── src/__tests__/                # Vitest + Testing Library test suite (165 tests)
├── index.html
├── vite.config.ts                # Code splitting: vendor-gemini, vendor-react, app
├── vitest.config.ts              # pool: forks (required on Node 18 to avoid OOM)
├── render.yaml                   # Render static site deployment config
└── package.json
```

## Adding a new provider

The architecture is designed for this. Adding, say, AssemblyAI requires:

1. Create `src/services/transcription/assemblyai.ts` with a `transcribeWithAssemblyAI` function
2. Add `'assemblyai'` to the `Provider` type in `src/types.ts`
3. Add cases in `transcribe()`, `validateApiKey()`, `fetchModels()`, and `getDefaultModel()` in `src/services/transcription/index.ts`
4. Add a `ProviderMeta` entry in the `PROVIDERS` array in the same file
5. The rest of the app (UI, routing, config storage) requires no changes

## Test suite

172 tests across 10 files covering:

| File | What it tests |
|------|--------------|
| `services/prompt.test.ts` | `buildTranscriptionPrompt` — all name/no-name combinations, edge cases |
| `services/dualTrack.test.ts` | `buildDualTrackPrompt`, `buildMicOnlyPrompt`, AudioTracks routing contract (31 tests) |
| `services/errorClassification.test.ts` | `classifyError` — all HTTP status codes, SDK bracket format, non-Error objects |
| `services/config.test.ts` | localStorage roundtrip, corruption handling, `updateModel` |
| `services/routing.test.ts` | Provider routing, argument passing, AudioTracks forwarding, exports |
| `components/ApiKeySetup.test.tsx` | Provider selection, key validation flow, model step |
| `components/AudioInput.test.tsx` | Tab switching, participant management, context + tracks passed to callback |
| `components/TranscriptView.test.tsx` | Rendering, copy/download, stats, reset |
| `components/ProcessingState.test.tsx` | All stage names, animation elements |
| `deployment.test.ts` | `dist/` integrity, `render.yaml`, no server-side imports, no secrets |

```bash
npm test
# Test Files  10 passed (10)
# Tests       172 passed (172)
```

## Reliability fixes (May 2025)

These changes resolved a consistent failure where 10-minute meeting recordings failed to transcribe across all providers.

### Fix 1 — MIME type codec suffix rejected by every provider API
**Files:** `gemini.ts`, `groq.ts`, `openai.ts`

`MediaRecorder` sets `file.type = "audio/webm;codecs=opus"`. All three provider APIs reject the `;codecs=opus` suffix with a 400 error, surfacing as a generic "Transcription failed."

**Fix:** Added `normalizeMimeType()` in all three providers to strip the suffix before any API call: `"audio/webm;codecs=opus"` → `"audio/webm"`.

### Fix 2 — Gemini inline base64 threshold was too high
**File:** `gemini.ts`

`INLINE_LIMIT_BYTES` was 20 MB, but a 20 MB file encodes to ~27 MB of base64 — over Gemini's 20 MB request body limit. Files between ~14–20 MB consistently produced silent HTTP 413 failures.

**Fix:** `INLINE_LIMIT_BYTES` lowered from 20 MB → **15 MB** (15 MB → ~20 MB base64, within the limit). Files above 15 MB now route through the File API.

### Fix 3 — No timeouts on API calls
**Files:** `gemini.ts`, `groq.ts`, `openai.ts`

A stalled connection or slow Gemini response hung the UI forever with no feedback.

**Fix:** `Promise.race([apiCall, timeoutAfter(N)])` added to all network calls — Gemini upload: 15 min, `generateContent`: 20 min, Groq/OpenAI: 5–8 min. Users now get a clear error instead of an infinite spinner. The longer Gemini timeouts support 2-hour meetings where processing can take 8–12 minutes.

### Fix 4 — No bitrate cap on MediaRecorder
**File:** `useAudioRecorder.ts`

Chrome records at 128–256 kbps by default. At 256 kbps a 10-minute recording is ~19 MB — at the edge of Gemini's inline limit and over Groq/OpenAI's 25 MB hard limit around 16 minutes.

**Fix:** Added `audioBitsPerSecond: 48_000` to `MediaRecorder`. At 48 kbps Opus stereo (transparent for speech): 10 min = **~3.6 MB**, 2 hours = **~43 MB** (Gemini File API). Well within all provider limits.

### Fix 5 — Recorded audio permanently lost on transcription failure
**Files:** `useAudioRecorder.ts`, `App.tsx`, `AudioInput.tsx`, `types.ts`

When the API call failed, the audio `Blob` was discarded with the error state.

**Fix (three layers):** `useAudioRecorder.ts` exposes `downloadAudio()` backed by a ref that survives `cleanup()`; `AudioInput.tsx` shows a **"Save"** button next to each completed recording; `App.tsx` stores `sourceFile` in error state and shows a **"Download Recording"** fallback panel on failure.

### Fix 6 — No chunking for Groq/OpenAI files > 25 MB
**Files:** `groq.ts`, `openai.ts`

Large uploaded files previously threw an immediate error for Groq and Whisper-1 with no recovery.

**Fix:** Both providers now split files into 23 MB chunks via `Blob.slice()`, transcribe each independently, and concatenate results. Live recordings are unaffected by Fix 4 (48 kbps cap keeps them well under 25 MB).

### Fix 7 — Speaker identification failure: AI guessing from mixed audio
**Files:** `useAudioRecorder.ts`, `gemini.ts`, `groq.ts`, `openai.ts`, `transcription/index.ts`, `AudioInput.tsx`, `App.tsx`, `types.ts`

The root cause of speaker misattribution: the app mixed mic and system audio into one file and asked the AI to guess who was speaking. This fails when voices are similar, accents match, or conversations are technical.

**Fix — Dual-track recording architecture:**

The recorder now runs three `MediaRecorder` instances in parallel:
- **Merged** — the original stereo mix (for Groq/OpenAI)
- **Mic-only** — host's microphone in complete isolation
- **System-only** — all remote participants in complete isolation

A new `AudioTracks` interface threads these separate blobs from the recorder through the entire transcription pipeline. Gemini receives both tracks as two separately labelled audio parts in a single `generateContent` request. The prompt says: *"Every word in Track 1 is [HostName]. Every word in Track 2 is from remote participants."* Host attribution is now guaranteed; participant attribution is dramatically improved. The UI shows a green **Dual-track mode** badge to confirm both tracks were captured, or an amber **Mic-only mode** badge when only the microphone was recorded.

For Groq and OpenAI Whisper, the mic and system tracks are transcribed separately and merged by timestamp — the host label is guaranteed; individual participant names require Gemini.

**31 new unit tests** were written for the dual-track prompt functions, AudioTracks routing contract, and type safety. 4 existing tests were also fixed for regressions introduced by the new 6-argument provider call signature.

---

## Roadmap

- [ ] **Project 2 — Meeting Notes Generator**: takes a transcript produced by this app and generates structured meeting notes (summary, action items, decisions, follow-ups) using the same BYOK pattern
- [ ] AssemblyAI provider (async transcription, native speaker diarization)
- [x] ~~OpenAI / Groq Whisper large file support (chunking workaround for >25 MB)~~ — shipped May 2025
- [x] ~~Reliable speaker identification for live recordings~~ — dual-track architecture shipped May 2025
- [ ] In-browser transcript editing before export
