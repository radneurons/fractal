// A transparent teaching tokenizer. Real tokenizers (BPE/unigram) are learned and differ by model —
// this one mimics their behaviour: common words → one token, rare/long words → several sub-word pieces.

const COMMON = new Set(
  ('the of and to a in is it you that he was for on are with as i his they be at one have this from or had by not word but what some we can out other were all there when up use your how said an each she which do their time if will way about many then them write would like so these her long make thing see him two has look more day could go come did number sound no most people my over know water than call first who may down side been now find any new work part take get place made live where after back little only round man year came show every good me give our under name very through just form sentence great think say help low line differ turn cause much mean before move right boy old too same tell does set three want air well also play small end put home read hand port large spell add even land here must big high such follow act why ask men change went light kind off need house picture try us again animal point mother world near build self earth father model agent tool data code test token context')
    .split(' '),
);
const PIECES = ['ing', 'tion', 'ed', 'er', 'est', 'ly', 'ment', 'ness', 'able', 'ize', 'un', 're', 'pre', 'dis', 'ize', 'ful', 'less', 's'];

export interface Token {
  text: string;
  id: number;
}

function idFor(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 100_000;
}

function splitWord(w: string): string[] {
  const lower = w.toLowerCase();
  if (COMMON.has(lower) || w.length <= 3) return [w];
  const out: string[] = [];
  let rest = w;
  // peel known prefixes/suffixes, then chunk the stem into ≤4-char pieces
  const pre = PIECES.find((p) => p.length > 1 && lower.startsWith(p) && lower.length > p.length + 3 && ['un', 're', 'pre', 'dis'].includes(p));
  if (pre) {
    out.push(rest.slice(0, pre.length));
    rest = rest.slice(pre.length);
  }
  const suf = PIECES.find((p) => rest.toLowerCase().endsWith(p) && rest.length > p.length + 2 && !['un', 're', 'pre', 'dis'].includes(p));
  let tail = '';
  if (suf) {
    tail = rest.slice(rest.length - suf.length);
    rest = rest.slice(0, rest.length - suf.length);
  }
  if (COMMON.has(rest.toLowerCase())) out.push(rest);
  else for (let i = 0; i < rest.length; i += 4) out.push(rest.slice(i, i + 4));
  if (tail) out.push(tail);
  return out;
}

export function teachTokenize(text: string): Token[] {
  const parts = text.match(/\s*[A-Za-z]+|\s*\d{1,3}|\s*[^\sA-Za-z\d]|\s+/g) ?? [];
  const out: Token[] = [];
  for (const p of parts) {
    const lead = p.match(/^\s*/)![0];
    const core = p.slice(lead.length);
    if (!core) {
      out.push({ text: p, id: idFor(p) });
      continue;
    }
    if (/^[A-Za-z]+$/.test(core)) {
      const pieces = splitWord(core);
      pieces.forEach((pc, i) => {
        const t = (i === 0 ? lead : '') + pc;
        out.push({ text: t, id: idFor(t) });
      });
    } else out.push({ text: p, id: idFor(p) });
  }
  return out;
}

export const estimateTokens = (text: string) => Math.ceil(text.length / 4);
