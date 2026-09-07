-- 3단계. 함수.
-- 02_rls.sql 을 실행한 뒤 이어서 붙여넣고 실행한다.
--
-- 왜 브라우저에서 표를 직접 조회하지 않고 함수를 쓰는가:
--
--   원자성 — 할 일 하나를 추가하면 todos / tags / todo_tags 세 표에 써야 한다.
--            브라우저에서 세 번 나눠 호출하면 중간에 실패했을 때 태그가 빠진
--            할 일이 남는다. 함수 안은 한 트랜잭션이라 전부 되거나 전부 안 된다.
--
--   안전성 — 검색어를 클라이언트에서 조립한 필터 문자열로 넘기면, 사용자가 친
--            쉼표나 괄호가 필터 문법으로 해석되어 조건을 빠져나갈 수 있다.
--            함수 인자로 넘기면 값은 값으로만 다뤄진다.
--
--   왕복   — 목록 + 태그를 한 번에 받는다. 로컬 SQLite 와 달리 클라우드는
--            왕복 한 번이 곧 지연이다.
--
-- 셋 다 security invoker 다. 즉 호출한 사람의 권한으로 실행되므로 RLS 가
-- 그대로 적용된다. security definer 로 만들면 RLS 를 우회해서, 이 파일이
-- 곧 보안 구멍이 된다.


-- 목록. 필터·검색·태그를 한 번에 처리하고 태그 배열까지 붙여서 돌려준다.
create or replace function public.list_todos(
  p_filter text default 'all',
  p_q      text default '',
  p_tag    text default '',
  p_today  date default null
)
returns table (
  id bigint, title text, notes text, done boolean,
  due_date date, created_at timestamptz, tags text[]
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pattern text;
begin
  -- 검색어의 % 와 _ 는 LIKE 의 와일드카드다. 이스케이프하지 않으면
  -- 검색창에 % 한 글자만 쳐도 전체 목록이 나온다.
  v_pattern := '%' ||
    replace(replace(replace(coalesce(p_q, ''), '\', '\'), '%', '\%'), '_', '\_') || '%';

  return query
  select t.id, t.title, t.notes, t.is_done, t.due_date, t.created_at,
         coalesce(
           array_agg(g.name order by g.name) filter (where g.name is not null),
           '{}'::text[]
         )
  from public.todos t
  left join public.todo_tags tt on tt.todo_id = t.id
  left join public.tags g       on g.id = tt.tag_id
  where (p_filter is distinct from 'open'  or t.is_done = false)
    and (p_filter is distinct from 'done'  or t.is_done = true)
    and (p_filter is distinct from 'today' or (t.is_done = false and t.due_date = p_today))
    and (coalesce(p_q, '') = ''
         or t.title ilike v_pattern
         or coalesce(t.notes, '') ilike v_pattern)
    -- 태그 조건을 JOIN 에 넣으면 그 항목의 나머지 태그가 결과에서 사라진다.
    -- exists 로 걸러야 "이 태그를 가진 할 일"을 고르면서 태그 목록은 온전히 남는다.
    and (coalesce(p_tag, '') = '' or exists (
          select 1 from public.todo_tags x
          join public.tags y on y.id = x.tag_id
          where x.todo_id = t.id and y.name = p_tag))
  group by t.id
  -- SQLite 는 NULL 을 먼저 정렬하지만 Postgres 는 ASC 에서 NULL 을 뒤로 보낸다.
  -- 기본값이 서로 반대라서, 어느 쪽에서도 같게 동작하도록 명시한다.
  order by t.is_done, t.due_date asc nulls last, t.created_at;
end;
$$;


-- 할 일 추가. 없는 태그는 만들고 있는 태그는 재사용한다.
create or replace function public.create_todo(
  p_title    text,
  p_notes    text default null,
  p_due_date date default null,
  p_tags     text[] default '{}'
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_id     bigint;
  v_name   text;
  v_tag_id bigint;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다.';
  end if;

  insert into public.todos (user_id, title, notes, due_date)
  values (v_uid, btrim(p_title), nullif(btrim(coalesce(p_notes, '')), ''), p_due_date)
  returning todos.id into v_id;

  foreach v_name in array coalesce(p_tags, '{}'::text[]) loop
    v_name := regexp_replace(btrim(v_name), '\s+', ' ', 'g');
    continue when v_name = '';

    -- do nothing 을 쓰면 이미 있는 태그일 때 returning 이 아무것도 주지 않아
    -- id 를 받지 못한다. 그래서 do update 로 자기 값을 덮어써서 행을 돌려받는다.
    insert into public.tags (user_id, name) values (v_uid, v_name)
    on conflict (user_id, name) do update set name = excluded.name
    returning tags.id into v_tag_id;

    insert into public.todo_tags (todo_id, tag_id) values (v_id, v_tag_id)
    on conflict do nothing;
  end loop;

  return v_id;
end;
$$;


-- 할 일의 태그를 통째로 바꾼다.
create or replace function public.set_todo_tags(p_todo_id bigint, p_tags text[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_name   text;
  v_tag_id bigint;
begin
  -- RLS 가 남의 할 일을 안 보이게 하므로, 못 찾으면 없는 것이거나 남의 것이다.
  if not exists (select 1 from public.todos t where t.id = p_todo_id and t.user_id = v_uid) then
    raise exception '해당 할 일이 없습니다.';
  end if;

  delete from public.todo_tags where todo_id = p_todo_id;

  foreach v_name in array coalesce(p_tags, '{}'::text[]) loop
    v_name := regexp_replace(btrim(v_name), '\s+', ' ', 'g');
    continue when v_name = '';

    insert into public.tags (user_id, name) values (v_uid, v_name)
    on conflict (user_id, name) do update set name = excluded.name
    returning tags.id into v_tag_id;

    insert into public.todo_tags (todo_id, tag_id) values (p_todo_id, v_tag_id)
    on conflict do nothing;
  end loop;
end;
$$;


-- 로그인하지 않은 사람은 아예 호출도 못 하게 한다.
-- (security invoker + RLS 로 어차피 빈 결과지만, 문을 하나 더 잠가 둔다)
revoke execute on function public.list_todos(text, text, text, date)      from public, anon;
revoke execute on function public.create_todo(text, text, date, text[])   from public, anon;
revoke execute on function public.set_todo_tags(bigint, text[])           from public, anon;

grant execute on function public.list_todos(text, text, text, date)       to authenticated;
grant execute on function public.create_todo(text, text, date, text[])    to authenticated;
grant execute on function public.set_todo_tags(bigint, text[])            to authenticated;
