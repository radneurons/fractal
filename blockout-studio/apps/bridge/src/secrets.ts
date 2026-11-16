/** Secrets live ONLY here: OS keychain via keytar when available, otherwise an AES-256-GCM encrypted file.
 *  They are never sent to the browser, never written to project files, and listing returns names only. */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';

const SERVICE = 'blockout-studio';
type Keytar = { getPassword(s: string, a: string): Promise<string | null>; setPassword(s: string, a: string, p: string): Promise<void>; deletePassword(s: string, a: string): Promise<boolean>; findCredentials(s: string): Promise<{ account: string }[]> };
export class SecretStore {
  private keytar: Keytar | null = null; private ready: Promise<void>; readonly file: string; backend: 'keychain' | 'encrypted-file' = 'encrypted-file';
  constructor(private dir: string, forceFile = false) {
    this.file = join(dir, 'secrets.enc');
    this.ready = forceFile ? Promise.resolve() : import('keytar').then(async (m) => { const k = ((m as { default?: Keytar }).default ?? m) as Keytar; await k.findCredentials(SERVICE); this.keytar = k; this.backend = 'keychain'; }).catch(() => { /* no keychain (headless Linux, CI): use the encrypted file */ });
  }
  /** Key derivation: scrypt over a passphrase (BLOCKOUT_SECRET_PASSPHRASE) or, failing that, a per-install random key file readable only by the user. */
  private key(salt: Buffer): Buffer {
    let pass = process.env.BLOCKOUT_SECRET_PASSPHRASE;
    if (!pass) { const kf = join(this.dir, '.keyfile'); if (!existsSync(kf)) { mkdirSync(this.dir, { recursive: true }); writeFileSync(kf, randomBytes(32).toString('hex'), { mode: 0o600 }); } try { chmodSync(kf, 0o600); } catch { /* windows */ } pass = readFileSync(kf, 'utf8') + userInfo().username + hostname(); }
    return scryptSync(pass, salt, 32);
  }
  private readFile(): Record<string, string> {
    if (!existsSync(this.file)) return {};
    const buf = readFileSync(this.file), salt = buf.subarray(0, 16), iv = buf.subarray(16, 28), tag = buf.subarray(28, 44), d = createDecipheriv('aes-256-gcm', this.key(salt), iv); d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(buf.subarray(44)), d.final()]).toString('utf8'));
  }
  private writeFile(v: Record<string, string>) {
    mkdirSync(this.dir, { recursive: true }); const salt = randomBytes(16), iv = randomBytes(12), c = createCipheriv('aes-256-gcm', this.key(salt), iv), enc = Buffer.concat([c.update(JSON.stringify(v), 'utf8'), c.final()]);
    writeFileSync(this.file, Buffer.concat([salt, iv, c.getAuthTag(), enc]), { mode: 0o600 });
  }
  async get(name: string): Promise<string | undefined> { await this.ready; if (this.keytar) return (await this.keytar.getPassword(SERVICE, name)) ?? undefined; return this.readFile()[name]; }
  async set(name: string, value: string): Promise<void> { await this.ready; if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name)) throw new Error('invalid secret name'); if (this.keytar) return this.keytar.setPassword(SERVICE, name, value); const v = this.readFile(); v[name] = value; this.writeFile(v); }
  async delete(name: string): Promise<void> { await this.ready; if (this.keytar) { await this.keytar.deletePassword(SERVICE, name); return; } const v = this.readFile(); delete v[name]; this.writeFile(v); }
  async names(): Promise<string[]> { await this.ready; if (this.keytar) return (await this.keytar.findCredentials(SERVICE)).map((c) => c.account).sort(); return Object.keys(this.readFile()).sort(); }
}
