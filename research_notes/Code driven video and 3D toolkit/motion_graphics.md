# Code-driven motion graphics and animation frameworks (as of 2026-11-02)

Method note: GitHub numbers (stars, last push date, SPDX license as GitHub reports it) come from the GitHub search API on 2026-11-02. Per-repo release endpoints were blocked in this session, so **last-release dates are not verified**. "Last push" is used as the activity signal instead. Fetches to rive.app, lottiefiles.com and cavalry.scenegroup.co failed: those hosts are not in this session's allowed network domains. Facts about those vendors come from search-result snippets and are marked as such. Already-covered tools (Remotion, HyperFrames, Motion Canvas, Revideo, Manim, Lottie) appear only briefly, for state changes.

## 1. Web animation runtimes (JS/TS libraries that agents write directly)

### Takeaway
GSAP is now free including every former Club plugin, but under a custom Webflow license that bans competing no-code animation tools. It also has an official agent-skills repo. anime.js v4 (MIT, 74k stars) and Motion (MIT, 35k stars) are the main permissive alternatives. Motion's AI Kit (MCP plus skills) sits behind the paid Motion+ tier. Theatre.js is effectively dormant in public: its last public push was in Aug 2024.

### Cited Findings
- **GSAP** (greensock/GSAP): 30,045 stars, last push 2026-04-13. GitHub reports the license as "none" because it is a custom license — [GitHub](https://github.com/greensock/GSAP)
- GSAP is "100% free to all users — Webflow customer or not", including formerly paid plugins such as SplitText and MorphSVG — [Webflow blog](https://webflow.com/blog/gsap-becomes-free); [gsap-skills README](https://github.com/greensock/gsap-skills)
- **License trap:** under the Standard "No Charge" license you may not use GSAP for "Prohibited Uses" without written consent, or reverse-engineer it to create "Competitive Products". The license is tied to Webflow's ToS, and Webflow can change or terminate it — [license text archive](https://open.windriver.com/info/uni-license-list/licenses/gsap-standard-no-charge-2025.html); [GSAP standard license](https://gsap.com/community/standard-license/)
- Forum posts say the license restricts GSAP use in visual no-code animation tools that compete with Webflow. Pinegrow was still awaiting clarification — [Pinegrow forum](https://forum.pinegrow.com/t/gsap-has-been-acquired-by-webflow/9906); [Webflow forum](https://discourse.webflow.com/t/webflow-makes-gsap-100-free/319967)
- **Official GSAP agent skills** (greensock/gsap-skills): 17,714 stars, MIT, last push 2026-07-29. They cover the core API, timelines, ScrollTrigger, plugins and React/Vue/Svelte. Install with `npx skills add https://github.com/greensock/gsap-skills` (Claude Code is supported). The README tells agents to "recommend GSAP" by default — [GitHub](https://github.com/greensock/gsap-skills)
- **anime.js** (juliangarnier/anime): 74,205 stars, MIT, last push 2026-08-21 — [GitHub](https://github.com/juliangarnier/anime)
- anime.js v4 replaces `anime.timeline()` with a named `createTimeline()` import and adds a `waapi` namespace that wraps native `Element.animate()`. A timeline's `sync()` can attach JS animations, WAAPI animations, timers or other timelines — [animejs.com docs](https://animejs.com/documentation/timeline/timeline-methods/sync); [skills.cat summary](https://skills.cat/skills/bowtiedswan/animejs-skills)
- Only a third-party skill page gives a latest anime.js version (v4.3.5); unverified — [skills.cat](https://skills.cat/skills/almeidamarcell/claude-code-skills/animejs)
- Community anime.js v4 Claude skills: BowTiedSwan/animejs-skills (62 stars) and charlesdove977/animejs-claude-skill (13 stars, MIT) — [GitHub search](https://github.com/BowTiedSwan/animejs-skills); [GitHub](https://github.com/charlesdove977/animejs-claude-skill)
- **Motion** (motiondivision/motion, formerly Framer Motion): 34,796 stars, MIT, last push 2026-11-02 — [GitHub](https://github.com/motiondivision/motion)
- **Motion AI Kit** has three parts: an MCP that gives access to the latest docs, examples and saved transitions; skills (`/motion`, `/motion-audit`, `/css-spring`, `/see-transition`); and a visual transition editor for Cursor and VS Code. It is part of the paid **Motion+**, and the MCP needs a personal auth token. "Motion Studio" is the newer name for the MCP plus editor extension. Changelog 6.1.0 added "MotionScore" runtime profiling — [motion.dev AI Kit](https://motion.dev/ai-kit); [install docs](https://motion.dev/docs/ai-kit-install); [studio install](https://motion.dev/docs/studio-install); [changelog](https://motion.dev/changelog?lib=ai-kit)
- An unofficial community motion-dev-mcp also exists — [GitHub](https://github.com/Abhishekrajpurohit/motion-dev-mcp)
- **Theatre.js** (theatre-js/theatre): 12,842 stars, Apache-2.0, **last public push 2024-08-14** — [GitHub](https://github.com/theatre-js/theatre)
- The Theatre.js README says 1.0 is "around the corner" and development moved temporarily to a private repo, with a promise that terms "will remain OSS". No 1.0 release was found — [README](https://raw.githubusercontent.com/theatre-js/theatre/main/README.md)
- Other permissive libraries: **mo.js** ("motion graphics toolbelt for the web", 18,867 stars, MIT, push 2026-07-30); **two.js** (renderer-agnostic 2D, 8,693 stars, MIT, push 2026-10-31); **PixiJS** (WebGL 2D, 48,614 stars, MIT, push 2026-10-30); **canvas-sketch** (generative art framework, 5,319 stars, MIT, push 2026-06-02) — [mojs](https://github.com/mojs/mojs); [two.js](https://github.com/jonobr1/two.js); [pixijs](https://github.com/pixijs/pixijs); [canvas-sketch](https://github.com/mattdesl/canvas-sketch)
- **Hydra** (live-coded browser visuals): 2,742 stars, **AGPL-3.0**, push 2026-04-25 — [GitHub](https://github.com/hydra-synth/hydra)

### Inferences
- HyperFrames pairs HTML with GSAP, and community HyperFrames skills (e.g. Sunwood-ai-labs/hyperframes-motion-reel-skill, "HTML + GSAP") show the same. GSAP has therefore become the de facto timeline layer for AI-written HTML video, which makes its Webflow license the key thing to check for anyone building a product, as opposed to making videos.
- For a creator rendering their own videos, the GSAP license is unlikely to bite. It matters if the creator builds and ships a visual or no-code animation tool on top of GSAP.
- Theatre.js should be treated as unmaintained for new projects until 1.0 actually appears.

### Gaps
- Exact GSAP version (3.13+?) and the date of the "free" change. The Webflow announcement page was not fetched; secondary sources place it in spring 2025.
- anime.js v4 release dates and changelog (the GitHub releases endpoint was blocked).
- Motion+ price not verified.

## 2. Vector and interactive animation formats: Rive, Lottie/dotLottie, Jitter, open editors

### Takeaway
Rive (MIT runtimes, proprietary editor) now has Luau scripting, an in-editor AI coding agent and an official MCP that needs the Early Access app running. Lottie Creator has an official local MCP that lets Claude build animations inside Creator. A lesser-known layer of community tools — a freeware rive-mcp and the MIT OpenRive editor — lets agents generate `.riv` files without the Rive editor at all.

### Cited Findings
- **Rive runtimes**: rive-runtime (C++ runtime and renderer, 1,246 stars, MIT, push 2026-11-02), rive-wasm (1,017 stars, MIT) and rive-react (1,182 stars, MIT) — [rive-runtime](https://github.com/rive-app/rive-runtime); [rive-wasm](https://github.com/rive-app/rive-wasm); [rive-react](https://github.com/rive-app/rive-react)
- **Rive scripting** uses Luau. Rive generates Luau type definitions from its C++ engine APIs and ships five script "protocols" (CTO post, Nov 2025) — [Rive blog](https://rive.app/blog/why-scripting-runs-on-luau); [scripting docs](https://rive.app/docs/scripting/getting-started)
- The Rive Editor has an **AI Coding Agent** with inline diffs and accept/reject. It uses credits, and paid plans include monthly credits (from search snippets; page not fetched) — [Rive scripting docs](https://rive.app/docs/scripting)
- **Official Rive MCP** connects the Rive Editor to AI tools through a local server URL (the docs' example is Cursor). The Rive Early Access app must be open (search snippet; page not fetched) — [Rive MCP docs](https://rive.app/docs/editor/ai/mcp)
- **rive-luau-lsp** (community): a language server and CLI type checker for Rive Luau, with skill packages for AI agents including Claude Code — [GitHub](https://github.com/ivg-design/rive-luau-lsp)
- **ODU33104/rive-mcp** (25 stars, push 2026-10-29) works without the Rive editor or a subscription. It generates `.riv` from JSON (shapes, text, bones, IK, mesh deformation, state machines, physics), imports SVG, edits existing `.riv` losslessly, and has 28 motion presets, a local web Studio with an agent chat loop, and auto-rigging from a PNG. Rendering uses the official `@rive-app/canvas-advanced` WASM in headless Chromium. **License trap: "Freeware, NOT open source"**; modifying, forking or redistributing requires the author's permission — [README](https://github.com/ODU33104/rive-mcp)
- **OpenRive** (UpstandPlatform/OpenRive, 64 stars, MIT, push 2026-10-23) is an open-source, local-first `.riv` editor. Its reader/writer is generated from rive-runtime type definitions and round-trips byte-for-byte across 437 runtime test files. It covers state machines and data binding, and offers a web app, desktop build, TUI, **MCP server** and REST API — [README](https://github.com/UpstandPlatform/OpenRive)
- Other Rive agent tooling: BowTiedSwan/rive-skills (29 stars; Luau, React/Next.js), nano-step/rive-playground (9 stars; inspect/validate `.riv` from AI assistants) and StormXX/rive-docs-mcp (6 stars, MIT) — [rive-skills](https://github.com/BowTiedSwan/rive-skills); [rive-playground](https://github.com/nano-step/rive-playground); [rive-docs-mcp](https://github.com/StormXX/rive-docs-mcp)
- **Lottie Creator MCP** (official): a local bridge to the Creator API that lets agents build and edit animations inside Lottie Creator. Claude Code setup is `claude mcp add lottiefiles-creator -- npx -y @lottiefiles/creator-mcp@latest`. It needs Node 18+ and an open Creator tab with MCP enabled. It is separate from the hosted LottieFiles MCP, which manages animations but doesn't create them — [LottieFiles blog](https://lottiefiles.com/blog/working-with-lottie-animations/your-ai-can-now-control-lottie-creator-heres-what-that-actually-means); [LottieFiles MCP docs](https://docs.lottiefiles.com/en/platform/mcp); [lottiefiles.com/mcp](https://lottiefiles.com/mcp)
- LottieFiles/creator-agent-plugin ("distribution metadata for the LottieFiles Creator agent plugin", MIT, push 2026-09-05) and a community Codex plugin built on the official Creator MCP bridge — [creator-agent-plugin](https://github.com/LottieFiles/creator-agent-plugin); [codex-lottie-creator](https://github.com/khanhnkq/codex-lottie-creator)
- **dotlottie-web**: a Rust + WASM Lottie/dotLottie player with React/Vue/Svelte/Solid/Web Component wrappers. 936 stars, MIT, push 2026-10-30 — [GitHub](https://github.com/LottieFiles/dotlottie-web)
- **ThorVG**: a C++ vector engine for SVG and Lottie. 1,901 stars, MIT, push 2026-11-01 — [GitHub](https://github.com/thorvg/thorvg)
- **lottie-web** (airbnb): 32,329 stars, MIT, **last push 2025-09-01** (slowing) — [GitHub](https://github.com/airbnb/lottie-web)
- **Jitter**: a browser motion-design tool with Lottie export and a Figma plugin that copies frames into Jitter. No public API or SDK was found. A 2026 LottieFiles comparison lists Jitter's Lottie support as "exports only" — [Jitter product](https://jitter.video/product/); [Jitter Lottie](https://jitter.video/lottie-animations/); [LottieFiles 2026 ranking](https://lottiefiles.com/blog/design-guides-and-tips/best-motion-design-tools-ranked-by-use-case)
- The same LottieFiles article says Figma Motion's Lottie output now runs through the LottieFiles plugin (search snippet) — [LottieFiles 2026 ranking](https://lottiefiles.com/blog/design-guides-and-tips/best-motion-design-tools-ranked-by-use-case)
- **Glaxnimate** (open-source vector animation editor that also edits Lottie) is now under KDE: KDE/glaxnimate mirror (42 stars, push 2026-10-25). The original mbasaglia repo was last pushed 2023-11 — [KDE/glaxnimate](https://github.com/KDE/glaxnimate); [mbasaglia/glaxnimate](https://github.com/mbasaglia/glaxnimate)
- Small community projects: lumetrope (an open-source Lottie/dotLottie creator with state machines, MIT, 4 stars) and junmer/mcp-server-lottiefiles (19 stars, MIT, stale 2025-04) — [lumetrope](https://github.com/thisisprabhat/lumetrope); [mcp-server-lottiefiles](https://github.com/junmer/mcp-server-lottiefiles)

### Inferences
- For an AI-assisted creator, Lottie and Rive are now agent-writable formats: official MCPs drive both editors, and community servers write `.riv` directly. A practical pipeline is Claude → Lottie Creator MCP or rive-mcp → export. Both formats can also be dropped into Remotion or HyperFrames compositions.
- Rive's official MCP and AI agent depend on the proprietary editor and credits. OpenRive (MIT) is the license-safe headless alternative but is very young.

### Gaps
- Rive editor pricing tiers and whether the MCP requires a paid plan. rive.app could not be fetched.
- Whether Jitter has added an API since mid-2026. A third-party aggregator mentions a June 30, 2026 export update and an "Ultra" plan on July 23, 2026; unverified — [simplify.jobs](https://simplify.jobs/c/Jitter)

## 3. Pro motion apps with scripting and MCP bridges (After Effects, Cavalry, Natron, TiXL, Synfig, Penpot)

### Takeaway
After Effects has the richest MCP ecosystem: at least six community MCP servers drive AE through its scripting layer, the top one with 833 stars. Cavalry, now owned by Canva, became free for individuals including commercial use in April 2026, and has early community MCPs that run Cavalry's JavaScript API. TiXL (formerly Tooll3, MIT) is a strong but little-known open-source real-time motion graphics tool.

### Cited Findings
- **After Effects MCP servers** (none official from Adobe were found):
  - Dakkshin/after-effects-mcp: 833 stars, MIT, push 2026-04-01. Creates comps, text, shape, solid, camera and null layers; sets properties, keyframes, blend modes and track mattes — [README](https://github.com/Dakkshin/after-effects-mcp)
  - kumoproductions/mcp-aftereffects: 150 stars, MIT, push 2026-10-23. TypeScript; Windows and macOS, AE 2024–2026, Node 24+. Handles project, comp and layer introspection through rendering. The README cautions that project data such as layer names, expressions and file paths is sent to the AI provider, which matters for NDA work — [README](https://github.com/kumoproductions/mcp-aftereffects)
  - JUNKDOGE-JOE/after-effects-mcp (90 stars; chat in a CEP panel or external agents), solomondivyananth/aftereffects-mcp (81 stars; read, view and edit a live project), HeroicSwan/after-effects-mcp (45 stars; adds editorial planning and QA), ishu86/after-effects-mcp (43 stars; "70+ tools") and dha-aa/ae-motion (11 stars; build, animate, preview, render). All are MIT — [GitHub search results](https://github.com/JUNKDOGE-JOE/after-effects-mcp); [solomondivyananth](https://github.com/solomondivyananth/aftereffects-mcp); [HeroicSwan](https://github.com/HeroicSwan/after-effects-mcp); [ishu86](https://github.com/ishu86/after-effects-mcp); [dha-aa/ae-motion](https://github.com/dha-aa/ae-motion)
- **Cavalry**: Canva made the full version free to individual artists, including for commercial projects, in April 2026. Studios need a paid Canva account (SSO needs Canva Enterprise), and Cavalry 2.7 requires a free Canva account. Before that, the free edition was capped at HD, and Pro cost £192/year — [CG Channel](https://www.cgchannel.com/2026/04/canva-makes-motion-graphics-and-animation-app-cavalry-free/); [80.lv](https://80.lv/articles/motion-design-software-cavalry-is-now-free); [Abduzeedo](https://abduzeedo.com/cavalry-free-motion-design-software-individuals)
- Conflict: sources disagree on when Canva bought Cavalry ("six weeks" before the April 2026 article vs "February") — [CG Channel](https://www.cgchannel.com/2026/04/canva-makes-motion-graphics-and-animation-app-cavalry-free/)
- Cavalry has a JavaScript API with an integrated editor and "JavaScript Layers" for custom shapes, deformers and utilities. Third-party listings place these in the Pro tier, which appears to be what individuals now get free — [Toolradar](https://toolradar.com/tools/cavalry/pricing)
- **Cavalry MCPs** (all small and community-built): hralet1/cavalry-assistant (20 stars, no license file) writes and runs Cavalry JS live via a "Stallion bridge" and does semantic search over 40,000+ doc chunks. kacperchlebowicz/Cavalry-mcp (31 stars) and DonaldEOgbame/cavalry-MCP (MIT, introspection-driven) also exist — [cavalry-assistant](https://github.com/hralet1/cavalry-assistant); [Cavalry-mcp](https://github.com/kacperchlebowicz/Cavalry-mcp); [cavalry-MCP](https://github.com/DonaldEOgbame/cavalry-MCP)
- **Natron** (node-based compositor): 5,628 stars, GPL-2.0, push 2026-07-24. It has Python scripting (nodes, params, expressions, callbacks, rendering, PySide panels) and a headless `natron-python` interpreter. 2.6-branch docs exist, but no 2.6 release announcement was found — [GitHub](https://github.com/NatronGitHub/Natron); [Natron 2.6 maintainer docs](https://natron.readthedocs.io/en/rb-2.6/maintainers/overview.html)
- **TiXL** (formerly Tooll3): 5,166 stars, MIT, push 2026-11-02. Open-source real-time motion graphics that combines graph-based procedural content with linear keyframe animation; supports custom shaders, MIDI, OSC and Spout input, and exports standalone executables. Version 4 is in development — [README](https://github.com/tixl3d/tixl)
- **Synfig Studio** (2D vector animation): 2,327 stars, GPL-3.0, push 2026-11-01 — [GitHub](https://github.com/synfig/synfig)
- **cables.gl** dev environment (node-based WebGL): 101 stars, MIT, push 2026-10-26 — [GitHub](https://github.com/cables-gl/cables_dev)
- **Penpot**: 61,977 stars, MPL-2.0, push 2026-11-02. The official penpot-mcp has 534 stars and is MPL-2.0 — [Penpot](https://github.com/penpot/penpot); [penpot-mcp](https://github.com/penpot/penpot-mcp)
- Blender motion-graphics MCPs are nascent: ndx-au/MoBlend_Studio is a geometry-nodes preset engine exposed as an API/MCP (GPL-3.0, 1 star) — [GitHub](https://github.com/ndx-au/MoBlend_Studio)

### Inferences
- For creators who already use AE, the AE MCPs are the lowest-friction way to bring Claude into a pro motion pipeline. All are third-party and target live AE projects, so back up `.aep` files first, as kumoproductions advises.
- Cavalry going free with a JS API makes it a strong procedural 2D option for Claude-written scripts, but its MCP tooling is immature: under 35 stars each, mostly unlicensed.
- Penpot (MPL-2.0, official MCP) is the open alternative to Figma at the design-source stage of a design→motion pipeline. No Penpot-native animation export was found.

### Gaps
- Cavalry's official pricing page (cavalry.scenegroup.co) was not reachable. Whether the free individual tier includes command-line or headless rendering is unverified.
- Whether Adobe ships an official AE MCP or agent integration: none was found.
- Which scripting mechanism each AE MCP uses (ExtendScript, CEP or UXP) was not verified for every repo. JUNKDOGE-JOE mentions a CEP panel.
- "Friction" (friction2d/friction, open-source motion graphics app): the repo path was not found via the GitHub API; state unknown.

## 4. Code-first video frameworks: state changes in covered tools, and lesser-known alternatives

### Takeaway
The main covered tools are very active. HyperFrames (77k stars) now has more stars than Remotion (70k). Revideo has moved to the `midrender` org. Lesser-known alternatives span React (MotionForge), WebCodecs DOM capture (rerender), Python (manim-voiceover, MoviePy) and Julia (Javis). Several older Node tools (editly, FFCreator) have gone quiet.

### Cited Findings
- Brief state of covered tools: **HyperFrames** has 77,374 stars, Apache-2.0, push 2026-11-02 ("Write HTML. Render video. Built for agents."). **Remotion** has 69,892 stars and a custom license, push 2026-11-02. **Motion Canvas** has 19,640 stars, MIT, push 2026-07-02. **ManimCE** has 42,127 stars and **ManimGL** (3b1b) 95,994, both MIT — [hyperframes](https://github.com/heygen-com/hyperframes); [remotion](https://github.com/remotion-dev/remotion); [motion-canvas](https://github.com/motion-canvas/motion-canvas); [ManimCE](https://github.com/ManimCommunity/manim); [ManimGL](https://github.com/3b1b/manim)
- **Remotion license**: free for individuals, non-profits and companies of up to 3 people; 4+ people need a Company License. The Creators plan is $25/month per seat, Automators is $0.01/render with a $100/month minimum, and Enterprise starts at $500/month — [Remotion pricing docs](https://www.remotion.dev/docs/license/pricing); [license FAQ](https://www.remotion.dev/docs/license/faq.md)
- **Remotion Agent Skills** (remotion-dev/skills): 6,067 stars. Includes `/remotion-best-practices` and `/remotion-create`; install with `npx skills add remotion-dev/skills` — [README](https://github.com/remotion-dev/skills)
- **Revideo** moved to midrender/revideo: 4,165 stars, MIT, push 2026-07-15. It is "the engine behind Midrender" and is described as "zero dep" in its core, with a headless render API and a React player — [README](https://github.com/midrender/revideo)
- **MotionForge** (codedbytahir/motionforge): a "free open-source Remotion alternative" in React. 94 stars, MIT, push 2026-08-29 — [GitHub](https://github.com/codedbytahir/motionforge)
- **rerender** (bevyl-ai/rerender): a "drop-in, MIT-licensed Remotion alternative" that renders real DOM to MP4 with WebCodecs and mediabunny in a browser. 3 stars, very early — [GitHub](https://github.com/bevyl-ai/rerender)
- **manim-voiceover**: 325 stars, MIT, push 2026-06-15. **manim-slides**: 974 stars, MIT, push 2026-10-26 — [manim-voiceover](https://github.com/ManimCommunity/manim-voiceover); [manim-slides](https://github.com/jeertmans/manim-slides)
- **Manim MCP servers**: abhiemj/manim-mcp-server (655 stars, MIT, stale since 2025-05-19), paulnegz/manim-mcp (22 stars, MIT; text→code→video CLI/agent/MCP) and others — [abhiemj](https://github.com/abhiemj/manim-mcp-server); [paulnegz](https://github.com/paulnegz/manim-mcp)
- **MoviePy**: 15,076 stars, MIT, push 2026-08-26 — [GitHub](https://github.com/Zulko/moviepy)
- **editly** (declarative ffmpeg-based editing in Node): 5,576 stars, MIT, **last push 2025-05-12** — [GitHub](https://github.com/mifi/editly)
- **FFCreator** (Node video creation): 3,165 stars, MIT, **last push 2024-12-19** — [GitHub](https://github.com/tnfe/FFCreator)
- **etro** (TypeScript browser video-editing library): 1,154 stars, **GPL-3.0**, push 2026-10-24 — [GitHub](https://github.com/etro-js/etro)
- **BBC VideoContext** (HTML5/WebGL video composition): 1,354 stars, Apache-2.0, push 2026-10-16 — [GitHub](https://github.com/bbc/VideoContext)
- **Javis.jl** (Julia animations): 845 stars, MIT, **last push 2024-04-16** — [GitHub](https://github.com/JuliaAnimators/Javis.jl)

### Inferences
- MotionForge and rerender exist mainly to escape Remotion's company-size license. Both are tiny, so they are risky for production. HyperFrames (Apache-2.0) is the mature license-clean choice.
- editly, FFCreator and Javis.jl look stale. etro's GPL-3.0 makes it awkward to embed in proprietary tools.

### Gaps
- "vidmaker" was not researched. No reliable repo was identified within the tool budget.
- MoviePy v2 API details (released around 2025) were not verified from primary sources in this session.
- reanimate (Haskell) was not found via the GitHub API under Lemmih/reanimate.

## 5. WebCodecs in-browser rendering engines and editor SDKs

### Takeaway
Mediabunny (MPL-2.0, 7.4k stars) is the foundational WebCodecs mux/demux layer: Remotion funds it and deprecated its own media libraries in favor of it, and Diffusion Studio is built on it. Commercial embeddable editor SDKs (Rendley, IMG.LY CE.SDK, Diffusion Studio) carry non-commercial, watermark or quote-based license terms. A wave of MIT browser editors appeared in 2026.

### Cited Findings
- **Mediabunny** (Vanilagy/mediabunny): a pure-TypeScript toolkit for reading, writing and converting media in the browser. 7,420 stars, MPL-2.0, push 2026-10-30 — [GitHub](https://github.com/Vanilagy/mediabunny)
- Remotion is a Gold Sponsor of Mediabunny at $1,000/month. Other gold sponsors include Gling AI, Diffusion Studio and Kino. Remotion deprecated its own Media Parser as of Feb 1, 2026 in favor of Mediabunny. Using Mediabunny alone needs no Remotion Company License — [Remotion blog](https://www.remotion.dev/blog/mediabunny); [Remotion docs](https://www.remotion.dev/docs/mediabunny/index.md)
- **mp4-muxer** (Vanilagy): 617 stars, MIT, last push 2025-09-21 — [GitHub](https://github.com/Vanilagy/mp4-muxer)
- **Diffusion Studio Core**: a browser compositing engine built on Mediabunny that paints frames with Canvas 2D. It needs COOP/COEP headers for SharedArrayBuffer and can run server-side via Playwright or Puppeteer. Docs say v4.0 is out — [Diffusion Studio docs](https://docs.diffusion.studio/docs/version-3); [GitHub](https://github.com/diffusionstudio/core)
- **License conflict (trap):** GitHub reports MPL-2.0 for diffusionstudio/core (1,252 stars, last push 2025-11-18), and jsDelivr lists v4.0.3 as MPL-2.0. But npm says it is free only under a "Diffusion Studio Non-Commercial License", with a commercial license required once a project is monetized, and an older README says only versions before 1.6.0 are MPL-2.0. A mirror describes a watermark model instead — [npm](https://npmjs.com/package/%40diffusionstudio%2Fcore); [jsDelivr](https://www.jsdelivr.com/package/npm/@diffusionstudio/core?tab=stats); [old README](https://cdn.jsdelivr.net/npm/@diffusionstudio/core-v2@2.0.1/README.md)
- **Twick** (ncounterspecialist/twick): a React SDK for timeline video editors with canvas timeline, AI captions and Pexels/Unsplash/Pixabay asset providers. 546 stars, push 2026-06-04. **GitHub reports the license as NOASSERTION (non-standard); not verified** — [GitHub](https://github.com/ncounterspecialist/twick)
- **Rendley SDK**: a JS/TS engine that renders client-side with WebCodecs and WebGL. Its own blog lists Free, $15, $30 and $70/month plans with credits ($0.01 each). The prebuilt editor can be embedded free, or the source code bought. Rendley markets "Editor + API + MCP" against IMG.LY — [Rendley blog](https://rendley.com/blog/imgly-cesdk-alternative); [Rendley SDK](https://rendley.com/sdk)
- **IMG.LY CE.SDK**: pricing is quote-based, the video editor is CE.SDK in video mode, and AI plugins are included in the license. Each license key covers a single commercial product. Without a license it runs in watermarked evaluation mode — [IMG.LY pricing](https://img.ly/pricing); [IMG.LY FAQ](https://img.ly/faqs); [support](https://support.img.ly/for-how-many-products-is-my-photoeditor-sdk-or-videoeditor-sdk-license-valid); [RN README](https://unpkg.com/@imgly/editor-react-native@1.53.0/README.md)
- **Open-source browser and desktop editors** (2026):
  - **FreeCut**: browser video editor, 2,304 stars, MIT, push 2026-10-29
  - **velocut**: Rust/WASM engine with WebGPU, "AI-native", 453 stars, MIT
  - **MartinDelophy/ai-video-editor**: local-first, agents and humans edit the same timeline, 931 stars, MIT
  - **WeftCut**: drives the timeline from any MCP client, 298 stars, MIT
  - **omniclip**: 1,468 stars, MIT
  - **Concat**: "CapCut replacement", scriptable through JS, 13,679 stars, **AGPL-3.0**
  - Sources: [freecut](https://github.com/walterlow/freecut); [velocut](https://github.com/open-ribbi/velocut); [ai-video-editor](https://github.com/MartinDelophy/ai-video-editor); [WeftCut](https://github.com/WeftCut/WeftCut); [omniclip](https://github.com/omni-media/omniclip); [Concat](https://github.com/jub0t/Concat)
- **kajisho5/ffmpeg-skill**: a local video editor for coding agents with 42 FFmpeg tools, a machine-readable contract and an MCP server. 4,322 stars, MIT, push 2026-10-31 — [GitHub](https://github.com/kajisho5/ffmpeg-skill)

### Inferences
- For a creator using Claude Code, Mediabunny is the safe low-level building block (MPL-2.0 is file-level copyleft). The editor SDKs suit people building products, not making videos.
- The agent-plus-timeline editors (WeftCut, ai-video-editor, velocut) are a new 2026 category: a human-editable NLE that Claude also drives via MCP. They are young, and I did not assess their quality.

### Gaps
- The current LICENSE file for Diffusion Studio Core v4 was not read directly; resolve before any commercial use.
- Twick's actual license terms.
- Rendley's own pricing page was not fetched; the figures come from its blog.

## 6. Cloud JSON-to-video render APIs (Shotstack, Creatomate, JSON2Video)

### Takeaway
These are template- and JSON-driven render services, which suit Claude generating JSON. Shotstack has the strongest MCP story, JSON2Video has a new official MCP, and Creatomate has only community MCPs. Pricing information is mostly vendor-authored and conflicting.

### Cited Findings
- Shotstack offers an MCP server and documentation structured for coding assistants (a Shotstack-authored page) — [Shotstack](https://shotstack.io/vs/creatomate-alternatives/)
- Pricing claims conflict. JSON2Video's comparison lists Shotstack's entry plan at $39/month (200 min) with no free plan. Others estimate about $0.20–0.40 per rendered minute. JSON2Video reportedly has a free tier of 600 credits (about 10 min) or a Hobby plan at $16.95/month. Creatomate prices by computation, so higher resolution and fps cost more (a Shotstack claim) — [JSON2Video](https://json2video.com/how-to/shotstack-alternative/); [Wireflow](https://www.wireflow.ai/blog/creatomate-vs-shotstack); [Motionbox](https://motionbox.io/blog/best-json2video-alternatives-in-2026)
- **JSON2Video/json2video-mcp**: the official MCP server, MIT, push 2026-10-28 (1 star) — [GitHub](https://github.com/JSON2Video/json2video-mcp)
- Creatomate MCPs are community-built only: WAR10CK222/creatomate-mcp-server (MIT) and adflowgit/creatomate-mcp-server — [WAR10CK222](https://github.com/WAR10CK222/creatomate-mcp-server); [adflowgit](https://github.com/adflowgit/creatomate-mcp-server)

### Inferences
- Pick these APIs to scale templated variants, such as social cutdowns, rather than for bespoke motion design. Expressiveness is below GSAP, HyperFrames or Remotion.

### Gaps
- Official pricing pages were not fetched. All prices above are from vendor or affiliate comparisons and need confirmation.
- The name and package of Shotstack's official MCP were not verified.

## 7. Animated data visualization and diagram animation

### Takeaway
Vizzu (Apache-2.0) is the purpose-built animated chart-transition library. D3 and Observable Plot remain the general-purpose base. Penrose generates diagrams from notation. New MCP-enabled diagram animators such as Excalimate make "diagram → keyframed explainer" accessible to agents.

### Cited Findings
- **Vizzu** (vizzu-lib): animated data visualizations and data stories. 2,047 stars, Apache-2.0, push 2026-04-20 — [GitHub](https://github.com/vizzuhq/vizzu-lib)
- **D3**: 113,856 stars, ISC, push 2026-10-21. **Observable Plot**: 5,417 stars, ISC, push 2026-10-30 — [d3](https://github.com/d3/d3); [plot](https://github.com/observablehq/plot)
- **Penrose** ("create beautiful diagrams just by typing notation in plain text"): 8,010 stars, MIT, push 2026-10-31 — [GitHub](https://github.com/penrose/penrose)
- **Excalimate**: animates Excalidraw diagrams with opacity, position, scale, rotation and arrow draw-on, plus camera animation. Exports MP4, WebM, GIF or animated SVG and includes an **MCP server**. 100 stars, MIT, push 2026-11-01. The README cautions that much of the code was AI-built and bugs are still being fixed — [README](https://github.com/excalimate/excalimate)
- **kymostudio** ("Bring your Diagrams to Life", Apache-2.0, 10 stars) and **nakkas** (an MCP that "turns AI into an SVG artist", MIT, 31 stars) — [kymostudio](https://github.com/kymostudio/kymostudio); [nakkas](https://github.com/arikusi/nakkas)
- iart-ai's skill packs include data-animation-skills (3 skills) and map-animation-skills ("Vox-style editorial maps") — [motion-skills README](https://github.com/iart-ai/motion-skills)

### Gaps
- Flourish (commercial) animation and export capabilities and API were not researched within budget.
- Observable Plot has no native animation/transition API that I verified; animation typically means re-rendering per frame. Unverified.

## 8. SVG animation and kinetic typography

### Takeaway
SVG.js is still maintained, but Vivus is unmaintained since 2022. For kinetic type, the now-free GSAP SplitText plus agent skills is the practical default. Dedicated kinetic-typography generators are niche.

### Cited Findings
- **SVG.js**: 11,849 stars, push 2026-08-04. GitHub reports the license as NOASSERTION; verify before relying on it — [GitHub](https://github.com/svgdotjs/svg.js)
- **Vivus** (SVG line-drawing animation): 15,479 stars, MIT, **last push 2022-07-06** — [GitHub](https://github.com/maxwellito/vivus)
- GSAP SplitText (text splitting for kinetic type) is among the formerly paid plugins now free — [gsap-skills README](https://github.com/greensock/gsap-skills)
- **pv-tool** ("automatically generate kinetic typography"): 453 stars, NOASSERTION license, push 2026-05-18 — [GitHub](https://github.com/DanteAlighieri13210914/pv-tool)
- **bang-motion**: an agent skill for browser motion graphics (openers, promos, bumpers, kinetic typography). 978 stars, MIT — [GitHub](https://github.com/bangtutorial/bang-motion)
- **geomotion**: hand-drawn morphing line animations; zero-dependency JS engine with studio and CLI. MIT, 6 stars — [GitHub](https://github.com/hacimertgokhan/geomotion)

### Gaps
- Figma-to-motion pipelines beyond Jitter's Figma plugin and Figma Motion → LottieFiles were not researched in depth.

## 9. Claude skills and MCP ecosystem for motion graphics (cross-cutting)

### Takeaway
By late 2026, official agent skills exist for GSAP and Remotion, official MCPs exist for Rive, Lottie Creator, Motion (paid), Penpot and JSON2Video, and a large community skill ecosystem has grown around them. Star counts are high, but quality varies and many licenses are non-standard.

### Cited Findings
- Official: greensock/gsap-skills (17,714 stars, MIT), remotion-dev/skills (6,067 stars), the Motion AI Kit (Motion+), the Rive MCP (Early Access app), the Lottie Creator MCP (`@lottiefiles/creator-mcp`), penpot/penpot-mcp (534 stars) and JSON2Video/json2video-mcp — sources in sections 1–6 above
- **Community skill packs**:
  - **iart-ai/motion-skills**: 1,146 stars, MIT. 56 skills in 19 packs covering kinetic typography, data charts, explainers, TikTok/Reels, 3D/WebGL and math animation. It is the open-source craft behind the commercial iart.ai. (The search-result description says "50 skills"; the README says 56.) — [README](https://github.com/iart-ai/motion-skills)
  - **Vincentwei1021/anything2explainer**: topic in, narrated explainer video out. 2,975 stars, NOASSERTION — [GitHub](https://github.com/Vincentwei1021/anything2explainer)
  - **nateherkai/herk-edit-kit**: 15 skills for editing videos, reels and Shorts. 2,497 stars, NOASSERTION — [GitHub](https://github.com/nateherkai/herk-edit-kit)
  - **Barty-Bart/motion-graphics**: 1,003 stars, NOASSERTION — [GitHub](https://github.com/Barty-Bart/motion-graphics)
  - **haidrrrry/claude-remotion-skill**: 767 stars, MIT — [GitHub](https://github.com/haidrrrry/claude-remotion-skill)
  - **AThevon/genjutsu**: creative coding skills for Claude Code, claude.ai and Cowork. 722 stars, NOASSERTION — [GitHub](https://github.com/AThevon/genjutsu)
  - **frankxai/awesome-motion-design-agent-skills**: a curated list covering GSAP, Motion, Remotion, Lottie and Rive. CC0, 90 stars — [GitHub](https://github.com/frankxai/awesome-motion-design-agent-skills)
  - **wilwaldon/Claude-Code-Video-Toolkit**: skills plus MCPs for video with Claude Code. 104 stars, no license — [GitHub](https://github.com/wilwaldon/Claude-Code-Video-Toolkit)
- No Theatre.js MCP or skill was found (GitHub search for "theatre.js mcp" returned nothing) — [GitHub search](https://github.com/search?q=theatre.js+mcp&type=repositories)

### Inferences
- Several high-star community skills carry NOASSERTION or no license. Treat them as "read and learn", not "vendor into a product", until the license is checked.
- Official skills (GSAP, Remotion) are likely the most reliable because they track API changes. GSAP's README also biases agents toward GSAP by default.

### Gaps
- No quality or benchmark evaluation of any skill pack was done. Star counts may be inflated, since several repos created in 2026 have thousands of stars.

## 10. License traps summary (cross-cutting)

### Takeaway
The main traps are: GSAP (free but proprietary, no competing no-code tools); Remotion (company license at 4+ people); Diffusion Studio Core (conflicting non-commercial vs MPL signals); ODU33104/rive-mcp (freeware, no forks); copyleft AGPL/GPL tools (Hydra, Concat, etro, Natron, Synfig); IMG.LY (quote-based, one license per product); and Cavalry (free for individuals only, studios pay Canva).

### Cited Findings
- GSAP Standard "No Charge" license restrictions — [license archive](https://open.windriver.com/info/uni-license-list/licenses/gsap-standard-no-charge-2025.html)
- Remotion: 4+ person companies need a Company License; collaborating teams' headcounts combine — [Remotion license FAQ](https://www.remotion.dev/docs/license/faq.md)
- Diffusion Studio: non-commercial vs MPL conflict — [npm](https://npmjs.com/package/%40diffusionstudio%2Fcore)
- rive-mcp: "Freeware, NOT open source" — [README](https://github.com/ODU33104/rive-mcp)
- AGPL: Hydra, Concat. GPL: etro (GPL-3.0), Natron (GPL-2.0), Synfig (GPL-3.0) — [hydra](https://github.com/hydra-synth/hydra); [Concat](https://github.com/jub0t/Concat); [etro](https://github.com/etro-js/etro); [Natron](https://github.com/NatronGitHub/Natron); [synfig](https://github.com/synfig/synfig)
- Cavalry: studios need a paid Canva account — [CG Channel](https://www.cgchannel.com/2026/04/canva-makes-motion-graphics-and-animation-app-cavalry-free/)
- Motion AI Kit: requires paid Motion+ — [motion.dev](https://motion.dev/ai-kit)

### Inferences
- Permissive core stack for a creator: HyperFrames (Apache-2.0), anime.js, Motion, PixiJS, two.js and mo.js (all MIT), Mediabunny (MPL-2.0), Vizzu (Apache-2.0), Penrose (MIT), D3/Plot (ISC), TiXL (MIT), Manim (MIT) and the Rive/Lottie runtimes (MIT).

### Gaps
- Licenses reported as NOASSERTION (Twick, SVG.js, several skill packs) were not resolved.
