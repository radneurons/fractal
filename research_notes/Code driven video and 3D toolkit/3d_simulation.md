# 3D, Simulation and Virtual Production Tools for Video Creators (as of Nov 2026), with Claude / Claude Code control

Scope note: these notes come from about 30 search and fetch calls. Primary sources (GitHub repos, LICENSE files, Epic's blog) were fetched where possible. The rest is third-party coverage and is flagged. www.blender.org could not be fetched from this sandbox (DNS blocked), so details of the official Blender Lab MCP come from secondary sources only. Items listed only in Inferences or Gaps come from background knowledge and have NOT been verified against a 2026 source.

---

## 1. Blender ecosystem: what can Claude drive, and how?

### Takeaway
Blender is the most Claude-drivable 3D tool in Nov 2026. Two MCP routes exist:
- The community "MCP for Blender" (formerly ahujasid/blender-mcp): about 33k stars, MIT license, built-in hooks for asset and AI-generation services.
- An official Blender Lab MCP server, reported as v1.0.0 in April 2026, which needs Blender 5.1+.

Both run arbitrary Python inside Blender, so bpy scripting and headless rendering remain the strongest base for repeatable video pipelines.

### Cited Findings
- **Project status:** The community project is now called "MCP for Blender" (repo `ahujasid/mcp-for-blender`, PyPI package `mcp-for-blender`). It was formerly `blender-mcp`, and existing `uvx blender-mcp` configs still work. It has about 33.0k stars and 3.0k forks, is MIT licensed, and states it is not affiliated with the Blender Foundation. — [GitHub ahujasid/blender-mcp (redirects to mcp-for-blender)](https://github.com/ahujasid/blender-mcp)
- **Tools:**
  - A socket-based two-way bridge, plus object, material and color control.
  - A `look` tool that captures viewport, camera, wireframe, X-ray or render views so the model can check its own work.
  - `execute_blender_code`, which runs arbitrary bpy.
  - Asset sources: Poly Haven (CC0 HDRIs, textures and models, no key), Sketchfab, and Poly Pizza.
  - A `generate_3d` tool backed by Hyper3D Rodin, Hunyuan3D (including a Tencent Cloud mode), Meshy and Tripo.
  — [GitHub](https://github.com/ahujasid/blender-mcp)
- **Security and telemetry:**
  - The add-on's socket server "has no authentication or encryption", so keep it on localhost or use an SSH tunnel.
  - `BLENDER_MCP_SAFE_MODE=1` screens scripts for risky operations before they run.
  - An anonymous usage record is collected by default. Content (prompts, code, screenshots) is collected only with opt-in, and `DISABLE_TELEMETRY=true` turns everything off.
  — [GitHub](https://github.com/ahujasid/blender-mcp)
- **Rename date, CVEs, latest release:** A third-party guide says the rename happened on 1 Sep 2026 "to avoid confusion with official blender foundation". It reports four CVEs in 2026, including code injection and a Poly Haven downloader path traversal that was fixed in PR #258 (20 Jul 2026). It gives the latest PyPI release as mcp-for-blender 2.2.6 (28 Oct 2026). Secondary source, not verified on GitHub. — [StraySpark security guide](https://www.strayspark.studio/blog/is-blender-mcp-safe-security-guide-2026)
- **Official Blender Lab MCP server:**
  - Documented at blender.org/lab/mcp-server and hosted at projects.blender.org/lab/blender_mcp.
  - Requires Blender 5.1+ and listens on port 9876 by default, which clashes with other Blender MCP add-ons.
  - Ships an .mcpb bundle for Claude.
  - Reportedly warns that it "will execute LLM generated code in Blender without any guards".
  - Pitched at analysis, debugging and scripting, not at generating art.
  All of this is secondary reporting. — [StraySpark official-server comparison](https://www.strayspark.studio/blog/official-blender-mcp-server-comparison-2026); [developersdigest](https://www.developersdigest.tech/mcp-servers/blender-mcp)
- **Official server version:** A vendor page says the official server was released as v1.0.0 on 27 Apr 2026. — [developersdigest](https://www.developersdigest.tech/mcp-servers/blender-mcp) (unverified)
- **Architecture:** Both the community and official servers use the same design: a Blender add-on runs a TCP socket server, and a separate MCP process relays requests to it. — [StraySpark](https://www.strayspark.studio/blog/is-blender-mcp-safe-security-guide-2026)
- **Infinigen (Princeton):** A procedural generator of photorealistic natural (and later indoor) worlds built on Blender primitives, under a BSD 3-Clause license.
  - It was intended mainly for computer-vision research data.
  - It needs an NVIDIA or Apple Silicon GPU and must be compiled from source.
  - It credits BlenderProc and Blender-FLIP-Fluids among its dependencies or inspirations.
  — [BlenderNation](https://www.blendernation.com/2023/06/19/infinigen-free-and-open-source-procedural-world-generator-in-blender/); [arXiv 2306.09310](https://ar5iv.labs.arxiv.org/html/2306.09310); [Infinigen wiki](https://github.com/princeton-vl/infinigen/wiki)

### Inferences
- **Best automation path:** For video, Claude Code plus plain bpy scripts run with `blender -b file.blend -P script.py -- args` (headless, no MCP needed) is probably the most robust option. It is version-controllable, works on a render farm, and is batchable. MCP is better for interactive look-dev, where Claude takes viewport screenshots and iterates.
- **Choosing between the two MCP servers:** The community server is better for asset and AI-generation glue (Poly Haven, Rodin, Hunyuan3D, Tripo, Meshy built in). The official Lab server is likely better long-term for stability and API correctness, but it seems to have fewer generative hooks.
- **Infinigen** is an underused source of endless procedural nature and interior backdrops and camera-path B-roll. It works well as a "background plate generator" that Claude can drive via CLI/gin configs. (The gin config mechanism is from background knowledge.)
- **Unverified tools:** These are from background knowledge and were not verified for 2026.
  - BlenderProc (DLR, GPL-3.0): a Python pipeline for photoreal synthetic renders.
  - Sverchok (GPL) and Animation Nodes: node-based parametric add-ons. Animation Nodes development has largely stalled since Geometry Nodes matured.
  - Geometry Nodes: built-in procedural modeling and instancing that bpy can construct programmatically.
  - FLIP Fluids: a paid add-on, about $76 on Superhive/Blender Market.

### Gaps
- Could not fetch blender.org/lab, so the official MCP server's exact tool list, release date and license are unconfirmed.
- No 2026 confirmation of the BlenderProc, Sverchok or Animation Nodes status, or of FLIP Fluids pricing.
- The CVE IDs for blender-mcp were not individually verified on NVD.

---

## 2. Game engines for cinematics (Unreal, Unity, Godot): MCP and licensing

### Takeaway
Unreal Engine 5 (Sequencer plus Movie Render Queue or Movie Render Graph, with full editor Python) is the strongest engine for cinematic video. Several community MCP servers (ChiR24, UEMCP, runreal, UE5RC-MCP) let Claude drive it.

Licensing matters for creators. Linear video and film content is not a runtime product, so it falls under the seat model, which is free under $1M annual revenue. It does not fall under the 5% game royalty.

Unity and Godot have third-party MCP bridges (for example GladeKit), but I found no first-party MCP servers from Unity or Godot.

### Cited Findings
- **Epic pricing (game developers):** The 5% royalty above $1M lifetime gross per product is unchanged.
- **Epic pricing (non-game users):**
  - Companies with more than $1M annual gross revenue must buy Unreal Subscription seats.
  - UE stays free for students, educators, hobbyists and companies under $1M.
  - Non-game apps that are licensed to third parties and rely on UE code at runtime still pay royalties.
  — [Epic blog](https://www.unrealengine.com/blog/we-are-updating-unreal-engine-twinmotion-and-realitycapture-pricing-in-late-april)
- **Seat price:** $1,850 per seat per year (the 2024 announcement figure). Check against Epic's current pricing. — [Engadget via engt.co](https://engt.co/3Tyf6ib); [VGC](https://videogameschronicle.com/news/epic-will-start-charging-non-game-developers-for-unreal-engine-use)
- **Twinmotion and RealityScan:** Reportedly, from 27 May 2026, Unreal Subscriptions no longer include Twinmotion and RealityScan. This comes from a search summary of Epic's update and is not directly confirmed. — [Epic blog](https://www.unrealengine.com/blog/we-are-updating-unreal-engine-twinmotion-and-realitycapture-pricing-in-late-april)
- **ChiR24/Unreal_mcp:**
  - MIT license; supports UE 5.0–5.8.
  - Connects over HTTP served by the editor plugin, or over stdio through a Node server.
  - Exposes a single `unreal` tool covering Level Sequences, cameras, Movie Render Queue and Take Recorder.
  — [ChiR24 wiki](https://github.com/ChiR24/Unreal_mcp/wiki/Home)
- **UEMCP (ATDev):**
  - Plugin-free: it uses UE's built-in Python remote-execution protocol and supports UE 5.0–5.7.
  - Claude Code setup: `claude mcp add unreal -- uvx uemcp`.
  - It "executes Python inside your editor process, by design".
  — [PyPI uemcp](https://pypi.org/project/uemcp/); [Glama](https://glama.ai/mcp/servers/ATDev-Inc/uemcp/tree)
- **runreal unreal-mcp:** Python, uses remote execution, needs UE 5.4+. Tools include `editor_take_screenshot` and `editor_move_camera`. — [Playbooks](https://playbooks.com/mcp/runreal-unreal-engine)
- **UE5RC-MCP:** Bridges to the UE5 Remote Control API plus an editor plugin, with 149 tools listed. — [PyPI search result](https://pypi.org/user/owenpkent/) (vendor claim)
- **XaihtUnrealEngineMCP:** Needs UE 5.7+ and the Python Editor Script Plugin. — [GitHub XAIHT](https://github.com/XAIHT/XaihtUnrealEngineMCP)
- **Other UE servers:** Glama lists servers with up to 105 tools covering sequencer, rendering, asset import and editor Python. — [Glama](https://glama.ai/mcp/servers?query=Information+and+Resources+on+Unreal+Engine)
- **Movie Render Graph:** None of the MCP servers found explicitly documents Movie Render Graph support, as opposed to the older Movie Render Queue. — [search, ChiR24 wiki](https://github.com/ChiR24/Unreal_mcp/wiki/Home)
- **GladeKit MCP (Unity and Godot):**
  - Unity: bridge installed via Package Manager on localhost:8765, with 260+ tools.
  - Godot: Godot 4.3+ GDScript only (no C#/Mono, web export or headless) on localhost:8766, with 105 tools.
  - Claude Code sees about 80 curated tools by default.
  - Install: `claude mcp add --transport stdio gladekit-mcp --scope user -- uvx gladekit-mcp`.
  - These are vendor claims.
  — [PyPI gladekit-mcp](https://pypi.org/project/gladekit-mcp/0.7.20/)
- **CoplayDev unity-mcp:** Listed in one comparison as an alternative Unity MCP server. — [PyPI gladekit-mcp](https://pypi.org/project/gladekit-mcp/0.7.20/)

### Inferences
- **Recommended Unreal setup:** Pair Claude Code with UEMCP or ChiR24 to build Level Sequences, place cameras and CineCameraActors, and queue renders. Then render headlessly with `UnrealEditor-Cmd.exe <project> -game -MoviePipelineConfig=...` (command-line rendering is background knowledge).
- **Unreal's free assets** (MetaHumans, Quixel Megascans via Fab, Lumen/Nanite) are the reason to choose UE over Blender for photoreal environments. Verify current Fab and Megascans licensing.
- **Godot** is MIT licensed with no royalties (background knowledge), so it is a good fit for stylized or 2.5D motion graphics where licensing simplicity matters. Its movie-maker mode (`--write-movie`) renders deterministic frame sequences, which suits code-driven video (background knowledge, unverified).
- **Unity** licensing after the 2024 cancellation of the runtime fee was not researched here.

### Gaps
- Not confirmed: whether Unity has shipped a first-party AI/MCP feature (Unity AI / Muse successor) usable from Claude in 2026.
- Not confirmed: whether Epic ships its own MCP or AI assistant in UE 5.7/5.8.
- The current Unreal seat price for 2026 was not confirmed on Epic's live pricing page.

---

## 3. Gaussian splatting, NeRF and feed-forward 3D reconstruction

### Takeaway
The open stack is mature and permissive (nerfstudio, gsplat, Spark), and feed-forward reconstruction (VGGT) now replaces slow COLMAP solves for many shots. That makes "phone video → camera track + splat scene → re-rendered camera move" a scriptable pipeline.

Commercial cloud options include World Labs Marble (generated worlds exported as splats or meshes).

### Cited Findings
- **gsplat:** An Apache-2.0 CUDA library for Gaussian splatting from the nerfstudio project, published in JMLR. — [arXiv 2409.06765](https://arxiv.org/html/2409.06765v1); [JMLR](https://www.jmlr.org/beta/papers/v26/24-1476.html)
- **nerfstudio:** Apache-2.0. Its Splatfacto method implements 3DGS. — [radiancefields.com](https://radiancefields.com/nerf-studio/)
- **Spark (`@sparkjsdev/spark`):**
  - World Labs' MIT-licensed 3DGS renderer for three.js. It launched as "Forge" in June 2025 and was renamed Spark.
  - Splats and meshes share one scene (`SparkRenderer` plus `SplatMesh`), and it needs three.js r180+.
  - Reads PLY, SPZ, SPLAT, KSPLAT and SOG files.
  - Supports real-time splat color editing, displacement, skeletal animation and multi-splat sorting.
  - Spark 2.0 (14 Apr 2026) added streamable LOD for huge scenes.
  — [sparkjs.dev](https://sparkjs.dev/); [GitHub](https://github.com/sparkjsdev/spark); [radiancefields](https://radiancefields.com/platforms/spark)
- **three.js native splats:** three.js r186 reportedly ships a native Gaussian splat renderer with splat raycasting (radiancefields headline, unverified). — [radiancefields](https://radiancefields.com/platforms/spark)
- **VGGT (Oxford VGG and Meta, CVPR 2025):**
  - From 1 to hundreds of images it outputs camera intrinsics and extrinsics, depth with confidence, point maps and 3D point tracks, "typically… in less than 1 second".
  - `demo_colmap.py` exports to COLMAP `sparse/`, with optional bundle adjustment, ready for gsplat training.
  - Licensing: the code license was updated on 29 Jul 2025 to allow commercial use (excluding military). Only the VGGT-1B-Commercial checkpoint is commercial, and the original VGGT-1B is non-commercial. Checkpoint access goes through an auto-approved form.
  — [GitHub facebookresearch/vggt](https://github.com/facebookresearch/vggt)
- **World Labs Marble:**
  - Exports splats as SPZ or PLY (about 2M or 500K splat tiers) and meshes as GLB (collider mesh, plus a high-quality mesh that can take up to an hour).
  - The Free plan cannot export, and high-quality mesh export and commercial rights are on Pro.
  - The World API is pay-as-you-go.
  — [Marble docs](https://docs.worldlabs.ai/marble/export/gaussian-splat)
- **Marble extras:** A beta API task turns posed views into SPZ splats at $5 per run. — [radiancefields](https://radiancefields.com/world-labs-opens-gaussian-splat-creation-in-marble)
- **Marble 1.1:** Adds auto-expanding worlds. — [NYU Shanghai RITS](https://rits.shanghai.nyu.edu/ai/world-labs-releases-marble-1-1-auto-expanding-3d-world-generation)
- **Pricing conflicts:** Third-party pricing details conflict (Standard $20/mo with export, a mesh export costing about $2.80). — [invideo](https://invideo.io/blog/world-labs-marble-3d-worlds/) (conflicts with docs)
- **Claude skills for Marble:** Community "world-labs-skills" Claude skills exist for Marble export workflows. — [skills.cat](https://skills.cat/skills/cloudai-x/world-labs-skills/world-labs-export)

### Inferences
- **Proposed pipeline** (plausible, but not tested end to end in sources):
  1. Shoot a phone orbit.
  2. Extract frames with ffmpeg.
  3. Get cameras from VGGT and export to COLMAP.
  4. Train with gsplat or nerfstudio `ns-train splatfacto`.
  5. Render a new camera path, or load the splat into Spark (web), Blender or Unreal for compositing.
- **Spark** is the most code-friendly real-time splat viewer for Claude-authored HTML/three.js scenes, which can then be screen-captured or rendered frame by frame with Puppeteer.
- **Unverified tools** (background knowledge, not checked for 2026):
  - Jawset Postshot: Windows desktop trainer with a free tier and a paid Indie/Pro tier; has UE and AE plugins.
  - Luma AI: pivoted toward video generation (Ray models), with its splat capture de-emphasized.
  - Polycam: mobile capture plus splats; freemium.
  - SuperSplat: PlayCanvas, MIT, browser splat editor.
  - Unreal splat plugins: Luma UE plugin, XVERSE XScene, Volinga.
  - Blender splat add-ons: KIRI 3DGS Render add-on, "3DGS Render by KIRI".
  - MASt3R/DUSt3R (Naver): CC BY-NC-SA, non-commercial.
  - MegaSaM (Google/Cornell, CVPR 2025): camera and depth from casual dynamic video.
  - 4D/dynamic splats: 4DGS, Shape-of-Motion.

### Gaps
- Postshot pricing and licensing: the search returned junk.
- MegaSaM and MASt3R license terms are not verified.
- Current Luma and Polycam product status is not verified.
- No 2026 source found on mature 4D Gaussian splat tooling for production video.
- Blender and Unreal splat plugin names and licenses are not verified.

---

## 4. Simulation tools (physics, fluids, pyro) and their licensing

### Takeaway
Open, Python-scriptable GPU simulators are ideal for Claude Code: they are pure code with no GUI.
- **Genesis:** Apache-2.0. Rigid, MPM, SPH, FEM, PBD and stable-fluid solvers in one engine.
- **NVIDIA Warp:** Apache-2.0 since 2025. A differentiable CUDA kernel language.

Commercial tools such as Houdini and JangaFX's EmberGen/LiquiGen remain the production standards. They have cheap indie tiers but are harder for an agent to drive.

### Cited Findings
- **Genesis (Genesis-Embodied-AI):**
  - Apache-2.0, announced Dec 2024 by 20+ labs.
  - Integrates Rigid body, MPM, SPH, FEM, PBD and Stable Fluid solvers.
  - Self-reported speed: 10–80x faster than Isaac Gym/MJX, and 43M FPS for a Franka arm on one RTX 4090.
  - The generative "4D world" layer was promised for later.
  — [comfyui-wiki](https://comfyui-wiki.com/en/news/2024-12-19-genesis-universal-physics-engine); [texxr](https://texxr.com/880547/researchers-release-genesis-fast-robot-simulator)
- **Genesis versions:** v0.3.0 was released on 5 Aug 2025, and development is "now officially supported by Genesis AI" (seen on a mirror). — [GitHub mirror](https://github.com/lszformal/Genesis)
- **NVIDIA Warp:**
  - Now Apache-2.0 (earlier versions were under a non-commercial NVIDIA license), with the bundled libmathdx still under an NVIDIA SLA.
  - Its FAQ positions it alongside Numba and Taichi, focused on differentiable physics, and "not a replacement for IsaacGym, IsaacSim, or PhysX".
  — [Warp docs](https://warp.readthedocs.io/); [heise](https://heise.de/-10381872)
- **Warp releases:** A 1.17.0 dev build is on PyPI (July 2026). — [PyPI](https://pypi.org/project/warp-lang/1.17.0.dev20260727/)
- **Houdini pricing (third-party 2026 guides):**
  - Apprentice is free and non-commercial, with watermarked renders.
  - Indie is about $299/yr ($449 for 2 years), for entities with ≤$100K annual gross, and includes up to 3 Indie and 2 Karma licenses.
  - Older listings say $269/yr.
  — [shade.inc](https://shade.inc/blog/sidefx-houdini-pricing-2026-fx-core-indie-license-costs); [superrendersfarm](https://superrendersfarm.com/de/article/how-much-does-houdini-cost); [toolradar](https://toolradar.com/tools/houdini/pricing) (conflicting)
- **EmberGen pricing:**
  - 2023: Indie (under $1M/yr revenue) cost $19.99/mo, with a perpetual license after 18 months, or $299.99 perpetual.
  - An undated brochure says $24.99/mo or $239.99/yr.
  - JangaFX's 2026 pricing page has an Indie/Hobby tier for under $1M revenue or funding.
  — [CG Channel 2023](https://www.cgchannel.com/2023/10/jangafx-ships-embergen-1-0-7/); [JangaFX brochure](https://jangafx.com/downloads/embergen/EmberGen-Pre-Order-Brochure.pdf); [Digital Production Mar 2026](https://digitalproduction.com/2026/03/20/jangafx-makes-its-layoff-assistance-programme-permanent/)
- **JangaFX 2026:** EmberGen 2.0 is a 2026 ground-up rebuild. Six-month free licenses for laid-off artists cover EmberGen, LiquiGen, IlluGen and GeoGen. — [80.lv roadmap](https://80.lv/articles/jangafx-reveals-2026-roadmap); [Digital Production](https://digitalproduction.com/2026/03/20/jangafx-makes-its-layoff-assistance-programme-permanent/)

### Inferences
- **For agent-driven sims:**
  - Genesis or Warp (or Taichi) scripts can export per-frame particles or meshes (PLY/OBJ/Alembic via helper libraries) to Blender for rendering. This is the most Claude-friendly route to fluids, sand, snow and cloth.
  - Houdini has a full Python API (`hou`) and hython for headless cooks, so Claude Code can drive it. Apprentice/Indie restrictions (non-commercial; ≤$100K revenue) apply.
  - EmberGen is GUI- and real-time-first. Agent control is weak; treat it as a human-in-the-loop tool exporting VDB or flipbooks. (Background knowledge.)
- **Blender built-ins (Mantaflow fluids/smoke, rigid body, cloth)** are free but slow. FLIP Fluids (a paid add-on) is the common upgrade, and both are scriptable via bpy (background knowledge).
- **Web physics** (Rapier: Rust/WASM, Apache-2.0; cannon-es: MIT) suits Claude-authored three.js motion graphics captured to video (background knowledge, unverified).

### Gaps
- No 2026 source on Taichi's maintenance status (activity reportedly slowed; unverified).
- No current EmberGen 2.0 pricing.
- Houdini prices not confirmed on sidefx.com.
- No verified MCP server for Houdini or EmberGen was found (not searched in depth).

---

## 5. AI 3D generation, rigging, mocap-from-video and camera tracking

### Takeaway
Open weights now cover image-to-3D (TRELLIS.2, MIT; Hunyuan3D 2.1, with a restrictive Tencent license), single-image objects and bodies (SAM 3D, SAM License, commercial OK) and auto-rigging (UniRig, MIT code).

Hosted APIs (Tripo, Meshy, Rodin) have MCP servers and are wired into the Blender MCP. Video-to-mocap models (GVHMR and similar) are mostly research or non-commercial and depend on SMPL licensing.

### Cited Findings
- **TRELLIS.2 (Microsoft, 4B parameters):** Image-to-3D, released Dec 2025 under MIT; code and dataset are also public. — [HF model card](https://huggingface.co/microsoft/TRELLIS.2-4B/blob/main/README.md); [comfyui-wiki](https://comfyui-wiki.com/news/2025-12-18-microsoft-trellis2-3d-generation)
- **Hunyuan3D 2.1:**
  - Released 13 Jun 2025, "fully open-sourced", with a 3.3B shape model and a 2B PBR paint model, plus training code.
  - VRAM: 10GB for shape, 21GB for texture, 29GB for both.
  - Has a diffusers-style API and Gradio with `--low_vram_mode`.
  — [GitHub Hunyuan3D-2.1](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1)
- **Hunyuan3D 2.1 license (Tencent Hunyuan 3D 2.1 Community License):**
  - The territory excludes the EU, UK and South Korea.
  - Above 1M MAU you need a separate license, granted at Tencent's discretion.
  - Outputs may not be used to improve other AI models.
  — [LICENSE](https://raw.githubusercontent.com/Tencent-Hunyuan/Hunyuan3D-2.1/main/LICENSE)
- **Hunyuan3D 2.0 and Hunyuan3D-Part:** Same EU/UK/South Korea exclusions. — [HF license commit](https://huggingface.co/tencent/Hunyuan3D-2/commit/61f7f039268937ff365927372b4f2f5c9f486792); [Wind River](https://open.windriver.com/info/uni-license-list/licenses/tencent-hunyuan-3d-2.0-cla.html)
- **Hunyuan3D 3.0 Pro:** Appears to be a hosted product. Scenario treats 2.1 as the open-source baseline. — [Scenario help](https://help.scenario.com/articles/5967392966-hunyuan-3d-models-the-essentials) (implied, not explicit)
- **Do not confuse with HunYuan 3.0:** An Apache-2.0 relicense with geographic restrictions dropped was reported for the HunYuan 3.0 (Hy3) LLM, not Hunyuan3D. — [KuCoin news](https://www.kucoin.com/news/flash/tencent-opens-source-huanyuan-3-0-with-apache-2-0-license-halves-hallucination-rate)
- **SAM 3D (Meta):**
  - SAM 3D Objects and SAM 3D Body were released on 19 Nov 2025, with checkpoints, inference code and a parametric human model (MHR).
  - The SAM License is royalty-free and commercial use is allowed, with conditions (pass the license along; trade-control and weapons limits).
  - Sources conflict on the MHR body model's license (Apache-2.0 vs separately licensed).
  — [Meta blog](https://ai.meta.com/blog/sam-3d/); [Roboflow](https://roboflow.com/model-licenses/segment-anything-3); [HF mirror](https://huggingface.co/LibreYOLO/LibreSAM3DBodyh-mesh)
- **UniRig (VAST-AI Research, SIGGRAPH 2025):** An automatic skeleton and skin-weight predictor. The code is MIT, but the checkpoints and training data (Rig-XL, VRoid, Objaverse) carry their own terms. — [comfy.icu](https://comfy.icu/node/BD_AutoRigUniRig); [skillsdirectory](https://www.skillsdirectory.com/skills/akillness-unirig)
- **MCP servers for hosted 3D APIs:**
  - Tripo: official `VAST-AI-Research/tripo-mcp` (uvx; imports into Blender).
  - Meshy: community `meshy-ai-mcp-server` (needs MESHY_API_KEY).
  - Rodin: `rodin-gen2-mcp` (PyPI).
  - `trident-mcp`: one Go server spanning Tripo, Meshy and Rodin, with retopology and format conversion.
  — [tripo-mcp](https://github.com/VAST-AI-Research/tripo-mcp); [meshy-ai-mcp-server](https://github.com/pasie15/meshy-ai-mcp-server); [PyPI rodin-gen2-mcp](https://pypi.org/project/rodin-gen2-mcp/); [Enterprise DNA trident](https://enterprisedna.co/directories/mcp/mordor-forge-trident-mcp)
- **Video mocap:**
  - PromptHMR outputs a GLB with human and camera motion for Blender.
  - GVHMR (ZJU, gravity-aligned human motion from one camera) is reported as non-commercial by third-party wrappers.
  - SMPL and SMPL-X body models need separate licenses.
  — [PromptHMR GitHub](https://github.com/yufu-wang/PromptHMR); [GVHMR GitHub](https://github.com/zju3dv/GVHMR); [ComfyUI-MotionCapture](https://github.com/PozzettiAndrea/ComfyUI-MotionCapture)

### Inferences
- **Commercial-safe open picks:**
  - TRELLIS.2 (MIT) for asset generation.
  - SAM 3D Objects (SAM License) for single-photo props.
  - UniRig code (check the weights' terms) for auto-rigging.
- **Hunyuan3D 2.x** is unusable for EU, UK and Korean creators under its license, and its anti-distillation clause matters for anyone training models.
- **Video-to-mocap commercial reality:** Most open research mocap (GVHMR, WHAM, TRAM) sits behind non-commercial terms plus SMPL licensing. Paid services are the commercial route (Move.ai, Rokoko Vision, DeepMotion, Wonder Dynamics/Autodesk Flow Studio; background knowledge, not verified for 2026).
- **Camera tracking:**
  - Classic and free: the Blender motion tracker (built in, bpy-scriptable), COLMAP (BSD) and GLOMAP (faster global SfM, BSD).
  - AI-era: VGGT-1B-Commercial and MegaSaM for dynamic shots.
  - Pro: SynthEyes (about $300+), not agent-scriptable.
  - These are background knowledge except VGGT.

### Gaps
- No verified license for WHAM, MegaSaM, MASt3R or PromptHMR.
- Hunyuan3D 3.x open-weight status is not confirmed.
- Meshy, Tripo and Rodin pricing and output-ownership terms for 2026 were not researched.
- Stable Fast 3D / SPAR3D (Stability Community License: free under $1M revenue) is not verified for 2026.
- Move.ai, Rokoko and DeepMotion 2026 pricing not researched.

---

## 6. World models / interactive 3D world generation: relevant to video?

### Takeaway
Google's Project Genie (Genie 3) is a consumer-facing world-model "playground" with video export. It is short, closed and subscription-gated.

Tencent's HunyuanWorld 1.0 and Voyager are downloadable but under the territory-restricted Tencent license. World Labs Marble (section 3) is the most production-friendly option because it exports real 3D (splats or meshes) rather than pixels.

### Cited Findings
- **Project Genie launch:** Launched 29 Jan 2026 as an experimental prototype for Google AI Ultra subscribers in the US. It is browser-only, worlds can be explored for 60 seconds, and runs can be exported as short videos. Genie 3's promptable world events are not included. — [YourStory](https://yourstory.com/ai-story/google-deepmind-project-genie-launch); [technews.tw](https://technews.tw/2026/01/30/google-rolls-out-project-genie-access-to-google-ai-ultra-subscribers-in-the-us/); [itdaily](https://itdaily.com/news/cloud/google-launches-project-genie)
- **Project Genie expansion:** At I/O in May 2026, Street View integration arrived for real-place worlds, and the rollout to Ultra subscribers worldwide began 19 May 2026. — [heise](https://heise.de/-11300433); [Gigazine](https://gigazine.net/news/20260520-project-genie-expands)
- **Genie 4:** A single blog claims a trusted-tester research preview (unverified). — [SmartScope](https://smartscope.blog/en/blog/genie-4-release-date-access-differences-genie-3-2026/)
- **Genie 3 research preview:** Announced Aug 2025, interactive at 720p and 24fps. — [cgworld.jp](https://cgworld.jp/flashnews/01-202509-HunyuanWorld-Voyager.html)
- **HunyuanWorld-Voyager:**
  - Open-sourced 2 Sep 2025. It generates world-consistent RGB plus depth video from one image along a user-defined camera path, trained on 100K+ clips.
  - Tencent community license: commercial use is allowed under 1M MAU, and the EU, UK and South Korea are excluded.
  — [cgworld.jp](https://cgworld.jp/flashnews/01-202509-HunyuanWorld-Voyager.html); [The Neuron](https://www.theneuron.ai/explainer-articles/tencent-just-open-sourced-a-3d-world-generator)
- **HunyuanWorld-1.0:** Described by Tencent as "the first open-source, simulation-capable, immersive 3D world generation model". — [Hunyuan3D-2.1 GitHub](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1)

### Inferences
- **What "camera path + depth" models are good for:** Voyager-style models fit establishing shots and parallax moves from a single still. Depth output lets Claude-scripted pipelines reproject the result into Blender or a splat.
- **Project Genie limits:** It is not automatable (no public API found) and is limited to 60s clips. Treat it as a mood or previs tool, not a production renderer.
- **Production recommendation:** For final-quality, code-driven video, prefer world generators that output 3D assets (Marble splats or GLB, HunyuanWorld meshes) and render them in Blender, Unreal or Spark with deterministic cameras.

### Gaps
- No 2026 information found on HunyuanWorld updates (e.g. versions after 1.0 or Voyager).
- No information on Genie API access.
- Other world models were not researched (e.g. Odyssey, Dynamics Lab Mirage, Skywork Matrix-Game, Decart; named from background knowledge only).
