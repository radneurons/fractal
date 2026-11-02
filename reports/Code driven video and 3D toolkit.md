# Turn Claude into your video pipeline engineer

The biggest upgrade for a Claude-assisted video creator in late 2026 is not another generator. It is a **control layer**: Claude Code writes deterministic, frame-indexed code (HTML/GSAP, shaders, bpy, ComfyUI JSON) and drives the stateful apps that code cannot replace through a small set of mature bridges. The strongest of these are **samuelgursky/davinci-resolve-mcp** (about 390 granular tools), **MCP for Blender** (about 33k stars), **8beeeaaat/touchdesigner-mcp** (it returns rendered frames so Claude can see its own work), **Comfy-Org's official comfy-mcp**, and the hosted connectors from Anthropic's 28 April 2026 creative launch, ElevenLabs, fal and Descript. The lesser-known tools that add the most leverage are **glslViewer plus gokayfem/shader-skills** for shader clips, **TypeGPU** and **TiXL** for GPU work, **OpenRive** and **Excalimate** for agent-written vector animation, **Mediabunny** for in-browser encoding, **VGGT → gsplat → Spark** for turning phone footage into Gaussian-splat flythroughs, **Genesis and NVIDIA Warp** for physics you can script, **TRELLIS.2** and **SeedVR2** for permissively licensed 3D and upscaling, and **beat_this**, **python-audio-separator** and **ACE-Step 1.5** for audio. Licensing is the hidden cost:
- **GSAP** is free but bans competing products.
- **Remotion** charges companies of four or more people.
- **Tencent's Hunyuan licenses** exclude the EU, UK and South Korea.
- **Most open video-to-audio foley weights** are non-commercial.
- **Several high-star community skills** ship with no clear license.

Security is the other cost: the community bridges execute arbitrary code, and blender-mcp collected CVEs in 2026. The report ends with ten concrete pipelines that combine these pieces.

A note on evidence: star counts and dates are snapshots taken on or near 2026-11-02. Anything marked **[unverified]** comes from a single secondary source, from conflicting sources, or from the researchers' background knowledge without a 2026 citation. Check those against the primary LICENSE file or model card before you rely on them.

## Two tiers of agent control: hosted connectors and powerful but risky local bridges

By November 2026, connecting Claude to creative software comes in two tiers.

**Tier one: official hosted connectors.** On 28 April 2026 Anthropic launched **nine creative connectors**: Adobe (50+ Creative Cloud tools), Blender, Ableton, Splice, Autodesk Fusion, SketchUp, Affinity by Canva, Resolume Arena and Resolume Wire ([IT Brief UK](https://itbrief.co.uk/story/anthropic-links-claude-to-adobe-blender-ableton); [RedShark News](https://www.redsharknews.com/anthropic-claude-creative-connectors-adobe-blender-autodesk)).
- **Adobe** exposes a remote MCP at `https://adobe-creativity.adobe.io/mcp` covering Photoshop, Illustrator, Firefly, Express, Premiere, Lightroom, InDesign and Stock ([Adobe blog](https://blog.adobe.com/en/publish/2026/04/28/adobe-for-creativity-connector)). Reviewers say it behaves closer to Express/Firefly-level automation than to full desktop Premiere control ([MindStudio](https://www.mindstudio.ai/blog/claude-mcp-adobe-vs-photoshop-premiere-what-it-does)).
- **Other hosted MCPs**, all OAuth with nothing to install: **Figma** at `mcp.figma.com/mcp` ([Figma Help](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server)), **ElevenLabs** at `api.elevenlabs.io/v1/mcp` (the local server is now deprecated) ([GitHub](https://github.com/elevenlabs/elevenlabs-mcp)), **fal** with 1,000+ models ([fal docs](https://fal.ai/docs/documentation/model-apis/mcp.md)) and **Descript** at `api.descript.com/v2/mcp` ([Descript help](https://help.descript.com/api-and-mcp/mcp)).

**Tier two: community local bridges.** These drive desktop apps over sockets and usually go much deeper:
- Resolve, with 390 tools.
- Unity: CoplayDev's MCP for Unity has reached **v10.3.0** ([GitHub](https://github.com/CoplayDev/unity-mcp)).
- TouchDesigner networks.
- REAPER, where shiehn/total-reaper-mcp offers profiles from 15 to 600+ tools ([GitHub](https://github.com/shiehn/total-reaper-mcp)).

The cost of that depth is security. Most of these bridges expose a raw "execute code" tool. **CVE-2026-10688** is a code-injection-to-RCE flaw in Blender MCP's `execute_blender_code`, and the project had not responded at disclosure ([NVD](https://nvd.nist.gov/vuln/detail/CVE-2026-10688)). **CVE-2026-10661** hit its `input_image_url` handling ([SentinelOne](https://www.sentinelone.com/vulnerability-database/cve-2026-10661/)). Combined with prompt injection from downloaded assets or web text, any code-exec tool means local RCE. The practical rules:
- Pin versions.
- Keep Claude Code's permission prompts on for code-exec tools.
- Run in a VM or container without network egress where you can.
- Read `curl | sh` installers before running them.

The REAPER server suggests a second design lesson: giant tool surfaces degrade tool selection, so small task-focused profiles (Resolve's 37-tool "compound" mode, for example) tend to beat "everything" modes.

**Skills are where most of the craft now lives.** Vendor-maintained skills track API changes daily:
- **Remotion Agent Skills** (13 skills, including `/remotion-captions`, `/remotion-maps` with a Cesium flythrough technique, and `/remotion-license`) ([GitHub](https://github.com/remotion-dev/skills)).
- **HyperFrames**, installable as a Claude Code plugin with a ~450-block registry and a `/media-use` skill for music, SFX, voiceover and cutouts ([GitHub](https://github.com/heygen-com/hyperframes)).
- **greensock/gsap-skills** (17.7k stars, MIT) ([GitHub](https://github.com/greensock/gsap-skills)).
- **Software Mansion's TypeGPU skill** ([skills.sh](https://skills.sh/software-mansion-labs/skills/typegpu)).

Discovery runs through Vercel's skills.sh / `npx skills` CLI, launched 20 January 2026. Its leaderboard ranks by anonymous install telemetry, not quality ([qaskills.sh](https://qaskills.sh/blog/skills-sh-agent-skills-directory-guide)). HyperFrames warns that `skills add` can lag `main` by hours. Anthropic's own `anthropics/skills` repo contains no video skills; the only motion-adjacent ones are algorithmic-art, slack-gif-creator and canvas-design ([GitHub](https://github.com/anthropics/skills)).

**The real differentiator is a visual feedback loop.** Shaders and 3D scenes that compile but render black, NaN or blown-out are the typical failure mode of agent-written visuals. The tools that solve it give Claude eyes:
- TouchDesigner MCP's `get_top_image`.
- Blender MCP's `look` tool (viewport, camera, wireframe or render capture) ([GitHub](https://github.com/ahujasid/blender-mcp)).
- shader-skills' headless WebGL2 black-frame and NaN checks.
- The plain Claude Code loop: render five PNG frames, read them, fix, repeat.

For file-based tools (glslViewer, HyperFrames, Remotion, bpy scripts, ffmpeg), Bash plus skills usually beats an MCP wrapper. Several "famous" wrappers are stale: misbahsy/video-audio-mcp was last updated May 2025 and chongdashu/unreal-mcp April 2025 ([GitHub](https://github.com/misbahsy/video-audio-mcp); [GitHub](https://github.com/chongdashu/unreal-mcp)).

## Motion graphics: GSAP is free but fenced, and Rive and Lottie became agent-writable

### State changes in tools you already use

**HyperFrames now has more stars than Remotion**: 77,374 (Apache-2.0) vs 69,892 (custom license) ([HyperFrames](https://github.com/heygen-com/hyperframes); [Remotion](https://github.com/remotion-dev/remotion)). Remotion stays free for individuals and companies of up to three people. Four or more people need a Company License: the Creators plan is $25/seat/month, Automators costs $0.01/render with a $100 monthly minimum, and Enterprise starts at $500/month. Headcounts of collaborating teams combine ([Remotion pricing](https://www.remotion.dev/docs/license/pricing); [FAQ](https://www.remotion.dev/docs/license/faq.md)).

Other changes:
- **Revideo** moved to the `midrender` org as "the engine behind Midrender" ([GitHub](https://github.com/midrender/revideo)).
- **Motion Canvas** last pushed in July 2026 ([GitHub](https://github.com/motion-canvas/motion-canvas)).
- The most-starred **Manim MCP** server, abhiemj/manim-mcp-server (655 stars), has been stale since May 2025 ([GitHub](https://github.com/abhiemj/manim-mcp-server)). **manim-voiceover** (MIT) remains the cleanest way to sync narration to Manim ([GitHub](https://github.com/ManimCommunity/manim-voiceover)).
- **Lottie Creator has an official local MCP** that builds animations inside Creator: `claude mcp add lottiefiles-creator -- npx -y @lottiefiles/creator-mcp@latest`. It needs an open Creator tab with MCP enabled. The hosted LottieFiles MCP only manages animations ([LottieFiles blog](https://lottiefiles.com/blog/working-with-lottie-animations/your-ai-can-now-control-lottie-creator-heres-what-that-actually-means)). airbnb/lottie-web's last push was September 2025, while the Rust/WASM **dotlottie-web** and the C++ **ThorVG** engine are the actively maintained players ([dotlottie-web](https://github.com/LottieFiles/dotlottie-web); [ThorVG](https://github.com/thorvg/thorvg)).

### The web animation runtimes Claude writes directly

**GSAP** (30k stars) became "100% free" in 2025, including the formerly paid SplitText and MorphSVG plugins. It is the de facto timeline layer under HyperFrames and most AI-written HTML video ([gsap-skills README](https://github.com/greensock/gsap-skills)). The license is the catch. GSAP's Standard "No Charge" license is proprietary and tied to Webflow's terms. It forbids "Prohibited Uses" and using GSAP to build "Competitive Products", which forum threads read as visual no-code animation tools that compete with Webflow ([license archive](https://open.windriver.com/info/uni-license-list/licenses/gsap-standard-no-charge-2025.html)). Rendering your own videos is unaffected. Building a motion SaaS on GSAP is not safe. The official gsap-skills README also tells agents to "recommend GSAP" by default, a vendor bias worth knowing about.

The permissive alternatives are:
- **anime.js v4** (74k stars, MIT). It has a `createTimeline()` API whose `sync()` can attach WAAPI animations, timers and other timelines ([GitHub](https://github.com/juliangarnier/anime); [docs](https://animejs.com/documentation/timeline/timeline-methods/sync)).
- **Motion** (35k stars, MIT). Its AI Kit (MCP, `/motion` skills and a visual transition editor) sits behind the paid Motion+ tier ([motion.dev](https://motion.dev/ai-kit)).
- **mo.js**, a "motion graphics toolbelt", and **two.js**, renderer-agnostic 2D (both MIT) ([mo.js](https://github.com/mojs/mojs); [two.js](https://github.com/jonobr1/two.js)).

**Theatre.js should be treated as dormant.** Its last public push was August 2024, development moved to a private repo, and the promised 1.0 has not appeared ([README](https://raw.githubusercontent.com/theatre-js/theatre/main/README.md)).

### Rive and Lottie as agent-writable formats

Rive's runtimes are MIT. The editor is proprietary and now has Luau scripting ([Rive blog](https://rive.app/blog/why-scripting-runs-on-luau)), an in-editor AI coding agent that uses credits, and an official MCP that reportedly requires the Early Access app to be open ([Rive MCP docs](https://rive.app/docs/editor/ai/mcp), search snippet only). Two community projects matter more to agents because they skip the editor entirely:
- **OpenRive** (MIT, 64 stars) is a local-first `.riv` editor whose reader/writer is generated from rive-runtime type definitions. It **round-trips byte-for-byte across 437 runtime test files**, covers state machines and data binding, and ships an MCP server, REST API and TUI ([README](https://github.com/UpstandPlatform/OpenRive)).
- **ODU33104/rive-mcp** is more capable. It generates `.riv` from JSON, including bones, IK, mesh deformation, physics and state machines, and offers 28 motion presets and PNG auto-rigging. But it is "**Freeware, NOT open source**", and forking or redistributing it requires the author's permission ([README](https://github.com/ODU33104/rive-mcp)).

The community **rive-luau-lsp** gives Claude Code a type checker for Rive scripts ([GitHub](https://github.com/ivg-design/rive-luau-lsp)).

### Pro apps with scripting bridges

**After Effects has the richest community MCP scene, but nothing official from Adobe.** Dakkshin/after-effects-mcp (833 stars, MIT) creates comps and text, shape, solid, camera and null layers, and sets properties, keyframes, blend modes and track mattes ([README](https://github.com/Dakkshin/after-effects-mcp)). kumoproductions/mcp-aftereffects (150 stars, MIT, AE 2024–2026) runs the full loop from introspection to render. Its README warns that layer names, expressions and file paths are sent to the AI provider, which matters for NDA work ([README](https://github.com/kumoproductions/mcp-aftereffects)).

**Cavalry became free for individual artists, including commercial work, in April 2026** after Canva acquired it. Studios need a paid Canva account ([CG Channel](https://www.cgchannel.com/2026/04/canva-makes-motion-graphics-and-animation-app-cavalry-free/)). Its JavaScript API and JavaScript Layers make it a strong procedural 2D target for Claude-written scripts. Its MCPs (hralet1/cavalry-assistant, kacperchlebowicz/Cavalry-mcp) are under 35 stars and mostly unlicensed, though ([cavalry-assistant](https://github.com/hralet1/cavalry-assistant)).

**TiXL**, formerly Tooll3 (5.2k stars, MIT), is the sleeper. It is open-source real-time motion graphics that mixes procedural graphs with linear keyframes, custom shaders, MIDI/OSC/Spout input and standalone executable export, and v4 is in development ([README](https://github.com/tixl3d/tixl)). **Natron** (GPL-2.0) offers a headless `natron-python` compositor that Claude can script ([GitHub](https://github.com/NatronGitHub/Natron)). **Penpot**'s official MCP (MPL-2.0, 534 stars) is the open design-source alternative to Figma at the start of a design-to-motion pipeline ([GitHub](https://github.com/penpot/penpot-mcp)).

### Rendering infrastructure and the new agent-plus-timeline editors

**Mediabunny** (7.4k stars, MPL-2.0) is now the foundation for WebCodecs mux and demux. Remotion sponsors it at $1,000/month and deprecated its own Media Parser in its favor on 1 February 2026. Using Mediabunny alone needs no Remotion license ([Remotion blog](https://www.remotion.dev/blog/mediabunny); [GitHub](https://github.com/Vanilagy/mediabunny)).

A new 2026 category also appeared: MIT-licensed editors that a human and Claude edit on the same timeline. Examples are **WeftCut** (driven from any MCP client), **MartinDelophy/ai-video-editor** (931 stars), the Rust/WASM/WebGPU **velocut** and the browser editor **FreeCut** (2.3k stars). All are young and unassessed ([WeftCut](https://github.com/WeftCut/WeftCut); [ai-video-editor](https://github.com/MartinDelophy/ai-video-editor); [velocut](https://github.com/open-ribbi/velocut); [FreeCut](https://github.com/walterlow/freecut)).

The license traps in this group:
- **Diffusion Studio Core**: GitHub reports MPL-2.0, while npm says non-commercial with a paid license once you monetize ([npm](https://npmjs.com/package/%40diffusionstudio%2Fcore)).
- **Concat**, the "CapCut replacement" (13.7k stars): AGPL-3.0 ([GitHub](https://github.com/jub0t/Concat)).
- **MotionForge** and **rerender**: MIT Remotion alternatives, but tiny projects ([MotionForge](https://github.com/codedbytahir/motionforge); [rerender](https://github.com/bevyl-ai/rerender)).

For templated variants at scale, **JSON2Video** has an official MCP (MIT) and Shotstack markets one. Creatomate has only community MCPs, and pricing claims across these vendors conflict ([JSON2Video MCP](https://github.com/JSON2Video/json2video-mcp); [Shotstack](https://shotstack.io/vs/creatomate-alternatives/)).

### Data stories and diagram explainers

**Vizzu** (Apache-2.0) is purpose-built for animated chart-to-chart transitions ([GitHub](https://github.com/vizzuhq/vizzu-lib)). **Penrose** (MIT, 8k stars) generates diagrams from plain-text notation ([GitHub](https://github.com/penrose/penrose)). **Excalimate** (MIT) keyframes Excalidraw diagrams, including camera moves and arrow draw-ons, exports MP4, WebM, GIF or animated SVG, and ships an MCP server. Its README admits much of the code was AI-built and is still being debugged ([README](https://github.com/excalimate/excalimate)).

Community skill packs worth reading:
- **iart-ai/motion-skills**: 56 skills in 19 packs, including Vox-style map animation, MIT ([README](https://github.com/iart-ai/motion-skills)).
- **bangtutorial/bang-motion**: kinetic type and openers, MIT ([GitHub](https://github.com/bangtutorial/bang-motion)).

Several high-star packs, including the Herk Edit Kit (2.5k stars) and anything2explainer (3k), report NOASSERTION licenses. Read them for craft, but don't vendor them into a product ([herk-edit-kit](https://github.com/nateherkai/herk-edit-kit); [anything2explainer](https://github.com/Vincentwei1021/anything2explainer)).

## Video-with-code: a deterministic frame clock matters more than WebGL vs WebGPU

The single rule for agent-written generative video is that **every pixel must be a pure function of the frame index**. Never derive it from `performance.now()` or `requestAnimationFrame` deltas. Three proven capture patterns enforce this:
- **Virtual-clock injection.** timecut overrides the page's JS time functions, snapshots each frame and pipes it to ffmpeg; CCapture.js steps a fake clock one frame at a time ([timecut](https://github.com/tungs/timecut); [CCapture.js](https://spite.github.io/ccapture.js/)).
- **True headless determinism.** puppeteer-capture runs Chrome with `--deterministic-mode --enable-begin-frame-control`, and HyperFrames reportedly does the same with a seek plus `beginFrame` per frame ([puppeteer-capture](https://npmjs.com/package/puppeteer-capture)).
- **In-page encoding.** canvas-record records 2D, WebGL or WebGPU canvases with WebCodecs plus Mediabunny, skipping the screenshot round-trip ([canvas-record](https://github.com/dmnsgn/canvas-record)).

HyperFrames also ships `@hyperframes/shader-transitions` (swirl vortex, gravitational lens and others) and claims frame-identical output locally and in HeyGen's cloud ([HeyGen docs](https://developers.heygen.com/hyperframes-overview)).

### Three.js, TSL and TypeGPU

Three.js remains the center of gravity because Claude has the most training data for it. **WebGPURenderer with TSL**, the node-based shading language that compiles to WGSL or GLSL, is now the forward path, while WebGLRenderer is "still maintained" for pure WebGL 2 ([threejs.org manual](https://threejs.org/manual/en/webgpurenderer.html)). A secondary blog says r182 (December 2025) made WebGPU the recommended renderer **[unverified]** ([youngju.dev](https://www.youngju.dev/blog/culture/2026-05-16-webgpu-webgl-2026-three-js-r3f-babylon-playcanvas-tres-needle-native-webgpu-wgsl-deep-dive)). Expect Claude to hallucinate older `ShaderMaterial` patterns and wrong TSL import paths unless you feed it current examples. Also note that WebGPU may still be missing from stable Chrome on headless Linux render boxes **[unverified, single source]** ([buildmvpfast](https://www.buildmvpfast.com/blog/threejs-webgl-to-webgpu-renderer-migration-2026)). TSL's ability to emit GLSL is your fallback there.

For timeline work, Remotion's `<ThreeCanvas>` syncs React Three Fiber to `useCurrentFrame()` and forces on-demand rendering. Async textures need `advance()` before capture ([Remotion docs](https://www.remotion.dev/docs/three-canvas)).

**TypeGPU** (Software Mansion, MIT) is the most interesting lesser-known WebGPU option. One `d.*` schema defines the GPU type, the CPU buffer layout and the TypeScript type. Shaders can be TypeScript functions marked `'use gpu'` and compiled by a bundler plugin, and an official agent skill exists ([TypeGPU docs](https://docs.swmansion.com/TypeGPU/)). Sources disagree on whether the current line is 0.11 or 0.12 ([OpenReplay](https://blog.openreplay.com/gpu-shaders-typescript-typegpu/)).

### The shortest shader-to-MP4 loop

**glslViewer** renders a fragment shader headless and records video directly. For example, `glslViewer in.frag -w 1920 -h 1080 --headless -E record,out.mp4,0,24,60` records seconds 0 to 24 at 60 fps, and its `frames` command dumps PNG ranges ([GitHub](https://github.com/patriciogonzalezvivo/glslviewer); [wiki](https://github.com/patriciogonzalezvivo/glslViewer/wiki/Interacting-with-GlslViewer)). Pair it with **gokayfem/shader-skills** (MIT, 418 stars), a Claude Code plugin that bundles:
- 186 GLSL functions in 20 modules (SDF raymarching, noise, terrain, water, atmosphere, tonemapping);
- a lint and glslangValidator check;
- 11 Shadertoy templates;
- a headless Playwright/ANGLE WebGL2 harness with 90 GPU property tests and NaN and black-frame detection.

It installs with `claude plugin marketplace add gokayfem/shader-skills` ([GitHub](https://github.com/gokayfem/shader-skills)). Together they close the loop: Claude writes the `.frag`, validates it, renders sample PNGs, looks at them, then records the final clip.

Two license cautions come from background knowledge and are **[unverified]**: public Shadertoy shaders default to CC BY-NC-SA 3.0, and the popular Lygia shader library is dual-licensed (Prosperity non-commercial plus a paid Patron license). Ask Claude to write commercial work from first principles, or from MIT libraries like shader-skills, rather than "remembering" Shadertoy code. A Shadertoy MCP exists only in aggregator listings and only searches shaders ([FlowHunt](https://www.flowhunt.io/mcp-servers/shadertoy)). **ISF**, a GLSL shader with a JSON header declaring its inputs, is a natural "parametric shader asset" format for Claude to emit **[unverified]**.

### Node-based real-time tools

**TouchDesigner** has the most mature creative MCP outside Blender. 8beeeaaat/touchdesigner-mcp (MIT, ~609 stars) has 14 tools, including `execute_python_script`, `get_td_node_errors` and `get_top_image` for visual feedback, plus a Claude Desktop `.mcpb` and a Claude plugin folder ([GitHub](https://github.com/8beeeaaat/touchdesigner-mcp)). The licensing bites, though. The free Non-Commercial key caps output at **1280×1280** and forbids paid work. Commercial costs **$600** and Pro **$2,200** ([Derivative licensing](https://derivative.ca/UserGuide/Licensing)). TouchDesigner is also Windows/macOS only **[unverified]**, which keeps it off Linux render farms.

The open alternatives:
- **cables.gl**: fully MIT, with an open-source offline standalone since July 2025, and it imposes no license on your output ([cables.gl](https://cables.gl/downloads)).
- **vvvv gamma**: free for non-commercial use but needs per-developer licenses commercially ([vvvv blog](https://vvvv.org/blog/2019/vvvv-gamma-licensing)).

No MCP exists for cables, vvvv, Notch, Hydra or glslViewer.

Two native frameworks deserve a look because they ship a frame-indexed clock and a video writer, so no browser capture hack is needed: **OPENRNDR** (Kotlin, BSD-2) and **canvas-sketch** (MIT, `--stream` to ffmpeg) **[unverified for OPENRNDR; canvas-sketch MIT confirmed]** ([canvas-sketch](https://github.com/mattdesl/canvas-sketch)). **Hydra** (AGPL-3.0) has a terse chain syntax that suits LLMs and an `a.fft` audio input ([GitHub](https://github.com/hydra-synth/hydra)).

### Audio-reactive presets

**Butterchurn** (MIT) is a WebGL 2 port of MilkDrop with thousands of presets, distributed separately from the code ([GitHub](https://github.com/jberg/butterchurn)). **projectM** (LGPL-2.1) is the native equivalent ([Wikipedia](https://en.wikipedia.org/wiki/MilkDrop)). Neither is deterministic out of the box. Butterchurn reads a live WebAudio AnalyserNode **[unverified]**, so for video you must inject precomputed per-frame FFT data and a fixed time step.

## Editing: Claude makes the decisions as data, and the NLE is the finishing room

The robust 2026 pattern is to have Claude produce **edit decisions as data** (OTIO, FCPXML, EDL or JSON), then push them into an NLE where a human finishes the job.

### DaVinci Resolve: the most capable target

**samuelgursky/davinci-resolve-mcp** (3.9k stars, MIT, v4.18.4) is the most capable NLE bridge. It offers:
- a 37-tool "compound" mode (recommended) and a 390-tool "full" mode with one tool per Resolve API method;
- timeline ripple and range operations, markers, local transcription, render-queue validation, color, Fusion and Fairlight;
- an optional Node server with **18 offline tools that read and edit `.drp/.drt/.drx` files with Resolve closed**.

It ships a `SKILL.md`, a `CLAUDE.md` and a `.claude` folder ([GitHub](https://github.com/samuelgursky/davinci-resolve-mcp)). External scripting effectively requires **Resolve Studio ($295)**. The project notes that Resolve 21.1 moved Python scripting to Studio, so the free edition only works through an in-app bridge it calls "supported-until-it-is-not". Install from GitHub: the PyPI package of the same name is stale or belongs to someone else ([PyPI](https://pypi.org/project/davinci-resolve-mcp/)).

Resolve 20's native AI complements it:
- **IntelliScript** builds a timeline of best takes matched to a script.
- **AI Multicam SmartSwitch** cuts to whoever is speaking.
- **AI Animated Subtitles** handles captions.
([Yahoo Tech](https://tech.yahoo.com/article/davinci-resolve-20s-latest-ai-feature-can-create-an-entire-timeline-based-on-a-script-120009351.html); [Newsshooter](https://www.newsshooter.com/?p=268330)).

**AutoSubs** (4.5k stars, MIT) captions on-device inside Resolve, Premiere and After Effects. It supports Whisper, Parakeet, Moonshine and Canary and adds speaker labels. The optional MMS forced-alignment weights are CC BY-NC ([GitHub](https://github.com/tmoroney/auto-subs)).

### Final Cut Pro, Premiere and interchange formats

**Final Cut Pro works best through generated FCPXML.** DareDev256's **fcp-mcp-server** (MIT, v0.27.2 released 2026-10-21) groups about 102 operations into 15 tools: transcript cuts, filler and silence removal, markers, roles and rough cuts ([GitHub](https://github.com/DareDev256/fcp-mcp-server)). One practitioner had Claude write raw FCPXML for a 231-clip project from transcripts and still frames alone ([tjsmind](https://tjsmind.com/writing/claude-final-cut-pro)).

**Premiere is workable but brittle.** The leading community MCP says CEP is the production bridge and UXP is experimental ([Adobe_Premiere_Pro_MCP](https://github.com/hetpatel-11/Adobe_Premiere_Pro_MCP)). Mike Chambers' **adb-mcp** is a proof of concept that spans Photoshop, Premiere, After Effects, InDesign and Illustrator through UXP ([GitHub](https://github.com/mikechambers/adb-mcp)).

**OpenTimelineIO** (0.18.1, Apache-2.0) is the neutral interchange layer, but its FCPXML and FCP7 adapters have not had a release since July 2023. Test round-trips against FCPXML 1.11+ ([PyPI](https://pypi.org/project/opentimelineio/); [adapter](https://pypi.org/project/otio-fcpx-xml-adapter/)). A lesser-known trick: **pyJianYingDraft** (~4.8k stars) writes CapCut/JianYing project drafts directly, so Claude can rough-cut a CapCut project ([topic page](https://github.com/topics/video-editing?o=desc&s=stars)).

### Transcript editing, filler removal and captions

**Descript's hosted MCP** (open beta API since 14 May 2026) lets Claude run Underlord agent actions on a hosted transcript editor. Calls cost media minutes and AI credits ([Descript help](https://help.descript.com/api-and-mcp/mcp)).

The open options:
- **FunClip** (Alibaba, 6.5k stars, MIT) clips by transcript and by speaker using Paraformer and CAM++, but it is Chinese-first, and Whisper support for English is "coming soon" ([GitHub](https://github.com/modelscope/FunClip)).
- **CrisperWhisper** is the specialist for verbatim filler-word transcription. Word boundaries land within about 30–41 ms, but its **standard weights are non-commercial** ([GitHub](https://github.com/nyrahealth/CrisperWhisper)).
- **videogrep** uses an "Anti-Capitalist" license that is not OSI-approved ([PyPI](https://pypi.org/project/videogrep/)).

State changes in ASR you already use: **WhisperX 3.8.6** (BSD-2, June 2026), **auto-editor 29.3.1** (Unlicense) and **PySceneDetect 0.7.2** (October 2026). The speed option to add is **NVIDIA Parakeet TDT 0.6B v3**: 6.34% average WER on the Open ASR Leaderboard and an RTFx of about 2,940. NVIDIA's pages disagree on whether its license is CC-BY-4.0 or the "NVIDIA open model license" ([NGC](https://catalog.ngc.nvidia.com/orgs/nvidia/-/collections/parakeet-tdt-0.6b/); [build.nvidia.com](https://build.nvidia.com/nvidia/parakeet-tdt-0_6b/modelcard)). **parakeet-mlx** (Apache-2.0) runs it on Apple Silicon ([PyPI](https://pypi.org/project/parakeet-mlx/)). **stable-ts** (MIT) force-aligns an existing script to audio, which helps when narration was read from a script ([PyPI](https://pypi.org/project/stable-ts/)).

### Reframing, clipping and video understanding

**Google AutoFlip is legacy and unsupported** ([MediaPipe docs](https://mediapipe.readthedocs.io/en/latest/solutions/solutions.html)). The modern recipe is a detector, a tracker and a smoothed virtual camera. Watch the licenses: **Ultralytics YOLO is AGPL-3.0**, while **roboflow supervision** (ByteTrack plus smoothing) is MIT ([PyPI ultralytics](https://pypi.org/project/ultralytics/); [PyPI supervision](https://pypi.org/project/supervision/)). The open clipper wave is led by **openshorts** (~7.4k stars). **podcli** ships its own MCP server, and **hookcut** uses Claude plus YouTube's "most replayed" engagement heatmap to pick moments, a signal few creators exploit ([topic: opusclip-alternative](https://github.com/topics/opusclip-alternative)).

For shot logging and B-roll matching:
- **Twelve Labs' official MCP** offers Marengo semantic search and Pegasus reasoning. Its old `mcp.twelvelabs.io/try` endpoint was retired for `mcp-alpic.twelvelabs.io/try` ([docs](https://docs.twelvelabs.io/docs/advanced/model-context-protocol)).
- **VideoDB Director** is an MIT agent framework ([GitHub](https://github.com/video-db/Director)).
- **Gemini's video API** returns MM:SS timestamps and accepts YouTube URLs directly ([Gemini docs](https://ai.google.dev/gemini-api/docs/interactions/video-understanding?authuser=0)).
- For local ffmpeg work, **KyaniteLabs/mcp-video** (Apache-2.0, released 2026-10-27) is the most complete MCP ([PyPI](https://pypi.org/project/mcp-video/)). **kajisho5/ffmpeg-skill** (4.3k stars, MIT) packages 42 ffmpeg tools behind a machine-readable contract plus an MCP ([GitHub](https://github.com/kajisho5/ffmpeg-skill)).

## 3D and simulation: Blender is the hub, and Gaussian splats are the sleeper

### Blender: two MCP routes

Blender is the most Claude-drivable 3D tool in late 2026, and there are two MCP routes:
- **The community "MCP for Blender"** (formerly blender-mcp, ~33k stars, MIT). It is a socket bridge with `execute_blender_code`, a `look` tool for self-inspection, Poly Haven (CC0), Sketchfab and Poly Pizza asset pulls, and a `generate_3d` tool backed by Hyper3D Rodin, Hunyuan3D, Meshy and Tripo. Its socket has "no authentication or encryption". Set `BLENDER_MCP_SAFE_MODE=1` to screen risky scripts and `DISABLE_TELEMETRY=true` to stop the default anonymous usage records ([GitHub](https://github.com/ahujasid/blender-mcp)).
- **An official Blender Lab MCP server**, reported as v1.0.0 in April 2026. It needs Blender 5.1+, defaults to port 9876 (clashing with other add-ons) and "will execute LLM generated code in Blender without any guards" **[unverified, secondary sources]** ([StraySpark](https://www.strayspark.studio/blog/official-blender-mcp-server-comparison-2026)). It is probably the backend of Anthropic's Blender connector, which is reportedly built by Blender developers ([letsdatascience](https://letsdatascience.com/news/anthropic-connects-claude-to-photoshop-blender-and-ableton-07f24586)).

Use MCP for interactive look-dev. Then freeze the result into a version-controlled `blender -b scene.blend -P build.py -- args` script for headless, batchable renders.

**Infinigen** (Princeton, BSD-3) is an underused generator of photoreal procedural nature and interior worlds built on Blender, which makes it an endless source of B-roll backdrops ([arXiv](https://ar5iv.labs.arxiv.org/html/2306.09310); [wiki](https://github.com/princeton-vl/infinigen/wiki)).

### Game engines for cinematics

**Unreal** (Sequencer plus Movie Render Queue) is the strongest engine for cinematics. Linear film and video content falls under the seat model, which is free below $1M annual revenue, not under the 5% game royalty ([Epic blog](https://www.unrealengine.com/blog/we-are-updating-unreal-engine-twinmotion-and-realitycapture-pricing-in-late-april)). For Claude, use **UEMCP**, which is plugin-free and uses UE's Python remote execution (`claude mcp add unreal -- uvx uemcp`) ([PyPI](https://pypi.org/project/uemcp/)), or **ChiR24/Unreal_mcp** (MIT, UE 5.0–5.8, with Level Sequences, cameras, MRQ and Take Recorder) ([wiki](https://github.com/ChiR24/Unreal_mcp/wiki/Home)). None of them documents Movie Render Graph support yet.

**Godot MCP** (Coding-Solo, MIT) launches and debugs projects through the Godot CLI ([GitHub](https://github.com/Coding-Solo/godot-mcp)). Godot's `--write-movie` deterministic frame export makes it a royalty-free stylized option **[unverified]**.

### Gaussian splats: phone footage to rendered fly-throughs

**Gaussian splatting is now a scriptable pipeline end to end.** The pieces:
- **VGGT** (Oxford VGG and Meta) turns 1 to hundreds of images into camera intrinsics and extrinsics, depth and point maps, "typically in less than 1 second", and exports COLMAP `sparse/` for training. Only the **VGGT-1B-Commercial** checkpoint is cleared for commercial use; the original 1B is non-commercial ([GitHub](https://github.com/facebookresearch/vggt)).
- **gsplat** (Apache-2.0) and nerfstudio's Splatfacto train the splats ([arXiv](https://arxiv.org/html/2409.06765v1); [radiancefields](https://radiancefields.com/nerf-studio/)).
- **Spark** (World Labs, MIT) renders them inside three.js r180+. It mixes splats and meshes in one scene, reads PLY, SPZ, SPLAT, KSPLAT and SOG, supports splat color editing, displacement and skeletal animation, and since **Spark 2.0 (April 2026)** streams LOD for huge scenes ([GitHub](https://github.com/sparkjsdev/spark); [radiancefields](https://radiancefields.com/platforms/spark)).
- **World Labs Marble** generates worlds from prompts and exports SPZ/PLY splats or GLB meshes. Export and commercial rights need a paid plan ([Marble docs](https://docs.worldlabs.ai/marble/export/gaussian-splat)).

Because Spark lives in a web page, a splat becomes just another layer an HTML video framework can capture.

### Simulation

**Physics you can script beats physics you have to click.** **Genesis** (Apache-2.0) unifies rigid, MPM, SPH, FEM, PBD and stable-fluid solvers in Python ([comfyui-wiki](https://comfyui-wiki.com/en/news/2024-12-19-genesis-universal-physics-engine)). **NVIDIA Warp** became Apache-2.0 (its bundled libmathdx stays under an NVIDIA SLA) and is a differentiable CUDA kernel language ([Warp docs](https://warp.readthedocs.io/); [heise](https://heise.de/-10381872)). Both let Claude write a sim, dump per-frame particles or meshes, and render them in Blender.

The production standards are harder for an agent to drive:
- **Houdini Indie** costs about $299/year for entities under $100K revenue. Prices conflict across third-party guides ([shade.inc](https://shade.inc/blog/sidefx-houdini-pricing-2026-fx-core-indie-license-costs)). Its `hou` and hython API makes it scriptable.
- **JangaFX's EmberGen 2.0** is a 2026 ground-up rebuild ([80.lv](https://80.lv/articles/jangafx-reveals-2026-roadmap)). It is GUI-first, so treat it as a human-in-the-loop VDB source.

### AI 3D assets, rigging and motion capture

**Image-to-3D:**
- **TRELLIS.2** (Microsoft, 4B, **MIT**) is the commercially clean image-to-3D pick ([HF](https://huggingface.co/microsoft/TRELLIS.2-4B/blob/main/README.md)).
- **SAM 3D Objects and Body** (Meta's SAM License, commercial use allowed with conditions) reconstruct props and people from single photos ([Meta](https://ai.meta.com/blog/sam-3d/)).
- **Hunyuan3D 2.1** is excellent, but its license **excludes the EU, UK and South Korea**, requires a separate license above 1M MAU, and bans using outputs to improve other models ([LICENSE](https://raw.githubusercontent.com/Tencent-Hunyuan/Hunyuan3D-2.1/main/LICENSE)).

**Rigging:** **UniRig** (MIT code, but the weights carry their own terms) predicts skeletons and skin weights ([comfy.icu](https://comfy.icu/node/BD_AutoRigUniRig)).

**Hosted generators:** Tripo ships an official `tripo-mcp` that imports into Blender, and `trident-mcp` wraps Tripo, Meshy and Rodin in one server ([tripo-mcp](https://github.com/VAST-AI-Research/tripo-mcp)).

**Video mocap** remains research-licensed. GVHMR is reported as non-commercial, and SMPL body models need separate licenses. **PromptHMR** outputs a GLB with human and camera motion for Blender ([PromptHMR](https://github.com/yufu-wang/PromptHMR); [GVHMR](https://github.com/zju3dv/GVHMR)).

### World models

**Google's Project Genie** exports only 60-second explorations and has no public API ([YourStory](https://yourstory.com/ai-story/google-deepmind-project-genie-launch)), so treat it as a mood board. **HunyuanWorld-Voyager** generates RGB plus depth video along a camera path you define, under the territory-restricted Tencent license ([cgworld.jp](https://cgworld.jp/flashnews/01-202509-HunyuanWorld-Voyager.html)).

## AI generation and VFX: open weights for control, closed APIs as interchangeable render backends

### Orchestration through ComfyUI and hosted APIs

**ComfyUI now has a first-party MCP.** Comfy-Org's **comfy-mcp** registers with `claude mcp add comfy-mcp -- comfy-mcp`, and a hosted remote version exists ([Comfy docs](https://docs.comfy.org/agent-tools/local); [GitHub](https://github.com/Comfy-Org/comfy-mcp)). Its exact tool list was not verified. Community servers fill the other niches:
- **artokun/comfyui-mcp** packages slash commands, skills and hooks as a full Claude Code plugin ([wiki](https://github.com/artokun/comfyui-mcp/wiki)).
- **PlateerLab/comfy-workflow-mcp** exposes each saved workflow as a tool and reloads it every run, so an artist tweaks the graph in the UI and Claude calls it. It is source-available, not OSI ([GitHub](https://github.com/PlateerLab/comfy-workflow-mcp)).
- **joenorton/comfyui-mcp-server** (Apache-2.0) adds `view_image` for visual feedback ([GitHub](https://github.com/joenorton/comfyui-mcp-server)).

For reproducibility, a skill holding git-versioned API-format workflow JSON with documented "slots" beats ad-hoc MCP calls.

**fal's hosted MCP** gives Claude 1,000+ models over OAuth or a bearer token. The MCP itself is free and generations are billed per use ([fal.ai/mcp](https://fal.ai/mcp)). Sources conflict on whether Replicate has an official MCP, and only the community `deepfates/mcp-replicate` was verified ([GitHub](https://github.com/deepfates/mcp-replicate)). Your connected **Higgsfield** MCP adds relight, reframe, upscale, outpaint, motion_control and `generate_3d`, so it doubles as a hosted VFX toolbox, not just a generator.

### Open-weight video models

The models worth knowing:
- **Wan 2.2** (Apache-2.0, July 2025) is the newest Wan with verifiably published weights and the base for most community LoRAs. Claims that **Wan 3.0** weights were released are contradicted by other sources and are **[unverified]**, and Wan 2.6 was API-only ([OrcaRouter](https://www.orcarouter.ai/blog/wan-3-0-release-date); [Morphic](https://morphic.com/resources/models/wan-3-0)).
- **LTX-2.3** (March 2026) generates synchronized audio and video in one pass. Its license is listed by one source as Apache-2.0 and by another as dual community/commercial **[unverified]** ([Thunder Compute](https://www.thundercompute.com/blog/best-open-source-ai-video-generation-models); [wavespeed](https://wavespeed.ai/landing/models/best-open-source-video-models-2026)).
- **HunyuanVideo 1.5** leads on photorealism under the Tencent license ([aimagicx](https://www.aimagicx.com/blog/open-source-ai-video-models-comparison-2026)).

Several lesser-known control models are the real VFX power tools. All of the following come from background knowledge and are **[unverified]**: **VACE** (masked inpainting/outpainting and depth- or pose-controlled video-to-video on Wan, Apache-2.0), **Wan2.2-Animate** (actor replacement with relighting), **ReCamMaster** (re-shoot existing footage on a new camera path), **FramePack** (minute-long image-to-video on 6 GB GPUs), and the **lightx2v/Self-Forcing distill LoRAs** that cut Wan to 4–8 steps. **Kijai's ComfyUI-WanVideoWrapper** usually adds new Wan research models within days.

### Closed video models

The closed models work as render backends that Claude picks by cost and capability:
- **Veo 3.1**: about $0.40/s Standard, native audio, 4K.
- **Kling 3.0**: about $0.10/s.
- **Seedance 2.5**: about $0.23/s, up to 30 s.
- **Runway Gen-4.5**: tops the Artificial Analysis leaderboard, but has no audio in its API.

All these prices come from third-party blogs ([teamday.ai](https://www.teamday.ai/blog/best-ai-video-models-2026); [rizzgen](https://rizzgen.ai/blogs/runway-kling-veo-sora-ltx-wan-seedance-comparison)). Reports that **Sora 2's API sunset on 24 September 2026** are **[unverified against OpenAI]**.

### Image models

The commercially clean open picks are **Qwen-Image-Edit-2511** (Apache-2.0) and **FLUX.2 [klein] 4B** (Apache-2.0). FLUX.2 [dev] and [klein] 9B need a BFL commercial license ([builderai.tools](https://builderai.tools/blog/best-open-source-image-generation-stack-2026); [Thunder Compute](https://www.thundercompute.com/blog/best-open-source-image-generation-models)). **Qwen-Image-2.1** (September 2026, native alpha) was reportedly released research-only **[unverified, single blog]** ([rohitraj.tech](https://rohitraj.tech/notes/qwen-image-2-1-commercial-license-alternatives-2026)).

### Rotoscoping, depth and finishing

**Segmentation and matting:**
- **SAM 3 / 3.1** brings text-prompted "find and track everything" segmentation under Meta's gated SAM License ([invideo](https://invideo.io/blog/ai-background-removal-models/)).
- **OpenField** chains SAM 3 tracking (in 250-frame chunks to avoid OOM) with Depth-Anything-V2 to prep footage for diffusion models ([GitHub](https://github.com/jlew23/OpenField)).
- Permissive alternatives are SAM 2 and BiRefNet. MatAnyone, the best hair-level video matting model, and ProPainter are believed to use the non-commercial S-Lab license **[unverified]**.

**Depth and relighting:**
- **Depth Anything 3** has official ComfyUI video-depth workflows ([Comfy docs](https://docs.comfy.org/tutorials/utility/depth-anything-3); [GitHub](https://github.com/ByteDance-Seed/depth-anything-3)). Larger Depth Anything checkpoints have historically been CC-BY-NC **[unverified for DA3]**.
- NVIDIA **DiffusionRenderer** (estimates G-buffers from video and re-renders under new HDR light) and IC-Light are the open relighting options **[unverified]**.

**Upscaling:** **SeedVR2** (3B/7B, **Apache-2.0**) is the standout open video upscaler and has an official ComfyUI node ([Comfy docs](https://docs.comfy.org/tutorials/utility/seedvr2); [comfyorg/comfyui_seedvr2](https://github.com/comfyorg/comfyui_seedvr2)).

**Lip-sync:** the open baselines are **LatentSync** (Apache-2.0, no release since June 2025) and **MuseTalk** (MIT, 30 fps+ but a 256×256 face crop) ([sync.so](https://sync.so/blog/what-is-latentsync); [sync.so](https://sync.so/blog/what-is-musetalk)).

## Audio: permissive stems and music, but foley is a license minefield

**Stem separation has moved past Demucs.** Use **python-audio-separator** (MIT, active), a CLI and library that wraps the UVR model zoo (MDX-Net, VR, Demucs, MDXC). It handles vocals, drums, bass, piano and guitar, plus de-reverb and denoise ([GitHub](https://github.com/nomadkaraoke/python-audio-separator)). Pair it with the BS-RoFormer and Mel-RoFormer checkpoints trained through **ZFTurbo's Music-Source-Separation-Training** (MIT) ([GitHub](https://github.com/ZFTurbo/Music-Source-Separation-Training)).

**Music generation:**
- **ACE-Step 1.5** (repo MIT, model card permits commercial use of outputs) is the strongest permissively licensed music model ([GitHub](https://github.com/ace-step/ACE-Step-1.5); [HF](https://huggingface.co/ACE-Step/acestep-v15-base/blob/main/README.md)). **YuE** (Apache-2.0) does lyrics-to-song ([GitHub](https://github.com/multimodal-art-projection/YuE)).
- **Suno and Udio have become walled gardens after their label settlements**, which makes them poor fits for automated pipelines. Suno's licensed models launched around September 2026 with download caps (reportedly 20 a month on Pro), and Udio has disabled all downloads since October 2025 ([ProPakistani](https://propakistani.pk/2026/09/10/suno-launches-licensed-ai-music-models-after-warner-copyright-settlement/); [ForkLog](https://forklog.com/en/suno-imposes-music-download-limits-amid-legal-and-content-concerns/); [Billboard](https://www.billboard.com/pro/what-suno-udio-licensing-deals-mean-future-ai-music/)).

**Video-to-audio foley is the biggest license trap in the stack:**
- **MMAudio** has MIT code but **CC-BY-NC checkpoints** ([GitHub](https://github.com/hkchengrex/MMAudio)).
- **HunyuanVideo-Foley** excludes the EU, UK and South Korea ([GitHub](https://github.com/Tencent-Hunyuan/HunyuanVideo-Foley)).
- **ThinkSound** says "Apache 2.0" and "Commercial use is NOT permitted" in the same README ([GitHub](https://github.com/FunAudioLLM/ThinkSound)).

For commercial SFX, use ElevenLabs through its hosted MCP.

**Beat and structure analysis:** **beat_this** (CPJKU, MIT, active) is the modern beat and downbeat tracker ([GitHub](https://github.com/CPJKU/beat_this)). It matters because the alternatives carry obligations: madmom's model files are CC BY-NC-SA, Essentia is AGPL-3.0, and all-in-one's intro/verse/chorus segmentation (MIT) has been stale since 2023 ([madmom](https://github.com/CPJKU/madmom); [Essentia](https://github.com/MTG/essentia); [all-in-one](https://github.com/mir-aidj/all-in-one)).

**TTS beyond Chatterbox:**
- **Kokoro** (82M, Apache-2.0) for tiny, fast narration ([GitHub](https://github.com/hexgrad/kokoro)).
- **Dia** (Apache-2.0) for dialogue ([GitHub](https://github.com/nari-labs/dia)).
- **IndexTTS2** for duration-controlled dubbing that fits a fixed video length. It is under a bilibili license with MAU and revenue thresholds ([GitHub](https://github.com/index-tts/index-tts)).
- **Fish Speech/OpenAudio** is free only under a revenue threshold and prohibits hosted services without a license ([GitHub](https://github.com/fishaudio/fish-speech)).
- **VibeVoice**'s long-form code was pulled by Microsoft in September 2025 over misuse ([windowsnews.ai](https://windowsnews.ai/article/microsoft-pulls-vibevoice-tts-code-after-misuse-shifts-to-open-source-asr-and-real-time-models.378734)).

**Finishing and DAW control:**
- **ffmpeg-normalize** (active) wraps EBU R128 two-pass loudnorm ([GitHub](https://github.com/slhck/ffmpeg-normalize)).
- **Spotify Pedalboard** loads VST3/AU plugins from Python but is **GPL-3.0** ([GitHub](https://github.com/spotify/pedalboard)).
- **total-reaper-mcp** (MIT) drives REAPER, and **ahujasid/ableton-mcp** (MIT) drives Live directly, unlike the documentation-grounded official Ableton connector ([REAPER MCP](https://github.com/shiehn/total-reaper-mcp); [ableton-mcp](https://github.com/ahujasid/ableton-mcp)).

## Ten pipelines that combine these tools

Each recipe below assumes Claude Code as the orchestrator: background Bash for long renders, subagents to fan out across shots, and a hook that runs `ffprobe` after every render to check duration, frame count and codec. The recurring design move is to compute every signal (beats, masks, cameras, depth) offline into JSON or image sequences keyed by frame index, so the render stays deterministic and re-runnable.

### 1. Stem-aware beat-synced shader visuals

Run `python-audio-separator` on the track to split drums, bass and vocals. Run **beat_this** on the full mix for beats and downbeats, and compute per-frame RMS and onset strength for each stem at the video's fps. Have Claude write `features.json`: one row per frame with `kick`, `bassEnergy`, `vocalPresence` and `isDownbeat`.

Claude then writes a raymarched `.frag` using shader-skills' SDF and noise modules. Drums drive camera shake and SDF displacement, bass drives fog density, vocals drive hue rotation, and downbeats trigger scene cuts. Bake the features into a 1×N data texture, or emit one uniform block per frame. Before the full `glslViewer -E record` pass, render ten sample frames and let Claude inspect them against the black-frame and NaN checks.

For a version with typography, put the shader inside a HyperFrames composition, use `@hyperframes/shader-transitions` on downbeats, and animate GSAP SplitText lyrics from WhisperX word timings. The license-clean core is MIT/Apache throughout. Avoid madmom and Essentia if you plan to ship the tool.

### 2. Phone-to-splat flythrough composited in HTML video

Shoot a slow orbit on a phone and extract frames with ffmpeg at 2–3 fps. Run VGGT-1B-Commercial to get cameras and export COLMAP, then train with gsplat or `ns-train splatfacto`. Load the PLY or SPZ into a three.js page with **Spark**, and have Claude write a camera spline whose position is a pure function of the frame number (Catmull-Rom through hand-picked keyframes, with ease-in/out).

Render it inside HyperFrames, or inside Remotion's `<ThreeCanvas>` if Spark's r180+ requirement matches Remotion's three version **[compatibility unverified]**. Layer Vizzu data callouts or kinetic type over the splat. Spark's splat color editing can grade the world to the brand palette.

To go further, generate the world with **Marble** instead of a capture. Or add Genesis-simulated particles as mesh layers in the same scene, since Spark mixes splats and meshes.

### 3. Text-prompted rotoscope plus depth relight

Prompt SAM 3 with "the presenter" to get per-frame masks. Refine the edges with BiRefNet, or with MatAnyone for hair (non-commercial **[unverified]**). Run Depth Anything 3's video workflow through comfy-mcp.

Claude then builds a Blender compositor graph with bpy. The plate goes in as a background, the depth map drives a volumetric fog and a depth-of-field pass, and the matte isolates the subject so a new HDRI-lit background (Poly Haven CC0) and a rim-light gradient sit behind and around them. For heavier relighting, send keyframes through DiffusionRenderer **[unverified]** or Higgsfield's `relight_image`. Export EXR with alpha to Resolve, and have davinci-resolve-mcp place the passes on tracks and queue the render.

The license-clean variant is SAM 2 + BiRefNet + a permissively licensed depth checkpoint.

### 4. Claude-directed procedural Blender scenes, frozen into code

Use the Blender MCP's `look` tool for look-dev. Claude builds a Geometry Nodes scatter, pulls Poly Haven textures, generates a hero prop with TRELLIS.2 (or Tripo via `tripo-mcp`), auto-rigs it with UniRig, and inspects viewport captures until the shot works.

Then comes the step most creators skip. Ask Claude to **export the session as a parameterized `build.py`** (seed, palette, camera path, frame range) and render headless with `blender -b -P build.py -- --seed 7`. One look-dev session then yields a family of variants for a series, rendered on any GPU box. Infinigen can supply background plates. Run the MCP with safe mode on and telemetry off, and keep a backup of the .blend.

### 5. Transcript-driven edit delivered to Resolve with B-roll

Transcribe with WhisperX, or Parakeet for speed. Add CrisperWhisper's verbatim pass if you can license it, so fillers and stutters are explicit tokens. Claude reads the transcript against your outline, selects keeper spans, drops fillers and retakes, and writes an OTIO timeline.

At the same time, index your B-roll library with Twelve Labs Marengo. Claude extracts nouns and topics per A-roll sentence, runs semantic search, and places matches as cutaways on V2. davinci-resolve-mcp's compound mode imports the timeline, adds chapter markers from the outline, applies a caption track via AutoSubs, and validates the render queue. Its offline `.drp` tools can stamp provenance notes without opening Resolve.

On Final Cut Pro, swap the last stage for fcp-mcp-server's FCPXML.

### 6. Engagement-signal shorts factory

Pull a long video with yt-dlp, or through kevinwatt's yt-dlp MCP ([GitHub](https://github.com/kevinwatt/yt-dlp-mcp)). Fetch its "most replayed" heatmap, hookcut-style, and have Claude score transcript windows by combining replay peaks with hook strength. For each window, build a 9:16 reframe from MediaPipe faces plus supervision's ByteTrack with an EMA-smoothed crop. Keeping this MIT means avoiding Ultralytics. Render word-highlight captions in a HyperFrames block and normalize to -14 LUFS with ffmpeg-normalize **[target unverified]**.

Claude can also run your connected Higgsfield `virality_predictor` on the drafts before you pick which to post. The stack is commodity, and the edge is the replay signal.

### 7. Agent-authored vector graphics system for a channel

Have Claude design a lower-third and transition kit as Rive state machines through **OpenRive's MCP** (MIT, editor-free), or as Lottie through the **Lottie Creator MCP**. Data binding lets one `.riv` file take name, title and color inputs. Drop the assets into HyperFrames or Remotion compositions with the MIT runtimes.

Store the design tokens in HyperFrames' `frame.md` design-system file, so every future episode inherits typography, color and motion rules. That turns a one-off prompt into a reusable brand system.

### 8. Physics title sequences from simulation code

Claude writes a Genesis MPM or SPH script in which sand or liquid pours onto letterforms meshed from your logo SVG. It exports per-frame meshes or particles, and a bpy script renders them with Cycles and a Poly Haven HDRI. Alternatively, keep it in the browser with three.js and Rapier physics **[unverified]**, stepped at a fixed timestep per frame and captured by HyperFrames.

Because the sim is code, Claude can tune viscosity, emitter timing and camera to land the logo reveal on a downbeat from recipe 1's `features.json`.

### 9. License-aware generative B-roll with a QA loop

Encode a "commercial-safe model registry" skill: Wan 2.2, VACE, FLUX.2 klein 4B, Qwen-Image-Edit-2511, SeedVR2, TRELLIS.2 and ACE-Step are allowed, while FLUX dev, MMAudio, ProPainter, MatAnyone and Hunyuan (for EU/UK clients) are refused. Claude turns a script into a shot list (JSON with duration, camera, reference images and a backend chosen by cost per second and audio need).

It generates keyframes with Qwen-Image, then motion with Wan 2.2 locally through comfy-mcp, or with Veo, Kling or Seedance through fal or Higgsfield. It interpolates with RIFE, upscales with SeedVR2, inspects sampled frames for artifacts, and re-queues failures. Subagents fan out per shot. The registry skill is the high-value artifact, because it prevents an NC model from silently reaching client work.

### 10. Live-to-render TouchDesigner visuals with machine eyes

For installations or VJ-style content, Claude builds a TouchDesigner network through touchdesigner-mcp: an audio spectrum CHOP feeding GLSL TOPs and an instancing SOP. After each change it calls `get_top_image` to see the output and `get_td_node_errors` to debug. It then switches Movie File Out to non-realtime for a frame-accurate export **[mechanism unverified]**.

Remember the free key's 1280×1280 cap and its ban on paid work. The open path is the same network idea in cables.gl, or a Hydra sketch with precomputed FFT, captured by puppeteer-capture.

## License and commercial-use quick reference

| Tool | License as reported | Commercial use for a creator | Key caveat / maturity |
|---|---|---|---|
| HyperFrames | Apache-2.0 | Yes | 77k stars, daily commits |
| Remotion | Custom | Free ≤3 people; paid Company License at 4+ | Team headcounts combine |
| GSAP (+ gsap-skills) | Proprietary "No Charge" (skills MIT) | Yes for videos | No competing no-code/visual tools; Webflow can change terms |
| anime.js / Motion / mo.js / two.js / PixiJS | MIT | Yes | Motion AI Kit needs paid Motion+ |
| Theatre.js | Apache-2.0 | Yes | Dormant since Aug 2024 |
| Rive runtimes / OpenRive | MIT | Yes | OpenRive is very young |
| ODU33104/rive-mcp | Freeware, not OSS | Use only | No forks or redistribution |
| Lottie Creator MCP / dotlottie-web / ThorVG | Vendor tool / MIT / MIT | Yes | Creator MCP needs an open Creator tab |
| Cavalry | Proprietary, free for individuals | Yes (individuals) | Studios need paid Canva; MCPs immature |
| TiXL | MIT | Yes | v4 in development |
| Natron / Synfig / etro | GPL-2.0 / GPL-3.0 / GPL-3.0 | Output yes | Copyleft if you distribute modified code |
| Hydra / Concat | AGPL-3.0 | Output yes | AGPL bites hosted services |
| Mediabunny | MPL-2.0 | Yes | File-level copyleft |
| Diffusion Studio Core | Conflicting (MPL vs non-commercial) | **Unclear** | Resolve before monetizing |
| TouchDesigner | Proprietary | Paid key only ($600 / $2,200) | Free key: 1280×1280, no paid work |
| cables.gl | MIT | Yes | No MCP |
| vvvv gamma | Proprietary | Per-developer license | Free for non-commercial use |
| shader-skills / glslViewer | MIT / BSD-MIT **[verify upstream]** | Yes | Code library is MIT |
| Shadertoy code / Lygia | CC BY-NC-SA default / Prosperity + Patron **[unverified]** | **No** without permission/sponsorship | LLM recall risk |
| three.js / TypeGPU / Spark | MIT | Yes | WebGPU on headless Linux uncertain |
| davinci-resolve-mcp | MIT | Yes | Needs Resolve Studio ($295) |
| fcp-mcp-server / OTIO | MIT / Apache-2.0 | Yes | OTIO FCPXML adapter stale since 2023 |
| Descript MCP | Commercial SaaS | Yes, credits | Cloud upload |
| CrisperWhisper | MIT code, NC weights | **No** with standard weights | Pro weights are paid |
| Parakeet TDT v3 | CC-BY-4.0 vs NVIDIA open model license | Likely yes **[conflict]** | Check card |
| Ultralytics YOLO | AGPL-3.0 | Output yes; product needs Enterprise | Use supervision + MediaPipe instead |
| videogrep | "Anti-Capitalist" | **Check** | Not OSI |
| MCP for Blender | MIT | Yes | CVE-2026-10688/10661; telemetry on by default |
| Blender Lab MCP | Unverified | Unverified | Executes code without guards |
| Unreal Engine | Proprietary | Free <$1M revenue for linear content | Seats above $1M |
| Godot / Coding-Solo MCP | MIT **[Godot unverified]** / MIT | Yes | — |
| Infinigen | BSD-3 | Yes | Compile from source; GPU needed |
| gsplat / nerfstudio | Apache-2.0 | Yes | — |
| VGGT | Code commercial; 1B weights NC | Only the **VGGT-1B-Commercial** checkpoint | No military use |
| World Labs Marble | Commercial SaaS | Pro plan | Free plan cannot export |
| Genesis / NVIDIA Warp | Apache-2.0 | Yes | Warp's libmathdx under NVIDIA SLA |
| Houdini Apprentice / Indie | Proprietary | No / ≤$100K revenue | Pricing sources conflict |
| TRELLIS.2 | MIT | Yes | — |
| SAM 3 / 3.1 / SAM 3D | SAM License (gated) | Yes, with conditions | Not OSI; pass the license along |
| Hunyuan3D 2.x, HunyuanVideo, HunyuanVideo-Foley, Voyager | Tencent Community License | Not in EU/UK/South Korea; MAU caps | Anti-distillation clause |
| Wan 2.2 / VACE | Apache-2.0 **[VACE unverified]** | Yes | Wan 3.0 weights unconfirmed |
| LTX-2 / 2.3 | Conflicting (Apache vs dual) | **Verify** | Revenue threshold likely |
| FLUX.2 klein 4B / dev, klein 9B | Apache-2.0 / non-commercial | 4B yes; others need BFL license | — |
| Qwen-Image-Edit-2511 / Qwen-Image-2.1 | Apache-2.0 / research-only **[unverified]** | Yes / No | — |
| SeedVR2 | Apache-2.0 | Yes | VRAM-hungry |
| MatAnyone / ProPainter | S-Lab NC **[unverified]** | **No** | Use BiRefNet / MiniMax-Remover **[license unverified]** |
| LatentSync / MuseTalk | Apache-2.0 / MIT | Yes | LatentSync stale; MuseTalk 256px face |
| comfy-mcp / PlateerLab comfy-workflow-mcp | Official / source-available | Yes / check terms | — |
| python-audio-separator / MSST | MIT | Yes | Check each checkpoint |
| ACE-Step 1.5 / YuE | MIT (wiki says Apache) / Apache-2.0 | Yes | — |
| MusicGen weights / MMAudio / ThinkSound | CC-BY-NC / CC-BY-NC / "Apache" + no commercial | **No** | Read READMEs, not badges |
| Suno / Udio | Commercial SaaS | Capped downloads / no downloads | Breaks automated pipelines |
| beat_this / madmom models / Essentia | MIT / CC BY-NC-SA / AGPL-3.0 | Yes / No / output yes | — |
| Kokoro / Dia / Orpheus | Apache-2.0 | Yes | Weight licenses not re-verified |
| Fish Speech / IndexTTS2 | Custom thresholds | Under revenue/MAU limits | No hosted service without a license (Fish) |
| Pedalboard | GPL-3.0 | Output yes | Copyleft if distributed |
| Herk Edit Kit, anything2explainer, motion-graphics packs | NOASSERTION | **Unclear** | Read, don't vendor |

## Conclusion

The pattern across every category is that **the moat has moved from generation to determinism, feedback and licensing hygiene**. Generators are interchangeable backends priced per second. Creators who stand out in 2026 have Claude produce re-runnable artifacts: a frame-indexed shader, a `build.py`, an OTIO timeline, versioned ComfyUI JSON and a `features.json` of beats. Claude also gets eyes on every render, and a registry skill routes around non-commercial weights. The tools that enable this are rarely the famous ones: glslViewer, shader-skills, OpenRive, Excalimate, Mediabunny, VGGT, Spark, Genesis, SeedVR2, beat_this and the Resolve MCP's offline project tools all sit below the star-count radar.

Two things to watch. First, **official connectors are converging with community bridges**: the Blender Lab server, Adobe's hosted MCP and Descript's MCP will likely absorb the safest 80% of community functionality. The deep, code-executing bridges will remain the power-user tier, and the security burden of running them will stay with you. Second, **license terms are drifting in both directions**: VGGT and Warp opened up for commercial use, while Qwen-Image-2.1, Suno and Udio closed down. Re-check the license table quarterly rather than treating it as settled.
