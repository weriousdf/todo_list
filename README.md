# 할 일 (Todo)

같은 Todo 앱을 두 가지 방식으로 만들었다. 폴더 하나가 한 판이고, 각각 따로 실행된다.

| 폴더 | 저장 위치 | 로그인 | 포트 |
|---|---|---|---|
| [`sqlite/`](sqlite/) | 내 컴퓨터의 `todo.db` 파일 하나 | 없음 | 3000 |
| [`supabase/`](supabase/) | Supabase 클라우드 Postgres | 있음 (이메일) | 3100 |

기능은 둘 다 같다. 기본 CRUD 네 가지(추가 · 목록 · 완료 표시 · 삭제)에
마감일 · 태그 · 오늘 할 일만 보기 · 검색을 더했다.

`sqlite/` 판에만 터미널용 `todo` 명령이 하나 더 있다(아래 참고).

## 실행

각 폴더에서 따로 실행한다. 포트가 달라서 둘을 동시에 띄워 비교할 수 있다.

```
cd sqlite
npm install
npm start
```

```
cd supabase
npm install
npm start
```

`supabase/` 판은 처음 한 번 Supabase 프로젝트를 만들고 `.env` 를 채워야 한다.
자세한 절차는 [`supabase/README.md`](supabase/README.md) 에 있다.

## 터미널에서 쓰기

`sqlite/` 판에는 브라우저 없이 같은 `todo.db` 를 다루는 `todo` 명령이 있다.
서버를 켜 두지 않아도 되고, 화면에서 한 일과 터미널에서 한 일이 같은 파일에 쌓인다.

```
cd sqlite
npm run todo -- list                       # 미완료만. --all / --done / --today
npm run todo -- add "우유 사기" --due 2026-09-10 --tag 장보기
npm run todo -- done 3                     # --undo 로 되돌린다
npm run todo -- rm 7                       # 되돌릴 수 없다. 확인을 한 번 묻는다
npm run todo -- summary                    # 오늘 끝낸 일
```

자세한 사용법과 걸리는 지점은 [`sqlite/README.md`](sqlite/README.md) 에 있다.

이 명령들은 AI 에이전트가 쓰라고 만든 창구이기도 하다. 화면은 사람이 클릭하라고 있는
것이라 에이전트가 붙잡기 번거롭지만, 명령줄은 그대로 실행하고 결과를 글로 읽을 수 있다.
그래서 같은 사용법을 루트 [`CLAUDE.md`](CLAUDE.md) 에도 적어 두었다 — 에이전트는 그
파일을 읽고 여기 적힌 명령을 직접 부른다.

`supabase/` 판에는 이 CLI 가 없다. 데이터가 클라우드에 있고 로그인 토큰이 있어야
읽히므로, 터미널에서 파일 하나를 여는 것으로는 닿지 않기 때문이다.

## 두 판의 진짜 차이

기능이 같으니 화면만 보면 구별이 안 된다. 차이는 **누가 데이터를 지키느냐**에 있다.

`sqlite/` 판은 브라우저 → Express → SQLite 순서로 흐른다. "이 할 일을 보여줄지"
판단하는 곳은 Express 코드다. 서버 코드를 고치면 무엇이든 할 수 있다.

`supabase/` 판은 브라우저가 DB 에 직접 붙는다. Express 는 정적 파일과 접속 정보만
넘겨준다. 그래서 판단하는 곳이 앱 코드가 아니라 **DB 안의 RLS 정책**이다.
`supabase/public/app.js` 를 아무리 고쳐도 남의 행은 나오지 않는다.

SQLite 에서 Postgres 로 옮기면서 문법도 여러 군데 달라졌다 — 불리언과 날짜 타입,
NULL 정렬 방향, 트리거 작성법. 어디가 어떻게 다른지는 [`supabase/README.md`](supabase/README.md)
아래쪽에 정리해 두었다.

## 확인

각 폴더에 확인 스크립트가 있다. 무엇을 확인하는지는 각 README 에 적혀 있다.

| 폴더 | 명령 | 확인하는 것 |
|---|---|---|
| `sqlite/` | `npm run db:check` | 표 · 인덱스 · 외래키 상태 |
| `sqlite/` | `npm run api:check` | API 검사 21개 |
| `supabase/` | `npm run check` | 연결 상태와 RLS 가 실제로 막는지 |
