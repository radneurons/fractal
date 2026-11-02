# AI Video/Image Generation & VFX Pipelines for Creators (as of Nov 2026) — open-source tools and Claude / Claude Code orchestration

**Method note for the report writer.** 15 tool calls. Web search worked, but WebFetch could not resolve most hosts in this sandbox (docs.comfy.org, en.wikipedia.org, fuser.studio all failed with ENOTFOUND). So most "Cited Findings" come from search-result snippets and secondary comparison blogs, not from primary pages I read in full. Several of those blogs read like SEO content and contradict each other. Where that happens I say so.

**Tag used in the notes.** Items under "Inferences" tagged **[PK]** come from my prior knowledge (training data to about mid-2026). I did NOT re-verify them this session. They are included because the task asks for a dense catalog. Treat every [PK] license, version or VRAM figure as "verify against the repo's LICENSE or the Hugging Face model card before use".

**Already covered elsewhere (only brief mentions here):**
- **ComfyUI:** the node-graph hub everything below plugs into.
- **Higgsfield:** a commercial aggregator. Its MCP server is connected in this session and exposes generate_image, generate_video, generate_audio, generate_3d, upscale_image/video, relight_image, remove_background, motion_control, reframe and outpaint_image (observed in this session's tool list).

---

## 1. Open-weight video generation models: what is current and usable?

### Takeaway
Three open-weight families lead in late 2026: Lightricks LTX-2/2.3 (audio+video in one pass), Alibaba Wan 2.2 (Apache 2.0, the de-facto ComfyUI workhorse) and Tencent HunyuanVideo 1.5. Alibaba's newer Wan 2.5/2.6/3.0 are API-first, and their open-weight status is disputed or unconfirmed. Default to Wan 2.2 if you need a clean open license.

### Cited Findings

**LTX-2 / LTX-2.3**
- Lightricks published the full LTX-2 release (code, weights, tooling) in January 2026 — [Wikipedia: LTX-2 (via search snippet)](https://en.wikipedia.org/wiki/LTX-2); [Thunder Compute](https://www.thundercompute.com/blog/best-open-source-ai-video-generation-models)
- LTX-2.3 followed in March 2026 and generates synchronized audio and video in a single inference pass — [Thunder Compute](https://www.thundercompute.com/blog/best-open-source-ai-video-generation-models); [LTX blog](https://ltx.io/blog/best-open-source-video-generation-models)
- **License conflict:** one source calls LTX the only open model with documented licensed training data and a clean Apache-2.0 commercial story. Another lists LTX-2.3 as "Dual: Community/Commercial" — [builderai.tools](https://builderai.tools/blog/best-open-source-video-generation-stack-2026); [wavespeed](https://wavespeed.ai/landing/models/best-open-source-video-models-2026). See [PK] below; I believe the dual license is correct.
- One early-2026 benchmark ranked LTX-2 the highest open-source model — [aimagicx comparison](https://www.aimagicx.com/blog/open-source-ai-video-models-comparison-2026)

**Wan**
- Wan 2.1 is Apache 2.0. Wan 2.2 was released by Tongyi Lab on 29 Jul 2025; one comparison table wrongly dates it Jan 2026 — [Thunder Compute](https://www.thundercompute.com/blog/best-open-source-ai-video-generation-models); [aimagicx](https://www.aimagicx.com/blog/open-source-ai-video-models-comparison-2026)
- **Wan 2.6** was sold only as a commercial API; weights were reportedly never published to HF, GitHub or ModelScope — [wan27.org](https://wan27.org/blog/wan-2-6-open-source-guide); [venice.ai lists it "Proprietary"](https://venice.ai/models/wan-2-6)
- **Wan 3.0 — conflicting reports:**
  - Morphic says it is closed and API-only, with no published weights — [Morphic](https://morphic.com/resources/models/wan-3-0)
  - OrcaRouter says the claimed Apache-2.0 "1.3B + 14B" release appears in no Alibaba announcement — [OrcaRouter](https://www.orcarouter.ai/blog/wan-3-0-release-date)
  - YouArt, Flowith and wan27.org claim weights were released around April 2026 — [YouArt](https://youart.ai/blog/wan-3-0-vs-wan-2-6); [Flowith](https://flowith.io/blog/wan-2-6-3-0-open-weight-architecture-democratize-ai-film-production/); [wan27.org](https://wan27.org/blog/wan-3-open-source)
  - **Verdict:** UNCONFIRMED. Wan 2.2 is the newest Wan with verifiably published weights.
- Wan 3.0 is reported to do 30-second video and document-to-video — [Morphic](https://morphic.com/resources/models/wan-3-0)

**HunyuanVideo 1.5**
- Uses a Tencent custom license that permits commercial use below 100M MAU — [aimagicx](https://www.aimagicx.com/blog/open-source-ai-video-models-comparison-2026)
- Release date conflict: that source dates it Feb 2026; I recall Nov 2025 [PK]
- Wan 2.2 and HunyuanVideo 1.5 are said to lead on photorealism — [aimagicx](https://www.aimagicx.com/blog/open-source-ai-video-models-comparison-2026)

**Cloud deployment**
- A 2026 guide covers running LTX-Video, Wan 2.2 I2V and Hunyuan Video Avatar on cloud GPUs — [Spheron](https://www.spheron.network/blog/image-to-video-gpu-cloud-ltx-wan-hunyuan/)

### Inferences
- **[PK] Wan 2.2 lineup** (Apache 2.0):
  - T2V/I2V-A14B: mixture-of-experts with high-noise and low-noise experts, 27B total / 14B active. Needs 80GB for native 720p; runs on consumer cards via fp8/GGUF and block-swap in Kijai's wrapper.
  - TI2V-5B: 720p@24fps on a single RTX 4090-class 24GB card.
  - Also Wan2.2-S2V-14B (speech-to-video) and Wan2.2-Animate-14B (character animation / replacement, Sept 2025).
  - Wan 2.5 (Sept 2025) added native audio but was API-only "preview".
  - Why it matters: Wan 2.1/2.2 is the base for most community LoRAs, VACE, distill LoRAs (lightx2v / CausVid / "Lightning" 4–8-step) and ComfyUI wrappers.
- **[PK] VACE (Alibaba, Apache 2.0):** all-in-one video creation and editing on Wan 2.1. Handles reference-to-video, video-to-video with pose/depth/flow control, masked inpainting/outpainting, move/swap/animate-anything. Very important for VFX-style edits.
- **[PK] HunyuanVideo** (13B, Dec 2024) and **HunyuanVideo 1.5** (~8.3B, can run on ~14GB VRAM with offload). Related releases: HunyuanVideo-I2V, HunyuanVideo-Avatar, HunyuanVideo-Foley (audio).
  - **License caveat:** the Tencent Hunyuan Community License excludes use in the EU, UK and South Korea, and adds an MAU threshold. Flag this for EU/UK creators.
- **[PK] LTX-Video (LTXV)** 2B/13B, 0.9.x series: very fast, near-real-time on H100 at low resolution. Licensed under the "LTXV Open Weights License"; I recall free commercial use for entities under about $10M annual revenue. The LTX-2 license is similar, i.e. NOT pure Apache. That would explain the "Dual Community/Commercial" listing — verify. Lightricks maintains its own ComfyUI-LTXVideo nodes and LTX-2 trainer (LoRA) code.
- **[PK] Other open video models:**
  - **Mochi 1** (Genmo, 10B, Apache 2.0): older and largely superseded, but cleanly licensed.
  - **CogVideoX** (Zhipu/THUDM): 2B under Apache 2.0, 5B under the custom CogVideoX license. Mostly superseded, but it underpins research models (Hallo3, DiffusionRenderer variants, ConsisID).
  - **SkyReels V1/V2** (Skywork):
    - V2 uses "diffusion forcing" for theoretically infinite-length video.
    - SkyReels-A1/A2 handle portrait animation and multi-element composition.
    - License is a Skywork community license — verify.
  - **FramePack** (Lvmin Zhang / lllyasviel, Apr 2025, Apache 2.0): next-frame-section packing on Hunyuan. Generates minute-long I2V on 6GB laptop GPUs with constant memory. A big creator favorite; FramePack-F1 variant.
  - **Self-Forcing** (Adobe Research + UT Austin, Jun 2025) and **CausVid**: autoregressive distillation of Wan 1.3B into few-step causal models. About 16–17 fps streaming on one H100. Self-Forcing++ and others extend length. Their distill LoRAs are widely used to speed up Wan.
  - **MAGI-1** (Sand AI, Apache 2.0): autoregressive chunk-wise video.
  - **Kandinsky 5.0 Video** (Sber AI, late 2025, MIT).
  - **Real-time / interactive "world model" trend:** Matrix-Game 2.0 (Skywork), Hunyuan-GameCraft / HunyuanWorld-Voyager. Relevant to the "3D toolkit" angle.
- **Practical hardware tiers [PK]:**
  - 8–12GB: FramePack, LTXV-2B, Wan 1.3B, GGUF-quantized Wan 14B with heavy offload (slow).
  - 16–24GB: Wan 2.2 5B native; 14B in fp8/GGUF with block-swap; HunyuanVideo 1.5; LTX-2 distilled/fp8.
  - 48–80GB (A6000/H100): full-precision 14B at 720p, LoRA training.
  - **Rule of thumb:** a 5s 720p Wan 14B clip takes many minutes on a 4090 without distill LoRAs, and about 1–2 min with 4–8-step lightx2v LoRAs.

### Gaps
- Could not open primary HF model cards (fetch blocked), so exact LTX-2.3 license text, HunyuanVideo 1.5 date and territory clause, and Wan 3.0 weight status are not verified from primary sources.
- No reliable source found on whether HunyuanVideo has a 2.0 or later open release in 2026.
- No verified current data on SkyReels V3, Mochi successors, or new 2026 open entrants (e.g. from StepFun, Kuaishou, ByteDance open-weight releases).

---

## 2. Commercial / closed video models (for Claude-orchestrated API pipelines)

### Takeaway
There is no single best closed model in late 2026; it depends on the job:
- **Veo 3.1:** realism plus native audio, at a premium price.
- **Runway Gen-4.5:** leaderboard leader and editing control, but short clips and no audio in the API.
- **Kling 3.0:** value, multi-shot.
- **Seedance 2.x:** reference-driven commercial work; 2.5 is the newest.
- **Sora 2:** reportedly being sunset.
All are reachable programmatically via vendor APIs or aggregators (fal, Replicate, Higgsfield, ComfyUI API/partner nodes).

### Cited Findings
- **Sora 2 shutdown (secondary sources):** OpenAI reportedly closed the Sora app on 26 Apr 2026 and the API sunsets 24 Sep 2026, with no announced replacement. Another source lists it as "Legacy" on OpenAI's API page — [teamday.ai (Sept 2026)](https://www.teamday.ai/blog/best-ai-video-models-2026); [getaiperks](https://www.getaiperks.com/en/blogs/44-best-ai-video-generators-2026). **Unverified against OpenAI primary sources.**
- **Runway Gen-4.5:**
  - Reportedly tops the Artificial Analysis text-to-video leaderboard at about 1,247 Elo. Typical clips are 2–10s.
  - Runway Gen-4.5 and Luma Ray 3.2 expose no audio option in their APIs.
  - Sources: [rizzgen comparison](https://rizzgen.ai/blogs/runway-kling-veo-sora-ltx-wan-seedance-comparison); [teamday.ai](https://www.teamday.ai/blog/best-ai-video-models-2026)
- **Veo 3.1:** leads on physical realism and native audio, with 4K output. Reported tier prices are about $0.40 / $0.10 / $0.05 per second for Standard / Fast / Lite — [teamday.ai](https://www.teamday.ai/blog/best-ai-video-models-2026); [mstudio](https://mstudio.ai/insights/best-ai-video-generator-2026)
- **Kling 3.0:** about $0.10/s with native 4K. Native audio is disputed (one source says no, another says yes) — [teamday.ai](https://www.teamday.ai/blog/best-ai-video-models-2026); [getaiperks](https://www.getaiperks.com/en/blogs/44-best-ai-video-generators-2026)
- **Seedance:**
  - 2.0 is positioned as strongest for commercial/product and reference-driven shots.
  - Seedance 2.5 is about $0.23/s with clips up to 30s — [teamday.ai](https://www.teamday.ai/blog/best-ai-video-models-2026); [guptadeepak](https://guptadeepak.com/tools/top-5-ai-video-generation-tools-2026/)
  - This session also has an installed "seedance-take-score" skill that compiles prompts for Seedance 2.5 (T2V, I2V, reference, extend, edit). That is evidence that skills-as-prompt-compilers for specific models are a live pattern (observed in session skill list).
- **Pricing caveat:** price figures are third-party blog figures, not vendor docs — [pixflow](https://pixflow.net/blog/best-ai-video-generator/); [serenitiesai](https://serenitiesai.com/articles/best-ai-video-generator-comparison-2026)

### Inferences
- **[PK] Earlier context for these models:**
  - **Runway:** Aleph (Jul 2025) is in-context video-to-video editing: change angle, relight, remove objects, restyle. It is the main closed "AI VFX" tool. Act-Two does performance capture to character. Gen-4 References gives consistency.
  - **Luma:** Ray3 (Sept 2025) introduced 16-bit HDR / EXR output, which matters for real VFX compositing. Luma Modify Video does v2v.
  - **MiniMax Hailuo 02 / 2.3:** strong physics, low cost.
  - **Kling:** 2.1 / 2.5 Turbo preceded 3.0. Kling has multi-image "Elements" references, a lip-sync API and a motion-brush.
  - **Google Flow / Veo 3.1:** "ingredients to video", first/last frame, scene extension.
  - **ByteDance OmniHuman 1.5:** in Dreamina/CapCut.
- **Pipeline implication:** Claude can treat closed models as interchangeable "render backends" behind one tool interface (fal/Replicate/Higgsfield MCP). It picks by cost per second, audio need, clip length and reference support, then post-processes locally with open tools (upscale, interpolate, matte, composite).
- **C2PA / SynthID provenance:** watermarks are applied by Google (SynthID), OpenAI (C2PA) and others; this is relevant for commercial disclosure.

### Gaps
- No primary vendor pages verified (Google, Runway, Kuaishou, ByteDance pricing).
- The Sora 2 sunset claim is notable and should be confirmed on OpenAI's deprecations page.
- No verified info on Veo 4, Runway Gen-5, Kling 3.x successors or Luma Ray 4 existing as of Nov 2026.

---

## 3. ComfyUI ecosystem and programmatic / agent orchestration

### Takeaway
ComfyUI is the execution substrate. Comfy-Org now ships a first-party MCP server ("comfy-mcp", formerly comfy-local-mcp) plus a hosted remote MCP. Several community MCP servers turn saved workflows into agent tools. Claude Code can therefore build, edit, queue and retrieve ComfyUI workflows directly.

### Cited Findings
- **Official Comfy MCP:**
  - Comfy's docs describe "comfy-local-mcp" as the first-party local MCP server; it has been renamed comfy-mcp.
  - Claude Code registration is one command: `claude mcp add comfy-mcp -- comfy-mcp`.
  - A hosted cloud MCP can be added as a remote/custom connector with sign-in.
  - Sources: [Comfy docs: agent-tools/local](https://docs.comfy.org/agent-tools/local); [Comfy-Org/comfy-mcp](https://github.com/Comfy-Org/comfy-mcp); [comfy.org/mcp](https://comfy.org/mcp/); [PyPI comfy-mcp](https://pypi.org/project/comfy-mcp/)
- **Community MCP servers:**
  - **artokun/comfyui-mcp:** packaged as a Claude Code plugin with slash commands, skills and hooks. It can find/download a checkpoint, build a workflow, execute it and return the image — [artokun wiki](https://github.com/artokun/comfyui-mcp/wiki)
  - **IO-AtelierTech/comfyui-mcp:** lists, loads, saves and validates workflow files, and executes them — [GitHub](https://github.com/IO-AtelierTech/comfyui-mcp)
  - **PlateerLab/comfy-workflow-mcp:** exposes saved workflows in a ComfyUI server (local, remote or vast.ai) as MCP tools. It reloads the saved file every run, so edits in the UI propagate. It is "source-available", not OSI open source — [GitHub](https://github.com/PlateerLab/comfy-workflow-mcp)
  - Also [2233admin/comfyui-mcp](https://github.com/2233admin/comfyui-mcp); [cuzelac comfy-mcp](https://lobehub.com/mcp/cuzelac-comfy-mcp)
- **Official ComfyUI tool nodes:**
  - SeedVR2 upscaling and Depth Anything 3 video-depth have official ComfyUI tutorials/workflows — [Comfy docs SeedVR2](https://docs.comfy.org/tutorials/utility/seedvr2); [Comfy docs DA3](https://docs.comfy.org/tutorials/utility/depth-anything-3)
  - comfyorg hosts an official SeedVR2 node repo — [comfyorg/comfyui_seedvr2](https://github.com/comfyorg/comfyui_seedvr2)

### Inferences
- **[PK] ComfyUI HTTP API (the core of any Claude automation):**
  - Export a graph via "Export (API)" to get API-format JSON: a node-id → {class_type, inputs} map.
  - Claude edits inputs such as prompt text, seed, LoadImage filename and frame count, then calls `POST /prompt` with {prompt, client_id}.
  - Track progress over the `ws://host/ws?clientId=` websocket. Fetch outputs via `GET /history/{prompt_id}` and `/view?filename=`. Upload inputs via `POST /upload/image`.
  - Claude Code is very good at this, because it is just JSON patching plus a small Python/Node client.
- **[PK] Other ecosystem pieces:**
  - **comfy-cli** (Comfy-Org, `pip install comfy-cli`): `comfy install`, `comfy launch --background`, `comfy node install <name>`, `comfy model download --url`, `comfy run --workflow api.json`. Ideal for headless setup by an agent on a rented GPU.
  - **ComfyUI-Manager:** custom-node/model manager, now bundled/integrated into core ComfyUI distributions. Agents can install nodes via the CLI or Manager API instead of the GUI.
  - **Kijai's ComfyUI-WanVideoWrapper** (Apache 2.0): the bleeding-edge wrapper that supports new Wan-family research models within days of release. Covers VACE, Wan-Animate, MultiTalk/InfiniteTalk, ATI, Uni3C, FantasyTalking, MiniMax-Remover, SkyReels, and block-swap/fp8/torch.compile memory tricks. Kijai also maintains wrappers for HunyuanVideo, FramePack, LivePortrait, Florence2, DepthAnything, GIMM-VFI, etc. Lesser-known but arguably the single most important repo for open video VFX.
  - **Other high-value node packs:** ComfyUI-VideoHelperSuite (video load/combine, essential for frame I/O); ComfyUI-GGUF (city96, quantized models); ComfyUI-Frame-Interpolation (RIFE/FILM/GIMM); comfyui_controlnet_aux (preprocessors: depth, pose, lineart); ComfyUI-KJNodes.
  - **Comfy partner/API nodes** call Veo, Kling, Runway, Luma, GPT-image, Nano Banana etc. from inside graphs, billed via Comfy credits. Comfy Cloud is the hosted runner.
  - **SwarmUI** (mcmonkey, MIT): a friendlier UI over a ComfyUI backend with its own API and multi-GPU/multi-backend load-balancing. Good for batch generation farms.
  - **InvokeAI** (Apache 2.0): canvas-centric, pro-artist UI with layers/regional prompting. I recall the Invoke company's team joining Adobe in late 2025, with the OSS project continuing — verify.
- **Claude Code skill pattern:** a SKILL.md that contains:
  - a library of API-format workflow templates with documented "slots" (node ids to patch);
  - a tiny `comfy_client.py` (queue, wait, download);
  - model-specific prompt guides (e.g. the Seedance take-score skill).
  This beats raw MCP for reproducibility, because the workflow JSON is version-controlled in git.

### Gaps
- Could not read the Comfy docs page directly (host blocked), so the exact tool list of the official comfy-mcp (e.g. whether it can install nodes, edit graphs, or only run) is unverified.
- Maintenance status and stars of community MCP servers are not verified.

---

## 4. Image generation & editing models

### Takeaway
- **Open, commercially clean:** Qwen-Image and Qwen-Image-Edit (2509/2511, Apache 2.0), FLUX.2 [klein] 4B (Apache 2.0) and HiDream-I1 (MIT) are the commercially-clean open picks.
- **FLUX dev-tier weights** (FLUX.1 [dev], Kontext [dev], FLUX.2 [dev], klein 9B) are non-commercial to self-host commercially without a BFL license.
- **Qwen-Image-2.1:** reported (Sept 2026) under a research-only license.
- **Closed:** Nano Banana (Gemini image) and GPT-image dominate instruction-based editing.

### Cited Findings
- **FLUX.2 licensing:**
  - [dev] and [klein] tiers need a BFL commercial license for commercial model use; outputs may be usable commercially.
  - FLUX.2 [klein] 4B is Apache 2.0, while [klein] 9B is non-commercial.
  - Sources: [Thunder Compute image models](https://www.thundercompute.com/blog/best-open-source-image-generation-models); [pinggy](https://pinggy.io/blog/best_free_open_source_ai_image_generators_to_self_host/); [builderai.tools](https://builderai.tools/blog/best-open-source-image-generation-stack-2026); [Wikipedia: Flux](https://en.wikipedia.org/wiki/Flux_(text-to-image_model))
- **Qwen-Image-Edit-2511:** described as the best open editing model and the easiest license call (Apache 2.0, 20B Qwen-Image base) — [builderai.tools](https://builderai.tools/blog/best-open-source-image-generation-stack-2026); [simplismart](https://simplismart.ai/comparisons/qwen-image-vs-flux-2-which-open-weight-image-model-should-you-deploy)
- **Qwen-Image-2.1:** reportedly shipped 20 Sep 2026 as a 7B model with native 2K output and a real alpha channel, under a research-only license forbidding commercial use — [rohitraj.tech](https://rohitraj.tech/notes/qwen-image-2-1-commercial-license-alternatives-2026); [eesel](https://www.eesel.ai/blog/qwen-image-2-1-alternatives). **Single-blog claim; verify on HF.** Whether the restriction extends to an Edit variant is unknown.

### Inferences
- **[PK] FLUX.1 family:**
  - [schnell] is Apache 2.0.
  - [dev] and **FLUX.1 Kontext [dev]** (Jun 2025, 12B in-context editing: character consistency, local edits, text edits) are under the FLUX.1 [dev] Non-Commercial License. BFL sells a self-serve commercial license.
  - FLUX.1 Krea [dev] is an aesthetic fine-tune under the same license.
  - FLUX.2 (Nov 2025) includes [pro]/[flex] (API) and [dev] 32B (open weights, non-commercial). It supports multi-reference (up to about 10 images) generation/editing.
- **[PK] Qwen-Image** (Aug 2025, 20B MMDiT, Apache 2.0) is best-in-class at rendering text (including Chinese). The Qwen-Image-Edit line (Aug 2025 → 2509 multi-image → 2511) is Apache 2.0, and Lightning distill LoRAs exist.
- **[PK] HiDream-I1** (17B, MIT) and HiDream-E1 editing.
- **[PK] SDXL** (CreativeML OpenRAIL++-M) is still the base for the vast ControlNet/LoRA/IP-Adapter ecosystem and for low-VRAM work. SD3.5 uses the Stability Community License (free under $1M revenue).
- **[PK] Other open image models:** Hunyuan Image 2.1/3.0 (Tencent, big autoregressive MoE, territory-restricted license), Lumina, Chroma (Apache, de-distilled FLUX schnell), OmniGen2.
- **[PK] Closed image models:**
  - **Nano Banana** = Gemini 2.5 Flash Image (Aug 2025); **Nano Banana Pro** = Gemini 3 Pro Image (Nov 2025). Strong multi-turn editing and character consistency; SynthID watermark.
  - **OpenAI gpt-image-1** (Apr 2025) and later gpt-image-1-mini / 1.5 — verify current.
  - Also Seedream 4.x (ByteDance), Ideogram 3, Midjourney v7 (no official API).
- **Creator pipeline use:**
  - Image models are mostly used for keyframes / first-last frames fed to I2V models, plateaus/backgrounds, and texture/concept art.
  - Edit models (Kontext, Qwen-Edit, Nano Banana) give shot-to-shot consistency for storyboards.

### Gaps
- No primary-source verification of the FLUX.2 license text, Qwen-Image-2.1, or the current GPT-image version.

---

## 5. Lip-sync, talking heads & avatars

### Takeaway
- **Open, commercially usable:** LatentSync (Apache 2.0, but stagnant since mid-2025) and MuseTalk (MIT, real-time but 256px face crop) remain the open baselines.
- **Full-body talking video:** heavier Wan-based models (InfiniteTalk/MultiTalk, Wan2.2-S2V) handle talking video with body motion.
- **Hosted:** HeyGen, Hedra, OmniHuman (closed) and sync.so cover this.

### Cited Findings
- **LatentSync** (ByteDance, diffusion-based, Apache 2.0): reportedly no release since June 2025 (stale repo) — [sync.so: LatentSync](https://sync.so/blog/what-is-latentsync)
- **MuseTalk** (Tencent Lyra Lab, 2024, MIT):
  - Runs at 30fps+, but the face region is 256×256, which limits resolution.
  - Identity details (mustache, lip shape) can drift.
  - Sources: [sync.so: MuseTalk](https://sync.so/blog/what-is-musetalk); [HF camenduru/MuseTalk](https://huggingface.co/camenduru/MuseTalk)
- **InfiniteTalk:** heavier talking-video system with head and body motion, not a drop-in mouth swap. Users report slow inference, memory pressure at 720p, and degradation outside the face — [Instavar comparison (May 2026)](https://instavar.com/research/ai-video/open-source-lip-sync-models); [talking-avatar.dev](https://talking-avatar.dev/alternatives/10-best-open-source-lip-sync-alternatives-2026)
- **Instavar's picks (May 2026):** keeps LatentSync 1.6 as the local baseline and MuseTalk as the speed fallback — [Instavar](https://instavar.com/research/ai-video/open-source-lip-sync-models)
- **Production dubbing research** continues, e.g. TBDub (arXiv, Sept 2026) — [arXiv 2609.06144](https://arxiv.org/pdf/2609.06144)
- **Vanta** (an open-source "video engine" built on Remotion): combines voice cloning, avatars, captions, Wan 2.2/LTX T2V and a timeline editor. It is an example of code-driven assembly — [GitHub itsjwill/vanta](https://github.com/itsjwill/vanta)
- Note: sync.so and Instavar are vendors with commercial interest — [sync.so best free tools](https://sync.so/blog/the-best-free-open-source-lipsync-tools-2)

### Inferences
- **[PK] Hallo / Hallo2 / Hallo3** (Fudan): portrait animation. Hallo3 is CogVideoX-based with dynamic backgrounds and is heavy (about 40GB+). License: verify (the CogVideoX-5B license is inherited).
- **[PK] Sonic** (Tencent, CVPR 2025): audio-driven portrait. I recall a non-commercial restriction — verify.
- **[PK] OmniHuman-1/1.5** (ByteDance): closed, available via Dreamina/CapCut and some APIs.
- **[PK] LivePortrait** (Kuaishou/KwaiVGI): expression/pose retargeting (driving-video to portrait), very fast, also animals.
  - Code is MIT, but the default face detector depends on InsightFace models, which are non-commercial. Commercial users must swap the detector.
  - Excellent for "puppeteer a still with my webcam performance".
- **[PK] MultiTalk/InfiniteTalk** (MeiGen-AI, Apache 2.0, Wan-based; multi-person and unlimited-length dubbing). Others: FantasyTalking, Wan2.2-S2V-14B, HunyuanVideo-Avatar, Hedra Character-3 (closed), HeyGen Avatar IV (closed API), Kling lip-sync API.
- **[PK] Ethics/legal:** voice cloning and likeness use require consent. Many hosted tools enforce identity verification.

### Gaps
- Could not verify licenses for Hallo3, Sonic or OmniHuman API availability.
- I did not find current benchmark numbers (LSE-C/D, FID) comparing 2026 models.

---

## 6. Upscaling & frame interpolation

### Takeaway
- **SeedVR2** (ByteDance Seed; 3B/7B one-step diffusion video restoration, Apache 2.0) is the standout open video upscaler and now has an official ComfyUI node.
- Real-ESRGAN, RIFE and FILM remain the fast, permissively licensed classics.
- Topaz is the polished commercial option.

### Cited Findings
- **SeedVR2 license:** official ComfyUI docs say the SeedVR2 3B and 7B models are Apache 2.0. The numz wrapper switched its license back to Apache 2.0 to match ByteDance Seed. Older copies list MIT — [Comfy docs SeedVR2](https://docs.comfy.org/tutorials/utility/seedvr2); [numz/ComfyUI-SeedVR2_VideoUpscaler](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler); [AInVFX HF](https://huggingface.co/AInVFX/SeedVR2_comfyUI); [comfyorg/comfyui_seedvr2](https://github.com/comfyorg/comfyui_seedvr2)
- **SeedVR2 usage:** works on both images and video — [weirdwonderfulai](https://weirdwonderfulai.art/resources/seedvr2-upscaler-for-video-and-images/)

### Inferences
- **[PK] SeedVR2 practicalities:** it is VRAM-hungry. Use 3B fp8/GGUF for 16–24GB, with tiled/batched temporal processing. The numz/AInVFX node supports block-swap and multi-GPU.
- **[PK] Upscalers:**
  - **Real-ESRGAN** (BSD-3): fast GAN upscaler, plus anime models. Runs via ncnn-vulkan on any GPU, including AMD/Intel.
  - **Video2X** (k4yt3x): AGPL-3.0 wrapper that drives Real-ESRGAN, Real-CUGAN, Anime4K and RIFE via Vulkan. The AGPL is a copyleft caveat if embedded in services.
  - **Topaz Video AI / "Topaz Video"** (commercial): moved to subscription in 2025. The Starlight diffusion models (cloud plus local "mini") do restoration. It has a CLI/ffmpeg filter usable by agents.
  - Others: FlashVSR (real-time diffusion VSR), Upscale-A-Video (S-Lab non-commercial), STAR.
- **[PK] Interpolation:**
  - **RIFE** (MIT, hzwer): real-time; Practical-RIFE v4.x.
  - **FILM** (Google, Apache 2.0): large motion.
  - **GIMM-VFI** (NeurIPS 2024): implicit motion modelling, arbitrary-timestep and higher quality, but slower. License: verify. Available via Kijai's wrapper.
  - All three are available in ComfyUI-Frame-Interpolation.
  - Typical use: generate at 16fps (Wan) or 24fps, then interpolate to 24/30/60.
- **Pipeline order:** generate → (optional) interpolate → SeedVR2/Real-ESRGAN upscale → ffmpeg encode (ProRes/EXR for comp). Claude can script this end-to-end.

### Gaps
- Licenses for GIMM-VFI and FlashVSR, and Topaz's current pricing/CLI, are not verified this session.

---

## 7. Segmentation, rotoscoping & matting

### Takeaway
SAM 3 / SAM 3.1 (Meta, text-prompted "find and track everything") is the new roto backbone, but it uses Meta's own gated SAM License, not OSI. SAM 2 (Apache 2.0), BiRefNet (MIT) and Cutie are permissive alternatives. MatAnyone gives video alpha mattes but (as I recall) is non-commercial.

### Cited Findings
- **SAM 3.1:** a text-prompted find-and-track engine producing per-object masks for downstream VFX. It ships under Meta's SAM License with gated checkpoints, not a standard open-source license — [invideo blog (2026)](https://invideo.io/blog/ai-background-removal-models/)
- **Background-removal comparison:** that blog compares SAM 3.1, Bria, BEN v2 and BiRefNet — [invideo](https://invideo.io/blog/ai-background-removal-models/)
- **OpenField:** an open local pipeline combining SAM 3 silhouette tracking, Depth-Anything-V2 geometry and audio conditioning to prep video for diffusion models such as Seedance. It runs SAM 3 in 250-frame segments to avoid GPU OOM — [GitHub jlew23/OpenField](https://github.com/jlew23/OpenField)
- **Video2Sim:** combines SAM 3 and Depth Anything 3 — [GitHub 9LogM/Video2Sim](https://github.com/9LogM/Video2Sim/releases/tag/v1.0.0)

### Inferences
- **[PK] SAM family:**
  - **SAM 2** (Jul 2024, Apache 2.0): click/box prompts with a memory bank for video propagation; SAM 2.1 checkpoints.
  - **SAM 3** (Nov 2025): adds open-vocabulary text/exemplar prompts ("all red cars").
  - **SAM 3D Objects/Body:** released alongside SAM 3; relevant for the 3D toolkit.
- **[PK] Matting:**
  - **MatAnyone** (NTU S-Lab, CVPR 2025): memory-propagated video matting from a first-frame mask. Gives hair-level alpha; pairs with SAM 2/3 for the initial mask. S-Lab License 1.0 is non-commercial — verify.
  - **Robust Video Matting (RVM):** GPL-3.0; real-time human matting without a mask. Copyleft caveat.
  - **BiRefNet** (MIT): top image dichotomous segmentation and background removal, used per-frame. BEN2 is an alternative.
  - **Cutie** (hkchengrex, CVPR 2024): video object segmentation successor to XMem; widely used in ProPainter-style pipelines. License: verify (I believe MIT).
- **VFX use:** Claude can chain SAM 3 text prompt → masks → MatAnyone alpha → export PNG/EXR alpha sequences for Nuke/Resolve/After Effects/Blender compositing. It can also feed the masks to inpainting (section 9).

### Gaps
- Exact SAM 3 license terms (commercial allowed? gating conditions) are not verified from Meta's repo.
- MatAnyone and Cutie licenses are not verified (search returned nothing relevant).

---

## 8. Depth, normals & relighting

### Takeaway
- **Depth:** Depth Anything 3 (ByteDance Seed, late 2025) generalizes depth to spatially consistent geometry/pose from arbitrary views and has official ComfyUI video workflows. Video Depth Anything and DepthCrafter target temporally stable video depth.
- **Relighting:** IC-Light (open) and NVIDIA DiffusionRenderer (inverse/forward rendering) are the open options. Google LightLab is research-only.
- **License watch-out:** many larger depth checkpoints are CC-BY-NC.

### Cited Findings
- **Depth Anything 3:** predicts spatially consistent geometry from arbitrary visual inputs with or without known camera poses. It is trained only on public academic datasets — [GitHub ByteDance-Seed/Depth-Anything-3](https://github.com/ByteDance-Seed/depth-anything-3)
- **DA3 in ComfyUI:** ComfyUI has official DA3 tutorials, including a video-depth workflow producing per-frame depth maps — [Comfy docs DA3](https://docs.comfy.org/tutorials/utility/depth-anything-3)
- **VideoDepthViewer3D:** streams MP4s to WebXR/VR with DA3 metric depth — [GitHub amariichi/VideoDepthViewer3D](https://github.com/amariichi/VideoDepthViewer3D)
- **Higgsfield MCP:** exposes a relight_image tool, a hosted relighting option callable from Claude (observed in this session's tool list).

### Inferences
- **[PK] Depth Anything licenses:** V2-Small is Apache 2.0; V2-Base/Large/Giant are CC-BY-NC-4.0. Video Depth Anything (Jan 2025) has the same split: Small Apache, Large non-commercial. DA3 checkpoints likely have a similar split — verify per checkpoint.
- **[PK] DepthCrafter** (Tencent ARC): SVD-based, temporally consistent long video depth. Custom license — verify.
- **[PK] Marigold** (ETH, Apache code): diffusion depth plus normals/intrinsics variants. It has diffusers pipelines.
- **[PK] Normals:** NormalCrafter, StableNormal, Lotus.
- **[PK] Relighting:**
  - **IC-Light** (lllyasviel): SD1.5-based v1 is open (Apache). The FLUX-based "IC-Light v2" was API/demo only.
  - **LightLab** (Google, SIGGRAPH 2025): controllable light-source editing; paper only, no weights.
  - **NVIDIA DiffusionRenderer** (CVPR 2025): estimates G-buffers (albedo, normal, depth, roughness/metallic) from video, then re-renders under new HDR environment lighting. Cosmos-based release under the NVIDIA open model license.
  - Also Light-A-Video (training-free video relighting), RelightVid, and Runway Aleph / Beeble SwitchLight (commercial; produces PBR passes from footage).
- **Why it matters:** depth/normal/albedo passes turn AI or live footage into compositing-ready AOVs: fog, DoF, relight, 3D-camera parallax in Blender. Claude can drive this via Blender Python plus ComfyUI.

### Gaps
- DA3 license per checkpoint, DiffusionRenderer license specifics, and whether LightLab ever released code are unverified.

---

## 9. Motion control, camera control, character animation & inpainting / object removal

### Takeaway
The Wan ecosystem dominates controllable open video:
- **VACE:** universal control/editing.
- **Wan2.2-Animate:** character replacement / animation from a driving video.
- **Uni3C / ReCamMaster / ATI:** camera and trajectory control.
- **MiniMax-Remover / DiffuEraser:** object removal.
ProPainter remains the non-diffusion classic but is (as I recall) non-commercial.

### Cited Findings
- **DiffuEraser** (diffusion video inpainting) was authored at Tongyi Lab, Alibaba, and embeds ProPainter as a prior. Its repo includes a LICENSE file (terms not viewed) — [HF DiffuEraser demo](https://huggingface.co/spaces/cocktailpeanut/DiffuEraser-demo/tree/main/propainter/model); [RunComfy DiffuEraser workflow](https://www.runcomfy.com/es/comfyui-workflows/diffueraser-workflow-in-comfyui-video-inpainting-with-automated-mask-generation)
- **Higgsfield MCP motion tools:** exposes motion_control (single-character Kling recast) and Genjutsu motion/replace-object routes (observed in session MCP instructions).

### Inferences
- **[PK] Wan2.2-Animate-14B** (Sept 2025, Apache 2.0): two modes.
  - Animation: drive a still character with a reference performance.
  - Replacement: swap the actor in footage with relighting via a "relighting LoRA".
  - It is the open answer to Runway Act-Two and Viggle.
- **[PK] Older controls:** ControlNet-style video control via VACE (depth/pose/canny/flow inputs), Wan "Fun Control" models (Alibaba PAI VideoX-Fun), and AnimateDiff (legacy).
- **[PK] Camera control:**
  - **ReCamMaster** (KwaiVGI/Zhejiang U., ICCV 2025): re-renders an existing video with a new camera trajectory. Novel-view "reshoot". Wan-based.
  - **CameraCtrl / CameraCtrl II:** Plücker-embedding camera control.
  - **Uni3C** (Alibaba DAMO): unified camera + human motion control for Wan.
  - **ATI** (ByteDance, "Any Trajectory Instruction"): drag/trajectory control on Wan.
  - Also MotionCtrl, Motion Prompting (Google), and Kling/Runway closed motion brushes.
- **[PK] Inpainting / object removal:**
  - **ProPainter** (NTU S-Lab, ICCV 2023): flow-guided propagation + transformer. S-Lab License (non-commercial) — the most-used open remover, but license-encumbered.
  - **DiffuEraser:** I believe Apache 2.0 — verify. Includes a ProPainter dependency, so check S-Lab inheritance.
  - **MiniMax-Remover** (MiniMax, 2025): Wan-based minimax-optimized remover. Fast (few steps) and no CFG; license: verify (I recall Apache 2.0).
  - Also VideoPainter, OmnimatteZero, Generative Omnimatte (Google research, removes object plus its shadows/reflections), and VACE masked inpainting.
- **Typical removal pipeline:** SAM 3 text prompt → masks (dilate) → MiniMax-Remover / DiffuEraser / VACE → SeedVR2 upscale. All of it can be driven as a ComfyUI API workflow by Claude.

### Gaps
- Licenses for ReCamMaster, ATI, Uni3C, MiniMax-Remover, DiffuEraser and ProPainter are not verified from repos this session (the search returned irrelevant results).
- 2026 successors (e.g. Wan 2.6/3-based Animate) are not verified.

---

## 10. Hosted GPU/APIs and their MCP servers (run without a local GPU)

### Takeaway
- **fal:** runs an official, hosted, OAuth MCP server (mcp.fal.ai) over 1,000+ models, with a one-line Claude Code add. It is the easiest "Claude → any image/video model" bridge.
- **Replicate:** has an MCP server, but sources conflict on whether it is official.
- **Modal / RunPod:** the "bring your own ComfyUI" serverless GPU options.

### Cited Findings
- **fal MCP:**
  - Hosted endpoint lets an assistant search, run and chain 1,000+ generative models, with nothing to install.
  - The remote server is at mcp.fal.ai/mcp-relay with OAuth and a one-line Claude Code add.
  - The MCP itself is free; generations are billed per use.
  - Sources: [fal.ai/mcp](https://fal.ai/mcp); [fal docs MCP](https://fal.ai/docs/documentation/model-apis/mcp.md)
- **Community fal servers:** e.g. a local server needing FAL_KEY, with catalogs of about 600+ models — [mgd1984/fal-mcp-server](https://github.com/mgd1984/fal-mcp-server); [PyPI fal-ai-mcp-server](https://pypi.org/project/fal-ai-mcp-server/); [lobehub enescanguven-fal-mcp](https://lobehub.com/mcp/enescanguven-fal-mcp); [Composio fal toolkit](https://composio.dev/toolkits/fal_ai)
- **Replicate MCP — conflict:** one comparison says it is the official server maintained by Replicate; Artlist lists it as a community server — [Glen comparison](https://tryglen.com/compare/replicate-vs-fal); [Artlist MCP connectors 2026](https://artlist.io/blog/the-best-mcp-connectors-for-ai-image-and-video-generation-in-2026/)
- **Positioning:** fal is media-first and speed-optimized; Replicate is broader, including custom models (Cog) — [Glen](https://tryglen.com/compare/replicate-vs-fal)
- **Spheron:** documents deploying LTX/Wan/Hunyuan I2V on rented GPUs — [Spheron](https://www.spheron.network/blog/image-to-video-gpu-cloud-ltx-wan-hunyuan/)

### Inferences
- **[PK] Replicate:** I recall Replicate publishing an official `replicate-mcp` npm package and a remote server in 2025. Replicate's Cog packages custom models/LoRAs as APIs. Verify current status.
- **[PK] Modal:** serverless Python GPU functions with official ComfyUI examples (`modal deploy` a ComfyUI app exposing the /prompt API). Per-second billing and good cold-start snapshots. Claude Code can write and deploy these directly.
- **[PK] RunPod:** pods plus serverless endpoints, with an official `worker-comfyui` template (send workflow JSON, get images back, upload to S3). I recall a RunPod MCP server for managing pods/endpoints — verify.
- **[PK] Others:** WaveSpeed, Novita, Together (images), SiliconFlow, Comfy Cloud, and Higgsfield (aggregator, MCP connected here).
- **Cost logic:** closed models are about $0.05–0.40/s of output (section 2). Self-hosting Wan 2.2 on a rented H100 (about $2–3/h [PK]) wins for high volume or LoRA-specific work. APIs win for bursts and SOTA quality.

### Gaps
- Replicate MCP official status, RunPod/Modal MCP servers, and current GPU hourly prices are unverified.

---

## 11. How Claude / Claude Code orchestrates these (synthesis)

### Takeaway
Claude's leverage is as a **pipeline engineer and director**, not a pixel generator. It:
- writes and patches ComfyUI API JSON and Python glue;
- calls generation backends through MCP (comfy-mcp, fal, Higgsfield, Replicate);
- runs ffmpeg/Blender/compositing scripts;
- encodes model-specific know-how as Skills.

The reproducible core is git-versioned workflow JSON + scripts + skills.

### Cited Findings
- **Official ComfyUI MCP:** Comfy-Org ships comfy-mcp for local ComfyUI plus a hosted remote MCP; registration in Claude Code is `claude mcp add comfy-mcp -- comfy-mcp` — [Comfy docs](https://docs.comfy.org/agent-tools/local); [comfy.org/mcp](https://comfy.org/mcp/)
- **Claude Code plugin for ComfyUI:** packages a ComfyUI MCP with slash commands, skills and hooks, i.e. a full plugin pattern — [artokun/comfyui-mcp wiki](https://github.com/artokun/comfyui-mcp/wiki)
- **Saved workflows as tools:** an artist designs in the UI and the agent calls the workflow as a tool — [PlateerLab/comfy-workflow-mcp](https://github.com/PlateerLab/comfy-workflow-mcp)
- **fal MCP:** one-line Claude Code add, 1,000+ models — [fal docs](https://fal.ai/docs/documentation/model-apis/mcp.md)
- **Code-first assembly:** a Remotion-based open video engine combining generation, TTS, avatars and captions shows the code-first assembly layer — [vanta](https://github.com/itsjwill/vanta)
- **Model-specific prompt-compiler skills:** e.g. Seedance 2.5 "take score" (observed in this session's skill list).

### Inferences
- **Reference architecture for a creator pipeline driven by Claude Code:**
  1. **Plan:** Claude turns a script into a shot list (JSON: shot, duration, camera, references, model choice by cost/audio/length).
  2. **Keyframes:** Qwen-Image / FLUX.2 / Nano Banana (via comfy-mcp or fal MCP), plus edit models for consistency.
  3. **Motion:** Wan 2.2 / LTX-2 locally via ComfyUI API, or Veo/Kling/Seedance via fal/Higgsfield.
  4. **VFX passes:** SAM 3 → MatAnyone mattes; DA3 depth; MiniMax-Remover cleanup; Wan-Animate actor replacement; DiffusionRenderer/IC-Light relight.
  5. **Finishing:** RIFE/GIMM interpolate → SeedVR2 upscale → lip-sync (LatentSync/MuseTalk) → ffmpeg/Remotion/Blender (bpy) assembly, captions, audio mix.
  6. **QA:** Claude inspects frames (it can read images), checks durations and frame counts with ffprobe, and re-queues failed shots.
- **Claude Code specifics:**
  - Long renders: use background Bash and wait/monitor loops rather than blocking.
  - Use subagents to fan out per shot.
  - Use hooks, e.g. auto-run ffprobe validation after each render.
  - Use headless `claude -p` or the Agent SDK for batch/CI rendering.
  - Keep secrets (FAL_KEY, REPLICATE_API_TOKEN) in env, not prompts.
- **License-aware routing as a skill:** encode a table of "commercial-safe" vs "NC" models (FLUX dev, DA-V2-L, ProPainter, MatAnyone, Hunyuan territory clause) so the agent refuses NC models for client work. This is a concrete, high-value skill to build.
- **Lesser-known but high-leverage picks to emphasize:** Kijai's WanVideoWrapper, VACE, FramePack, Self-Forcing/lightx2v distill LoRAs, SeedVR2, MiniMax-Remover, ReCamMaster, Uni3C, DiffusionRenderer, Depth Anything 3, comfy-cli, PlateerLab comfy-workflow-mcp, Video2X, OpenField, VideoDepthViewer3D.

### Gaps
- No public benchmark or case study found on end-to-end agent-driven video pipelines (reliability, cost per finished minute).
- Unverified whether Anthropic has published official skills or examples for media pipelines.
- Network restrictions prevented fetching primary docs. The report writer should treat all [PK] items as needing verification, especially licenses.
