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
