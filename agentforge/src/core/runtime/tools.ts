// Deterministic tool implementations used by Agent Studio, games and lesson demos.
// These really execute (calculator parses and evaluates; search runs lexical retrieval) against local, safe data.
import { z } from 'zod';

// ───────── Calculator: a safe shunting-yard parser (no eval).
export function calculate(expr: string): number {
  const tokens = expr.replace(/\s+/g, '').match(/\d+(?:\.\d+)?|[-+*/%^()]/g);
  if (!tokens || tokens.join('') !== expr.replace(/\s+/g, '')) throw new Error(`Invalid expression: ${expr}`);
  const prec: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 };
  const out: (number | string)[] = [];
  const ops: string[] = [];
  let prev: string | null = null;
  for (const t of tokens) {
    if (/^\d/.test(t)) out.push(parseFloat(t));
    else if (t === '(') ops.push(t);
    else if (t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop()!);
      if (!ops.length) throw new Error('Mismatched parentheses');
      ops.pop();
    } else {
      if (t === '-' && (prev === null || (prev in prec) || prev === '(')) {
        out.push(0); // unary minus → 0 - x
      }
      while (ops.length && ops[ops.length - 1] !== '(' && (prec[ops[ops.length - 1]] > prec[t] || (prec[ops[ops.length - 1]] === prec[t] && t !== '^'))) out.push(ops.pop()!);
      ops.push(t);
    }
    prev = t;
  }
  while (ops.length) {
    const o = ops.pop()!;
    if (o === '(') throw new Error('Mismatched parentheses');
    out.push(o);
  }
  const st: number[] = [];
  for (const t of out) {
    if (typeof t === 'number') st.push(t);
    else {
      const b = st.pop();
      const a = st.pop();
      if (a === undefined || b === undefined) throw new Error('Malformed expression');
      st.push(t === '+' ? a + b : t === '-' ? a - b : t === '*' ? a * b : t === '/' ? a / b : t === '%' ? a % b : Math.pow(a, b));
    }
  }
  if (st.length !== 1 || !Number.isFinite(st[0])) throw new Error('Malformed expression');
  return Math.round(st[0] * 1e6) / 1e6;
}

// ───────── Local knowledge base for search tools.
export const KB = [
  { id: 'kb-refund', title: 'Refund policy', text: 'Annual plans can be refunded in full within 30 days of purchase. Monthly plans are not refundable but can be cancelled at any time. Refunds are processed within 5 business days.' },
  { id: 'kb-shipping', title: 'Shipping times', text: 'Standard shipping takes 3 to 5 business days. Express shipping takes 1 to 2 business days. Orders placed after 2pm ship the next business day.' },
  { id: 'kb-pricing', title: 'Pricing', text: 'The Starter plan costs 12 dollars per month. The Team plan costs 30 dollars per user per month. Enterprise pricing is available on request from sales.' },
  { id: 'kb-security', title: 'Security', text: 'All data is encrypted at rest and in transit. Single sign-on is available on the Team and Enterprise plans. We never sell customer data.' },
  { id: 'kb-support', title: 'Support hours', text: 'Support is available Monday to Friday, 8am to 6pm UTC. Enterprise customers have 24/7 support with a one hour response target.' },
];

/** Tiny suffix-stripping stemmer so "refunds"/"refunded" match "refund". */
export const stem = (w: string) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w);
const terms = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem);
const STOP = new Set(['the', 'and', 'can', 'get', 'what', 'how', 'does', 'our', 'your', 'are', 'for', 'you', 'with', 'this', 'that', 'from', 'about']);

export function searchKB(query: string, k = 2) {
  const words = [...new Set(terms(query).filter((w) => w.length > 2 && !STOP.has(w)))];
  return KB.map((d) => {
    const t = new Set(terms(`${d.title} ${d.text}`));
    return { ...d, score: words.filter((w) => t.has(w)).length };
  })
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ id, title, text }) => ({ id, title, snippet: text }));
}

const ORDERS: Record<string, { id: string; status: string; age_days: number; plan: string; total: number }> = {
  '991': { id: '991', status: 'delivered', age_days: 40, plan: 'annual', total: 360 },
  '1204': { id: '1204', status: 'shipped', age_days: 2, plan: 'monthly', total: 12 },
  '1310': { id: '1310', status: 'processing', age_days: 0, plan: 'annual', total: 360 },
};
const REVENUE: Record<string, number> = { Q1: 1_900_000, Q2: 2_100_000, Q3: 2_400_000, Q4: 2_750_000 };
const WEATHER: Record<string, { temp_c: number; rain_mm: number; conditions: string }> = {
  oslo: { temp_c: 4, rain_mm: 6, conditions: 'rain' },
  lisbon: { temp_c: 19, rain_mm: 0, conditions: 'sunny' },
  tokyo: { temp_c: 13, rain_mm: 1, conditions: 'cloudy' },
};
export const VFILES: Record<string, string> = {
  'README.md': '# Acme App\nRun `npm test` to execute tests.',
  'src/tax.js': 'export const rate = 0.2;\nexport function tax(x) { return x * rate; }',
  'docs/onboarding.md': 'New engineers: read README.md, then run the test suite.',
};

export interface ToolSpec {
  id: string;
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  schemaText: string;
  impact: 'read' | 'write' | 'external';
  triggers: string[];
  run: (args: any, opts: { failMode?: 'never' | 'always' | 'first'; attempt: number }) => unknown;
}

export const TOOLS: Record<string, ToolSpec> = {
  calculator: {
    id: 'calculator', name: 'calculator', impact: 'read',
    description: 'Evaluate an arithmetic expression exactly. Use for any arithmetic.',
    schema: z.object({ expression: z.string().min(1) }).strict(),
    schemaText: '{ expression: string }',
    triggers: ['%', 'percent', 'calculate', 'sum', 'total', '*', 'times', 'plus', 'minus', 'divide'],
    run: (a) => ({ value: calculate(a.expression) }),
  },
  get_revenue: {
    id: 'get_revenue', name: 'get_revenue', impact: 'read',
    description: 'Return company revenue in dollars for a quarter (Q1–Q4).',
    schema: z.object({ quarter: z.enum(['Q1', 'Q2', 'Q3', 'Q4']) }).strict(),
    schemaText: '{ quarter: "Q1" | "Q2" | "Q3" | "Q4" }',
    triggers: ['revenue', 'sales'],
    run: (a) => ({ quarter: a.quarter, revenue: REVENUE[a.quarter] }),
  },
  search_docs: {
    id: 'search_docs', name: 'search_docs', impact: 'read',
    description: 'Search the product documentation (refunds, shipping, pricing, security, support). Not for specific orders.',
    schema: z.object({ query: z.string().min(2) }).strict(),
    schemaText: '{ query: string }',
    triggers: ['policy', 'refund', 'shipping', 'price', 'pricing', 'plan', 'security', 'support', 'hours', 'how long', 'docs'],
    run: (a) => {
      const results = searchKB(a.query);
      return results.length ? { results } : { results: [], note: `no matches for "${a.query}"` };
    },
  },
  get_order: {
    id: 'get_order', name: 'get_order', impact: 'read',
    description: 'Look up one order by its numeric id. Requires the order id — never guess it.',
    schema: z.object({ order_id: z.string().regex(/^\d+$/) }).strict(),
    schemaText: '{ order_id: string (digits) }',
    triggers: ['order', 'my purchase', 'delivery status'],
    run: (a) => {
      const o = ORDERS[a.order_id];
      if (!o) throw new Error(`order ${a.order_id} not found`);
      return o;
    },
  },
  get_weather: {
    id: 'get_weather', name: 'get_weather', impact: 'read',
    description: 'Current weather for a city (mock provider).',
    schema: z.object({ city: z.string().min(2) }).strict(),
    schemaText: '{ city: string }',
    triggers: ['weather', 'umbrella', 'rain', 'temperature', 'forecast'],
    run: (a, o) => {
      if (o.failMode === 'always' || (o.failMode === 'first' && o.attempt === 1)) throw new Error('weather service timeout');
      const w = WEATHER[String(a.city).toLowerCase()];
      if (!w) throw new Error(`unknown city ${a.city}`);
      return { city: a.city, ...w };
    },
  },
  file_lookup: {
    id: 'file_lookup', name: 'file_lookup', impact: 'read',
    description: 'Read a file from the sandboxed project folder.',
    schema: z.object({ path: z.string().min(1) }).strict(),
    schemaText: '{ path: string }',
    triggers: ['file', 'readme', 'read ', 'source'],
    run: (a) => {
      const p = String(a.path).replace(/^\.?\//, '');
      if (p.includes('..') || p.startsWith('/')) throw new Error('path outside sandbox denied');
      if (!(p in VFILES)) throw new Error(`no such file: ${p}`);
      return { path: p, content: VFILES[p] };
    },
  },
  send_email: {
    id: 'send_email', name: 'send_email', impact: 'external',
    description: 'Send an email (simulated outbox). High impact: requires human approval upstream.',
    schema: z.object({ to: z.string().email(), subject: z.string().min(1), body: z.string().min(1) }).strict(),
    schemaText: '{ to: email, subject: string, body: string }',
    triggers: ['email', 'send', 'notify'],
    run: (a) => ({ sent: true, to: a.to, subject: a.subject, outbox_id: `out-${a.to.length}${a.subject.length}` }),
  },
};

/** Argument extraction used by the offline (rule-based) agent policy. Returns null when a required value is missing. */
export function extractArgs(toolId: string, goal: string, obs: Record<string, any>): Record<string, unknown> | null {
  const g = goal.toLowerCase();
  switch (toolId) {
    case 'get_revenue': {
      const q = goal.match(/\bQ([1-4])\b/i);
      return q ? { quarter: `Q${q[1]}` } : null;
    }
    case 'calculator': {
      const pct = goal.match(/(\d+(?:\.\d+)?)\s*%/);
      if (pct && obs.get_revenue?.revenue) return { expression: `${obs.get_revenue.revenue}*${Number(pct[1]) / 100}` };
      const expr = goal.match(/[\d.]+(?:\s*[-+*/^]\s*[\d.]+)+/);
      return expr ? { expression: expr[0] } : null;
    }
    case 'search_docs': {
      const kw = TOOLS.search_docs.triggers.find((t) => g.includes(t));
      return kw ? { query: goal.replace(/[?!.]/g, '').slice(0, 80) } : null;
    }
    case 'get_order': {
      const m = goal.match(/order\s*(?:#|id|number)?\s*(\d+)/i);
      return m ? { order_id: m[1] } : null;
    }
    case 'get_weather': {
      const m = goal.match(/\b(?:in|for)\s+([A-Z][a-z]+)/);
      return m ? { city: m[1] } : null;
    }
    case 'file_lookup': {
      const m = goal.match(/([\w./-]+\.(?:md|js|ts|json))/);
      return m ? { path: m[1] } : null;
    }
    case 'send_email': {
      const m = goal.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
      return m ? { to: m[0], subject: 'Update from your assistant', body: goal.slice(0, 140) } : null;
    }
  }
  return null;
}

export function summarizeObservation(toolId: string, r: any): string {
  switch (toolId) {
    case 'get_revenue': return `${r.quarter} revenue is $${Number(r.revenue).toLocaleString('en-US')}`;
    case 'calculator': return `the result is ${Number(r.value).toLocaleString('en-US')}`;
    case 'search_docs': return r.results?.length ? `docs say: “${r.results[0].snippet}” [${r.results[0].id}]` : 'the docs had no matching answer';
    case 'get_order': return `order ${r.id} is ${r.status} (${r.age_days} days old, ${r.plan} plan)`;
    case 'get_weather': return `${r.city}: ${r.conditions}, ${r.temp_c}°C, ${r.rain_mm}mm rain`;
    case 'file_lookup': return `${r.path} contains: ${String(r.content).split('\n')[0]}`;
    case 'send_email': return `email sent to ${r.to}`;
  }
  return JSON.stringify(r);
}
