// Supabase 키의 정체를 확인한다. server.js 와 check.js 가 같이 쓴다.
//
// 예전 형식은 JWT 라서 가운데 조각에 role 이 들어 있고,
// 새 형식은 sb_publishable_ / sb_secret_ 접두사로 구분된다. 둘 다 처리한다.
export function classifyKey(key) {
  if (!key) return 'empty';
  if (key.startsWith('sb_secret_')) return 'service_role';
  if (key.startsWith('sb_publishable_')) return 'anon';
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    if (payload.role === 'service_role') return 'service_role';
    if (payload.role === 'anon') return 'anon';
    return `unknown(${payload.role ?? '?'})`;
  } catch {
    return 'unknown';
  }
}
