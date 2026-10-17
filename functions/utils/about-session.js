/** Signed, short-lived authorization specifically for writing the public About page.
 * Existing legacy admin tokens are not cryptographically authenticated and must
 * never authorize this endpoint. This credential is minted after a real login.
 */
const encoder = new TextEncoder();
function encodeUrl(bytes) {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function decodeUrl(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')), c => c.charCodeAt(0));
}
async function sign(env, message) {
  const secret = env.ABOUT_SESSION_SECRET || env.GITEE_TOKEN;
  if (!secret || secret.length < 12) throw new Error('缺少安全签名密钥');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return {key, signature: new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)))};
}
export async function makeAboutSession(env, user) {
  if (user.role !== 'system') return null;
  const data = { purpose: 'about-write', username: String(user.username), role: 'system', exp: Math.floor(Date.now() / 1000) + 12 * 3600 };
  const payload = encodeUrl(encoder.encode(JSON.stringify(data)));
  const {signature} = await sign(env, payload);
  return `${payload}.${encodeUrl(signature)}`;
}
export async function verifyAboutSession(env, token) {
  if (!token || token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const [payload, signature] = token.split('.');
    const {key} = await sign(env, payload);
    if (!await crypto.subtle.verify('HMAC', key, decodeUrl(signature), encoder.encode(payload))) return null;
    const data = JSON.parse(new TextDecoder().decode(decodeUrl(payload)));
    if (data.purpose !== 'about-write' || data.role !== 'system' || !data.username ||
        !Number.isInteger(data.exp) || data.exp <= Date.now()/1000 || data.exp > Date.now()/1000 + 12*3600) return null;
    return data;
  } catch (_) { return null; }
}
