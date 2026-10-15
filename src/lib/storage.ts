import { openDB } from 'idb';
import { openJSON, sealJSON, type KeyMaterial } from './crypto';
const db = () =>
  openDB('futo-notes-web', 1, {
    upgrade(db) {
      db.createObjectStore('vault');
    },
  });
export interface Metadata {
  collectionId: string;
  material: KeyMaterial;
}
export async function metadata(): Promise<Metadata | undefined> {
  return (await db()).get('vault', 'metadata');
}
export async function saveMetadata(meta: Metadata): Promise<void> {
  await (await db()).put('vault', meta, 'metadata');
}
export async function loadCache<T>(
  collectionId: string,
  key: CryptoKey,
): Promise<T | undefined> {
  const value = await (await db()).get('vault', `cache:${collectionId}`);
  return value ? openJSON<T>(key, new Uint8Array(value)) : undefined;
}
export async function saveCache(
  collectionId: string,
  key: CryptoKey,
  value: unknown,
): Promise<void> {
  const encrypted = await sealJSON(key, value);
  await (await db()).put('vault', encrypted, `cache:${collectionId}`);
}
export async function forgetCache(): Promise<void> {
  await (await db()).clear('vault');
}

// The password and bearer token are never written to browser storage.
// CryptoKey is stored with extractable=false; this remains browser-profile storage.
export interface RememberedUnlock {
  schema: 1;
  collectionId: string;
  key: CryptoKey;
  createdAt: number;
  expiresAt: number;
}
export async function saveRememberedUnlock(
  value: RememberedUnlock,
): Promise<void> {
  await (await db()).put('vault', value, 'remembered-unlock');
}
export async function clearRememberedUnlock(): Promise<void> {
  await (await db()).delete('vault', 'remembered-unlock');
}
export async function rememberedUnlock(
  minutes: number,
  now = Date.now(),
): Promise<RememberedUnlock | undefined> {
  const value = (await (await db()).get('vault', 'remembered-unlock')) as
    RememberedUnlock | undefined;
  if (!value) return;
  const deadline = Math.min(value.expiresAt, value.createdAt + minutes * 60000);
  if (
    value.schema !== 1 ||
    !value.collectionId ||
    !Number.isSafeInteger(value.createdAt) ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.createdAt > now + 5000 ||
    !Number.isFinite(deadline) ||
    deadline <= now ||
    value.key?.type !== 'secret' ||
    value.key.extractable !== false ||
    value.key.algorithm.name !== 'AES-GCM'
  ) {
    await clearRememberedUnlock();
    return;
  }
  const remembered = { ...value, expiresAt: deadline };
  if (deadline < value.expiresAt) await saveRememberedUnlock(remembered);
  return remembered;
}
export async function loadRuntimeConfig(): Promise<unknown> {
  return (await db()).get('vault', 'runtime-config');
}
export async function saveRuntimeConfig(value: unknown): Promise<void> {
  await (await db()).put('vault', value, 'runtime-config');
}
