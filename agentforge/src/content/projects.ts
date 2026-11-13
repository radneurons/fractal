// Project Workshop content. Guided projects have executable milestones graded by real tests in the sandbox.
import type { CodeTest } from '@/core/types';

export interface Milestone {
  id: string;
  title: string;
  kind: 'plan' | 'code' | 'reflect';
  skillId: string;
  brief: string;
  // plan/reflect
  checklist?: string[];
  prompt?: string;
  // code
  exports?: string[];
  starter?: string;
  solutionSketch?: string;
  tests?: CodeTest[];
}

export interface Project {
  id: string;
  title: string;
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  guided: boolean;
  skills: string[];
  scenario: string;
  requirements: string[];
  constraints: string[];
  architecture: string;
  rubric: { criterion: string; weight: number }[];
  milestones: Milestone[];
  portfolio: string;
}

const t = (name: string, code: string): CodeTest => ({ name, code });

export const PROJECTS: Project[] = [
  {
    id: 'p-extractor', title: 'Structured Data Extractor', level: 'beginner', guided: true,
    skills: ['p-format', 'api-structured', 'ev-datasets'],
    scenario: 'A small recruiting agency receives hundreds of free-text emails from candidates. They want name, email and years of experience extracted into a spreadsheet — and they need to know when extraction is unreliable.',
    requirements: ['Extract name, email and years_experience into a fixed schema', 'Return null for missing fields (never invent)', 'Validate every record before it is stored', 'Measure field-level accuracy on a labelled set'],
    constraints: ['No personal data beyond the three fields', 'Invalid records go to a review queue, not the spreadsheet'],
    architecture: 'email text → extraction (model or rules) → JSON → validator → store | review queue; offline evaluation harness computes field accuracy.',
    rubric: [{ criterion: 'Schema is precise and handles missing data', weight: 25 }, { criterion: 'Validation catches bad records', weight: 25 }, { criterion: 'Prompt is structured with delimiters and rules', weight: 20 }, { criterion: 'Evaluation measures accuracy honestly', weight: 30 }],
    portfolio: 'A tested extraction pipeline with a validator and an accuracy report.',
    milestones: [
      { id: 'm1', title: 'Plan the schema and acceptance criteria', kind: 'plan', skillId: 'pr-requirements', brief: 'Before code: decide the output contract and what "good enough" means.',
        checklist: ['Each field has a type and a rule for missing data', 'Acceptance threshold defined (e.g. ≥ 90% field accuracy on 20 labelled emails)', 'Failure path defined (review queue)', 'Non-goals written (e.g. no phone numbers)'],
        prompt: 'Write your schema and acceptance criteria.' },
      { id: 'm2', title: 'Rule-based baseline extractor', kind: 'code', skillId: 'pg-functions-data', brief: 'Build a deterministic baseline first — it gives you something to compare a model against. Implement `extract(text)` returning `{name, email, years_experience}` with nulls for missing values. Name comes from a line starting "Name:"; email is any address; years from "N years".',
        exports: ['extract'],
        starter: `function extract(text) {\n  return { name: null, email: null, years_experience: null };\n}`,
        tests: [
          t('extracts all fields', `const r = m.extract('Name: Ada Lovelace\\nI have 7 years of experience. Reach me at ada@math.org'); return r.name === 'Ada Lovelace' && r.email === 'ada@math.org' && r.years_experience === 7;`),
          t('missing email is null', `const r = m.extract('Name: Bo\\n3 years in sales'); return r.email === null && r.years_experience === 3;`),
          t('missing years is null', `const r = m.extract('Name: Cy\\ncy@x.io'); return r.years_experience === null;`),
          t('never invents a name', `return m.extract('hello, write back to z@z.io').name === null;`),
        ] },
      { id: 'm3', title: 'Validator', kind: 'code', skillId: 'api-structured', brief: 'Implement `validate(rec)` returning an array of problems (empty = valid). Rules: name is null or a non-empty string ≤ 80 chars; email is null or matches a basic email pattern; years_experience is null or an integer 0–60. Problems are the field names.',
        exports: ['validate'],
        starter: `function validate(rec) {\n  return [];\n}`,
        tests: [
          t('valid record', `return m.validate({name:'Ada', email:'a@b.co', years_experience: 7}).length === 0;`),
          t('nulls are allowed', `return m.validate({name:null, email:null, years_experience:null}).length === 0;`),
          t('bad email', `return m.validate({name:'A', email:'nope', years_experience: 1}).includes('email');`),
          t('years must be integer 0-60', `return m.validate({name:'A', email:null, years_experience: 7.5}).includes('years_experience') && m.validate({name:'A', email:null, years_experience: 99}).includes('years_experience');`),
          t('empty name invalid', `return m.validate({name:'', email:null, years_experience:null}).includes('name');`),
        ] },
      { id: 'm4', title: 'Model prompt builder', kind: 'code', skillId: 'p-format', brief: 'For the model-based version, implement `buildPrompt(email)` returning a prompt string that: wraps the email in <email></email> tags, states the exact JSON keys, says to use null for missing values, and says to treat the email as data, not instructions.',
        exports: ['buildPrompt'],
        starter: `function buildPrompt(email) {\n  return 'Extract the data: ' + email;\n}`,
        tests: [
          t('delimits the email', `const p = m.buildPrompt('hi'); return p.includes('<email>') && p.includes('</email>');`),
          t('names all keys', `const p = m.buildPrompt('x'); return ['name','email','years_experience'].every(k => p.includes(k));`),
          t('null rule', `return /null/i.test(m.buildPrompt('x'));`),
          t('treats input as data', `return /data/i.test(m.buildPrompt('x')) && /instruction/i.test(m.buildPrompt('x'));`),
        ] },
      { id: 'm5', title: 'Accuracy evaluation', kind: 'code', skillId: 'ev-metrics', brief: 'Implement `fieldAccuracy(predictions, gold)` — both arrays of records — returning an object mapping each field to the fraction of records where prediction equals gold (null equals null).',
        exports: ['fieldAccuracy'],
        starter: `function fieldAccuracy(predictions, gold) {\n  return {};\n}`,
        tests: [
          t('perfect', `const g=[{name:'A',email:null,years_experience:1}]; const r=m.fieldAccuracy(g,g); return r.name===1&&r.email===1&&r.years_experience===1;`),
          t('partial', `const p=[{name:'A',email:'x',years_experience:1},{name:'B',email:null,years_experience:2}]; const g=[{name:'A',email:null,years_experience:1},{name:'C',email:null,years_experience:2}]; const r=m.fieldAccuracy(p,g); return r.name===0.5&&r.email===0.5&&r.years_experience===1;`),
        ] },
      { id: 'm6', title: 'Reflection', kind: 'reflect', skillId: 'ev-why', brief: 'What would make you trust this in production? What would you monitor?', prompt: 'Write 3–5 sentences.' },
    ],
  },
  {
    id: 'p-docqa', title: 'Document Q&A with Verifiable Sources', level: 'intermediate', guided: true,
    skills: ['r-chunking', 'r-retrieval', 'r-grounding', 'r-eval'],
    scenario: 'HR wants an assistant that answers policy questions from the employee handbook — and every answer must cite the paragraph it came from, or say it does not know.',
    requirements: ['Chunk documents with ids and metadata', 'Retrieve top-k chunks for a question', 'Answers cite chunk ids; uncited claims are rejected', 'Report recall@k on labelled questions'],
    constraints: ['Never answer from outside the handbook', 'Say "not found" when retrieval returns nothing relevant'],
    architecture: 'docs → chunker → index → retrieve(top-k) → grounded answer with [chunk-id] → citation verifier; evaluation set measures recall@k separately from answer quality.',
    rubric: [{ criterion: 'Chunks keep meaning and metadata', weight: 20 }, { criterion: 'Retrieval quality measured with recall@k', weight: 30 }, { criterion: 'Citations verified in code', weight: 30 }, { criterion: '"Not found" handled honestly', weight: 20 }],
    portfolio: 'A retrieval pipeline with citation verification and a retrieval-quality report.',
    milestones: [
      { id: 'm1', title: 'Chunker', kind: 'code', skillId: 'r-chunking', brief: 'Implement `chunk(docId, text, size, overlap)` that splits text into sentences (split after . ! ?) and groups `size` sentences per chunk, advancing by `size - overlap`. Return `[{id: docId + "#" + i, text}]`. Stop once the last sentence is included.',
        exports: ['chunk'],
        starter: `function chunk(docId, text, size, overlap) {\n  return [{ id: docId + '#0', text }];\n}`,
        tests: [
          t('groups sentences', `const c = m.chunk('d', 'A. B. C. D.', 2, 0); return c.length === 2 && c[0].text === 'A. B.' && c[1].id === 'd#1';`),
          t('applies overlap', `const c = m.chunk('d', 'A. B. C.', 2, 1); return c.length === 2 && c[1].text === 'B. C.';`),
          t('single sentence', `const c = m.chunk('d', 'Only one.', 3, 1); return c.length === 1 && c[0].text === 'Only one.';`),
        ] },
      { id: 'm2', title: 'Retriever', kind: 'code', skillId: 'r-retrieval', brief: 'Implement `retrieve(chunks, query, k)` scoring each chunk by how many distinct lowercase query words (length > 2) it contains; return the top-k chunk ids with score > 0, highest first (ties keep input order).',
        exports: ['retrieve'],
        starter: `function retrieve(chunks, query, k) {\n  return [];\n}`,
        tests: [
          t('ranks by overlap', `const c=[{id:'a',text:'annual leave days'},{id:'b',text:'remote work'},{id:'c',text:'leave policy'}]; return JSON.stringify(m.retrieve(c,'how many leave days',2))==='["a","c"]';`),
          t('ignores short words', `return m.retrieve([{id:'a',text:'is it on'}],'is it on',3).length===0;`),
          t('respects k', `const c=[{id:'a',text:'x leave'},{id:'b',text:'y leave'}]; return m.retrieve(c,'leave',1).length===1;`),
        ] },
      { id: 'm3', title: 'Citation verifier', kind: 'code', skillId: 'r-grounding', brief: 'Implement `verifyCitations(answer, retrievedIds)`: find every citation like [leave#0] in the answer; return `{valid: string[], invalid: string[], uncited: boolean}` where invalid citations are not in retrievedIds and uncited is true if the answer has no citations at all.',
        exports: ['verifyCitations'],
        starter: `function verifyCitations(answer, retrievedIds) {\n  return { valid: [], invalid: [], uncited: true };\n}`,
        tests: [
          t('valid citation', `const r=m.verifyCitations('25 days [leave#0].',['leave#0']); return r.valid[0]==='leave#0'&&r.invalid.length===0&&r.uncited===false;`),
          t('invalid citation', `const r=m.verifyCitations('Yes [remote#3].',['leave#0']); return r.invalid[0]==='remote#3';`),
          t('uncited answer', `return m.verifyCitations('Probably 20 days.',['leave#0']).uncited===true;`),
        ] },
      { id: 'm4', title: 'Recall@k evaluation', kind: 'code', skillId: 'r-eval', brief: 'Implement `recallAtK(results, k)` where results is `[{retrieved: string[], relevant: string}]`; return the fraction where `relevant` appears in the first k retrieved ids.',
        exports: ['recallAtK'],
        starter: `function recallAtK(results, k) {\n  return 0;\n}`,
        tests: [
          t('computes recall', `return m.recallAtK([{retrieved:['a','b'],relevant:'b'},{retrieved:['c'],relevant:'d'}],2)===0.5;`),
          t('respects k', `return m.recallAtK([{retrieved:['a','b'],relevant:'b'}],1)===0;`),
        ] },
      { id: 'm5', title: 'Reflection', kind: 'reflect', skillId: 'r-eval', brief: 'If recall@3 were 0.6, what would you change first, and why not the generation prompt?', prompt: 'Write 3–5 sentences.' },
    ],
  },
  {
    id: 'p-agentloop', title: 'Build a Bounded Tool-Using Agent Loop', level: 'advanced', guided: true,
    skills: ['ag-loop', 'ag-stop', 'ag-recovery', 'sec-confirm'],
    scenario: 'Your team wants its own minimal agent loop instead of a black-box framework, so every step is observable and bounded.',
    requirements: ['Execute tool requests and feed observations back', 'Stop on final answer or maxSteps', 'Return tool errors as observations', 'Reject unknown tools', 'Require approval for high-impact tools'],
    constraints: ['The model is a scripted function in tests — no network', 'Trace every step'],
    architecture: 'loop: decision = model(history) → validate → execute (or deny) → append observation → stop checks.',
    rubric: [{ criterion: 'Loop is correct and observable', weight: 30 }, { criterion: 'Termination is guaranteed', weight: 25 }, { criterion: 'Errors handled honestly', weight: 20 }, { criterion: 'High-impact actions gated', weight: 25 }],
    portfolio: 'A ~40-line, fully tested agent loop with budgets, error handling and approval gates.',
    milestones: [
      { id: 'm1', title: 'The core loop', kind: 'code', skillId: 'ag-loop', brief: 'Implement `runAgent(model, tools, maxSteps)`. Each step call `model(history)`; it returns `{type:"tool", name, args}` or `{type:"final", text}`. For tools, run `tools[name](args)` and push `{tool: name, result}` to history. Return `{answer, steps, history}`; if maxSteps is reached return answer `null`.',
        exports: ['runAgent'],
        starter: `function runAgent(model, tools, maxSteps) {\n  const history = [];\n  return { answer: null, steps: 0, history };\n}`,
        tests: [
          t('runs tools then answers', `const model = h => h.length === 0 ? {type:'tool', name:'add', args:{a:2,b:3}} : {type:'final', text: 'sum=' + h[0].result}; const r = m.runAgent(model, {add: ({a,b}) => a+b}, 5); return r.answer === 'sum=5' && r.steps === 2;`),
          t('stops at maxSteps', `const r = m.runAgent(() => ({type:'tool', name:'noop', args:{}}), {noop: () => 1}, 3); return r.answer === null && r.steps === 3;`),
          t('history records observations', `const model = h => h.length < 2 ? {type:'tool', name:'inc', args:{}} : {type:'final', text:'done'}; let n=0; const r = m.runAgent(model, {inc: () => ++n}, 5); return r.history.length === 2 && r.history[1].result === 2;`),
        ] },
      { id: 'm2', title: 'Errors and unknown tools', kind: 'code', skillId: 'ag-recovery', brief: 'Extend `runAgent`: if the tool is unknown push `{tool, error: "unknown tool"}`; if a tool throws push `{tool, error: message}`. The loop continues so the model can adapt.',
        exports: ['runAgent'],
        starter: `function runAgent(model, tools, maxSteps) {\n  // paste your loop from milestone 1, then add error handling\n  const history = [];\n  return { answer: null, steps: 0, history };\n}`,
        tests: [
          t('unknown tool is an observation', `const model = h => h.length === 0 ? {type:'tool', name:'ghost', args:{}} : {type:'final', text: h[0].error}; return m.runAgent(model, {}, 3).answer === 'unknown tool';`),
          t('thrown errors become observations', `const model = h => h.length === 0 ? {type:'tool', name:'boom', args:{}} : {type:'final', text: h[0].error}; return m.runAgent(model, {boom: () => { throw new Error('timeout'); }}, 3).answer === 'timeout';`),
          t('still runs good tools', `const model = h => h.length === 0 ? {type:'tool', name:'one', args:{}} : {type:'final', text: String(h[0].result)}; return m.runAgent(model, {one: () => 1}, 3).answer === '1';`),
        ] },
      { id: 'm3', title: 'Loop guard + approval gate', kind: 'code', skillId: 'sec-confirm', brief: 'Final version: `runAgent(model, tools, maxSteps, opts)` where `opts = {highImpact: string[], approve: (name, args) => boolean}`. Calls to a high-impact tool run only if `approve` returns true, otherwise push `{tool, error: "denied"}`. Also stop with answer "stopped: loop" if the same tool+args (JSON) is requested 3 times in a row.',
        exports: ['runAgent'],
        starter: `function runAgent(model, tools, maxSteps, opts = { highImpact: [], approve: () => false }) {\n  const history = [];\n  return { answer: null, steps: 0, history };\n}`,
        tests: [
          t('denies unapproved high-impact', `let sent=false; const model = h => h.length === 0 ? {type:'tool', name:'send', args:{}} : {type:'final', text: h[0].error || 'ok'}; const r = m.runAgent(model, {send: () => { sent = true; }}, 3, {highImpact:['send'], approve: () => false}); return r.answer === 'denied' && sent === false;`),
          t('runs approved high-impact', `let sent=false; const model = h => h.length === 0 ? {type:'tool', name:'send', args:{}} : {type:'final', text: 'ok'}; m.runAgent(model, {send: () => { sent = true; }}, 3, {highImpact:['send'], approve: () => true}); return sent === true;`),
          t('loop guard trips on 3 identical calls', `const r = m.runAgent(() => ({type:'tool', name:'q', args:{x:1}}), {q: () => 1}, 10, {highImpact: [], approve: () => true}); return r.answer === 'stopped: loop' && r.steps === 3;`),
          t('different args are not a loop', `let i=0; const model = h => h.length < 4 ? {type:'tool', name:'q', args:{x: i++}} : {type:'final', text:'done'}; return m.runAgent(model, {q: () => 1}, 10, {highImpact: [], approve: () => true}).answer === 'done';`),
        ] },
      { id: 'm4', title: 'Reflection', kind: 'reflect', skillId: 'ag-stop', brief: 'Which guarantees in your loop come from code and which depend on the model behaving well?', prompt: 'Write 3–5 sentences.' },
    ],
  },
  // ───── Briefs (milestone checklists + rubric; implementation is open-ended)
  {
    id: 'p-optimizer', title: 'AI Prompt Optimizer', level: 'beginner', guided: false, skills: ['p-iterate', 'p-verify'],
    scenario: 'A content team re-uses a handful of prompts daily and wants them to get measurably better over time.',
    requirements: ['Store prompt templates with versions', 'A test set of 10 inputs per template', 'Side-by-side comparison of versions with a written rubric'],
    constraints: ['Change one thing per version', 'Record why each change was made'],
    architecture: 'template registry → runner over test set → rubric scoring (human or model) → version history.',
    rubric: [{ criterion: 'Representative test sets', weight: 30 }, { criterion: 'Rubric written before results', weight: 30 }, { criterion: 'Disciplined versioning', weight: 40 }],
    portfolio: 'A versioned prompt library with before/after evidence.',
    milestones: [
      { id: 'm1', title: 'Pick two prompts and write test sets', kind: 'plan', skillId: 'p-iterate', brief: 'Choose prompts you actually use.', checklist: ['10 inputs per prompt, including 2 edge cases', 'Expected qualities written per input'] },
      { id: 'm2', title: 'Write the rubric', kind: 'plan', skillId: 'p-verify', brief: 'Define criteria before reading outputs.', checklist: ['3–5 criteria', 'Each criterion has a pass/fail definition'] },
      { id: 'm3', title: 'Iterate three versions', kind: 'plan', skillId: 'p-iterate', brief: 'Change one thing at a time.', checklist: ['v1, v2, v3 recorded with rationale', 'Scores recorded on the full test set each time'] },
      { id: 'm4', title: 'Reflection', kind: 'reflect', skillId: 'p-iterate', brief: 'Which change helped most, and how do you know?', prompt: 'Write 3–5 sentences.' },
    ],
  },
  {
    id: 'p-triage', title: 'Support Ticket Triage System', level: 'intermediate', guided: false, skills: ['ar-workflows', 'api-structured', 'ev-metrics'],
    scenario: 'Support receives 2,000 tickets per day. Route each to billing, bugs, feature requests or a human — with measured precision.',
    requirements: ['Classify with a fixed label set incl. "needs-human"', 'Validated structured output', 'Precision/recall per label on 100 labelled tickets'],
    constraints: ['Low-confidence → human queue', 'No auto-replies in v1'],
    architecture: 'ticket → classifier (structured output) → validator → router → queues; eval job computes per-label metrics.',
    rubric: [{ criterion: 'Per-label metrics reported', weight: 35 }, { criterion: 'Safe fallback to humans', weight: 30 }, { criterion: 'Workflow (not agent) design justified', weight: 35 }],
    portfolio: 'A routing workflow with a metrics report.',
    milestones: [
      { id: 'm1', title: 'Label set and dataset', kind: 'plan', skillId: 'ev-datasets', brief: 'Define labels and collect cases.', checklist: ['Labels are mutually exclusive', '100 labelled tickets incl. ambiguous ones'] },
      { id: 'm2', title: 'Classifier + validator', kind: 'plan', skillId: 'api-structured', brief: 'Build and validate.', checklist: ['Schema with enum labels', 'Invalid output → retry once → human queue'] },
      { id: 'm3', title: 'Measure', kind: 'plan', skillId: 'ev-metrics', brief: 'Compute and act on metrics.', checklist: ['Precision and recall per label', 'Decision on threshold for auto-routing'] },
      { id: 'm4', title: 'Reflection', kind: 'reflect', skillId: 'ar-workflows', brief: 'Why is a workflow better than an agent here?', prompt: 'Write 3–5 sentences.' },
    ],
  },
  {
    id: 'p-research', title: 'Multi-Agent Research System', level: 'advanced', guided: false, skills: ['ar-delegation', 'ar-termination', 'fr-research'],
    scenario: 'Produce competitor briefs: a lead agent delegates source-gathering to workers and writes a cited report.',
    requirements: ['Lead/worker task specs with output formats', 'Every claim cited', 'Global budget and termination guarantees', 'Compare cost/quality against a single agent'],
    constraints: ['Workers have read-only tools', 'Max 3 revision rounds'],
    architecture: 'lead(plan) → N workers(parallel, isolated context) → lead(synthesise) → citation verifier → report.',
    rubric: [{ criterion: 'Delegation specs are precise', weight: 25 }, { criterion: 'Termination guaranteed', weight: 25 }, { criterion: 'Citation validity measured', weight: 25 }, { criterion: 'Honest comparison vs single agent', weight: 25 }],
    portfolio: 'A research pipeline with a cost-quality comparison.',
    milestones: [
      { id: 'm1', title: 'Design the delegation contract', kind: 'plan', skillId: 'ar-delegation', brief: 'Specify worker tasks.', checklist: ['Objective, boundaries, output format, done-criteria per worker'] },
      { id: 'm2', title: 'Budgets and stop conditions', kind: 'plan', skillId: 'ar-termination', brief: 'Guarantee it ends.', checklist: ['Global step/time/cost limits', 'Revision cap with human escalation'] },
      { id: 'm3', title: 'Evaluate', kind: 'plan', skillId: 'fr-research', brief: 'Measure it.', checklist: ['5 known-answer questions', 'Citation validity %', 'Cost per report vs single agent'] },
      { id: 'm4', title: 'Reflection', kind: 'reflect', skillId: 'ar-delegation', brief: 'Did multi-agent pay for itself?', prompt: 'Write 3–5 sentences.' },
    ],
  },
  {
    id: 'p-mcp', title: 'MCP-Powered Productivity Agent', level: 'advanced', guided: false, skills: ['t-mcp', 't-untrusted', 'sec-least-priv'],
    scenario: 'Build an MCP server exposing your team\'s task tracker so coding agents and chat assistants can read and create tasks safely.',
    requirements: ['Tools: search_tasks, create_task; resource: current sprint', 'Input validation in the server', 'create_task requires confirmation in the host', 'Integration tests for each tool'],
    constraints: ['Least-privilege token for the tracker API', 'Treat task text as untrusted data'],
    architecture: 'MCP host ↔ client ↔ your server (tools/resources) ↔ tracker API (scoped token).',
    rubric: [{ criterion: 'Correct MCP primitives', weight: 25 }, { criterion: 'Validation and scoping', weight: 30 }, { criterion: 'Tests', weight: 25 }, { criterion: 'Injection-aware design', weight: 20 }],
    portfolio: 'A tested MCP server with a security note. See modelcontextprotocol.io for SDKs.',
    milestones: [
      { id: 'm1', title: 'Define primitives', kind: 'plan', skillId: 't-mcp', brief: 'Tools vs resources vs prompts.', checklist: ['Each capability classified and justified', 'Schemas written'] },
      { id: 'm2', title: 'Threat model', kind: 'plan', skillId: 't-untrusted', brief: 'What could injected task text do?', checklist: ['Untrusted inputs listed', 'Mitigation per risk'] },
      { id: 'm3', title: 'Implement + test', kind: 'plan', skillId: 'sec-least-priv', brief: 'Build with the official SDK.', checklist: ['Integration test per tool', 'Scoped credentials'] },
      { id: 'm4', title: 'Reflection', kind: 'reflect', skillId: 't-mcp', brief: 'What would you change before sharing this server publicly?', prompt: 'Write 3–5 sentences.' },
    ],
  },
  {
    id: 'p-seclab', title: 'Agent Security Testing Laboratory', level: 'expert', guided: false, skills: ['sec-injection', 'sec-sandbox', 'ev-graders'],
    scenario: 'Create a defensive evaluation suite that measures how often a tool-using agent can be manipulated by injected content — in an isolated environment.',
    requirements: ['20+ harmless injection test cases across channels', 'Deterministic graders for forbidden tool calls', 'Run in a sandbox with fake data and credentials', 'Report attack success rate before/after mitigations'],
    constraints: ['No real systems, accounts or data', 'Defensive purpose only'],
    architecture: 'test cases → sandboxed agent with mock tools → trace → grader (forbidden call? leaked canary?) → report.',
    rubric: [{ criterion: 'Coverage of channels', weight: 25 }, { criterion: 'Objective graders', weight: 25 }, { criterion: 'Isolation', weight: 25 }, { criterion: 'Mitigation evidence', weight: 25 }],
    portfolio: 'A reproducible, defensive security eval with before/after numbers.',
    milestones: [
      { id: 'm1', title: 'Case design', kind: 'plan', skillId: 'sec-injection', brief: 'Direct, indirect (docs, web, tool results).', checklist: ['20 cases with expected safe behaviour', 'Canary values to detect leaks'] },
      { id: 'm2', title: 'Isolation', kind: 'plan', skillId: 'sec-sandbox', brief: 'Make it safe to run.', checklist: ['Mock tools only', 'No network, fake credentials'] },
      { id: 'm3', title: 'Graders and report', kind: 'plan', skillId: 'ev-graders', brief: 'Measure.', checklist: ['Forbidden-call grader', 'Success rate before/after mitigation'] },
      { id: 'm4', title: 'Reflection', kind: 'reflect', skillId: 'sec-injection', brief: 'Which mitigation reduced risk most, and what residual risk remains?', prompt: 'Write 3–5 sentences.' },
    ],
  },
  {
    id: 'p-codeflow', title: 'Reproducible Coding-Agent Workflow', level: 'intermediate', guided: false, skills: ['cc-claudemd', 'cx-agentsmd', 'cc-plan', 'cx-choose'],
    scenario: 'Set up a repository so Claude Code and Codex both work reliably in it, then compare them on real tickets.',
    requirements: ['CLAUDE.md and AGENTS.md with verified commands', 'Permission/sandbox settings documented', 'A 5-ticket comparison with tests passed, diff size and review minutes'],
    constraints: ['Same task wording for both tools', 'Record failures honestly'],
    architecture: 'repo + instruction files + CI tests → agent runs on branches → review checklist → comparison table.',
    rubric: [{ criterion: 'Instruction files accurate and concise', weight: 30 }, { criterion: 'Safe permissions', weight: 25 }, { criterion: 'Fair comparison method', weight: 45 }],
    portfolio: 'A documented agent-ready repo and an evidence-based tool comparison.',
    milestones: [
      { id: 'm1', title: 'Instruction files', kind: 'plan', skillId: 'cc-claudemd', brief: 'Write and verify.', checklist: ['Every command in the files was run and works', 'Conventions justified'] },
      { id: 'm2', title: 'Controls', kind: 'plan', skillId: 'cc-permissions', brief: 'Least privilege.', checklist: ['Allow/ask/deny policy written', 'Sandbox mode chosen per task type'] },
      { id: 'm3', title: 'Comparison', kind: 'plan', skillId: 'cx-choose', brief: 'Run 5 tickets with each tool.', checklist: ['Same wording', 'Tests, diff size, review minutes recorded'] },
      { id: 'm4', title: 'Reflection', kind: 'reflect', skillId: 'cx-choose', brief: 'What would you tell your team, and how confident are you given 5 tickets?', prompt: 'Write 3–5 sentences.' },
    ],
  },
];

export const projectById = (id: string) => PROJECTS.find((p) => p.id === id);
