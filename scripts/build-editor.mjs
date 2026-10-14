// Browser integration of FUTO's unmodified editing behavior, pinned in Dockerfile.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = process.argv[2];
const mode = process.argv[3];
if (mode === 'patch') {
  const file = `${root}/src/features/images/vaultImageSrc.ts`;
  const original = readFileSync(file, 'utf8');
  const needle =
    'export function resolveVaultImageSrc(source: string): string {';
  if (!original.includes(needle))
    throw new Error('FUTO image bridge changed; review integration.');
  writeFileSync(
    file,
    original.replace(
      needle,
      `${needle}\n  const webImage = (window as unknown as { __futoWebImages?: Record<string,string> }).__futoWebImages?.[source];\n  if (webImage) return webImage;`,
    ),
  );
} else {
  const out = process.argv[4];
  mkdirSync(`${out}/web`, { recursive: true });
  let html = readFileSync(`${root}/build/native-editor/editor.html`, 'utf8');
  html = html.replace(
    '<head>',
    '<head><script src="/web/editor-host.js"></script>',
  );
  writeFileSync(`${out}/web/editor.html`, html);
  copyFileSync(`${root}/LICENSE.md`, `${out}/web/FUTO-LICENSE.md`);
  const hashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
    .filter((x) => x[1])
    .map(
      (x) => `'sha256-${createHash('sha256').update(x[1]).digest('base64')}'`,
    )
    .join(' ');
  mkdirSync(`${out}/nginx`, { recursive: true });
  writeFileSync(
    `${out}/nginx/editor-csp.conf`,
    `add_header Content-Security-Policy "default-src 'none'; script-src 'self' ${hashes}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'" always;\n`,
  );
}
