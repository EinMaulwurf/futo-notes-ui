import 'fake-indexeddb/auto';
import { beforeEach, describe, it, expect } from 'vitest';
import { importKey, encrypt, decrypt } from '../src/lib/crypto';
import {
  forgetCache,
  saveRememberedUnlock,
  rememberedUnlock,
  saveMetadata,
  metadata,
  saveCache,
  loadCache,
} from '../src/lib/storage';
import {
  validateConfig,
  formatDuration,
  DEFAULT_REMEMBER_MINUTES,
} from '../src/lib/config';
beforeEach(forgetCache);
describe('remembered browser keys', () => {
  it('persists a usable non-extractable key without exporting it', async () => {
    const key = await importKey(new Uint8Array(32).fill(7)),
      createdAt = Date.now();
    await saveRememberedUnlock({
      schema: 1,
      collectionId: 'vault',
      key,
      createdAt,
      expiresAt: createdAt + 120000,
    });
    const remembered = (await rememberedUnlock(2))!;
    expect(remembered.key.extractable).toBe(false);
    await expect(
      crypto.subtle.exportKey('raw', remembered.key),
    ).rejects.toThrow();
    const bytes = new TextEncoder().encode('private test note');
    expect(await decrypt(remembered.key, await encrypt(key, bytes))).toEqual(
      bytes,
    );
  });
  it('removes expired keys while preserving encrypted notes and metadata', async () => {
    const key = await importKey(new Uint8Array(32).fill(8)),
      createdAt = Date.now() - 180000;
    const material = {
      key_salt: '00',
      key_kdf: { kdf: 'pbkdf2-sha256', iterations: 100000, hash: 'SHA-256' },
      encrypted_vault_key: '00',
    };
    await saveMetadata({ collectionId: 'vault', material });
    await saveCache('vault', key, { content: 'pending offline edit' });
    await saveRememberedUnlock({
      schema: 1,
      collectionId: 'vault',
      key,
      createdAt,
      expiresAt: createdAt + 120000,
    });
    expect(await rememberedUnlock(2)).toBeUndefined();
    expect((await metadata())?.collectionId).toBe('vault');
    expect(await loadCache('vault', key)).toEqual({
      content: 'pending offline edit',
    });
  });
  it('shortens existing deadlines under a stricter policy without extending them', async () => {
    const key = await importKey(new Uint8Array(32).fill(9)),
      createdAt = Date.now();
    await saveRememberedUnlock({
      schema: 1,
      collectionId: 'vault',
      key,
      createdAt,
      expiresAt: createdAt + 10080 * 60000,
    });
    expect((await rememberedUnlock(43200))!.expiresAt).toBe(
      createdAt + 10080 * 60000,
    );
    expect((await rememberedUnlock(2))!.expiresAt).toBe(createdAt + 120000);
    expect((await rememberedUnlock(43200))!.expiresAt).toBe(createdAt + 120000);
    expect(await rememberedUnlock(2, createdAt + 120000)).toBeUndefined();
  });
});
describe('duration configuration', () => {
  it('uses seven days by default and validates whole minutes', () => {
    expect(DEFAULT_REMEMBER_MINUTES).toBe(10080);
    expect(
      validateConfig({ rememberBrowserMinutes: 43200 }).rememberBrowserMinutes,
    ).toBe(43200);
    for (const value of [0, -1, 1.5, '10080', 525601, null])
      expect(() => validateConfig({ rememberBrowserMinutes: value })).toThrow();
    expect(formatDuration(10080)).toBe('7 days');
    expect(formatDuration(1440)).toBe('1 day');
    expect(formatDuration(120)).toBe('2 hours');
    expect(formatDuration(2)).toBe('2 minutes');
  });
});
