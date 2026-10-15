import 'fake-indexeddb/auto';
import { execFileSync } from 'node:child_process';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { Api } from '../src/lib/api';
import { Vault } from '../src/lib/vault';
import { forgetCache } from '../src/lib/storage';
import { decrypt, unpack, fromBase64 } from '../src/lib/crypto';
const base = process.env.TEST_SYNC_URL;
const password = 'integration-test-only-not-a-real-secret';
const vaults: Vault[] = [];
async function device(api = new Api(base)) {
  const vault = new Vault(api);
  await vault.unlock(password);
  vaults.push(vault);
  return vault;
}
describe.skipIf(!base)('real FUTO server interoperability', () => {
  beforeEach(async () => {
    if (process.env.TEST_CONTAINER_NAME) {
      execFileSync('docker', ['restart', process.env.TEST_CONTAINER_NAME], {
        stdio: 'ignore',
      });
      for (let i = 0; i < 100; i++) {
        try {
          const r = await fetch(base + '/health');
          if (r.ok) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    await forgetCache();
    const api = new Api(base);
    await api.login(password);
    const { collections } = await api.request('/api/collections');
    for (const c of collections)
      await api.request(`/api/collections/${c.id}`, { method: 'DELETE' });
  });
  afterEach(async () => {
    for (const v of vaults.splice(0)) await v.lock();
    await forgetCache();
  });
  it('uses the configured lifetime in its secure login cookie', async () => {
    const result = await fetch(base + '/api/auth/password/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    expect(result.status).toBe(200);
    const cookie = result.headers.get('set-cookie')!;
    expect(cookie).toContain('Max-Age=120');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
  });
  it('creates, edits, renames and deletes notes across devices', async () => {
    const a = await device(),
      b = await device();
    const n = await a.create('Inbox/Idea.md', '# Idea\n- [ ] remember');
    await a.sync();
    await b.sync();
    expect(b.notes[0].content).toBe(n.content);
    await b.edit(b.notes[0].id, '# Idea\n- [x] remember');
    await b.sync();
    await a.sync();
    expect(a.notes[0].content).toContain('[x]');
    await a.rename(n.id, 'Work/Renamed.md');
    await a.sync();
    await b.sync();
    expect(b.notes[0].path).toBe('Work/Renamed.md');
    await b.remove(b.notes[0].id);
    await b.sync();
    expect(b.error).toBe('');
    await a.sync();
    expect(a.error).toBe('');
    expect(a.notes).toHaveLength(0);
  });
  it('keeps both versions of simultaneous edits and blocks a stale delete', async () => {
    const a = await device();
    const n = await a.create('Shared.md', 'base');
    await a.sync();
    const b = await device();
    await a.edit(n.id, 'phone version');
    await b.edit(b.notes[0].id, 'browser version');
    await a.sync();
    await b.sync();
    await a.sync();
    expect(a.notes.map((n) => n.content).sort()).toEqual([
      'browser version',
      'phone version',
    ]);
    expect(a.notes.some((n) => n.path.includes('conflict'))).toBe(true);
    const originalB = b.notes.find((n) => n.path === 'Shared.md')!;
    await b.remove(originalB.id);
    await a.edit(n.id, 'newer phone edit');
    await a.sync();
    expect(a.error).toBe('');
    await b.sync();
    expect(b.error).toBe('');
    expect(
      b.notes.some((n) => n.content === 'newer phone edit' && !n.deleted),
    ).toBe(true);
  });
  it('recovers a lost create response after reload without duplicating a note', async () => {
    const api = new Api(base),
      a = await device(api);
    let lose = true;
    const request = api.request.bind(api);
    api.request = async (path, init, binary) => {
      const response = await request(path, init, binary);
      if (lose && path.endsWith('/blob-objects')) {
        lose = false;
        throw new TypeError('response lost');
      }
      return response;
    };
    const n = await a.create('Retry.md', 'first');
    await a.sync();
    expect(a.notes[0].intent).toBeDefined();
    await a.edit(n.id, 'second');
    await a.lock();
    const b = await device();
    await b.sync();
    const result = await b.api.request(
      `/api/collections/${b.collectionId}/objects?sinceVersion=0`,
    );
    expect(result.objects.filter((n: any) => !n.deleted)).toHaveLength(1);
    expect(b.notes[0].content).toBe('second');
  });
  it('preserves same-name independent notes and encrypted offline edits', async () => {
    const a = await device(),
      b = await device();
    await a.create('Same.md', 'device A');
    await b.create('Same.md', 'device B');
    await a.sync();
    await b.sync();
    await a.sync();
    expect(a.notes.map((n) => n.content).sort()).toEqual([
      'device A',
      'device B',
    ]);
    const n = a.notes.find((n) => n.content === 'device A')!;
    await a.edit(n.id, 'private offline phrase');
    await a.lock();
    const offline = new Api(base);
    offline.login = async () => {
      throw new TypeError('offline');
    };
    offline.request = async () => {
      throw new TypeError('offline');
    };
    const c = await device(offline);
    expect(c.notes.some((n) => n.content === 'private offline phrase')).toBe(
      true,
    );
    await c.lock();
    const d = await device();
    expect(d.notes.some((n) => n.content === 'private offline phrase')).toBe(
      true,
    );
  });
  it('stores image payloads in the mobile-compatible base64 note frame', async () => {
    const a = await device();
    const bytes = Uint8Array.from([137, 80, 78, 71, 0, 255]);
    const filename = await a.image(
      new File([bytes], 'test.png', { type: 'image/png' }),
    );
    await a.sync();
    const note = a.notes.find((n) => n.path === filename)!;
    const response = await a.api.request(
      `/api/collections/${a.collectionId}/objects/${note.remoteId}`,
    );
    const sealed = await a.api.request(
      `/api/blobs/${response.object.blob_key}`,
      {},
      true,
    );
    const image = unpack(await decrypt(a.key!, sealed));
    expect(fromBase64(image.content)).toEqual(bytes);
  });
});
