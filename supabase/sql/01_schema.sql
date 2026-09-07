-- 1단계. 표 만들기.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행한다.
--
-- SQLite 판과 달라진 곳:
--   is_done   INTEGER 0/1   ->  boolean       (Postgres 에는 진짜 불리언이 있다)
--   due_date  TEXT + GLOB   ->  date          (진짜 날짜 타입. 형식 검사가 필요 없다)
--   시각      TEXT          ->  timestamptz   (시간대까지 담는다)
--   user_id   없음          ->  uuid          (누구의 할 일인지. RLS 가 이 칸으로 판단한다)

create table if not exists public.todos (
  id         bigint generated always as identity primary key,

  -- 기본값이 auth.uid() 라서 클라이언트가 user_id 를 보내지 않아도 된다.
  -- 보내더라도 아래 RLS 정책이 남의 id 를 거부한다.
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,

  title      text not null check (length(btrim(title)) > 0),
  notes      text,
  is_done    boolean not null default false,
  due_date   date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 태그 이름은 사람마다 따로 관리된다. 그래서 UNIQUE 가 (user_id, name) 이다.
-- name 만 UNIQUE 로 두면 먼저 '공부'를 만든 사람이 그 이름을 독점하고
-- 다른 사람은 자기 '공부' 태그를 만들지 못한다.
create table if not exists public.tags (
  id      bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name    text not null check (length(btrim(name)) > 0),
  color   text,
  unique (user_id, name)
);

-- 할 일과 태그를 잇는 연결표. SQLite 판과 역할이 같다.
create table if not exists public.todo_tags (
  todo_id bigint not null references public.todos(id) on delete cascade,
  tag_id  bigint not null references public.tags(id)  on delete cascade,
  primary key (todo_id, tag_id)
);

create index if not exists todos_user_open_due_idx on public.todos (user_id, is_done, due_date);
create index if not exists todo_tags_tag_idx       on public.todo_tags (tag_id);
create index if not exists tags_user_idx           on public.tags (user_id);

-- 수정 시각 자동 갱신.
-- SQLite 에서는 AFTER 트리거가 자기 표를 다시 UPDATE 해야 해서 무한 재귀를 막는
-- WHEN 절이 필요했다. Postgres 는 BEFORE 트리거에서 NEW 를 직접 고칠 수 있어
-- 다시 UPDATE 할 일이 없고, 따라서 재귀 문제도 없다.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists todos_set_updated_at on public.todos;
create trigger todos_set_updated_at
  before update on public.todos
  for each row execute function public.set_updated_at();
