// npm run check — Supabase 설정과 RLS 가 실제로 막는지 확인한다.
//
// 이 스크립트는 anon 키만 쓰고 로그인하지 않는다. 즉 "바깥에서 두드려 보는"
// 검사다. 로그인하지 않은 상태에서 아무것도 못 읽고 못 쓰는 것이 정상이다.
//
// 의존성 없이 Node 내장 fetch 로 PostgREST 를 직접 호출한다.

import { classifyKey } from './key.js';

const URL_BASE = (process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, '');
const ANON = (process.env.SUPABASE_ANON_KEY ?? '').trim();

const results = [];
function check(label, passed, detail = '') {
  results.push({ label, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}
function note(text) {
  console.log(`      ${text}`);
}

// ── 0. .env ──────────────────────────────────────────────────────────────
if (!URL_BASE || !ANON) {
  console.log('아직 .env 가 채워지지 않았습니다.');
  console.log('');
  console.log('  1) cp .env.example .env');
  console.log('  2) Supabase 대시보드 > Project Settings > API 에서');
  console.log('     Project URL 과 anon(public) 키를 복사해 넣기');
  console.log('  3) npm run check 다시 실행');
  process.exit(1);
}

const kind = classifyKey(ANON);
check('키가 anon(public) 키다', kind === 'anon', `종류: ${kind}`);
if (kind === 'service_role') {
  note('service_role 키는 RLS 를 우회합니다. 이 키로는 검사가 의미가 없습니다.');
  process.exit(1);
}

const headers = { apikey: ANON, Authorization: `Bearer ${ANON}` };

async function rest(path, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

// ── 1. 연결 ──────────────────────────────────────────────────────────────
try {
  const res = await fetch(`${URL_BASE}/auth/v1/health`, { headers });
  check('프로젝트에 연결된다', res.ok, `HTTP ${res.status}`);
  if (!res.ok) {
    note('SUPABASE_URL 이 맞는지, 프로젝트가 일시중지(pause) 되지 않았는지 확인하세요.');
    process.exit(1);
  }
} catch (error) {
  check('프로젝트에 연결된다', false, error.message);
  note('주소가 https://<프로젝트ID>.supabase.co 형태인지 확인하세요.');
  process.exit(1);
}

// ── 2. 표가 만들어졌는가 ──────────────────────────────────────────────────
// PostgREST 는 없는 표를 부르면 404 를 준다. RLS 로 막힌 표는 200 + 빈 배열이다.
// 이 차이로 "스키마를 안 돌렸다" 와 "RLS 가 막고 있다" 를 구분한다.
const tables = ['todos', 'tags', 'todo_tags'];
let schemaOk = true;
for (const table of tables) {
  const { status, body } = await rest(`${table}?select=*&limit=5`);
  if (status === 404) {
    schemaOk = false;
    check(`${table} 표가 있다`, false, '404 — 스키마가 아직 실행되지 않았습니다');
  } else {
    check(`${table} 표가 있다`, status === 200, `HTTP ${status}${status !== 200 ? ` ${JSON.stringify(body)}` : ''}`);
  }
}
if (!schemaOk) {
  note('supabase/01_schema.sql 을 대시보드 SQL Editor 에 붙여넣고 실행하세요.');
  process.exit(1);
}

// ── 3. 로그인 없이 읽히는가 (읽히면 안 된다) ──────────────────────────────
let anonRowTotal = 0;
for (const table of tables) {
  const { status, body } = await rest(`${table}?select=*&limit=5`);
  const rows = Array.isArray(body) ? body.length : 0;
  anonRowTotal += rows;
  check(`${table}: 로그인 없이 아무 행도 안 보인다`, status === 200 && rows === 0, `${rows}행`);
  if (rows > 0) {
    note(`경보: RLS 가 켜져 있지 않습니다. supabase/02_rls.sql 을 실행하세요.`);
  }
}

// ── 4. 로그인 없이 쓰이는가 (막혀야 하고, 막힌 이유가 중요하다) ────────────
{
  const { status, body } = await rest('todos', {
    method: 'POST',
    body: JSON.stringify({ title: '[검사] 로그인 없이 쓰기 시도' }),
  });
  const code = body?.code ?? '';
  const blocked = status >= 400;
  check('로그인 없이 쓰기가 막힌다', blocked, `HTTP ${status} ${code}`);

  if (blocked) {
    if (code === '42501') {
      note('42501 = RLS 정책이 막았습니다. 의도한 그대로입니다.');
    } else if (code === '23502') {
      note('23502 = user_id NOT NULL 제약이 막았습니다. RLS 때문이 아닙니다.');
      note('막히기는 했지만 RLS 가 켜졌다는 증거는 아닙니다. 02_rls.sql 실행을 확인하세요.');
    } else {
      note(`막혔지만 이유가 위 두 가지가 아닙니다: ${JSON.stringify(body)}`);
    }
  } else {
    note('경보: 로그인 없이 행이 삽입되었습니다. RLS 가 동작하지 않고 있습니다.');
    note('Supabase 대시보드 > Table Editor 에서 방금 들어간 행을 지우고 02_rls.sql 을 실행하세요.');
  }
}

// ── 5. 로그인 없이 함수를 부를 수 있는가 (부를 수 없어야 한다) ─────────────
{
  const { status, body } = await rest('rpc/list_todos', {
    method: 'POST',
    body: JSON.stringify({ p_filter: 'all' }),
  });
  const rows = Array.isArray(body) ? body.length : null;
  const blocked = status >= 400 || rows === 0;
  check('로그인 없이 list_todos 를 못 쓴다', blocked, `HTTP ${status}${rows !== null ? `, ${rows}행` : ''}`);
  if (status === 404) note('404 = anon 에게 실행 권한이 없습니다. 03_functions.sql 의 revoke 가 걸렸습니다.');
  if (rows > 0) note('경보: 로그인 없이 목록이 나왔습니다. RLS 와 권한 설정을 확인하세요.');
}

// ── 정리 ─────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.passed);
console.log('');
console.log(`${results.length}개 검사 중 ${results.length - failed.length}개 통과`);

if (failed.length === 0) {
  console.log('=> 전체 통과');
  console.log('');
  if (anonRowTotal === 0) {
    console.log('참고. 지금은 데이터가 없어도 0행이 나옵니다. 브라우저에서 로그인해 할 일을');
    console.log('      몇 개 넣은 뒤 이 검사를 다시 돌리세요. 그때도 0행이면 "데이터가 있는데도');
    console.log('      바깥에서는 안 보인다"가 되어 RLS 가 실제로 막고 있다는 증거가 됩니다.');
  }
} else {
  console.log(`=> 실패: ${failed.map((f) => f.label).join(', ')}`);
}
process.exit(failed.length === 0 ? 0 : 1);
