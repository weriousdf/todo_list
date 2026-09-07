-- 2단계. 행 수준 보안(RLS).
-- 01_schema.sql 을 실행한 뒤 이어서 붙여넣고 실행한다.
--
-- 알아둘 것 세 가지.
--
-- 1) RLS 를 켜고 정책을 하나도 만들지 않으면 "전부 차단"이다. 켜는 것만으로는
--    앱이 동작하지 않는다. 아래 정책들이 "본인 것만" 이라는 구멍을 뚫어 준다.
--
-- 2) service_role 키는 RLS 를 통째로 우회한다. 그래서 그 키는 절대 브라우저로
--    내려보내면 안 된다. 이 앱은 anon 키만 브라우저로 보낸다.
--
-- 3) auth.uid() 를 (select auth.uid()) 로 감싼 이유는 성능이다. 이렇게 쓰면
--    행마다 함수를 호출하지 않고 쿼리당 한 번만 호출해 값을 재사용한다.

alter table public.todos     enable row level security;
alter table public.tags      enable row level security;
alter table public.todo_tags enable row level security;


-- ── todos ────────────────────────────────────────────────────────────────
-- to authenticated: 로그인하지 않은 anon 역할에는 이 정책이 적용되지 않는다.
--                   즉 로그인 없이는 아무것도 보이지 않는다.

drop policy if exists "todos 조회: 본인 것만" on public.todos;
create policy "todos 조회: 본인 것만" on public.todos
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- with check 는 "들어오는 행"을 검사한다. 남의 user_id 로 넣으려 하면 거부된다.
drop policy if exists "todos 추가: 본인 것만" on public.todos;
create policy "todos 추가: 본인 것만" on public.todos
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- update 는 둘 다 필요하다.
--   using      = 고칠 수 있는 행이 무엇인가 (남의 행은 못 고른다)
--   with check = 고친 결과가 무엇인가       (내 행을 남에게 넘길 수 없다)
-- with check 를 빼면 자기 할 일의 user_id 를 남의 것으로 바꿔 넘길 수 있다.
drop policy if exists "todos 수정: 본인 것만" on public.todos;
create policy "todos 수정: 본인 것만" on public.todos
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "todos 삭제: 본인 것만" on public.todos;
create policy "todos 삭제: 본인 것만" on public.todos
  for delete to authenticated
  using ((select auth.uid()) = user_id);


-- ── tags ─────────────────────────────────────────────────────────────────

drop policy if exists "tags 조회: 본인 것만" on public.tags;
create policy "tags 조회: 본인 것만" on public.tags
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "tags 추가: 본인 것만" on public.tags;
create policy "tags 추가: 본인 것만" on public.tags
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "tags 수정: 본인 것만" on public.tags;
create policy "tags 수정: 본인 것만" on public.tags
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "tags 삭제: 본인 것만" on public.tags;
create policy "tags 삭제: 본인 것만" on public.tags
  for delete to authenticated
  using ((select auth.uid()) = user_id);


-- ── todo_tags ────────────────────────────────────────────────────────────
-- 연결표에는 user_id 칸이 없다. 주인은 연결된 할 일에서 따라온다.

drop policy if exists "todo_tags 조회: 본인 할 일의 연결만" on public.todo_tags;
create policy "todo_tags 조회: 본인 할 일의 연결만" on public.todo_tags
  for select to authenticated
  using (exists (
    select 1 from public.todos t
    where t.id = todo_id and t.user_id = (select auth.uid())
  ));

-- 추가할 때는 할 일과 태그가 둘 다 내 것인지 확인한다.
-- 할 일만 검사하면, 내 할 일에 남의 태그를 연결해서 그 사람의 태그 이름을
-- 읽어낼 수 있다. 두 조건이 모두 필요한 이유다.
drop policy if exists "todo_tags 추가: 본인 것끼리만" on public.todo_tags;
create policy "todo_tags 추가: 본인 것끼리만" on public.todo_tags
  for insert to authenticated
  with check (
    exists (select 1 from public.todos t where t.id = todo_id and t.user_id = (select auth.uid()))
    and
    exists (select 1 from public.tags g where g.id = tag_id  and g.user_id = (select auth.uid()))
  );

drop policy if exists "todo_tags 삭제: 본인 할 일의 연결만" on public.todo_tags;
create policy "todo_tags 삭제: 본인 할 일의 연결만" on public.todo_tags
  for delete to authenticated
  using (exists (
    select 1 from public.todos t
    where t.id = todo_id and t.user_id = (select auth.uid())
  ));
