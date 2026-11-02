# Audio Tools for Video Creators + MCP Servers / Claude Skills for Creative Tools (as of 2 Nov 2026)

Method note: Each GitHub repo listed as "verified" was shallow-cloned on 2026-11-02. That confirmed the repo exists, its last commit date, and the first line of its LICENSE file, and in several cases a README excerpt. The GitHub API was blocked in this session, so star counts come only from third-party pages and are flagged as such. Some descriptive details below come from prior knowledge and are marked "(prior knowledge, not re-verified)". The report writer should treat those as background, not as cited fact.

Already covered elsewhere, mentioned briefly here: Demucs (Meta's stem separation; last code push long ago, still the default 4-stem baseline); Chatterbox (Resemble AI TTS); VoiceStudio; WhisperX (word-level-aligned ASR, used for captions and lip-sync timing).

---

## A1. Stem separation, music generation and SFX / foley generation: what's current, how good, and what licenses

### Takeaway
For stem separation, the practical stack is `python-audio-separator` (CLI/library around UVR models) with the RoFormer-family checkpoints trained through ZFTurbo's MSST repo. All three are MIT and actively maintained. In music generation, ACE-Step 1.5 (MIT) is the strongest permissively licensed open model. Suno and Udio are now in a post-settlement "licensed walled garden" phase with download caps, which makes them weaker for pipelines. Most open video-to-audio foley models (MMAudio, HunyuanVideo-Foley, ThinkSound) are effectively non-commercial despite permissive-looking code licenses. That is the biggest license trap in this area.

### Cited Findings
**Stem separation**
- `python-audio-separator` (nomadkaraoke): "Easy to use audio stem separation from the command line or as a dependency in your own Python project, using the amazing MDX-Net, VR Arch, Demucs and MDXC models available in UVR". It handles vocals/instrumental and also drums, bass, piano and guitar, plus denoise and de-echo/de-reverb. It runs PTH or ONNX models, with MPS/CoreML acceleration on macOS. MIT license, last commit 2026-10-29 (verified). — [GitHub nomadkaraoke/python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator)
- Ultimate Vocal Remover GUI (Anjok07) is still active, with its last commit on 2026-10-06 (verified; LICENSE first line could not be parsed). — [GitHub Anjok07/ultimatevocalremovergui](https://github.com/Anjok07/ultimatevocalremovergui)
- ZFTurbo `Music-Source-Separation-Training` is the training/inference repo where most BS-RoFormer / Mel-RoFormer / SCNet community checkpoints originate. MIT license, last commit 2026-10-30 (verified). — [GitHub ZFTurbo/Music-Source-Separation-Training](https://github.com/ZFTurbo/Music-Source-Separation-Training)
- (prior knowledge, not re-verified) BS-RoFormer (ByteDance, band-split RoPE transformer) and Mel-RoFormer won or led the Sound Demixing Challenge 2023 and are the current SOTA family for vocal and instrumental separation. MVSEP.com is a web service and leaderboard that hosts these models plus ensembles, with per-model SDR tables. The search for MVSEP/SDR figures returned nothing this session.

**Music generation**
- ACE-Step 1.5: MIT license, last commit 2026-08-29 (verified). The HF model card states generated music can be used commercially. AMD's Feb 2026 blog calls it "commercial-grade" and says the project claims training on royalty-free / non-copyrighted material (a project claim, not independently verified). — [GitHub ace-step/ACE-Step-1.5](https://github.com/ace-step/ACE-Step-1.5); [HF acestep-v15-base README](https://huggingface.co/ACE-Step/acestep-v15-base/blob/main/README.md); [AMD blog](https://www.amd.com/en/blogs/2026/commercial-grade-ai-music-generation-on-amd-ryzen-ai-and-radeon-ace-step-1-5.html). ComfyUI Wiki lists Apache-2.0 instead, which conflicts with the repo's MIT LICENSE. — [ComfyUI Wiki](https://comfyui-wiki.com/en/models/ace-step/ace-step-v1-5)
- YuE (lyrics-to-full-song): Apache-2.0, very active (last commit 2026-11-01, verified). — [GitHub multimodal-art-projection/YuE](https://github.com/multimodal-art-projection/YuE)
- DiffRhythm (ASLP-lab, diffusion full-song generation): Apache-2.0, last commit 2025-11-27 (verified; slowing). — [GitHub ASLP-lab/DiffRhythm](https://github.com/ASLP-lab/DiffRhythm)
- AudioCraft / MusicGen (Meta): code is MIT, last commit 2025-03-13 (verified, effectively in maintenance). (Prior knowledge: MusicGen weights are CC-BY-NC 4.0, so they are non-commercial.) — [GitHub facebookresearch/audiocraft](https://github.com/facebookresearch/audiocraft)
- Stable Audio: `stable-audio-tools` was last updated 2026-05-26 (verified). — [GitHub Stability-AI/stable-audio-tools](https://github.com/Stability-AI/stable-audio-tools). Stable Audio Open 1.0 is under the Stability AI Community License, not fully open-commercial. — [DeepLearning.AI](https://charonhub.deeplearning.ai/stability-ai-releases-enhanced-text-to-audio-generator-stable-audio-open/). A newer **Stable Audio 3.0** family (Small SFX, Small, Medium open weights; Large API-only) was reported alongside label partnerships with UMG and WMG. I did not find the license text. — [Decrypt](https://decrypt.co/369237/elevenlabs-stability-ai-new-music-models?amp=1)
- ElevenLabs Music v2: free for ElevenMusic users, with commercial tiers through ElevenCreative/ElevenAPI. — [Decrypt](https://decrypt.co/369237/elevenlabs-stability-ai-new-music-models?amp=1)
- Suno: settled with Warner in Nov 2025 and committed to launching licensed models in 2026 and deprecating its current ones. — [Music Business Worldwide](https://www.musicbusinessworldwide.com/warner-music-group-settles-with-suno-strikes-first-of-its-kind-deal-with-ai-song-generator/). The licensed models were reported launched around 10 Sep 2026: free-tier songs are play/share only, and paid tiers get monthly download allowances with paid top-ups. — [ProPakistani](https://propakistani.pk/2026/09/10/suno-launches-licensed-ai-music-models-after-warner-copyright-settlement/). Reported caps from 3 Sep 2026: free 7 tracks total, Pro 20/month, Premier 60/month. — [ForkLog](https://forklog.com/en/suno-imposes-music-download-limits-amid-legal-and-content-concerns/). TNW reports Suno v6 trained on licensed Warner/BMG/Believe catalogue. — [The Next Web](https://thenextweb.com/news/suno-v6-warner-bmg-believe-licensed-models)
- Udio: settled with UMG (Oct 2025) and Warner, and is building a licensed "walled garden" platform. Downloads of audio, video and stems have been disabled on all plans since 29 Oct 2025 (still the case as of Sep 2026 per a secondary source). — [Billboard](https://www.billboard.com/pro/what-suno-udio-licensing-deals-mean-future-ai-music/); [Undetectr](https://undetectr.com/blog/udio-review-2026). Sony has not signed with either, per a secondary source. — [songcreator.pro](https://songcreator.pro/blog/suno-vs-udio)
- Suno/UMG status conflicts. One source reports an impasse in April 2026 and another claims a joint platform. — [OpusClip blog](https://www.opus.pro/blog/ai-music-news-april-2026); contradicted by [Undetectr](https://undetectr.com/blog/suno-udio-licensing-deals-explained)

**SFX / video-to-audio foley**
- MMAudio (hkchengrex): code is MIT, but **checkpoints are CC-BY-NC 4.0**. The authors "do not guarantee that the pre-trained models are suitable for commercial use". Last commit 2026-02-23 (verified). — [GitHub hkchengrex/MMAudio](https://github.com/hkchengrex/MMAudio)
- HunyuanVideo-Foley (Tencent): Tencent Hunyuan Community License. The license "DOES NOT APPLY IN THE EUROPEAN UNION, UNITED KINGDOM AND SOUTH KOREA", and organisations above 100M MAU need a separate license. Last commit 2025-09-29 (verified). — [GitHub Tencent-Hunyuan/HunyuanVideo-Foley](https://github.com/Tencent-Hunyuan/HunyuanVideo-Foley). Replicate's hosted version is labelled "Research & Non-commercial use only". — [Replicate](https://replicate.com/tencent/hunyuanvideo-foley)
- ThinkSound (FunAudioLLM, chain-of-thought V2A): the README says "released under the Apache 2.0 License" and also "**Commercial use is NOT permitted**", and it bundles a Stable Audio Open VAE under the Stability AI Community License. Last commit 2026-03-24 (verified). — [GitHub FunAudioLLM/ThinkSound](https://github.com/FunAudioLLM/ThinkSound)
- ElevenLabs SFX is reachable through the ElevenLabs MCP (example prompt "Create a soundscape of a thunderstorm in a dense jungle…"). — [GitHub elevenlabs/elevenlabs-mcp](https://github.com/elevenlabs/elevenlabs-mcp)

### Inferences
- For a commercial code-driven video pipeline, the safe open defaults are audio-separator plus RoFormer checkpoints (check each checkpoint's own license) for stems, ACE-Step 1.5 for music, and ElevenLabs or Stable Audio API for SFX. MMAudio, HunyuanVideo-Foley and ThinkSound are best for prototyping or personal use.
- Suno and Udio are poor fits for automated pipelines now. Download caps and walled gardens break "generate → download → mux" loops, and model deprecations mean outputs aren't reproducible.
- ThinkSound shows an "Apache-2.0 code + non-commercial use" contradiction. Agents and users should read README license notes, not just the SPDX badge.

### Gaps
- No current SDR numbers for BS-RoFormer / Mel-RoFormer / MVSEP ensembles were found this session. The MVSEP leaderboard should be checked directly.
- Stable Audio 3.0 license text was not found. The ElevenLabs Music output commercial terms were not found either.
- AudioLDM2 status and license were not researched this session.
- Suno's licensed-model naming (v5.5 vs v6) and exact caps come from secondary blogs and conflict in places. Official Suno help pages were not fetched.

---

## A2. Beat/onset/structure analysis, TTS/voice, cleanup/loudness and DAW automation

### Takeaway
For beat-synced editing, `beat_this` (CPJKU, MIT, active) is the modern beat/downbeat tracker. madmom and Essentia carry non-commercial or AGPL obligations, and `allin1` (structure analysis) has not been updated since 2023. On the TTS side, permissive leaders are Kokoro (Apache), Dia, Orpheus, CSM (Apache), VibeVoice (MIT repo, but Microsoft pulled long-form TTS code over misuse) and F5-TTS. Fish Speech/OpenAudio and IndexTTS2 have custom licenses with revenue or MAU thresholds. Spotify Pedalboard is the best Python FX engine but is GPL-3.0.

### Cited Findings
**Beat / onset / structure**
- `beat_this` (CPJKU): MIT, last commit 2026-05-28 (verified). (Prior knowledge: ISMIR 2024 transformer beat+downbeat tracker without DBN post-processing, which outperforms madmom on most benchmarks.) — [GitHub CPJKU/beat_this](https://github.com/CPJKU/beat_this)
- madmom: last commit 2024-08-25 (verified, dormant). Its LICENSE separates source code from data/model files, and the model files are **CC BY-NC-SA 4.0 ("You must not use the material for commercial purposes")**. — [GitHub CPJKU/madmom](https://github.com/CPJKU/madmom)
- Essentia (MTG): **AGPL-3.0** (COPYING.txt) plus a separate "Essentia Licensing.txt" (commercial licensing available), and it is active (last commit 2026-10-22, verified). — [GitHub MTG/essentia](https://github.com/MTG/essentia)
- aubio: GPL, last commit 2026-04-10 (verified). — [GitHub aubio/aubio](https://github.com/aubio/aubio)
- `all-in-one` (mir-aidj; beats, downbeats, tempo, and functional segments such as intro/verse/chorus): MIT, but last commit 2023-10-10 (verified, stale; dependency rot likely). — [GitHub mir-aidj/all-in-one](https://github.com/mir-aidj/all-in-one)
- (prior knowledge, not re-verified) librosa (ISC) is the default for onset_detect/beat_track/RMS envelopes. Remotion ships `@remotion/media-utils` (`useAudioData`, `visualizeAudio`) for audio-reactive visuals. The `remotion-multimedia` agent skill covers media metadata. — [GitHub remotion-dev/skills](https://github.com/remotion-dev/skills)

**TTS / voice**
- Kokoro (hexgrad, 82M): Apache-2.0, last commit 2025-08-06 (verified). — [GitHub hexgrad/kokoro](https://github.com/hexgrad/kokoro)
- F5-TTS: the code repo is MIT, last commit 2026-10-24 (verified). (Prior knowledge: the pretrained weights are CC-BY-NC because of the Emilia dataset.) — [GitHub SWivid/F5-TTS](https://github.com/SWivid/F5-TTS)
- Fish Speech / OpenAudio: under the **Fish Audio Community License**. Research and non-commercial use is free, and "limited uses for a Commercial Purpose by Licensees whose Annual Revenue is less than the Revenue Threshold" are allowed. Other commercial use **and any Hosted Service** require a separate written license. Last commit 2026-10-30 (verified). — [GitHub fishaudio/fish-speech](https://github.com/fishaudio/fish-speech). The S1-mini HF card has been reported as CC-BY-NC-SA-4.0, so sources conflict. — [HF mirror](https://huggingface.co/cocktailpeanut/oa)
- Dia (Nari Labs, dialogue TTS): Apache-2.0, last commit 2025-11-19 (verified). — [GitHub nari-labs/dia](https://github.com/nari-labs/dia)
- Orpheus TTS (Canopy): Apache-2.0, last commit 2025-12-05 (verified). — [GitHub canopyai/Orpheus-TTS](https://github.com/canopyai/Orpheus-TTS)
- Sesame CSM: Apache-2.0, last commit 2025-05-27 (verified, dormant). — [GitHub SesameAILabs/csm](https://github.com/SesameAILabs/csm)
- IndexTTS2 (bilibili; emotion and duration control, which helps dubbing to fit a video length): **bilibili Model Use License**. A separate license is needed if you exceed 100M MAU or RMB 1B annual revenue, and you may not use it to improve other (commercial) AI models. Last commit 2026-09-30 (verified). — [GitHub index-tts/index-tts](https://github.com/index-tts/index-tts)
- VibeVoice (Microsoft, long-form multi-speaker): the repo is MIT, last commit 2026-10-08 (verified). Microsoft removed the original long-form TTS inference code on 5 Sep 2025 over responsible-AI and misuse concerns. Weights stayed on HF, community forks keep the code, and Microsoft later shipped a real-time 0.5B TTS and an ASR model. — [GitHub microsoft/VibeVoice](https://github.com/microsoft/VibeVoice); [windowsnews.ai](https://windowsnews.ai/article/microsoft-pulls-vibevoice-tts-code-after-misuse-shifts-to-open-source-asr-and-real-time-models.378734)
- ElevenLabs is reachable from Claude through its MCP, which covers TTS, voice design, voice conversion, STT with diarization, audio isolation and SFX. Credits are required. — [GitHub elevenlabs/elevenlabs-mcp](https://github.com/elevenlabs/elevenlabs-mcp)

**Cleanup / loudness**
- DeepFilterNet: last commit 2024-10-17 (verified, dormant). — [GitHub Rikorose/DeepFilterNet](https://github.com/Rikorose/DeepFilterNet)
- Resemble Enhance: MIT, last commit 2024-12-03 (verified, dormant). — [GitHub resemble-ai/resemble-enhance](https://github.com/resemble-ai/resemble-enhance)
- ffmpeg-normalize: active (last commit 2026-10-14, verified). (Prior knowledge: MIT; it wraps ffmpeg's `loudnorm` EBU R128 two-pass filter. Typical targets are about -14 LUFS for YouTube and streaming and -23 LUFS for EBU broadcast.) — [GitHub slhck/ffmpeg-normalize](https://github.com/slhck/ffmpeg-normalize)

**DAW / FX automation**
- Pedalboard (Spotify): **GPL-3.0**, active (last commit 2026-10-07, verified). (Prior knowledge: it loads VST3/AU plugins and offers built-in compressor, reverb, EQ and limiter from Python.) — [GitHub spotify/pedalboard](https://github.com/spotify/pedalboard)
- REAPER MCP (`shiehn/total-reaper-mcp`): MIT, last commit 2026-08-03. It uses a Lua bridge inside REAPER and file-based IPC to a Python MCP server. Tool profiles are `dsl` (15 tools), `dsl-production` default (53), `groq-essential` (146) and `full` (600+). Developed on macOS, and the socket bridge is unfinished. — [GitHub shiehn/total-reaper-mcp](https://github.com/shiehn/total-reaper-mcp)
- Ableton MCP (`ahujasid/ableton-mcp`): MIT, last commit 2026-09-22 (verified). — [GitHub ahujasid/ableton-mcp](https://github.com/ahujasid/ableton-mcp)

### Inferences
- A good beat-sync recipe for Remotion or HyperFrames is to run `beat_this` (MIT) to get a beats/downbeats JSON and feed it into frame timing. allin1's segment labels are tempting, but expect install friction.
- Pedalboard's and Essentia's copyleft licenses matter only when you distribute software. Running them in a private render pipeline is generally fine, but this should be flagged for anyone shipping a product.
- The REAPER MCP's tool-profile design (15 to 600+ tools) is a useful pattern. Giant tool surfaces degrade LLM tool selection, so small, task-focused profiles are preferable.

### Gaps
- Exact current license status of the Kokoro, F5-TTS, Dia and Orpheus *weights* (as distinct from code) was not re-verified on HF this session.
- ElevenLabs v3 feature and pricing details and Adobe Podcast Enhance API availability were not researched.
- SoX maintenance status was not checked.

---

## B1. MCP servers connecting Claude to creative video/audio/3D tools

### Takeaway
Creative MCP split into two tiers in 2026. Tier one is **official hosted connectors**: Anthropic's nine creative connectors (28 Apr 2026: Adobe, Blender, Ableton, Splice, Autodesk Fusion, SketchUp, Affinity by Canva, Resolume Arena/Wire), plus Figma, Canva, ElevenLabs and fal hosted MCPs. Tier two is **community local bridges** that drive desktop apps over sockets, many of which expose arbitrary-code-execution tools. The community bridges are often more capable (e.g. DaVinci Resolve with 390 tools, Unity at v10) but carry real security risk, illustrated by two 2026 CVEs in blender-mcp.

### Cited Findings
**Anthropic creative connectors (official)**
- On 28 Apr 2026 Anthropic launched nine creative connectors: Adobe (50+ Creative Cloud tools), Blender, Ableton, Splice, Autodesk Fusion, SketchUp, Affinity by Canva, Resolume Arena, Resolume Wire. — [IT Brief UK](https://itbrief.co.uk/story/anthropic-links-claude-to-adobe-blender-ableton); [RedShark News](https://www.redsharknews.com/anthropic-claude-creative-connectors-adobe-blender-autodesk); primary post reportedly at anthropic.com/news/claude-for-creative-work (not opened)
- The Blender connector gives natural-language access to the Blender Python API (scene analysis, batch edits, custom tools) and was reportedly built by Blender developers. The Ableton connector is described by one source as education/documentation-grounded, unlike the community ableton-mcp, which drives Live directly. — [letsdatascience](https://letsdatascience.com/news/anthropic-connects-claude-to-photoshop-blender-and-ableton-07f24586); [noqta.tn](https://noqta.tn/en/news/anthropic-claude-creative-connectors-blender-adobe-2026)
- Adobe for creativity is a hosted remote MCP (`claude mcp add adobe-creativity --transport http https://adobe-creativity.adobe.io/mcp`) covering Photoshop, Illustrator, Firefly, Express, Premiere, Lightroom, InDesign and Stock. — [Adobe blog, 28 Apr 2026](https://blog.adobe.com/en/publish/2026/04/28/adobe-for-creativity-connector); [mcpservers.org](https://mcpservers.org/servers/adobe-creativity-mcp). Reviewers say it operates closer to Express/Firefly-level capability than to full desktop Photoshop or Premiere control. — [MindStudio](https://www.mindstudio.ai/blog/claude-mcp-adobe-vs-photoshop-premiere-what-it-does)

**3D / game engines**
- Blender MCP (ahujasid): MIT, last commit 2026-10-29 (verified). The PyPI package was renamed `mcp-for-blender`, though `uvx blender-mcp` still works. There is a one-line installer (`curl … mcp-for-blender.com/install.sh | sh`) that auto-configures Claude Desktop, Claude Code, Cursor, Codex and others, and a "Premium" tier exists. The README says to run only one server instance. — [GitHub ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp). Its tools include get_scene_info, create/modify/delete_object, set_material and execute_blender_code. Stars are about 32.7k as of 30 Oct 2026 per a single wiki source. — [aiwiki.ai](https://aiwiki.ai/wiki/blender_mcp)
- **Security:** CVE-2026-10688 is code injection leading to RCE via `execute_blender_code`; at disclosure the project had not responded. CVE-2026-10661 is injection in the `input_image_url` handling, fixed at commit 5b37be2. Suggested mitigations are to disable execute_blender_code, sandbox with no egress, and require human approval for code calls. — [NVD CVE-2026-10688](https://nvd.nist.gov/vuln/detail/CVE-2026-10688); [SentinelOne CVE-2026-10661](https://www.sentinelone.com/vulnerability-database/cve-2026-10661/)
- Unity MCP (CoplayDev "MCP for Unity"): MIT, v10.3.0 (2026-10-04), last commit 2026-10-30 (verified). It provides about 50 focused tools for scenes, GameObjects, C# script editing, assets, tests, profiling and builds. It also has tool groups (vfx/animation/ui/testing), multi-instance routing, Roslyn script validation, and a remote-hosted server with auth. Supports Unity 2021.3 LTS to 6.x and is sponsored by Aura. — [GitHub CoplayDev/unity-mcp](https://github.com/CoplayDev/unity-mcp)
- Alternative Unity MCP (IvanMurzak/Unity-MCP): Apache-2.0, last commit 2026-10-31 (verified). — [GitHub IvanMurzak/Unity-MCP](https://github.com/IvanMurzak/Unity-MCP)
- Unreal MCP (chongdashu): marked "EXPERIMENTAL", "Production use is not recommended", last commit **2025-04-22** (verified, stale). It is a C++ plugin TCP server on port 55557 plus a Python FastMCP server, with actor CRUD and transforms, Blueprint class/component creation, Blueprint node-graph wiring, and viewport control. Requires UE 5.5+. — [GitHub chongdashu/unreal-mcp](https://github.com/chongdashu/unreal-mcp)
- Godot MCP (Coding-Solo): MIT, last commit 2026-04-16 (verified). It launches the editor, runs projects in debug, captures debug output, does scene management and UID management (4.4+), and uses the Godot CLI plus a bundled `godot_operations.gd`. — [GitHub Coding-Solo/godot-mcp](https://github.com/Coding-Solo/godot-mcp)
- TouchDesigner MCP (8beeeaaat): MIT, last commit 2026-10-31 (verified), npm `touchdesigner-mcp-server`. It creates, modifies and deletes nodes, queries project structure, and runs Python in TD. Tools include `describe_td_tools` and `get_td_node_errors`. Version compatibility is enforced between the npm server and the `.tox` API version. — [GitHub 8beeeaaat/touchdesigner-mcp](https://github.com/8beeeaaat/touchdesigner-mcp)

**Video editing / compositing**
- DaVinci Resolve MCP (samuelgursky): MIT, v4.18.4, last commit 2026-11-01 (verified, very active). It has a compound mode with 37 tools (recommended) and a full granular mode with 390 tools (one per Resolve API method). An optional Node "advanced" server with 18 tools reads and edits `.drp/.drt/.drx` files offline with no Resolve running, including grading/QC catalogs and provenance reports. Key caveat: **Resolve 21.1 moved Python scripting to Studio**, so the free edition needs an in-app bridge script over an authenticated loopback listener. There is also a loopback control panel with a per-launch token. — [GitHub samuelgursky/davinci-resolve-mcp](https://github.com/samuelgursky/davinci-resolve-mcp)
- adb-mcp (Mike Chambers, an Adobe employee, but a proof-of-concept): MIT, last commit 2026-07-08 (verified). Separate MCP servers cover Photoshop, Premiere Pro, InDesign, After Effects and Illustrator. The path is MCP server → Node command proxy → UXP plugin → app, and requires Photoshop 26+ / Premiere Beta 25.3+. — [GitHub mikechambers/adb-mcp](https://github.com/mikechambers/adb-mcp)
- FFmpeg MCP (misbahsy/video-audio-mcp): MIT, last commit 2025-05-24 (verified, stale). It provides about 30 tools, among them trim, concat with transitions, B-roll insertion, silence removal, subtitle burn-in, overlays, and codec/bitrate/frame-rate changes. — [GitHub misbahsy/video-audio-mcp](https://github.com/misbahsy/video-audio-mcp)
- OBS MCP (royshil): GPL, last commit 2025-08-26 (verified). Uses OBS WebSocket (OBS 31+) with tools for scenes, sources, audio levels, streaming/recording/virtual cam and transitions. — [GitHub royshil/obs-mcp](https://github.com/royshil/obs-mcp)
- yt-dlp MCP (kevinwatt): active, last commit 2026-10-29 (verified). — [GitHub kevinwatt/yt-dlp-mcp](https://github.com/kevinwatt/yt-dlp-mcp)
- VideoDB agent-toolkit: last commit 2026-03-13 (verified). — [GitHub video-db/agent-toolkit](https://github.com/video-db/agent-toolkit)

**Generative / media APIs**
- ComfyUI MCP (joenorton/comfyui-mcp-server): Apache-2.0, last commit 2026-02-17 (verified). It runs over streamable HTTP. Tools include `generate_image`, `get_job`, `get_queue_status`, `cancel_job`, `regenerate` (replay with overrides) and `view_image` (agent visual feedback), and workflows are JSON files in `workflows/`. — [GitHub joenorton/comfyui-mcp-server](https://github.com/joenorton/comfyui-mcp-server)
- ElevenLabs MCP: the local server (MIT, last commit 2026-08-20) is now **deprecated in favor of the hosted MCP at `https://api.elevenlabs.io/v1/mcp` with OAuth** (no API keys in config). In the local server, `ELEVENLABS_MCP_BASE_PATH` is the file security boundary, and output modes are files, resources or both. — [GitHub elevenlabs/elevenlabs-mcp](https://github.com/elevenlabs/elevenlabs-mcp)
- fal.ai: official hosted MCP at `mcp.fal.ai/mcp` (Bearer token for Claude Code). It does not yet support OAuth for Claude Desktop/claude.ai custom connectors, and a separate docs MCP lives at docs.fal.ai/mcp. — [fal docs](https://fal.ai/docs/documentation/setting-up/mcp)
- Replicate: only the community `deepfates/mcp-replicate` was verified (last commit 2025-09-24). `replicate/replicate-mcp-server` did not resolve. — [GitHub deepfates/mcp-replicate](https://github.com/deepfates/mcp-replicate)

**Design**
- Figma MCP: remote server at `https://mcp.figma.com/mcp` (`claude mcp add --transport http figma-remote-mcp https://mcp.figma.com/mcp`, then auth via `/mcp`), available on all seats and plans. A full or Dev seat avoids usage limits. — [Figma Help](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server)
- Canva: a hosted design MCP at `https://mcp.canva.com/mcp` (OAuth; designs, assets, exports, comments), per a third-party directory, and a separate local Dev MCP (`npx -y @canva/cli@latest mcp`) for app development. — [Canva dev docs](https://canva.dev/docs/connect/mcp-server); [mcpservers.org](https://mcpservers.org/remote-mcp-servers/canva)

### Inferences
- Prefer official hosted connectors (Adobe, Figma, Canva, ElevenLabs, fal, Anthropic's Blender connector) for OAuth, no local secrets, and vendor maintenance. Use community bridges when you need deep desktop control: Resolve timelines, Unity editor, TouchDesigner networks, REAPER.
- Many community creative MCPs expose a raw "execute code" tool (Blender `execute_blender_code`, TouchDesigner Python, Resolve full mode, Unity script editing). Combined with prompt injection from untrusted inputs (downloaded assets, web text, image URLs), that gives local RCE. Recommended practice is to pin versions, keep Claude Code permission prompts on for those tools, disable code-exec tools where possible, run in a VM or container, and avoid `curl | sh` installers without reading them.
- Several "named" servers are stale (unreal-mcp Apr 2025, video-audio-mcp May 2025, obs-mcp Aug 2025). For FFmpeg in particular, letting Claude Code call `ffmpeg` directly via Bash is often more robust than an MCP wrapper.

### Gaps
- A Kdenlive MCP was not found. Several guessed repo names failed to resolve and search returned nothing.
- No dedicated After Effects-only or Photoshop-only community MCP was verified beyond adb-mcp. Premiere-specific community repos were not verified.
- Star counts for most repos were unavailable (GitHub API blocked), and only blender-mcp has a third-party figure.
- The Anthropic primary announcement and Blender's own announcement were not opened. Whether the official Blender connector supersedes ahujasid's project is unclear.
- Whether the CVE-2026-10688 execute_blender_code issue is fixed in the 2026-10-29 HEAD was not checked.

---

## B2. Claude skills, plugins and registries for video/creative work

### Takeaway
The most important creative skills are vendor-maintained. **Remotion Agent Skills** (`npx skills add remotion-dev/skills`, 13 skills) and **HyperFrames** (HeyGen, Apache-2.0, installable as a Claude Code plugin with a ~450-block registry and a `/media-use` skill for music, SFX and voiceover) are both updated daily. Discovery runs through Vercel's skills.sh / `npx skills` CLI, launched Jan 2026 with a telemetry-ranked leaderboard, plus awesome-lists. Anthropic's own `anthropics/skills` repo has no video skills.

### Cited Findings
- Remotion Agent Skills: installed with `npx skills add remotion-dev/skills` or `gh skill install remotion-dev/skills`, and also offered on `bun create video`. The skills are `/remotion-best-practices` (umbrella), `/remotion-create`, `/remotion-markup`, `/remotion-studio`, `/remotion-render`, `/remotion-maps` (incl. Cesium flythrough technique), `/remotion-captions` (transcribe, import SRT, display), `/remotion-saas`, `/remotion-interactivity`, `/remotion-docs`, `/remotion-license` (from v4.0.540), `/remotion-upgrade` and `/remotion-multimedia`. Last commit 2026-11-02 (verified). — [GitHub remotion-dev/skills](https://github.com/remotion-dev/skills); [Remotion docs](https://www.remotion.dev/docs/ai/skills)
- A third-party listing shows `remotion-render` at about 169.2K installs. Skills are plain-text instructions, not executable code. — [llmbase.ai](https://llmbase.ai/skills/remotion-dev/remotion-render/)
- HyperFrames (HeyGen): Apache-2.0, last commit 2026-11-02 (verified). Compositions are "HTML files with data attributes. No React requirement". Installed with `claude plugin install hyperframes@hyperframes`. The core skills are `/hyperframes`, `/hyperframes-cli`, `/hyperframes-registry` (~450 blocks covering transitions, overlays, kinetic type, captions, charts and maps) and `/media-use` (music, SFX, images, voiceover, avatar, transcripts, cutouts). On-demand skills include `/remotion-to-hyperframes` (also Motion Canvas, Lottie, Three.js), `/slideshow` and `/figma`. Requires Node 22+ and FFmpeg. `frame.md` is a DESIGN.md superset for video design systems. The repo also has internal `.agents/skills` such as captions-overlay, changelog-video and motion-doctrine. — [GitHub heygen-com/hyperframes](https://github.com/heygen-com/hyperframes)
- The HyperFrames README warns that `skills add` resolves the skills.sh registry blob, "which can lag `main` by hours". — [GitHub heygen-com/hyperframes](https://github.com/heygen-com/hyperframes)
- skills.sh / `npx skills` (Vercel) launched 20 Jan 2026. Use `npx skills add <owner>/<repo>` with `--list`/`--skill`. The leaderboard ranks by anonymous telemetry, which is on by default (`DISABLE_TELEMETRY=1` disables it). The CLI repo `vercel-labs/skills` is MIT, last commit 2026-10-29 (verified). — [qaskills.sh guide](https://qaskills.sh/blog/skills-sh-agent-skills-directory-guide); [GitHub vercel-labs/skills](https://github.com/vercel-labs/skills)
- anthropics/skills (last commit 2026-10-28, verified) contains: academy-guide, algorithmic-art, brand-guidelines, canvas-design, claude-api, discernment-nudge, doc-coauthoring, docx, frontend-design, internal-comms, mcp-builder, pdf, pptx, skill-creator, slack-gif-creator, theme-factory, web-artifacts-builder, webapp-testing, xlsx. The only motion-adjacent ones are algorithmic-art, slack-gif-creator and canvas-design. — [GitHub anthropics/skills](https://github.com/anthropics/skills)
- Awesome-lists: ComposioHQ/awesome-claude-skills (last commit 2026-07-24), travisvn/awesome-claude-skills (2026-04-28), punkpeye/awesome-mcp-servers (MIT, 2026-11-01). All verified. — [ComposioHQ](https://github.com/ComposioHQ/awesome-claude-skills); [travisvn](https://github.com/travisvn/awesome-claude-skills); [punkpeye](https://github.com/punkpeye/awesome-mcp-servers)

### Inferences
- For a code-driven video toolkit, the strongest Claude integration is to install Remotion or HyperFrames skills (authoring), add the ElevenLabs hosted MCP (voice and SFX) and fal hosted MCP (generative video/image), and call ffmpeg, ffmpeg-normalize and beat_this directly through Claude Code's Bash.
- Skills are lower-risk than MCP servers because they are instructions, but skills that bundle scripts (e.g. HyperFrames' `align-captions.mjs`) still execute code. Install from vendor repos and review scripts.
- skills.sh install counts are telemetry-driven popularity, not a quality or security signal.

### Gaps
- Glama and Smithery registry listings for creative MCPs were not checked this session.
- No Claude Code plugin marketplace focused specifically on video was found besides HyperFrames' own `hyperframes` marketplace.
- Current skills.sh install counts for creative skills were not obtained.
