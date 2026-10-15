#!/usr/bin/env python3
"""Initialize a new vault's credentials; never change an existing vault's password here."""
import getpass, hashlib, os, secrets
from pathlib import Path
root = Path(__file__).resolve().parent.parent
if (root / '.env').exists() or (root / 'data/db/notes.db').exists():
    raise SystemExit('Existing configuration/data found. Refusing to change vault credentials.')
password = getpass.getpass('Sync password (empty = generate): ') if os.isatty(0) else ''
if password and len(password) < 16:
    raise SystemExit('Use at least 16 characters.')
password = password or secrets.token_urlsafe(32)
salt = secrets.token_bytes(16)
hash_value = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=64).hex()
config = f'FUTO_NOTES_PORT=3005\nREMEMBER_BROWSER_MINUTES=10080\nFUTO_NOTES_PASSWORD_HASH=scrypt:N=16384,r=8,p=1:{salt.hex()}:{hash_value}\n'
fd = os.open(root / '.env', os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
with os.fdopen(fd, 'w') as stream: stream.write(config)
fd = os.open(root / '.sync-password', os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
with os.fdopen(fd, 'w') as stream: stream.write(password + '\n')
print('Credentials initialized. Read .sync-password locally, save it in your password manager, then delete that file.')
