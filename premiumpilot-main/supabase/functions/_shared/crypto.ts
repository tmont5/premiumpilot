// AES-256-GCM token encryption (PRD §4 / §15).
// Key comes from the Edge Function secret TOKEN_ENCRYPTION_KEY (32 bytes, base64).
// Output format (base64): [12-byte IV][ciphertext+tag].

function getKeyBytes(): Uint8Array {
  const b64 = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  if (!b64) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (bytes.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes (base64)");
  return bytes;
}

async function importKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", getKeyBytes(), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptToken(plaintext: string): Promise<string> {
  const key = await importKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder().encode(plaintext);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return btoa(String.fromCharCode(...out));
}

export async function decryptToken(payload: string): Promise<string> {
  const key = await importKey();
  const raw = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
  const iv = raw.slice(0, 12);
  const ct = raw.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}
