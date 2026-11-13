// A real, small retrieval engine: chunking, BM25, a toy hashed-trigram "embedding" and hybrid ranking.
// The embedding is NOT a neural embedding — it is a transparent stand-in that captures sub-word overlap, labelled as such in the UI.
import { stem } from './tools';

export interface Doc {
  id: string;
  title: string;
  text: string;
}
export interface Chunk {
  id: string;
  docId: string;
  title: string;
  text: string;
  index: number;
}

export const HANDBOOK: Doc[] = [
  { id: 'leave', title: 'Leave policy', text: 'Employees receive 25 days of annual leave per year. Up to 5 unused days can be carried over to the next year. Leave requests must be submitted at least 10 days in advance through the HR portal. Parental leave is 16 weeks at full pay for all parents.' },
  { id: 'remote', title: 'Remote work', text: 'Staff may work remotely up to three days per week with manager approval. Fully remote arrangements require director sign-off. A home-office stipend of 400 euros is paid once per year. Remote workers must be reachable during core hours from 10:00 to 15:00.' },
  { id: 'expenses', title: 'Expenses', text: 'Travel expenses must be submitted within 30 days with receipts attached. Flights over 6 hours may be booked in premium economy. Meals are reimbursed up to 60 euros per day. Expense code E-4012 is used for client entertainment.' },
  { id: 'security', title: 'Security', text: 'Laptops must use full-disk encryption. Passwords must be at least 14 characters and stored in the approved password manager. Never paste customer data or credentials into unapproved AI tools. Report suspected phishing to security within one hour.' },
  { id: 'onboarding', title: 'Onboarding', text: 'New hires receive their laptop on day one. During the first week they complete security training and meet their onboarding buddy. The probation period lasts six months and ends with a review meeting.' },
];

export function chunkDocs(docs: Doc[], sentencesPerChunk: number, overlap: number): Chunk[] {
  const out: Chunk[] = [];
  for (const d of docs) {
    const sents = d.text.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [d.text];
    const step = Math.max(1, sentencesPerChunk - overlap);
    for (let i = 0, k = 0; i < sents.length; i += step, k++) {
      out.push({ id: `${d.id}#${k}`, docId: d.id, title: d.title, text: sents.slice(i, i + sentencesPerChunk).join(' '), index: k });
      if (i + sentencesPerChunk >= sents.length) break;
    }
  }
  return out;
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'are', 'be', 'for', 'at', 'on', 'with', 'by', 'per', 'must', 'may', 'can', 'how', 'what', 'many', 'do', 'i', 'we', 'my', 'our', 'their', 'they', 'it', 'up', 'from', 'once']);
export const tokenize = (s: string) => s.toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w && !STOP.has(w)).map(stem);

export function bm25Scores(chunks: Chunk[], query: string, k1 = 1.4, b = 0.75): number[] {
  const docs = chunks.map((c) => tokenize(`${c.title} ${c.text}`));
  const avg = docs.reduce((s, d) => s + d.length, 0) / Math.max(1, docs.length);
  const q = [...new Set(tokenize(query))];
  const df = new Map<string, number>();
  for (const t of q) df.set(t, docs.filter((d) => d.includes(t)).length);
  const N = docs.length;
  return docs.map((d) => {
    let s = 0;
    for (const t of q) {
      const f = d.filter((x) => x === t).length;
      if (!f) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avg)));
    }
    return s;
  });
}

const DIM = 256;
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % DIM;
}
/** Toy embedding: L2-normalised bag of hashed character trigrams of stemmed words. */
export function toyEmbed(text: string): Float32Array {
  const v = new Float32Array(DIM);
  for (const w of tokenize(text)) {
    const p = `^${w}$`;
    for (let i = 0; i < p.length - 2; i++) v[hash(p.slice(i, i + 3))] += 1;
  }
  let n = 0;
  for (let i = 0; i < DIM; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= n;
  return v;
}
export function cosine(a: Float32Array, b: Float32Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export type Method = 'bm25' | 'vector' | 'hybrid';
export interface Hit {
  chunk: Chunk;
  score: number;
  bm25: number;
  vector: number;
  rank: number;
}

export function retrieve(chunks: Chunk[], query: string, method: Method, k: number): Hit[] {
  const bm = bm25Scores(chunks, query);
  const qv = toyEmbed(query);
  const vec = chunks.map((c) => cosine(qv, toyEmbed(`${c.title} ${c.text}`)));
  const maxBm = Math.max(1e-9, ...bm);
  const maxV = Math.max(1e-9, ...vec);
  const scored = chunks.map((c, i) => {
    const nb = bm[i] / maxBm;
    const nv = vec[i] / maxV;
    const score = method === 'bm25' ? bm[i] : method === 'vector' ? vec[i] : 0.5 * nb + 0.5 * nv;
    return { chunk: c, score, bm25: bm[i], vector: vec[i] };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

/** Labelled questions for retrieval evaluation: the doc that contains the answer. */
export const RETRIEVAL_EVAL = [
  { q: 'How many vacation days do I get?', doc: 'leave' },
  { q: 'Can I carry over unused leave?', doc: 'leave' },
  { q: 'How many days a week can I work from home?', doc: 'remote' },
  { q: 'Is there money for my home office?', doc: 'remote' },
  { q: 'What is code E-4012?', doc: 'expenses' },
  { q: 'Deadline for submitting travel receipts?', doc: 'expenses' },
  { q: 'How long must my password be?', doc: 'security' },
  { q: 'Can I paste client data into a chatbot?', doc: 'security' },
  { q: 'When do new employees get a computer?', doc: 'onboarding' },
  { q: 'How long is probation?', doc: 'onboarding' },
];

export function recallAtK(chunks: Chunk[], method: Method, k: number) {
  const rows = RETRIEVAL_EVAL.map((e) => {
    const hits = retrieve(chunks, e.q, method, k);
    const pos = hits.findIndex((h) => h.chunk.docId === e.doc);
    return { ...e, hit: pos >= 0, rank: pos >= 0 ? pos + 1 : null, top: hits[0]?.chunk.id ?? '—' };
  });
  const recall = rows.filter((r) => r.hit).length / rows.length;
  const mrr = rows.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / rows.length;
  return { recall, mrr, rows };
}
