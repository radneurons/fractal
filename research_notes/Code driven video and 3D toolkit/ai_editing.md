# Programmatic & AI-Assisted Video Editing Tools (as of Nov 2, 2026)

Method note: GitHub API and github.com were blocked from this sandbox's shell, so star counts come from WebFetch reads of GitHub repo and topic pages (snapshots on or near 2026-11-02) or from third-party MCP directories (marked as such). Version, date and license data for Python and npm packages come from the live PyPI and npm registry JSON, queried 2026-11-02. A small model summarized each WebFetch page, so a few unfamiliar repo names or star counts from topic pages may be wrong. Those are marked **[unverified]**.

Already covered elsewhere (brief): FFmpeg, auto-editor, WhisperX, PySceneDetect, Hypit, Herk Edit Kit, yt-dlp. For reference: auto-editor 29.3.1 (Unlicense, Nim, ~5.7k stars), WhisperX 3.8.6 (BSD-2, released 2026-06-26), PySceneDetect/scenedetect 0.7.2 (BSD-3, 2026-10-12). hypit-ai/hypit shows 27.5k stars on the GitHub video-editing topic page.

---

## Q1. NLE automation and interchange: how can Claude drive Resolve, Premiere, FCP and the open-source NLEs?

### Takeaway
The best-developed agent-to-NLE route in late 2026 is **DaVinci Resolve Studio plus samuelgursky/davinci-resolve-mcp** (3.9k stars, MIT, about 390 granular tools). **Final Cut Pro** works well through generated FCPXML (fcp-mcp-server on PyPI, MIT, very active). **Premiere Pro** MCPs exist but are community-built and fragile, because CEP is the stable bridge and UXP is still experimental. **OpenTimelineIO** stays the neutral interchange layer between all three.

### Cited Findings
**OpenTimelineIO (OTIO)**
- `opentimelineio` 0.18.1 on PyPI, Apache-2.0, last upload 2025-11-09. The adapters ship as separate packages: `otio-fcpx-xml-adapter` 1.0.0 and `otio-fcp-adapter` 1.0.0 (both last released 2023-07-07, Apache-2.0) and `otio-aaf-adapter` 2.0.0 (2025-11-21). — [PyPI opentimelineio](https://pypi.org/project/opentimelineio/); [PyPI otio-fcpx-xml-adapter](https://pypi.org/project/otio-fcpx-xml-adapter/); [PyPI otio-aaf-adapter](https://pypi.org/project/otio-aaf-adapter/)
- Caveat: the FCPXML and FCP7-XML adapters have had no release since 2023, so test round-trips against current FCPXML versions (1.11+). — same PyPI pages (inference from dates)

**DaVinci Resolve**
- **samuelgursky/davinci-resolve-mcp**: 3.9k stars, MIT, version badge 4.18.4. It offers 37 tools in the default "compound" server and 390 in the granular "full" server, plus an optional Node server with 18 offline tools for `.drp/.drt/.drx` files and the project database that runs without Resolve open. It covers timeline editing (ripple insert, range ops, gap/overlap detection), markers, local transcription, render queue validation, media pool, color, Fusion and Fairlight. It ships `docs/SKILL.md` ("AI Skill Reference"), `CLAUDE.md`/`AGENTS.md` and a `.claude` folder. — [GitHub](https://github.com/samuelgursky/davinci-resolve-mcp)
- Requires Resolve 18.5+ and Python 3.10–3.12. External scripting needs **Studio** (set the preference to "Local"). The free edition only works through an in-app bridge script, which the README calls "a supported-until-it-is-not tier". — [GitHub](https://github.com/samuelgursky/davinci-resolve-mcp)
- The project's release notes say it added the 12 scripting methods introduced in Resolve 20.0–20.2.2, and it was tested on 19.1.3 and 20.3.2 Studio. The PyPI package `davinci-resolve-mcp` 0.1.1 (2025-03-21) is stale or belongs to someone else, so install from GitHub. — [mcpservers.org listing](https://mcpservers.org/en/servers/github-com-samuelgursky-davinci-resolve-mcp); [PyPI](https://pypi.org/project/davinci-resolve-mcp/)
- Alternatives: **lordhoell/davinci-resolve-mcp** claims 440+ tools and a bundled Claude Code skill and needs Resolve 19+. **tooflex/davinci-resolve-mcp** is a stdio server for Claude Desktop. Neither was verified in depth. — [lordhoell](https://github.com/lordhoell/davinci-resolve-mcp); [tooflex](https://github.com/tooflex/davinci-resolve-mcp)
- Resolve 20's built-in AI: **IntelliScript** matches transcribed audio to a script and builds a timeline of the best takes, with alternate takes on extra tracks. Resolve 20 also added **AI Animated Subtitles**, **AI Multicam SmartSwitch** (cuts to whoever is speaking) and **AI Audio Assistant**. Studio costs $295 one-time. — [Yahoo Tech](https://tech.yahoo.com/article/davinci-resolve-20s-latest-ai-feature-can-create-an-entire-timeline-based-on-a-script-120009351.html); [Newsshooter](https://www.newsshooter.com/?p=268330)
- **tmoroney/auto-subs** (AutoSubs): 4.5k stars, MIT (the optional MMS forced-alignment weights are CC BY-NC 4.0). It generates subtitles on-device for **Resolve, Premiere Pro and After Effects**, with a standalone app and CLI. ASR engines include Whisper, Moonshine, Parakeet, SenseVoice, Canary, GigaAM and Omni-ASR. It labels speakers with a roughly 40 MB diarization model. — [GitHub](https://github.com/tmoroney/auto-subs)

**Premiere Pro**
- **hetpatel-11/Adobe_Premiere_Pro_MCP**: claims 283 tools, 13 resources and 10 prompts. Its maintainers say **CEP is the supported production bridge and UXP is experimental**. — [GitHub](https://github.com/hetpatel-11/Adobe_Premiere_Pro_MCP); [search summary via Vagon blog](https://vagon.io/blog/how-to-use-claude-code-with-premiere-pro-mcp-computer-use)
- **morim3/mcp_adobe_premiere**: a FastMCP (Python) server plus a UXP plugin. Needs Premiere Pro Beta 25.3+. — [GitHub](https://github.com/morim3/mcp_adobe_premiere)
- **mikechambers/adb-mcp** ("Adobe Creative Suite MCP"): UXP plugins for Photoshop and Premiere through a proxy server. Needs Premiere Beta 25.3 build 46+. — [Playbooks](https://playbooks.com/mcp/mikechambers-adobe-creative-suite)
- **ab-ishe-k "Premiere Pro MCP"**: a Node server plus a UXP panel, with an HMAC-authenticated WebSocket bound to 127.0.0.1. Needs Premiere 25.6+ and is Windows-only. — [Glama](https://glama.ai/mcp/servers/ab-ishe-k/adobe-premium-pro-mcp/tree)
- Premiere's native AI: Generative Extend and Media Intelligence (natural-language search across footage) became GA in April 2025, along with caption translation into 27 languages. Auto Reframe already existed. I could not confirm a "Premiere Pro 26" release. — [NewscastStudio](https://www.newscaststudio.com/2025/04/03/adobe-brings-generative-extend-media-intelligence-to-premiere-pro); [Business Wire](https://www.businesswire.com/news/home/20250402472642/en)

**Final Cut Pro (FCPXML)**
- **DareDev256/fcp-mcp-server**: `fcp-mcp-server` 0.27.2 on PyPI, MIT, released **2026-10-21** (very active). It lets Claude read, edit and generate FCPXML timelines: cut detection, markers, roles, local Whisper transcription, filler-word removal, transcript-based cuts, silence removal and rough cuts. It groups about 102 operations into 15 tools and installs with one `claude mcp add`. — [GitHub](https://github.com/DareDev256/fcp-mcp-server); [PyPI](https://pypi.org/project/fcp-mcp-server/); [Claude Plugin Hub](https://www.claudepluginhub.com/plugins/daredev256-fcpxml-mcp)
- A "Final Cut Pro FCPXML Generator" Claude Code skill outputs FCPXML 1.8–1.11 (FCP 10.4–10.7+). You supply the media paths. — [MCP Market](https://mcpmarket.com/tools/skills/final-cut-pro-fcpxml-generator)
- **Cutler** (commercial) turns Claude or ChatGPT into an FCP editor that exports validated FCPXML with roles and keywords. Premiere and Resolve XML export is in beta. — [Cutler](https://cutler.miracontents.com/)
- Practitioner report: Claude wrote raw FCPXML with no MCP for a 231-clip project, working from local transcripts and still frames rather than the video files. — [tjsmind](https://tjsmind.com/writing/claude-final-cut-pro)
- **chatcut-to-fcpxml** (AFangTeam) is an Agent Skill that converts a ChatCut timeline to FCPXML with frame-accurate cuts and captions. — [skills listing via search](https://skillsmp.com/creators/madappgang/claude-code/plugins-video-editing-skills-final-cut-pro)

**CapCut / JianYing and other scriptable editors**
- **GuanYixuan/pyJianYingDraft**: about 4.8k stars. A Python library that writes JianYing (CapCut CN) project drafts, so a script or agent can build a project that a human then finishes in CapCut. — [GitHub topic page](https://github.com/topics/video-editing?o=desc&s=stars)
- The video-editing topic page also lists **jub0t/Concat** (about 13.7k stars, a "local-first CapCut alternative scriptable via JSON-RPC and MCP") and **storytold/filmcraft** (about 17.2k stars, a Rust NLE). **[unverified]**: I don't recognize either name and could not cross-check them, so they may be summarizer errors. — [GitHub topic page](https://github.com/topics/video-editing?o=desc&s=stars)
- Programmatic composition libraries: **MoviePy** 2.2.1 (MIT, last release 2025-05-21, about 15.1k stars). **editly** (npm 0.14.2, MIT, last release **2022-12-23**, effectively dormant). — [PyPI moviepy](https://pypi.org/project/moviepy/); [npm editly](https://www.npmjs.com/package/editly); [topic page](https://github.com/topics/video-editing?o=desc&s=stars)
- **OpenShot/openshot-qt**: about 6.7k stars, updated 2026-11-02. It is built on libopenshot, which has a Python API. — [topic page](https://github.com/topics/video-editing?o=desc&s=stars)

### Inferences
- For a creator driving edits from Claude Code, the most robust pattern is: Claude makes the edit decisions as data (an EDL, OTIO or FCPXML), then pushes them into an NLE for human finishing. Resolve MCP and FCPXML are the most mature targets. Premiere is workable but brittle, since Adobe's UXP for Premiere is still maturing.
- Resolve Studio ($295) is effectively required for agent control, because the free edition lacks external scripting.
- A cheap, licence-clean "human-in-the-loop" output is FCPXML or OTIO, which avoids giving an agent live control of an NLE.

### Gaps
- I could not verify current stars or activity for LosslessCut (mifi/lossless-cut, GPL-2.0 per my prior knowledge), Kdenlive, MLT, Shotcut or Olive, because GitHub access was blocked. Olive was alpha and largely stalled as of my training data. Kdenlive and Shotcut project files are MLT XML, which an LLM can generate directly. None of this was re-verified this session.
- No official Adobe or Blackmagic MCP server was found. All the NLE MCPs are community projects.

---

## Q2. Transcript-based editing, filler and silence cutting: which open-source and commercial tools?

### Takeaway
The open-source options are **FunClip** (Alibaba, 6.5k stars, MIT, very active), **mli/autocut** (stable but quiet), **videogrep** (supercut-by-search, non-commercial licence) and fcp-mcp-server (above). For accurate filler cutting, **CrisperWhisper** is the specialist ASR, but its standard weights are **non-commercial**. Descript now has an official **hosted MCP** (open beta), which makes it the strongest commercial transcript editor for Claude.

### Cited Findings
- **modelscope/FunClip**: 6.5k stars, 769 forks, MIT code (model weights carry their own licences; the default Paraformer, SeACo and CAM++ models are Apache-2.0). Release v2.2.1 is dated 2026-09-01, and the repo was updated 2026-11-01. It uses Paraformer-Large ASR with token timestamps, hotword biasing (SeACo), and CAM++ speaker IDs, so you can clip by speaker. You pick transcript segments in a Gradio UI and get the clip plus SRTs. LLM-assisted clipping goes through gateways, and **TwelveLabs Pegasus** can reason over the visuals. Limits: it is Chinese-first (`-l en` switches to English Paraformer), Whisper support for English is "coming soon", and silence removal is still planned. — [GitHub](https://github.com/modelscope/FunClip); [topic page](https://github.com/topics/video-editing?o=desc&s=stars)
- **mli/autocut** (PyPI `autocut-sub`): 1.1.0, Apache-2.0, last release 2024-10-05. You edit a Markdown or SRT transcript to choose which sentences to keep. Low activity. — [PyPI](https://pypi.org/project/autocut-sub/)
- **videogrep** 2.3.0: last release 2024-04-19, licence "Anti-Capitalist" (not OSI-approved, so check before commercial use). It makes supercuts from a search over subtitles or transcripts. — [PyPI](https://pypi.org/project/videogrep/)
- **CrisperWhisper** (nyrahealth): about 1.5k stars. The inference code is MIT, but the **standard weights carry a non-commercial research licence** and the Pro models are commercial-licence only. It has a verbatim mode (fillers, repetitions, stutters) and an "intended" mode, with word-boundary error of about 30 ms (read speech) and 41 ms (conversational). PyPI `crisperwhisper` 2.0.3 was released 2026-09-14. — [GitHub](https://github.com/nyrahealth/CrisperWhisper); [PyPI](https://pypi.org/project/crisperwhisper/)
- **Descript**: API in open beta since **2026-05-14** (import, project creation, running Underlord agent actions). A hosted **MCP at `https://api.descript.com/v2/mcp`** uses OAuth and works with Claude. Calls consume media minutes and AI credits. Descript's engineering post "Don't ship your API as an MCP" explains why the MCP has different defaults from the API. — [Descript help: MCP](https://help.descript.com/api-and-mcp/mcp); [Descript blog](https://www.descript.com/blog/article/dont-ship-your-api-as-an-mcp); [Claude customer story](https://claude.com/ko/customers/descript)
- Resolve IntelliScript does script-to-timeline assembly natively (see Q1). — [Yahoo Tech](https://tech.yahoo.com/article/davinci-resolve-20s-latest-ai-feature-can-create-an-entire-timeline-based-on-a-script-120009351.html)
- **CrabbyCut** (tamphamdesigner92-tb, 4 stars, updated 2026-11-02) matches footage to a script by transcription and builds the timeline automatically. Very early. — [GitHub topic auto-reframe](https://github.com/topics/auto-reframe)

### Inferences
- Filler cutting that pairs CrisperWhisper (verbatim) with auto-editor (silence) is technically best-in-class, but commercial creators need Nyra's commercial licence. WhisperX with prompts, or Parakeet, are licence-clean but tend to drop "um/uh".
- Descript's MCP lets Claude delegate full transcript edits to a hosted NLE. The trade-offs are cloud upload and credit costs.

### Gaps
- I did not find a maintained open-source Descript clone with a full GUI (one that combines a text editor, overdub and timeline). FunClip and autocut are the closest.

---

## Q3. Captioning and animated captions: which ASR engines and renderers?

### Takeaway
ASR is a solved commodity: faster-whisper, whisper.cpp, WhisperX, stable-ts, and **NVIDIA Parakeet TDT v3** for speed. Animated "TikTok-style" captions come from **Remotion's @remotion/captions** (code-driven, very active) or captacity (simple, dormant). Resolve 20 and AutoSubs cover NLE-native captions.

### Cited Findings
- **faster-whisper** 1.2.1: MIT, released 2025-10-31 (CTranslate2 backend). — [PyPI](https://pypi.org/project/faster-whisper/)
- **stable-ts** 2.19.1: MIT, released 2025-08-16. It stabilizes Whisper word timestamps and supports forced alignment of an existing transcript. — [PyPI](https://pypi.org/project/stable-ts/)
- **whisper-timestamped** 1.15.9: **GPLv3**, released 2025-09-09. — [PyPI](https://pypi.org/project/whisper-timestamped/)
- **pywhispercpp** 1.5.1 (MIT, 2026-08-22) provides Python bindings for whisper.cpp. **mlx-whisper** 0.4.3 (MIT, 2025-08-29) runs Whisper on Apple Silicon. **parakeet-mlx** 0.6.0 (Apache-2.0, released 2026-11-02) runs Parakeet on Apple Silicon. — [PyPI pywhispercpp](https://pypi.org/project/pywhispercpp/); [PyPI mlx-whisper](https://pypi.org/project/mlx-whisper/); [PyPI parakeet-mlx](https://pypi.org/project/parakeet-mlx/)
- **NVIDIA Parakeet TDT 0.6B v3**: word- and segment-level timestamps, average WER 6.34% on the HF Open ASR Leaderboard, RTFx about 2940 (batch 128). **The licence is inconsistent across NVIDIA pages**: NGC says CC-BY-4.0, while the build.nvidia.com card says "NVIDIA open model licence". NeMo toolkit 3.0.0 is Apache-2.0 (2026-08-07). — [NGC collection](https://catalog.ngc.nvidia.com/orgs/nvidia/-/collections/parakeet-tdt-0.6b/); [build.nvidia.com card](https://build.nvidia.com/nvidia/parakeet-tdt-0_6b/modelcard); [PyPI nemo_toolkit](https://pypi.org/project/nemo_toolkit/)
- **Remotion**: `@remotion/captions` 4.0.540 (MIT), `@remotion/openai-whisper` 4.0.540 (MIT) and `@remotion/install-whisper-cpp` 4.0.540 ("SEE LICENSE IN LICENSE.md"), all published **2026-11-02**. Remotion's core licence requires a paid company licence for larger organizations, so check LICENSE.md. — [npm @remotion/captions](https://www.npmjs.com/package/@remotion/captions); [npm @remotion/install-whisper-cpp](https://www.npmjs.com/package/@remotion/install-whisper-cpp)
- **captacity** (unconv) 0.3.1: MIT, last release 2024-06-07. It burns word-highlight captions onto video from Python. Dormant. — [PyPI](https://pypi.org/project/captacity/)
- Speaker diarization for multi-speaker captions and podcast cutting: **pyannote.audio** 4.0.7 (released 2026-06-30). Its gated models need an HF token. — [PyPI](https://pypi.org/project/pyannote.audio/)
- AutoSubs adds captions inside Resolve and Premiere with diarization (see Q1). Resolve 20 has native AI Animated Subtitles. — [GitHub auto-subs](https://github.com/tmoroney/auto-subs); [Newsshooter](https://www.newsshooter.com/?p=268330)

### Inferences
- A good Claude-driven caption stack: Parakeet or faster-whisper for ASR, then stable-ts or WhisperX for alignment, then JSON word timings, then Remotion (a React template Claude can write) or ASS subtitles burned in with FFmpeg. Remotion is the most "code-native" option for animated captions.

### Gaps
- I did not verify current pricing or APIs for Submagic or Captions.ai (Mirage). Submagic is believed to have a public API, but this is unconfirmed this session.
- I did not verify whisper.cpp's star count or latest release (GitHub blocked). It is MIT.

---

## Q4. Auto-reframe (16:9 to 9:16) with subject tracking

### Takeaway
Google **AutoFlip is legacy and unsupported** (MediaPipe legacy solutions ended 2023-03-01). Today's pattern is detector plus tracker plus a smoothed virtual camera: YOLO or MediaPipe faces, ByteTrack via supervision, and active-speaker logic. The pattern is packaged in shorts generators like **openshorts**, or in **pyautoflip**. Watch the **AGPL-3.0 on Ultralytics YOLO**.

### Cited Findings
- MediaPipe legacy solutions, including AutoFlip, lost support as of 2023-03-01. The code stays available as-is. — [MediaPipe docs](https://mediapipe.readthedocs.io/en/latest/solutions/solutions.html); original design in [Google Research blog](https://www.research.google/blog/autoflip-an-open-source-framework-for-intelligent-video-reframing/)
- **pyautoflip** (PyPI) is a Python re-implementation "inspired by AutoFlip". It has `pyautoflip reframe -i in.mp4 -o out.mp4`, `--method detection|saliency` (UNISAL saliency) and `--motion-threshold`. Its maintenance and licence are not verified. — [PyPI pyautoflip](https://pypi.org/project/pyautoflip/)
- **ultralytics** 8.4.198 is **AGPL-3.0**, released 2026-11-02, so a commercial closed product needs an Enterprise licence. **roboflow supervision** 0.31.3 is MIT (2026-10-28) and provides ByteTrack tracking, smoothing and annotators. — [PyPI ultralytics](https://pypi.org/project/ultralytics/); [PyPI supervision](https://pypi.org/project/supervision/)
- From the GitHub "auto-reframe" topic: **framesight** (CPU-only CLI that outputs JSON for face tracking, head pose and mouth openness, the signals active-speaker detection needs), **Frametage-Encoder-Autoframer** (reframe plus NVENC HLS), **ClipSmith** (local subject-aware reframe), and **2boysfromtown/2bft-video-editor** (Claude Code skills for face-tracked 16:9→9:16 reframe, captions, pause cuts and QC). All are tiny projects (0–37 stars). — [GitHub topic auto-reframe](https://github.com/topics/auto-reframe)
- **OpenClipper** (GrepCut): MIT, a Tauri desktop app. Its reframe engine adapts AutoFlip-style smart crops per target format. — [GitHub](https://github.com/GrepCut/OpenClipper)

### Inferences
- For talking heads, "face tracking + mouth-openness active speaker + EMA-smoothed crop window" is enough and runs fully MIT if you use MediaPipe faces and supervision rather than Ultralytics. YOLO gives better general subject tracking (sports, products) but brings AGPL.

### Gaps
- No well-starred, actively maintained, standalone open-source reframe library (separate from a whole shorts app) was confirmed. Reframing mostly lives inside clip generators.

---

## Q5. Highlight and clip extraction (OpusClip-like open source)

### Takeaway
The category has grown fast in 2026. **mutonby/openshorts** (about 7.4k stars, updated daily) is the leader. **Anil-matcha/AI-Youtube-Shorts-Generator** (about 5.7k) and **FunClip** follow. **podcli** stands out as a podcast clipper with its own **MCP server**. ClipsAI's library is dormant.

### Cited Findings
- **mutonby/openshorts**: about 7.4k stars, Python, updated 2026-11-02. It turns long videos into vertical shorts with moment detection, face tracking, subtitles and dubbing, and self-hosts via Docker. — [topic auto-reframe](https://github.com/topics/auto-reframe); [topic video-editing](https://github.com/topics/video-editing?o=desc&s=stars)
- **Anil-matcha/AI-Youtube-Shorts-Generator** (formerly under SamurAIGPT): about 5.7k stars, updated 2026-10-24, uses LLM highlight detection. — [topic video-editing](https://github.com/topics/video-editing?o=desc&s=stars)
- **clipsai** 0.2.1: MIT, last release **2024-01-15**, dormant. — [PyPI](https://pypi.org/project/clipsai/)
- **RayVentura/ShortGPT**: about 8.1k stars, last updated 2025-02-10 (stale). — [topic video-editing](https://github.com/topics/video-editing?o=desc&s=stars)
- **nmbrthirteen/podcli**: 81 stars, updated 2026-10-31. Makes vertical podcast clips with face tracking and burned captions, usable via CLI, **MCP server** or web app. — [topic opusclip-alternative](https://github.com/topics/opusclip-alternative)
- **artbyjazi/autoclip**: 221 stars, local-first, speaker-tracked captioned 9:16. **osbytes/reelsaw**: face-tracked shorts with filler cuts. **differentiatorX/hookcut**: uses **Claude** plus YouTube engagement data (most-replayed) to pick moments. **anubhavsanket/viral-clipper**: fully local with Ollama and Gemma 3. — [topic opusclip-alternative](https://github.com/topics/opusclip-alternative)
- **fralapo/clippyme**: self-hosted; uses Gemini for viral-moment detection, Faster-Whisper, PySceneDetect, YOLO, MediaPipe, auto-editor and FFmpeg, with TikTok, Reels and Shorts scheduling. **paragbml/open-clip-studio**: MIT, four reframing modes, split-screen for two speakers. — [clippyme](https://github.com/fralapo/clippyme); [open-clip-studio](https://github.com/paragbml/open-clip-studio)
- **TheNoumanDev/zero-dollar-studio**: Claude Code skills for a zero-cost YouTube pipeline, including a shorts generator. — [topic opusclip-alternative](https://github.com/topics/opusclip-alternative)

### Inferences
- Most of these repos are the same stack in different wrappers: yt-dlp, Whisper, an LLM scoring transcript chunks, face tracking, an FFmpeg crop, and burned captions. For a Claude Code workflow, building that stack yourself as skills (or using podcli's MCP) gives more control than adopting a full app.
- Using real engagement signals, such as YouTube's "most replayed" heatmap as in hookcut, is an underused and powerful way to pick highlights.

### Gaps
- I could not confirm licences for openshorts or AI-Youtube-Shorts-Generator (GitHub blocked).

---

## Q6. MCP servers, APIs and video understanding for edit decisions and B-roll matching

### Takeaway
For Claude, the strongest video-understanding plug-ins are the **Twelve Labs official MCP** (Marengo search plus Pegasus reasoning), **VideoDB** (Director agent framework under MIT, with an MCP) and **Gemini's video API**, which reads video natively with MM:SS timestamps, so it can log shots. For local FFmpeg operations, **mcp-video** (KyaniteLabs, Apache-2.0, very active) is the most complete FFmpeg MCP.

### Cited Findings
**FFmpeg/editing MCP servers**
- **KyaniteLabs/mcp-video** (PyPI `mcp-video` 1.6.20, Apache-2.0, released 2026-10-27, homepage kinocut.dev): structured FFmpeg editing, subtitles, audio, effects and media analysis. Runs with `uvx mcp-video`. — [PyPI](https://pypi.org/project/mcp-video/); [mcpservers.org](https://mcpservers.org/es/servers/kyanitelabs/mcp-video)
- **PedroMarianoAlmeida/ffmpeg-mcp** (npm `ffmpeg-mcp-server` 1.0.4, MIT, 2026-10-18): cut, concatenate, images to video, silence detection and removal, raw FFmpeg passthrough. — [npm](https://www.npmjs.com/package/ffmpeg-mcp-server); [Enterprise DNA](https://enterprisedna.co/directories/mcp/video-creator-ffmpeg-mcp)
- **video-creator/ffmpeg-mcp** (PyPI 0.1.2, 2025-04-01, about 134 stars per a directory, MIT): trim, stitch, overlay, play. Low activity. — [PyPI](https://pypi.org/project/ffmpeg-mcp/)
- **kajisho5/ffmpeg-skill**: about 4.3k stars, "local FFmpeg tools with an MCP server for coding agents". **[unverified]**: listed on the GitHub topic page but not cross-checked. — [topic video-editing](https://github.com/topics/video-editing?o=desc&s=stars)
- Smaller ones: kush36agrawal video-editor (about 31 stars) and video-edit-mcp (about 22 stars). — [Playbooks](https://playbooks.com/mcp/kush36agrawal-video-editor)

**Video understanding**
- **Twelve Labs MCP** (official): exposes indexing, semantic search (Marengo embeddings), and summaries and Q&A (Pegasus) as MCP tools. Its docs name Claude Code as a supported client. The old endpoint `mcp.twelvelabs.io/try` was due for retirement on 2026-07-15, with `mcp-alpic.twelvelabs.io/try` as the replacement. PyPI `twelvelabs` SDK 1.3.6 was released 2026-10-06. — [Twelve Labs blog](https://www.twelvelabs.io/blog/twelve-labs-mcp-server); [docs](https://docs.twelvelabs.io/docs/advanced/model-context-protocol); [PyPI](https://pypi.org/project/twelvelabs/)
- **VideoDB**: Director is an open-source (MIT) backend and frontend for video agents, covering upload, summary, search, dubbing, branding, dynamic editing and clipping, and results stream back. Third-party directories list a `videodb-director-mcp` (runs via uvx, needs an API key). Python SDK `videodb` 0.5.1 is Apache-2.0 (2026-07-24). — [VideoDB docs](https://docs.videodb.io/pages/build-with-agents/director); [GitHub Director](https://github.com/video-db/Director); [mcp.so](https://mcp.so/servers/modelcontextprotocol-video-db); [PyPI videodb](https://pypi.org/project/videodb/)
- **Gemini API video understanding**: you can prompt about MM:SS timestamps. Default sampling is 1 fps and custom fps is supported. Public YouTube URLs can be passed directly: 8 hours per day on the free tier, and up to 10 videos per request on 2.5+ models. Community Claude Code skills ("gemini-video-understanding") wrap it. — [Gemini docs](https://ai.google.dev/gemini-api/docs/interactions/video-understanding?authuser=0); [Smithery skill](https://smithery.ai/skills/einverne/gemini-video-understanding)

**Commercial clip and caption tools (brief)**
- Premiere Media Intelligence does natural-language footage search. Resolve IntelliScript and SmartSwitch handle script assembly and multicam (see Q1). Descript's MCP covers hosted transcript editing (see Q2). — sources above

### Inferences
- **B-roll matching recipe**: index A-roll and B-roll with Twelve Labs Marengo or VideoDB (or local CLIP and Qwen-VL embeddings). Have Claude pull nouns and topics from the A-roll transcript, run semantic search over the B-roll index, and write matches as cutaways into OTIO or FCPXML on track V2. This uses only tools verified above.
- **Shot logging**: Gemini (cheap, long context, timestamps) or Twelve Labs Pegasus can produce per-shot JSON logs, which Claude then uses to plan edits. Open alternatives (Qwen3-VL, VideoLLaMA3) work locally but take more setup.

### Gaps
- I did not verify Shotstack, Kapwing API, Creatomate or Rendi pricing and features this session. Shotstack's npm SDK name did not resolve.
- Qwen3-VL and VideoLLaMA3 licences, stars and video-timestamp quality were not verified (GitHub blocked). Qwen models are generally Apache-2.0, but some sizes have had different licences in the past, so check each model card.
- Google Cloud Video Intelligence API status in 2026 was not checked.
- I did not independently confirm the burningion/video-editing-mcp (Video Jungle) and misbahsy/video-audio-mcp repos named in the brief. `video-audio-mcp` is not on PyPI.
