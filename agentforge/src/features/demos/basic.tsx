// Foundational demos: tokenizer, rule-vs-model, neural net, LLM pipeline, context window.
import { useMemo, useState } from 'react';
import { teachTokenize, estimateTokens } from '@/core/runtime/tokenizer';
import { Icon, TruthLabel } from '@/ui/kit';

// ───────── Tokenizer
export function TokenizerDemo() {
  const [text, setText] = useState('Unbelievably, tokenization splits rare words like "Kubernetes" into pieces.');
  const toks = useMemo(() => teachTokenize(text), [text]);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <div className="card stack">
      <div className="row between"><b>Tokenizer explorer</b><TruthLabel kind="simulated" detail="Teaching tokenizer: mimics sub-word behaviour. Real tokenizers are learned and differ per model — use the provider's token counter for exact counts." /></div>
      <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} aria-label="Text to tokenize" />
      <div aria-label="Tokens" style={{ lineHeight: 2 }}>
        {toks.map((t, i) => <span key={i} className="token" style={{ background: `hsl(${(t.id * 47) % 360} 70% 50% / .22)`, border: `1px solid hsl(${(t.id * 47) % 360} 70% 55% / .5)` }} title={`id ${t.id}`}>{t.text.replace(/ /g, '·')}</span>)}
      </div>
      <div className="grid g4">
        <div className="kpi"><span className="v">{toks.length}</span><span className="l">teaching tokens</span></div>
        <div className="kpi"><span className="v">{estimateTokens(text)}</span><span className="l">≈ chars ÷ 4</span></div>
        <div className="kpi"><span className="v">{words}</span><span className="l">words</span></div>
        <div className="kpi"><span className="v">{words ? (toks.length / words).toFixed(2) : '—'}</span><span className="l">tokens / word</span></div>
      </div>
      <div className="tiny faint">Try: code (<code>{'const x = fn(a,b);'}</code>), a long rare word, numbers, or another language — token counts rise.</div>
    </div>
  );
}

// ───────── Rule vs model
const FEATURES = [
  { name: 'Mentions money / prizes', re: /(free|money|prize|win|\$|cash|r[e3]ward)/i, w: 1.6 },
  { name: 'Odd spelling (digits in words)', re: /[a-z][0-9][a-z]|[0-9][a-z]{2,}/i, w: 1.3 },
  { name: 'Urgency', re: /(urgent|now|today only|act fast|immediately|!!)/i, w: 1.1 },
  { name: 'Contains a link', re: /(http|www\.|\.com|click)/i, w: 0.9 },
  { name: 'Personal greeting', re: /\b(hi|hello|dear) [A-Z][a-z]+/, w: -1.4 },
  { name: 'Meeting / work words', re: /(meeting|agenda|invoice|project|deck|report)/i, w: -1.2 },
];
export function RuleVsModelDemo() {
  const [msg, setMsg] = useState('Fr33 m0ney!! Click now to claim your prize');
  const rule = /free money/i.test(msg);
  const hits = FEATURES.map((f) => ({ ...f, on: f.re.test(msg) }));
  const z = -1 + hits.reduce((s, f) => s + (f.on ? f.w : 0), 0);
  const p = 1 / (1 + Math.exp(-z));
  const samples = ['Free money for you', 'Fr33 m0ney!! Click now to claim your prize', 'Hi Priya, agenda for Monday\'s meeting attached', 'Win a FREE cruise — act fast! www.deal.example', 'Your invoice for October is ready'];
  return (
    <div className="card stack">
      <div className="row between"><b>Rule-based vs learned classifier</b><TruthLabel kind="simulated" detail="The 'learned' side is a tiny logistic model with authored weights — it shows how learned systems combine many weak signals." /></div>
      <input className="input" value={msg} onChange={(e) => setMsg(e.target.value)} aria-label="Message to classify" />
      <div className="row">{samples.map((s) => <button key={s} className="chip" style={{ cursor: 'pointer' }} onClick={() => setMsg(s)}>{s.slice(0, 28)}…</button>)}</div>
      <div className="grid g2">
        <div className="card inset">
          <div className="eyebrow">Hand-written rule</div>
          <code>if text contains "free money" → spam</code>
          <h3 style={{ margin: '10px 0 0', color: rule ? 'var(--danger)' : 'var(--success)' }}>{rule ? 'SPAM' : 'Not spam'}</h3>
          <div className="tiny faint">Exact and predictable — but misses anything it wasn't written for.</div>
        </div>
        <div className="card inset">
          <div className="eyebrow">Learned (weighted signals)</div>
          {hits.map((f) => <div key={f.name} className="row between tiny" style={{ opacity: f.on ? 1 : 0.45 }}><span>{f.on ? '●' : '○'} {f.name}</span><span className="mono">{f.w > 0 ? '+' : ''}{f.w}</span></div>)}
          <h3 style={{ margin: '10px 0 0', color: p > 0.5 ? 'var(--danger)' : 'var(--success)' }}>{p > 0.5 ? 'SPAM' : 'Not spam'} · {(p * 100).toFixed(0)}%</h3>
          <div className="tiny faint">Flexible with messy input — and can be confidently wrong.</div>
        </div>
      </div>
    </div>
  );
}

// ───────── Neural net (real gradient descent on a logistic neuron)
const FRUIT = [
  { c: 0.9, s: 0.7, y: 1 }, { c: 0.8, s: 0.9, y: 1 }, { c: 0.7, s: 0.6, y: 1 }, { c: 0.3, s: 0.2, y: 0 }, { c: 0.2, s: 0.5, y: 0 }, { c: 0.5, s: 0.1, y: 0 }, { c: 0.6, s: 0.8, y: 1 }, { c: 0.4, s: 0.4, y: 0 },
];
const sig = (z: number) => 1 / (1 + Math.exp(-z));
export function NeuralNetDemo() {
  const [w1, setW1] = useState(-0.5);
  const [w2, setW2] = useState(0.3);
  const [b, setB] = useState(0.2);
  const [epochs, setEpochs] = useState(0);
  const preds = FRUIT.map((f) => sig(w1 * f.c + w2 * f.s + b));
  const loss = FRUIT.reduce((s, f, i) => s - (f.y * Math.log(preds[i] + 1e-9) + (1 - f.y) * Math.log(1 - preds[i] + 1e-9)), 0) / FRUIT.length;
  const acc = FRUIT.filter((f, i) => (preds[i] > 0.5 ? 1 : 0) === f.y).length / FRUIT.length;
  const train = (n: number) => {
    let a = w1, c = w2, d = b;
    for (let e = 0; e < n; e++) {
      let g1 = 0, g2 = 0, gb = 0;
      for (const f of FRUIT) {
        const err = sig(a * f.c + c * f.s + d) - f.y;
        g1 += err * f.c; g2 += err * f.s; gb += err;
      }
      a -= (1.5 * g1) / FRUIT.length; c -= (1.5 * g2) / FRUIT.length; d -= (1.5 * gb) / FRUIT.length;
    }
    setW1(+a.toFixed(3)); setW2(+c.toFixed(3)); setB(+d.toFixed(3)); setEpochs((x) => x + n);
  };
  const W = 260;
  return (
    <div className="card stack">
      <div className="row between"><b>A single neuron, trained live</b><TruthLabel kind="executed" detail="Real gradient descent on a logistic neuron, computed in your browser." /></div>
      <div className="grid g2" style={{ alignItems: 'center' }}>
        <svg viewBox={`0 0 ${W} ${W}`} role="img" aria-label={`Decision plot: accuracy ${(acc * 100).toFixed(0)} percent`} style={{ width: '100%', maxWidth: 320, background: 'var(--bg-2)', borderRadius: 12, border: '1px solid var(--border)' }}>
          {Array.from({ length: 20 }, (_, i) => Array.from({ length: 20 }, (_, j) => {
            const c = (i + 0.5) / 20, s = 1 - (j + 0.5) / 20;
            const p = sig(w1 * c + w2 * s + b);
            return <rect key={`${i}-${j}`} x={i * 13} y={j * 13} width={13} height={13} fill={p > 0.5 ? 'var(--accent)' : 'var(--violet)'} opacity={0.08 + Math.abs(p - 0.5) * 0.3} />;
          }))}
          {FRUIT.map((f, i) => <circle key={i} cx={f.c * W} cy={(1 - f.s) * W} r={7} fill={f.y ? 'var(--accent)' : 'var(--violet)'} stroke={(preds[i] > 0.5 ? 1 : 0) === f.y ? 'var(--text)' : 'var(--danger)'} strokeWidth={2} />)}
          <text x={6} y={W - 6} fontSize={10} fill="var(--text-3)">colour →</text>
          <text x={6} y={14} fontSize={10} fill="var(--text-3)">↑ softness</text>
        </svg>
        <div className="stack sm">
          {[['Weight: colour', w1, setW1], ['Weight: softness', w2, setW2], ['Bias', b, setB]].map(([l, v, set]) => (
            <label key={l as string} className="field">{l as string}: <span className="mono">{(v as number).toFixed(2)}</span>
              <input type="range" min={-6} max={6} step={0.05} value={v as number} onChange={(e) => (set as (n: number) => void)(Number(e.target.value))} />
            </label>
          ))}
          <div className="row"><button className="btn" onClick={() => train(1)}>Train 1 step</button><button className="btn primary" onClick={() => train(50)}><Icon name="play" /> Train 50 steps</button></div>
          <div className="row tiny"><span className="chip">loss {loss.toFixed(3)}</span><span className="chip">accuracy {(acc * 100).toFixed(0)}%</span><span className="chip">epochs {epochs}</span></div>
          <div className="tiny faint">Teal = ripe, violet = unripe. Red outline = misclassified. Training nudges weights to reduce loss.</div>
        </div>
      </div>
    </div>
  );
}

// ───────── LLM pipeline (conceptual stepper with authored probabilities)
export function LlmPipelineDemo() {
  const [stage, setStage] = useState(0);
  const prompt = 'The capital of France is';
  const toks = teachTokenize(prompt);
  const stages = ['Input', 'Tokenize', 'Context', 'Next-token probabilities', 'Output'];
  const probs = [[' Paris', 0.92], [' a', 0.02], [' located', 0.01], [' the', 0.01], [' known', 0.01]] as const;
  return (
    <div className="card stack">
      <div className="row between"><b>How an LLM processes text</b><TruthLabel kind="demo" detail="Conceptual visualisation. Probabilities are authored for teaching, not from a live model." /></div>
      <div className="row" role="tablist" aria-label="Pipeline stage">
        {stages.map((s, i) => <button key={s} role="tab" aria-selected={stage === i} className={`btn sm ${stage === i ? 'primary' : ''}`} onClick={() => setStage(i)}>{i + 1}. {s}</button>)}
      </div>
      <div className="card inset" style={{ minHeight: 150 }}>
        {stage === 0 && <p style={{ fontSize: '1.2rem' }}>"{prompt}"</p>}
        {stage === 1 && <div>{toks.map((t, i) => <span key={i} className="token" style={{ background: 'var(--accent-soft)' }}>{t.text.replace(/ /g, '·')}</span>)}<p className="small muted" style={{ marginTop: 10 }}>{toks.length} tokens. Each becomes a number (an id) and then a vector the network can compute with.</p></div>}
        {stage === 2 && <div className="small"><p>The context window now holds: <b>system prompt</b> + <b>your tokens</b>. Attention lets each token weigh every other token — "capital" and "France" strongly shape what comes next.</p><p className="muted">Nothing is looked up. Without tools, the model only has its weights and this context.</p></div>}
        {stage === 3 && <div className="stack sm">{probs.map(([t, p]) => <div key={t} className="row nowrap"><span className="mono" style={{ width: 90 }}>{t.replace(/ /g, '·')}</span><div className="bar" style={{ flex: 1 }}><span style={{ width: `${p * 100}%` }} /></div><span className="mono tiny" style={{ width: 40 }}>{(p * 100).toFixed(0)}%</span></div>)}</div>}
        {stage === 4 && <div><p style={{ fontSize: '1.2rem' }}>"{prompt}<b style={{ color: 'var(--accent)' }}> Paris</b>"</p><p className="small muted">Append the chosen token and repeat until a stop condition. For an obscure fact, the most probable continuation might be wrong — fluency is not verification.</p></div>}
      </div>
      <div className="row"><button className="btn" disabled={stage === 0} onClick={() => setStage(stage - 1)}>Back</button><button className="btn primary" disabled={stage === 4} onClick={() => setStage(stage + 1)}>Next stage</button></div>
    </div>
  );
}

// ───────── Context window explorer
const BLOCKS = [
  { id: 'sys', label: 'System prompt & rules', tokens: 1500, fact: 'rules', fixed: true },
  { id: 'q', label: 'User question: "Can I get a refund?"', tokens: 300, fact: 'question', fixed: true },
  { id: 'pol', label: 'Refund policy (relevant)', tokens: 2500, fact: 'policy' },
  { id: 'ord', label: 'This customer\'s order record', tokens: 900, fact: 'order' },
  { id: 'hist', label: 'Full 40-turn chat history', tokens: 14000 },
  { id: 'sum', label: 'Summary of the chat so far', tokens: 1200, fact: 'history' },
  { id: 'faq', label: 'Entire FAQ (mostly irrelevant)', tokens: 20000 },
  { id: 'ship', label: 'Shipping policy', tokens: 2200 },
];
export function ContextWindowDemo() {
  const [budget, setBudget] = useState(16000);
  const [reserve, setReserve] = useState(2000);
  const [on, setOn] = useState<Record<string, boolean>>({ sys: true, q: true, pol: true, hist: true });
  const used = BLOCKS.filter((b) => on[b.id]).reduce((s, b) => s + b.tokens, 0);
  const fits = used + reserve <= budget;
  const facts = new Set(BLOCKS.filter((b) => on[b.id] && b.fact).map((b) => b.fact));
  if (on.hist) facts.add('history');
  const answerable = ['question', 'policy', 'order'].every((f) => facts.has(f));
  return (
    <div className="card stack">
      <div className="row between"><b>Context window budget</b><TruthLabel kind="simulated" detail="Token sizes are illustrative." /></div>
      <div className="grid g2">
        <label className="field">Context window: {budget.toLocaleString()} tokens<input type="range" min={4000} max={64000} step={1000} value={budget} onChange={(e) => setBudget(+e.target.value)} /></label>
        <label className="field">Reserved for the answer: {reserve.toLocaleString()}<input type="range" min={0} max={8000} step={500} value={reserve} onChange={(e) => setReserve(+e.target.value)} /></label>
      </div>
      <div className="bar" style={{ height: 14 }} role="meter" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={used + reserve} aria-label="Context usage">
        <span style={{ width: `${Math.min(100, (used / budget) * 100)}%`, background: fits ? 'var(--accent)' : 'var(--danger)' }} />
      </div>
      <div className="row between small"><span>{used.toLocaleString()} input + {reserve.toLocaleString()} reserved = {(used + reserve).toLocaleString()} / {budget.toLocaleString()}</span><b style={{ color: fits ? 'var(--success)' : 'var(--danger)' }}>{fits ? 'Fits' : 'Over budget — request would fail or be truncated'}</b></div>
      <div className="grid g2">
        {BLOCKS.map((b) => (
          <label key={b.id} className="opt" style={{ cursor: b.fixed ? 'default' : 'pointer' }}>
            <input type="checkbox" checked={!!on[b.id]} disabled={b.fixed} onChange={(e) => setOn({ ...on, [b.id]: e.target.checked })} />
            <span style={{ flex: 1 }}>{b.label}</span><span className="mono tiny">{b.tokens.toLocaleString()}</span>
          </label>
        ))}
      </div>
      <div className={`callout ${fits && answerable ? '' : 'warn'}`}>
        {!fits ? 'Too much context. Drop irrelevant material or replace the long history with its summary.' : answerable ? '✓ Fits, and the model has the policy, the order and the question — it can answer reliably.' : 'Fits — but the model is missing information it needs (policy and/or order record). It may guess.'}
      </div>
    </div>
  );
}
