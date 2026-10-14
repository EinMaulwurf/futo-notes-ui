import { describe, it, expect } from 'vitest';
import { createCipheriv, pbkdf2Sync } from 'node:crypto';
import {
  pack,
  unpack,
  importKey,
  decrypt,
  encrypt,
  unlockKey,
  newKeyMaterial,
  hex,
  validPath,
} from '../src/lib/crypto';
describe('FUTO wire compatibility', () => {
  it('reads independent AES-GCM and PBKDF2 fixtures with FUTO byte framing', async () => {
    const salt = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
    const password = 'fixture-only-password',
      raw = Buffer.alloc(32, 7),
      iv = Buffer.alloc(12, 3);
    const seal = (key: Buffer, value: Buffer) => {
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      return Buffer.concat([
        iv,
        cipher.update(value),
        cipher.final(),
        cipher.getAuthTag(),
      ]);
    };
    const wrapped = seal(pbkdf2Sync(password, salt, 100000, 32, 'sha256'), raw);
    const key = await unlockKey(password, {
      key_salt: salt.toString('hex'),
      key_kdf: { kdf: 'pbkdf2-sha256', iterations: 100000, hash: 'SHA-256' },
      encrypted_vault_key: wrapped.toString('hex'),
    });
    const path = Buffer.from('Work/カフェ.md'),
      body = Buffer.from('# café\n☕️'),
      size = Buffer.alloc(4);
    size.writeUInt32BE(path.length);
    const fixture = Buffer.concat([Buffer.from([2]), size, path, body]);
    expect(
      unpack(await decrypt(key, new Uint8Array(seal(raw, fixture)))),
    ).toEqual({ path: 'Work/カフェ.md', content: '# café\n☕️' });
    expect(Buffer.from(pack('Work/カフェ.md', '# café\n☕️'))).toEqual(fixture);
    expect(
      unpack(new Uint8Array(Buffer.concat([size, path, body]))).content,
    ).toBe('# café\n☕️');
  });
  it('rejects tampering, wrong passwords, malformed frames and unsafe paths', async () => {
    const material = await newKeyMaterial('a password for test only');
    await expect(unlockKey('wrong', material)).rejects.toThrow('unlock');
    const key = await importKey(new Uint8Array(32).fill(8));
    const blob = await encrypt(key, pack('empty.md', ''));
    blob[15] ^= 1;
    await expect(decrypt(key, blob)).rejects.toThrow();
    expect(() => unpack(new Uint8Array([2, 0, 0, 0, 10]))).toThrow();
    expect(() => unpack(new Uint8Array([3, 0, 0, 0, 0]))).toThrow();
    for (const path of [
      '../escape.md',
      '/absolute.md',
      'x/../y.md',
      'a\\b.md',
      'a//b.md',
    ])
      expect(() => validPath(path)).toThrow();
    expect(hex(new Uint8Array([1, 255]))).toBe('01ff');
  });
});
