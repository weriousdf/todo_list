# Todo 앱

## 개요
할 일을 추가·완료·조회하는 1인용 앱. 데이터는 내 컴퓨터의 `sqlite/todo.db` 파일 하나에 저장된다.
(`supabase/` 는 같은 앱의 클라우드 판이다. 아래 CLI 는 `sqlite/` 판 전용이다.)

## 명령
모두 `sqlite/` 폴더에서 실행한다. 서버는 켜 두지 않아도 된다.

- 목록: `npm run todo -- list` — 검색어, `--all` `--done` `--today` `--tag` 사용 가능
- 추가: `npm run todo -- add "<내용>"` — `--due YYYY-MM-DD` `--tag` `--notes`
- 완료: `npm run todo -- done <번호>` — 여러 개 가능, `--undo` 로 되돌림
- 오늘 완료 요약: `npm run todo -- summary` — `--date YYYY-MM-DD`

`npm run todo --` 대신 `node src/cli.js <명령>` 으로 써도 같다.
웹 화면은 `npm start` → http://localhost:3000 이며 같은 `todo.db` 를 본다.

## 규칙
- 데이터는 `sqlite/todo.db` 에 저장한다. UI 문구는 존댓말로.
- 할 일을 읽고 쓸 때는 위 CLI 를 쓴다. `todo.db` 에 SQL 을 직접 걸지 않는다.

## 하지 말 것
- `todo.db`(실데이터)를 직접 지우거나 덮어쓰지 말 것.
- 데이터를 바꾸는 명령(`add`·`done`)은 실행 전에 무엇을 바꿀지 먼저 알릴 것.
