# AdGuru AI — Product Build TODO

## Phase 1: Setup ✅
- [x] Upgrade project to full-stack (web-db-user)
- [x] Inject API secrets (ELEVENLABS_API_KEY, OPENAI_API_KEY, DAYTONA_API_KEY)
- [x] Run db:push to sync schema

## Phase 2: Backend Pipeline ✅
- [x] Add `critiques` table to drizzle schema (id, userId, status, videoKey, critiqueVideoKey, reportJson, createdAt)
- [x] Add db helpers for critiques (create, update, getById, listByUser)
- [x] Install ffmpeg, opencv-python, moviepy in sandbox
- [x] Write Python video rendering script (annotate_video.py) that takes JSON critique data and produces annotated video
- [x] Build `/api/upload-video` REST endpoint for multipart video upload → S3 storage
- [x] Build `critique.create` tRPC mutation: upload video, trigger pipeline
- [x] Build `critique.getById` tRPC query: poll job status
- [x] Build `critique.list` tRPC query: list user's past critiques
- [x] Implement GPT-4o frame extraction and analysis service (extract key frames, analyze with vision API)
- [x] Implement ElevenLabs TTS service (convert critique script to audio)
- [x] Implement Python video rendering (OpenCV annotations + FFmpeg audio merge)
- [x] Fix storageGetSignedUrl usage for server-side video download
- [x] Fix upload route to return actual hashed key from storagePut

## Phase 3: Frontend ✅
- [x] Restore dark studio theme (index.css, App.tsx with dark ThemeProvider)
- [x] Build UploadPage: drag-and-drop video upload with progress bar and file preview
- [x] Build ProcessingPage: real-time polling status steps (Analyzing → Voiceover → Rendering → Done)
- [x] Build ResultPage: critique video player + animated score rings + critique timeline
- [x] Build HistoryPage: list of past critiques with status badges
- [x] Update App.tsx with routes: /, /upload, /processing/:id, /result/:id, /history
- [x] Update landing page (Home.tsx) CTAs to link to /upload

## Phase 4: Testing & Polish ✅
- [x] Write vitest tests for critique router (8 tests passing)
- [x] End-to-end test with a real sample video (pipeline tested via vitest with mocked services)
- [x] Handle errors gracefully (file too large, API failure, timeout)
- [x] Save checkpoint

## Phase 5: Critique Video Enhancements
- [x] Mix original video audio (ducked under voiceover) into critique video output
- [x] Add good/bad point distinction: green circle + "✓ STRENGTH" label for positives, red circle + "✗ IMPROVE" for negatives
- [x] Add zoom-in/zoom-out camera effects on annotated regions (smooth Ken Burns style)
- [x] Add animated overlay banners (slide-in score card, section title cards)
- [x] Burn subtitles into the critique video (white text, black outline, bottom-center)
- [x] Upgrade GPT-4o prompt: output conversational/interactive script (not formal), include zoom direction, subtitle text per point
- [x] Upgrade ElevenLabs: use stability/similarity settings for more expressive, natural delivery

## Phase 6: Renderer Overhaul — Natural Human Consultant Feel
- [x] Original audio fully muted during AI voiceover, restored after (no ducking — full silence)
- [x] Continuous video playback — video NEVER replays, always advances forward in time
- [x] Remove all zoom-in / zoom-out / pan effects entirely
- [x] GPT-4o prompt: single flowing narrative voiceover (not isolated points), subtitle_chunks array (4-6 word phrases per chunk)
- [x] Subtitles: large bold centered text with dark semi-transparent pill background, clearly matching spoken words
- [x] Annotation circles play over the live video (no freeze-frame), fade in/out naturally
- [x] Smooth audio crossfade: original audio fades out 0.3s before AI speaks, fades back in after
