# Shaders, Creative Coding & Real-Time Visuals for Code-Driven Video (as of Nov 2026)

Scope: shaders (GLSL/WGSL), WebGL/WebGPU frameworks, generative-art frameworks, node-based real-time tools, deterministic frame capture to MP4, and how Claude / Claude Code drives them (MCP servers, skills).

Method note: ~17 tool calls. Items marked **[prior knowledge, unverified]** come from the researcher's training data (cutoff mid-2026) and were NOT re-verified in this session; the report writer should treat them as plausible but needing confirmation. www.heygen.com was unreachable from the sandbox (network allowlist), so HeyGen's own engineering write-up was only seen via search snippets.

---

## 1. Which web GPU/3D frameworks matter for AI-authored video, and what is their state?

### Takeaway
Three.js remains the center of gravity: its WebGPURenderer + TSL (node-based shading language that compiles to WGSL or GLSL) became the recommended path around r182 (Dec 2025), while WebGLRenderer is still maintained. For video generation, the key property is not WebGL vs WebGPU but whether the scene can be driven by an external frame clock (Remotion's `<ThreeCanvas>` does this for R3F). TypeGPU (Software Mansion) is the most interesting lesser-known WebGPU option: type-safe, lets you write shaders as TypeScript functions, MIT.

### Cited Findings
- Three.js manual: WebGPURenderer "comes with a new node-based material system" and supports TSL (three.js shading language); WebGLRenderer "is still maintained and the recommended choice for pure WebGL 2 applications." — [threejs.org manual](https://threejs.org/manual/en/webgpurenderer.html)
- r182 (Dec 2025) reportedly promoted WebGPURenderer to the recommended renderer (secondary blog, May 2026; not confirmed against official release notes). — [youngju.dev deep dive](https://www.youngju.dev/blog/culture/2026-05-16-webgpu-webgl-2026-three-js-r3f-babylon-playcanvas-tres-needle-native-webgpu-wgsl-deep-dive)
- WebGPU in three.js requires r171+; migration is close to a one-line renderer swap plus `await renderer.init()` before rendering. — [utsubo migration guide (JP, Jan 2026)](https://www.utsubo.com/ja/blog/webgpu-threejs-migration-guide); [buildmvpfast](https://www.buildmvpfast.com/blog/threejs-webgl-to-webgpu-renderer-migration-2026)
- Browser caveat: one mid-2026 blog claims WebGPU is not in stable on Linux, Intel Macs and Android (single source; relevant because headless Linux render farms are where video is usually rendered). — [buildmvpfast](https://www.buildmvpfast.com/blog/threejs-webgl-to-webgpu-renderer-migration-2026)
- Remotion `<ThreeCanvas>` wraps React Three Fiber's Canvas and synchronizes with `useCurrentFrame()`; animations must be written declaratively from the frame number; during render it overrides `frameloop` so the scene only updates on demand; async texture updates need `advance(performance.now())` before capture. — [Remotion docs: three-canvas](https://www.remotion.dev/docs/three-canvas)
- Community Remotion skills state that `useFrame()` from R3F is forbidden inside ThreeCanvas, ThreeCanvas needs explicit width/height, and `<Sequence>` inside it needs `layout="none"` (third-party skill pages, not official docs). — [skillselion remotion-best-practices](https://skillselion.com/skills/ncklrs/startup-os-skills/remotion-best-practices)
- TypeGPU: Software Mansion's TypeScript library for type-safe WebGPU; one `d.*` schema defines GPU type, CPU buffer layout and TS type; shaders can be TypeScript functions marked `'use gpu'` compiled via `unplugin-typegpu`, or WGSL, chosen per function; `tgpu-gen` converts WGSL files to TypeGPU definitions. MIT. — [TypeGPU docs](https://docs.swmansion.com/TypeGPU/); [tgpu-gen](https://docs.swmansion.com/TypeGPU/tooling/tgpu-gen/); [SWM blog](https://swmansion.com/blog/type-safety-in-webgpu-applications-the-typegpu-approach-5df019ac6a61)
- TypeGPU versions conflict: a skill targets 0.11.2, while a 2026 article says the 0.12 line shipped Aug 12, 2026. There is an official Software Mansion agent skill for TypeGPU on skills.sh. — [skills.sh typegpu](https://skills.sh/software-mansion-labs/skills/typegpu); [OpenReplay](https://blog.openreplay.com/gpu-shaders-typescript-typegpu/)

### Inferences
- [prior knowledge, unverified] Licenses: three.js MIT; React Three Fiber, drei, @react-three/postprocessing (pmndrs) MIT; Threlte (Svelte + three) MIT; Babylon.js Apache-2.0 (has its own WebGPU engine and a Node Material Editor that is very LLM-friendly because materials serialize to JSON); PlayCanvas engine MIT (editor is a hosted commercial service); OGL (minimal WebGL lib by Nathan Gordon) Unlicense; regl (functional WebGL) MIT, largely in maintenance mode; twgl.js MIT, thin WebGL helper; Use.GPU (Steven Wittens) MIT, reactive/declarative WebGPU, low adoption/experimental.
- For Claude: three.js + R3F has by far the most training data, so Claude produces working code most reliably there. TSL is newer and LLMs often hallucinate older GLSL `ShaderMaterial` patterns or wrong TSL import paths (`three/tsl`, `three/webgpu`) — expect to give Claude the current docs/examples. TypeGPU explicitly ships an agent skill, which mitigates this.
- For deterministic video, WebGL2 in headless Chrome (ANGLE/SwiftShader or GPU) is the safer default in late 2026; WebGPU in headless Linux depends on Chrome flags/driver availability. TSL's ability to emit GLSL for WebGL2 fallback means TSL-authored materials can still render on a CPU-only render box.

### Gaps
- Exact current three.js release number in Nov 2026 and official confirmation of the r182 "recommended renderer" claim — official release notes not fetched.
- Whether Remotion's `<ThreeCanvas>` officially supports WebGPURenderer (R3F v9 supports async `gl` factories; not verified).
- Remotion licensing terms (free for individuals/small companies, paid company license above a threshold — [prior knowledge, unverified]; search did not return the license page).

---

## 2. Shader authoring tools and libraries (Shadertoy, ISF, glslViewer, Lygia, hydra, etc.)

### Takeaway
For AI-generated shader video the most useful lesser-known tool is **glslViewer**: a CLI that renders a fragment shader headless and records MP4/GIF/PNG sequences directly, which makes it a perfect "render target" for Claude Code. Shadertoy is the lingua franca for shader code (mainImage convention) that LLMs know best, but its default content license is non-commercial. Lygia is the go-to shader function library but has a non-permissive dual license.

### Cited Findings
- glslViewer (Patricio Gonzalez Vivo) supports headless rendering and PNG-sequence export. — [glslViewer GitHub](https://github.com/patriciogonzalezvivo/glslviewer)
- Headless record example: `glslViewer input.frag -w 1920 -h 1920 --nocursor --headless -E record,output.mp4,0,24,60` (record from second 0 to 24 at 60 fps), then re-encode with ffmpeg. — [community gist](https://Gist.github.com/devloop01)
- glslViewer `record` command records MP4/GIF from second A to B at a given fps (default 24); `frames` saves images between two frame numbers. — [glslViewer wiki](https://github.com/patriciogonzalezvivo/glslViewer/wiki/Interacting-with-GlslViewer)
- glslViewer 3.2.4 license listed as "BSD MIT" with ffmpeg an optional dependency (Gentoo overlay, third-party; verify upstream LICENSE). — [gpo.zugaina.org](https://gpo.zugaina.org/media-gfx/glslViewer)
- Shadertoy MCP server: aggregator listings describe tools `get_shader_info` and `search_shader` (retrieve/search Shadertoy shaders by prompt); install methods conflict (npx `@shadertoy/mcp-server` vs. Python/uv); one listing says last updated ~11 months ago. No official Shadertoy source found. — [FlowHunt](https://www.flowhunt.io/mcp-servers/shadertoy); [llmbase.ai](https://llmbase.ai/de/mcp-servers/shader-toy/)

### Inferences
- [prior knowledge, unverified] Shadertoy: browser-based GLSL ES 3.0 playground; public shaders default to CC BY-NC-SA 3.0 unless the author states otherwise — so copying Shadertoy code (or letting Claude "remember" it) into commercial video is a license risk. The Shadertoy MCP above is a read/search tool (useful as retrieval for reference), not a renderer.
- [prior knowledge, unverified] ISF (Interactive Shader Format, VIDVOX): GLSL fragment shader + JSON header declaring inputs (floats, colors, images, audio); supported by VDMX, Resolume-adjacent tools, TouchDesigner, Synesthesia-like hosts; MIT-ish open spec. It is an excellent format for Claude to emit because parameters are declared in machine-readable JSON — a natural "parametric shader asset" format for a video pipeline.
- [prior knowledge, unverified] KodeLife (hexler): live GLSL/HLSL/Metal editor, free evaluation with nag, paid license; desktop only, not scriptable for batch render. SHADERed: open-source (MIT) shader IDE with debugger, development has slowed. Bonzomatic: open-source live-coding tool used in demoscene "shader showdown" competitions. Not render-pipeline tools; low value for automation.
- [prior knowledge, unverified] Lygia (Patricio Gonzalez Vivo): large multi-language (GLSL, HLSL, WGSL, Metal, CUDA) shader function library (noise, SDF, lighting, color, filters) with `#include` resolution; dual-licensed under Prosperity License (non-commercial) + Patron License (commercial via GitHub sponsorship). License caveat matters for commercial video.
- [prior knowledge, unverified] shader-park: JS DSL for SDF/raymarched shaders that compiles to GLSL, integrates with three.js and TouchDesigner; MIT; nice for LLMs because it's high-level JS.
- [prior knowledge, unverified] Hydra (Olivia Jack): browser live-coding video synth with chainable JS (`osc().rotate().out()`), built on regl; supports audio reactivity via `a.fft`; hydra-synth is AGPL-3.0 — copyleft caveat if embedded in a distributed product (rendered video output itself is generally not affected). Hydra's terse chain syntax is extremely LLM-friendly.
- glslViewer + Claude Code is the shortest loop: Claude writes `.frag`, runs glslViewer headless to render a few PNG frames, reads them (Claude can view images), iterates, then records the final MP4. Deterministic because time is derived from frame index in record mode.

### Gaps
- Current maintenance status of KodeLife, SHADERed, Bonzomatic, shader-park in 2026 — not searched.
- Whether glslViewer headless works on GPU-less Linux containers (likely needs EGL/Mesa llvmpipe) — not verified.
- Official Shadertoy terms/API status in 2026 — not fetched.

---

## 3. Node-based real-time tools and native creative-coding frameworks

### Takeaway
TouchDesigner is the most capable and now the most AI-connected (mature MIT-licensed MCP server), but the free Non-Commercial key caps resolution at 1280x1280 and forbids paid work; Commercial is $600, Pro $2,200. cables.gl is the best open alternative for web-native node-based visuals (MIT, open-source offline standalone since 2024–2025). vvvv gamma is free for non-commercial use but needs per-developer licenses commercially. Notch is commercial.

### Cited Findings
- TouchDesigner Non-Commercial: free for non-commercial use ONLY; image resolution limited to 1280x1280; keys without time limit for 2021+ builds; not for any paid work. — [Derivative: Licensing](https://derivative.ca/UserGuide/Licensing); [TouchDesigner Non-Commercial](https://derivative.ca/UserGuide/TouchDesigner_Non-Commercial)
- TouchDesigner Commercial: $600 USD, any resolution hardware supports. Pro: $2,200 USD (floating cloud license $3,300), includes 6 hrs Pro Support. Educational: $300, no resolution limit. Commercial or Pro required for any work you receive money for. — [Derivative: Licensing](https://derivative.ca/UserGuide/Licensing); [TouchDesigner Commercial](https://derivative.ca/UserGuide/TouchDesigner_Commercial); [TouchDesigner Pro](https://derivative.ca/UserGuide/TouchDesigner_Pro)
- cables.gl: everything needed to run a cables patch is MIT-licensed and using it does not impose a license on your work; open-source offline standalone v0.7.0 (July 7, 2025); node-based interface. — [cables.gl downloads](https://cables.gl/downloads); [cables FAQ license](https://cables.gl/docs/faq/licence_payment/userlicence/userlicence); [CDM, Aug 2024](https://cdm.link/2024/08/cables-gl-open-offline/)
- vvvv gamma: free without limitation for evaluation, non-commercial, FOSS development, teaching/learning; any commercial use requires a per-developer license; developer licenses can export and sell executables without extra charge; pricing depends on business size (2024 store snapshot; 2025–26 pricing not confirmed). — [vvvv store (2024)](https://2024.solidus.vvvv.org/products/vvvv-gamma-educational-license); [vvvv gamma licensing blog](https://vvvv.org/blog/2019/vvvv-gamma-licensing)

### Inferences
- [prior knowledge, unverified] TouchDesigner has a full Python API (every operator/parameter scriptable), which is exactly why MCP control works; it renders offline via the Movie File Out TOP with "realtime off" for frame-accurate, non-dropped-frame export. Windows/macOS only (no Linux), which rules it out of typical cloud render containers.
- [prior knowledge, unverified] Notch (notch.one): node-based real-time VFX for live events, Windows-only, subscription licensing (Notch Learning free with watermark); no known MCP.
- [prior knowledge, unverified] nodes.io (Variable studio): JS-based node graph creative-coding environment where each node is code; commercial/freemium; small community.
- [prior knowledge, unverified] Native frameworks: Nannou (Rust, MIT/Apache-2.0, wgpu-based; slower development cadence); OPENRNDR (Kotlin/JVM, BSD-2, has built-in `ScreenRecorder`/video extension using ffmpeg — first-class deterministic video export); openFrameworks (C++, MIT, ofxFFmpegRecorder etc.); Processing 4 (Java, LGPL/GPL, `saveFrame()` + Movie Maker / ffmpeg; Processing Foundation now stewards a Processing 4.x line). p5.js 2.0 (LGPL-2.1) released 2025 with async loading, a new shader `.modify()` "shader hooks" API and WebGPU work in progress; the Hermes p5 skill notes p5 2.x (2.2+) adds `.modify()`. — partial support: [Hermes creative-p5js docs](https://hermes-agent.nousresearch.com/docs/user-guide/skills/bundled/creative/creative-p5js)
- [prior knowledge, unverified] canvas-sketch (Matt DesLauriers, MIT): sketch runner with `--output` and built-in frame/MP4/GIF export via `canvas-sketch-cli --stream` piping to ffmpeg; time driven by `playhead`/`frame` props so exports are deterministic. Somewhat unmaintained but still works; a great "single-file sketch → MP4" pattern for Claude.
- OPENRNDR and canvas-sketch are underrated for AI video because they already expose a frame-indexed clock and a built-in video writer — no browser capture hack needed.

### Gaps
- Current (2026) Notch pricing, nodes.io status, Nannou release cadence — not searched.
- Whether TouchDesigner 2025/2026 builds changed Non-Commercial terms beyond what Derivative's wiki states.

---

## 4. Rendering deterministic frames to MP4

### Takeaway
Three proven patterns: (a) virtual-clock injection + per-frame screenshot (timecut/timesnap, CCapture.js); (b) true headless-Chrome determinism via CDP `HeadlessExperimental.beginFrame` with `--deterministic-mode --enable-begin-frame-control` (puppeteer-capture; also what HeyGen's HyperFrames does with seek + beginFrame per frame); (c) in-page encoding with WebCodecs + mediabunny (canvas-record) — fastest, no screenshot round-trip. The golden rule for any of them: animation must be a pure function of frame index, never of `performance.now()`/`requestAnimationFrame` deltas.

### Cited Findings
- timecut: uses timeweb + timesnap + puppeteer to open a page, override its time-handling JS functions, snapshot frames, and pipe them to ffmpeg; limitation: only JS time functions and video playback are virtualized, so other time sources aren't handled; some WebGL renderers need an option to capture pixels immediately after rendering. — [tungs/timecut](https://github.com/tungs/timecut)
- puppeteer-capture uses Chrome's HeadlessExperimental API with `--deterministic-mode` and `--enable-begin-frame-control` so Chrome renders each frame on demand; author argues screencast-based approaches fail for deterministic output; frame size must be specified. — [puppeteer-capture npm](https://npmjs.com/package/puppeteer-capture); [author blog](https://alexey-pelykh.com/blog/why-i-built-puppeteer-capture/)
- WebVideoCreator (WVC) takes a similar approach and uses WebCodecs to control timing of media outside developer control. — [WVC docs](https://docsearch.algolia.com/mcp/docs/repo/vinlic/webvideocreator)
- CCapture.js replaces the browser's notion of time with a clock that advances one fixed step per captured frame. — [CCapture.js](https://spite.github.io/ccapture.js/)
- canvas-record (dmnsgn): records a canvas region (2D/WebGL/WebGPU) to MP4/WebM/MKV/MOV/GIF/PNG/JPG sequences using WebCodecs and Wasm, in-browser or directly to the File System; its WebCodecs muxer options are mediabunny `OutputOptions`. — [canvas-record](https://github.com/dmnsgn/canvas-record)
- Mediabunny is the successor to mp4-muxer and webm-muxer (MP4/WebM muxing with streaming output). — via [canvas-record](https://github.com/dmnsgn/canvas-record) and search summary
- HyperFrames (HeyGen, open source): HTML compositions rendered by a Puppeteer + FFmpeg capture-and-encode pipeline to MP4, MOV, WebM, GIF or PNG sequence; compositions can include GSAP and WebGL shaders; `@hyperframes/shader-transitions` package provides WebGL scene transitions (e.g., swirl vortex, gravitational lens); claims frame-for-frame identical output locally vs. HeyGen cloud; agent skills installable via `npx skills add heygen-com/hyperframes`; v0.4.41 reported May 2026. — [HeyGen HyperFrames docs](https://developers.heygen.com/hyperframes-overview); [GitHub heygen-com/hyperframes](https://github.com/heygen-com/hyperframes); [silenceper write-up (May 2026)](https://silenceper.com/en/article/2026-05-02-hyperframes-html-video-rendering/)
- HeyGen's engineering write-up (seen only via search snippet) describes controlling Chrome frame-by-frame with a seek and `beginFrame` per frame. — [HeyGen research: HTML to video](https://www.heygen.com/research/html-to-video) (page not fetchable from sandbox)
- A 2026 open-source project issue describes the same target architecture for music videos: OffscreenCanvas WebGPU renderer + explicit frame clock + WebCodecs + mediabunny MP4/WebM. — [ford442/mod-player #518](https://github.com/ford442/mod-player/issues/518)

### Inferences
- Recommended stacks for Claude Code:
  1. **Pure shader clip**: glslViewer `--headless -E record` → ffmpeg re-encode (H.264 yuv420p, `-movflags +faststart`).
  2. **Three.js/R3F scene in a timeline with text/audio**: Remotion `<ThreeCanvas>` (frame-driven), `npx remotion render`; use `--gl=angle` or `--gl=swangle`/`egl` depending on host GPU [prior knowledge, unverified flag names].
  3. **HTML/GSAP + shader transitions, agent-native**: HyperFrames.
  4. **Any canvas sketch, fastest**: drive by frame index, `VideoEncoder` (WebCodecs) + mediabunny in-page, run headless via Playwright and save the blob — avoids PNG screenshot overhead.
  5. **Legacy/any page**: timecut (old, ~7 yrs; check Chrome compatibility).
- [prior knowledge, unverified] Determinism pitfalls: `Math.random()` (use seeded PRNG), GPU float differences across vendors (SwiftShader vs. NVIDIA can differ in last bits; fine for video, not for golden-image tests), `preserveDrawingBuffer: true` or reading pixels in the same task as rendering is needed for screenshot capture of WebGL, and post-processing passes with temporal accumulation (TAA, motion blur) must also be keyed to frame index.
- [prior knowledge, unverified] Licenses: timecut/timesnap BSD-3; CCapture.js MIT; mediabunny MPL-2.0; ffmpeg LGPL/GPL depending on build (libx264 makes it GPL).

### Gaps
- HyperFrames' license and its WebGL/GPU behavior in headless cloud renders — official page was blocked; not confirmed.
- No benchmark found comparing throughput of CDP beginFrame vs. WebCodecs in-page encoding.

---

## 5. Driving these tools with Claude / Claude Code: MCP servers and skills

### Takeaway
The most mature integration is **8beeeaaat/touchdesigner-mcp** (MIT, ~609 stars, 14 tools incl. Python execution and `get_top_image` for visual feedback, ships a Claude Desktop .mcpb and a Claude plugin). For shaders, **gokayfem/shader-skills** (MIT, ~418 stars) is a well-engineered Claude Code plugin with a 186-function GLSL library and a headless Playwright WebGL2 validation harness. No dedicated p5.js MCP server was found — only skills. Video-framework vendors (HeyGen HyperFrames, Software Mansion TypeGPU, Remotion community) now ship agent skills directly.

### Cited Findings
- touchdesigner-mcp: bridges AI models and TouchDesigner's WebServer DAT; agents can create/modify/delete nodes, query properties and project structure, run Python; MIT; 609 stars, 66 forks, 124 commits; npm package `touchdesigner-mcp-server`; default port 9981; requires `mcp_webserver_base.tox` component (API version ≥1.3.0); resources not implemented. — [GitHub 8beeeaaat/touchdesigner-mcp](https://github.com/8beeeaaat/touchdesigner-mcp)
- Its 14 tools: `create_td_node`, `delete_td_node`, `describe_td_tools`, `exec_node_method`, `execute_python_script`, `get_td_class_details`, `get_td_classes`, `get_td_info`, `get_td_module_help`, `get_td_node_errors`, `get_td_node_parameters`, `get_td_nodes`, `get_top_image`, `update_td_node_parameters`; plus 3 prompts; repo contains `.claude`, `.claude-plugin`, `plugins/touchdesigner`, `mcpb` folders. — [GitHub](https://github.com/8beeeaaat/touchdesigner-mcp)
- Releases v1.5.0 and v2.0.0 changed install steps (delete old component, re-import new .tox); Claude Desktop install via double-click .mcpb; one guide gives `claude mcp add -s user touchdesigner -- npx -y touchdesigner-mcp-server@latest --stdio` (sources differ on exact command). — [v2.0.0 release](https://github.com/8beeeaaat/touchdesigner-mcp/releases/tag/v2.0.0); [mcp.directory guide 2026](https://mcp.directory/blog/touchdesigner-mcp-complete-guide-2026)
- shader-skills (gokayfem): MIT; 418 stars; skill `shader-art-coding` with 186 GLSL functions in 20 modules (SDF raymarching, noise/terrain, water, atmosphere, tonemapping); `glsl_tools.py` search/bundle/check (lint + glslangValidator); 11 Shadertoy templates; headless WebGL2 harness under ANGLE via Playwright; 90 GPU property tests (Lipschitz bounds, SDF signs, noise derivatives); NaN/black-frame checks; targets Shadertoy/WebGL2/GLSL ES 3.00; adapters for Codex, Cursor, Copilot, Gemini CLI. Install: `claude plugin marketplace add gokayfem/shader-skills` then `claude plugin install shader-skills@shader-skills`. No video export built in. — [GitHub gokayfem/shader-skills](https://github.com/gokayfem/shader-skills)
- Other shader/p5 skills exist as directory listings (mcpmarket "GLSL Shader Programming", "Shader Dev", "WebGL Performance Optimizer", "p5.js Creative Coding"; a5c-ai GLSL skill; huawolf p5js skill); small star counts, unverified quality. — [mcpmarket GLSL](https://mcpmarket.com/tools/skills/glsl-shader-programming-expert); [mcpmarket p5](https://mcpmarket.com/tools/skills/p5-js-creative-coding-1); [skillmd a5c-ai glsl](https://skillmd.com/skills/a5c-ai/glsl); [skillsdirectory huawolf p5js](https://www.skillsdirectory.com/skills/huawolf-p5js)
- Nous Research's Hermes agent bundles a creative-p5js skill (p5.js 1.11.3 CDN, WebGL mode for GLSL, p5.sound for audio). — [Hermes docs](https://hermes-agent.nousresearch.com/docs/user-guide/skills/bundled/creative/creative-p5js)
- No p5.js-specific MCP server was found in searches. — (search result; [mcpmarket p5 listing](https://mcpmarket.com/tools/skills/p5-js-creative-coding-1) is a skill, not MCP)
- Shadertoy MCP (aggregator listings only; search/retrieve shaders; possibly stale). — [FlowHunt](https://www.flowhunt.io/mcp-servers/shadertoy)
- HyperFrames ships agent skills (`npx skills add heygen-com/hyperframes`); TypeGPU has an official Software Mansion skill. — [HyperFrames docs](https://developers.heygen.com/hyperframes-overview); [skills.sh typegpu](https://skills.sh/software-mansion-labs/skills/typegpu)

### Inferences
- The decisive capability for AI-driven visuals is a **visual feedback loop**: `get_top_image` (TouchDesigner MCP), shader-skills' headless render/black-frame check, or simply Claude Code rendering PNG frames and reading them. Without it, Claude's shaders frequently compile but look wrong (black screens, NaNs, blown exposure).
- MCP is unnecessary for most file-based tools (glslViewer, Remotion, HyperFrames, canvas-sketch, OPENRNDR): Claude Code's Bash + file tools suffice; skills (instructions + libraries) add more value than MCP there. MCP is valuable for stateful GUI apps (TouchDesigner, and potentially Blender/Unity — out of scope here).
- [prior knowledge, unverified] Other TouchDesigner MCP efforts exist (e.g., community forks and Derivative-forum projects), but 8beeeaaat's is the reference implementation; Derivative itself has not (to my knowledge) shipped an official MCP.
- Commercial-use caution for Claude-generated shaders: LLM output may reproduce well-known Shadertoy code (CC BY-NC-SA by default) or Lygia functions (Prosperity license); for commercial video prefer MIT-licensed libraries (shader-skills' library, three.js TSL nodes) and ask Claude to write from first principles.

### Gaps
- No official Anthropic/Claude skill specifically for shaders/creative coding was confirmed in this search.
- No MCP servers found for cables.gl, vvvv, Notch, hydra, or glslViewer.
- Security/quality of third-party skill listings not audited.

---

## 6. Audio-reactive visual tools

### Takeaway
Butterchurn (MIT, WebGL2 port of MilkDrop 2) and projectM (LGPL-2.1, native OpenGL MilkDrop reimplementation) give thousands of ready-made audio-reactive presets; for video, the key is to feed them precomputed FFT per frame offline rather than live audio. Hydra (`a.fft`) and p5.sound are lighter code-first options; Synesthesia is a commercial VJ app.

### Cited Findings
- Butterchurn: WebGL implementation of the MilkDrop visualizer; MIT; npm `butterchurn` + `butterchurn-presets`; requires WebGL 2. — [jberg/butterchurn](https://github.com/jberg/butterchurn); [npm](https://www.npmjs.com/package/butterchurn)
- Preset ownership: MIT on code; individual preset artists' visuals are a separate consideration (presets package distributed separately). — [Churn credits](https://churn.leyanlo.com/credits)
- projectM: open-source music visualizer library that parses MilkDrop presets, analyzes audio and renders with OpenGL; LGPL 2.1. — [projectM (Wikipedia comparison)](https://en.wikipedia.org/wiki/MilkDrop); [projectM itch.io](https://codav.itch.io/projectm)
- Original MilkDrop 2.25c source released under BSD license in May 2013. — [Wikipedia MilkDrop](https://en.wikipedia.org/wiki/MilkDrop)
- A 2026 project plans deterministic music-video export of a WebGPU visualizer using an explicit frame clock with WebCodecs + mediabunny. — [ford442/mod-player #518](https://github.com/ford442/mod-player/issues/518)

### Inferences
- [prior knowledge, unverified] Butterchurn's `render()` reads audio from a WebAudio AnalyserNode; for offline deterministic render you must step it with fixed elapsed time and inject per-frame audio data (e.g., via an OfflineAudioContext or precomputed FFT arrays) — otherwise output depends on real-time playback. MilkDrop presets also use internal randomness/time.
- [prior knowledge, unverified] Synesthesia (synesthesia.live): commercial macOS/Windows VJ app whose "scenes" are GLSL shaders with JSON controls (ISF-like), with audio-reactive uniforms; free trial, paid licenses. TouchDesigner's Audio Spectrum CHOP and cables' audio ops are the node-based equivalents.
- Practical Claude pattern: compute audio features offline in Python (librosa: onset, RMS, bands per video frame) → JSON → uniforms keyed by frame index in any of the shader/three/glslViewer pipelines. This is fully deterministic and framework-agnostic.

### Gaps
- Current 2026 maintenance status of butterchurn (last release) and projectM 4.x releases — not verified.
- Synesthesia pricing/licensing — not searched.
