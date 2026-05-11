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

## Phase 7: Renderer Bug Fixes (v3 → v4)
- [x] Fix multiple concentric glow rings → single clean circle with subtle fill glow
- [x] Fix subtitle position: moved to 82% height to avoid overlapping original video text
- [x] Confirmed: multiple circles in user-uploaded video were from rendering ON TOP of already-annotated output (not a code bug)
- [x] Confirmed: single annotation per segment renders exactly ONE circle
- [x] All 8 tests passing

## Phase 8: Audio & Report Card Fixes
- [x] Fix duplicate audio tracks in critique video (multiple tracks playing simultaneously)
- [x] Report card score rings: yellow for score < 80, green for score >= 80
- [x] Overall score bar: yellow for < 80, green for >= 80

## Phase 9: Audio Pipeline Rewrite (definitive fix)
- [x] Replace FFmpeg amix filter_complex with pydub-based single-timeline approach
- [x] pydub builds ONE audio track: silence original during voiceover windows, overlay voice at exact timestamps
- [x] Merge step uses explicit -map 0:v:0 -map 1:a:0 to guarantee exactly 1 video + 1 audio stream
- [x] Verified: output has nb_streams=2 (1 video + 1 audio only)
- [x] All 8 tests passing

## Phase 10: Smooth Video — Segment Count & Spacing Fix
- [x] GPT-4o prompt: scale segment count to video duration (3 for <20s, 4 for <40s, 5 for <60s, 6 for longer)
- [x] GPT-4o prompt: enforce minimum spacing = max(5s, duration/(maxSegments+1))
- [x] GPT-4o prompt: require 4-6 sentence flowing paragraphs per segment (not bullet points)
- [x] Server-side enforcement in analyzeVideo.ts: drop segments too close together, cap at maxSegments
- [x] Renderer-level enforcement in annotate_video.py: drop segments too close together
- [x] Verified: spacing enforcement correctly drops segments at runtime
- [x] All 8 tests passing

## Phase 11: Pause-and-Resume Pipeline Redesign
- [x] analyzeVideo.ts: two-pass approach — Pass 1: AI watches video and generates a full review plan (observations, what to say, when to pause); Pass 2: AI converts plan into structured critiqueSegments with natural flowing scripts
- [x] Each critiqueSegment has a pauseAtTimestamp: the video plays until this point, then PAUSES while the AI speaks, then RESUMES
- [x] The output video is LONGER than the original (original duration + sum of all voiceover durations + small gaps)
- [x] annotate_video.py: rewrite as pause-and-resume renderer — copy original frames up to pause point, then freeze the last frame while voiceover plays, then resume original frames
- [x] Subtitles show during the frozen/paused section only
- [x] Annotation circles appear on the frozen frame during the pause
- [x] Banner shows during the pause window
- [x] Minimum spacing only 1s (AI can comment as many times as needed, just not simultaneously)
- [x] All 8 tests passing

## Phase 12: Subtitle Alignment Fix
- [x] Diagnosed: GPT-4o estimated offsetSec at ~2.5 words/sec but ElevenLabs speaks at variable pace
- [x] Fixed: generateVoice.ts now transcribes each voice MP3 with Whisper after ElevenLabs generates it
- [x] Whisper segment timestamps grouped into 6-word subtitle chunks with real offsetSec values
- [x] pipeline.ts overrides GPT-estimated subtitleChunks with real Whisper timestamps
- [x] Fallback to estimated timing if Whisper is unavailable
- [x] 15 tests passing (3 new tests for Whisper grouping, fallback, and pipeline merge logic)

## Phase 13: GPT-5.5 Upgrade
- [x] Upgraded analyzeVideo.ts from GPT-4o to GPT-5.5 for better video understanding and reasoning
- [x] All 16 tests passing with new model
