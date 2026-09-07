// 정적 파일을 내려주고, .env 에서 읽은 Supabase 접속 정보를 브라우저에 넘긴다.
// 데이터는 브라우저가 Supabase 에 직접 읽고 쓴다 — 차단은 RLS 가 한다.
import express from 'express';
import path from 'node:path';
import { classifyKey } from './key.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);
const publicDir = path.resolve(import.meta.dirname, '..', 'public');

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').trim();
const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY ?? '').trim();

const keyKind = classifyKey(SUPABASE_ANON_KEY);

// service_role 키는 RLS 를 통째로 우회한다. 브라우저로 내려가는 순간 누구나
// 모든 사람의 데이터를 읽을 수 있게 되므로, 서버를 아예 띄우지 않는다.
if (keyKind === 'service_role') {
  console.error('');
  console.error('SUPABASE_ANON_KEY 에 service_role(secret) 키가 들어 있습니다.');
  console.error('이 키는 RLS 를 우회하므로 브라우저로 내려보내면 안 됩니다.');
  console.error('Supabase 대시보드 > Project Settings > API 에서 anon(public) 키로 바꿔 주세요.');
  console.error('');
  process.exit(1);
}

app.use(express.static(publicDir));

// 브라우저가 Supabase 에 접속하려면 주소와 anon 키가 필요하다.
// 소스에 박지 않고 .env 에서 읽어 여기서 내려준다.
//
// anon 키가 브라우저에 노출되는 것은 설계상 정상이다. 이 키 하나로는 아무 행도
// 읽거나 쓸 수 없고, 로그인해서 받은 토큰과 RLS 정책이 실제 차단을 한다.
app.get('/api/config', (_req, res) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({
      error: '.env 에 SUPABASE_URL 과 SUPABASE_ANON_KEY 를 넣어야 합니다. .env.example 을 참고하세요.',
    });
  }
  res.json({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: '서버에서 오류가 났습니다. 터미널 로그를 확인하세요.' });
});

app.listen(PORT, () => {
  console.log(`Todo 앱 실행 중 -> http://localhost:${PORT}`);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.log('');
    console.log('아직 .env 가 비어 있습니다. 화면에 설정 안내가 표시됩니다.');
    console.log('  cp .env.example .env  후 Supabase 대시보드의 값을 채우세요.');
  } else {
    console.log(`Supabase          -> ${SUPABASE_URL}`);
    console.log(`키 종류           -> ${keyKind}${keyKind === 'anon' ? ' (정상)' : ' — anon 키인지 확인하세요'}`);
  }
});
