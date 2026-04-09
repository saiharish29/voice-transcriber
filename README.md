# Voice Transcriber

A purely client-side React app that transcribes meeting audio using your own AI provider API key. No backend server — your key never leaves your browser.

## Features

- **Upload or record** — drag-drop an audio/video file, or record live mic + system audio
- **Multi-provider** — choose from Google Gemini, OpenAI, or Groq; switch any time in Settings
- **BYOK (Bring Your Own Key)** — API key stored only in `localStorage`, sent directly to the provider, never touches any intermediate server
- **Speaker identification** — enter participant names upfront; Gemini and GPT-4o Audio label speakers by real name instead of "Speaker A / Speaker B"
- **Timestamped output** — every speaker turn is timestamped `[HH:MM:SS]`
- **Export** — copy to clipboard, download as `.txt`, or download as `.md`
- **Render-ready** — deploys as a static site with zero server cost

## Supported providers

| Provider | Best for | Speaker ID | Max file | Free tier |
|----------|----------|-----------|----------|-----------|
| **Google Gemini** | Long meetings, best quality | Full (names) | 2 GB | Yes |
| **OpenAI** (GPT-4o Audio) | Existing OpenAI users, full speaker ID | Full (names) | 25 MB | No |
| **OpenAI** (Whisper-1) | Speed, cost | Plain transcript | 25 MB | No |
| **Groq** (Whisper) | Fast, free, English meetings | Names as spelling hint | 25 MB | Yes |

### Getting an API key

| Provider | URL | Notes |
|----------|-----|-------|
| Google Gemini | `aistudio.google.com/apikey` | Free tier available, key starts with `AIza` |
| OpenAI | `platform.openai.com/api-keys` | Key starts with `sk-` |
| Groq | `console.groq.com/keys` | Free tier, no credit card needed, key starts with `gsk_` |

## Supported file formats

MP3 · WAV · WebM · OGG · M4A · AAC · FLAC · MP4 · MOV · AVI — up to **500 MB** (Gemini supports up to 2 GB via its File API; OpenAI and Groq are limited to 25 MB)

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

## Speaker identification strategy

When participant names are provided, the transcription prompt uses a five-tier strategy:

1. **Channel signal** — in stereo recordings, left channel = the person recording (their mic); right channel = remote participants. This is the strongest signal.
2. **Name mentions** — when someone is addressed by name ("Thanks, Priya"), that voice is locked to that name from that point forward.
3. **Voice consistency** — once a voice is matched to a name, it stays matched for the entire recording.
4. **Context clues** — role, expertise, and meeting behaviour (who is presenting, who is asking questions).
5. **Fallback** — if a voice genuinely cannot be identified after all the above, it is labelled Speaker B, Speaker C, etc.

This approach works regardless of the meeting platform (Zoom, Teams, Google Meet, Webex, phone calls, etc.) — it requires no screenshots and no integration with the platform.

**Note:** Groq and OpenAI Whisper-1 do not support step 1–5 labelling. Names are passed as a spelling hint only and the output is a plain timestamped transcript.

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
│   │   └── useAudioRecorder.ts   # Mic + system audio capture via MediaRecorder
│   ├── services/
│   │   ├── config.ts             # localStorage read/write for stored config
│   │   └── transcription/
│   │       ├── index.ts          # Provider-agnostic router + PROVIDERS metadata
│   │       ├── gemini.ts         # Google Gemini — inline base64 + File API for >20 MB
│   │       ├── openai.ts         # OpenAI — GPT-4o Audio + Whisper-1
│   │       └── groq.ts           # Groq — Whisper via OpenAI-compatible API
│   ├── types.ts                  # Shared TypeScript types
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

165 tests across 9 files covering:

| File | What it tests |
|------|--------------|
| `services/prompt.test.ts` | `buildTranscriptionPrompt` — all name/no-name combinations, edge cases |
| `services/errorClassification.test.ts` | `classifyError` — all HTTP status codes, SDK bracket format, non-Error objects |
| `services/config.test.ts` | localStorage roundtrip, corruption handling, `updateModel` |
| `services/routing.test.ts` | Provider routing, argument passing, exports |
| `components/ApiKeySetup.test.tsx` | Provider selection, key validation flow, model step |
| `components/AudioInput.test.tsx` | Tab switching, participant management, context passed to callback |
| `components/TranscriptView.test.tsx` | Rendering, copy/download, stats, reset |
| `components/ProcessingState.test.tsx` | All stage names, animation elements |
| `deployment.test.ts` | `dist/` integrity, `render.yaml`, no server-side imports, no secrets |

```bash
npm test
# Test Files  9 passed (9)
# Tests      165 passed (165)
```

## Roadmap

- [ ] **Project 2 — Meeting Notes Generator**: takes a transcript produced by this app and generates structured meeting notes (summary, action items, decisions, follow-ups) using the same BYOK pattern
- [ ] AssemblyAI provider (async transcription, native speaker diarization)
- [ ] OpenAI Whisper large file support (chunking workaround for >25 MB)
- [ ] In-browser transcript editing before export
