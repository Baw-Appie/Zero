import { env } from '../env';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const fromBase64 = (value: string) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

const getKey = (() => {
  let keyPromise: Promise<CryptoKey> | null = null;
  return () => {
    if (keyPromise) return keyPromise;
    keyPromise = (async () => {
      const digest = await crypto.subtle.digest('SHA-256', encoder.encode(env.BETTER_AUTH_SECRET));
      return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    })();
    return keyPromise;
  };
})();

export const encryptCredential = async (value: string) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getKey();
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(value));
  return `${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
};

export const decryptCredential = async (value: string) => {
  const [ivPart, payloadPart] = value.split('.');
  if (!ivPart || !payloadPart) throw new Error('Credential is not in encrypted format');

  const iv = fromBase64(ivPart);
  const payload = fromBase64(payloadPart);
  const key = await getKey();
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, payload);
  return decoder.decode(decrypted);
};
