// 화면. 데이터는 Supabase 에 직접 읽고 쓴다.
//
// SQLite 판과 가장 크게 달라진 점: 여기에는 "서버가 나 대신 검사해 준다"가 없다.
// 브라우저가 DB 에 직접 붙으므로, 누가 무엇을 볼 수 있는지는 전적으로 RLS 정책이
// 정한다. 이 파일의 코드를 아무리 고쳐도 남의 행은 나오지 않는다.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const $ = (id) => document.getElementById(id);
const show = (id, on) => { $(id).hidden = !on; };

const state = { filter: 'all', q: '', tag: '' };
let sb = null;

// 오늘 날짜는 브라우저의 로컬 시각으로 만든다.
// DB 쪽에서 current_date 를 쓰면 서버 시간대를 따라가서 자정 근처에 어긋난다.
function todayLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function msg(el, text, kind = 'error') {
  el.textContent = text;
  el.className = `msg ${kind}`;
  el.hidden = !text;
}

// Supabase 가 돌려주는 영어 오류를 자주 보는 것만 우리말로 바꾼다.
function authError(error) {
  const raw = error?.message ?? '알 수 없는 오류';
  if (/invalid login credentials/i.test(raw)) return '이메일 또는 비밀번호가 맞지 않습니다.';
  if (/already registered/i.test(raw)) return '이미 가입된 이메일입니다. 로그인을 눌러 주세요.';
  if (/email not confirmed/i.test(raw)) return '메일 인증이 아직 안 됐습니다. 메일함을 확인하거나, 대시보드에서 Confirm email 을 끄세요.';
  if (/password should be at least/i.test(raw)) return '비밀번호는 6자 이상이어야 합니다.';
  if (/signups not allowed/i.test(raw)) return '회원가입이 꺼져 있습니다. 대시보드 Authentication 설정을 확인하세요.';
  if (/rate limit|too many/i.test(raw)) return '잠시 뒤에 다시 시도하세요. (무료 요금제는 메일 발송 횟수가 제한됩니다)';
  return raw;
}

// ── 데이터 ────────────────────────────────────────────────────────────────

async function listTodos() {
  const { data, error } = await sb.rpc('list_todos', {
    p_filter: state.filter,
    p_q: state.q,
    p_tag: state.tag,
    p_today: state.filter === 'today' ? todayLocal() : null,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// RLS 덕분에 내 태그와 내 연결만 돌아온다. 개수를 따로 셀 필요가 없다.
async function listTags() {
  const { data, error } = await sb.from('tags').select('id, name, todo_tags(todo_id)').order('name');
  if (error) throw new Error(error.message);
  return (data ?? []).map((t) => ({ id: t.id, name: t.name, count: t.todo_tags?.length ?? 0 }));
}

// ── 그리기 ────────────────────────────────────────────────────────────────

function dueLabel(dueDate, done) {
  const today = todayLocal();
  const el = document.createElement('span');
  el.className = 'due';
  if (dueDate < today && !done) {
    el.classList.add('overdue');
    el.textContent = `${dueDate} 지남`;
  } else if (dueDate === today) {
    el.textContent = '오늘';
  } else {
    el.textContent = dueDate;
  }
  return el;
}

// 제목·메모·태그는 사용자가 입력한 문자열이다. innerHTML 로 넣지 않고
// textContent 로만 넣어 <script> 같은 입력이 태그로 해석될 여지를 없앤다.
function itemNode(todo) {
  const li = document.createElement('li');
  li.className = 'item' + (todo.done ? ' done' : '');

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = todo.done;
  box.setAttribute('aria-label', `${todo.title} 완료 표시`);
  box.addEventListener('change', async () => {
    box.disabled = true;
    try {
      const { error } = await sb.from('todos').update({ is_done: box.checked }).eq('id', todo.id);
      if (error) throw new Error(error.message);
      await refresh();
    } catch (error) {
      msg($('form-error'), error.message);
      box.checked = !box.checked;
    } finally {
      box.disabled = false;
    }
  });

  const body = document.createElement('div');
  body.className = 'body';

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = todo.title;
  body.append(title);

  if (todo.notes) {
    const notes = document.createElement('div');
    notes.className = 'notes';
    notes.textContent = todo.notes;
    body.append(notes);
  }

  const tags = todo.tags ?? [];
  if (todo.due_date || tags.length) {
    const meta = document.createElement('div');
    meta.className = 'meta';
    if (todo.due_date) meta.append(dueLabel(todo.due_date, todo.done));
    for (const name of tags) {
      const tag = document.createElement('button');
      tag.type = 'button';
      tag.className = 'tag';
      tag.textContent = `#${name}`;
      tag.title = `'${name}' 태그로 걸러 보기`;
      tag.addEventListener('click', () => {
        state.tag = state.tag === name ? '' : name;
        refresh();
      });
      meta.append(tag);
    }
    body.append(meta);
  }

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'del';
  del.textContent = '삭제';
  del.setAttribute('aria-label', `${todo.title} 삭제`);
  del.addEventListener('click', async () => {
    if (!confirm(`'${todo.title}'을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try {
      const { error } = await sb.from('todos').delete().eq('id', todo.id);
      if (error) throw new Error(error.message);
      await refresh();
    } catch (error) {
      msg($('form-error'), error.message);
    }
  });

  li.append(box, body, del);
  return li;
}

function renderTagBar(tags) {
  const bar = $('tag-bar');
  bar.replaceChildren();
  for (const tag of tags.filter((t) => t.count > 0)) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (state.tag === tag.name ? ' on' : '');
    chip.textContent = `#${tag.name} ${tag.count}`;
    chip.addEventListener('click', () => {
      state.tag = state.tag === tag.name ? '' : tag.name;
      refresh();
    });
    bar.append(chip);
  }
}

function describe(count) {
  const parts = [];
  if (state.filter === 'today') parts.push('오늘 마감');
  else if (state.filter === 'open') parts.push('미완료');
  else if (state.filter === 'done') parts.push('완료');
  if (state.tag) parts.push(`#${state.tag}`);
  if (state.q) parts.push(`'${state.q}' 검색`);
  return `${parts.length ? parts.join(' · ') + ' — ' : ''}${count}건`;
}

async function refresh() {
  try {
    const [todos, tags] = await Promise.all([listTodos(), listTags()]);
    msg($('form-error'), '');
    $('status').textContent = describe(todos.length);
    renderTagBar(tags);

    const list = $('list');
    list.replaceChildren();
    if (todos.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = '표시할 할 일이 없습니다.';
      list.append(empty);
    } else {
      for (const todo of todos) list.append(itemNode(todo));
    }

    for (const chip of document.querySelectorAll('[data-filter]')) {
      chip.classList.toggle('on', chip.dataset.filter === state.filter);
    }
  } catch (error) {
    msg($('form-error'), error.message);
  }
}

// ── 화면 전환 ─────────────────────────────────────────────────────────────

function route(session) {
  const signedIn = Boolean(session);
  show('auth', !signedIn);
  show('app', signedIn);
  document.querySelector('.who').hidden = !signedIn;
  if (signedIn) {
    $('who-email').textContent = session.user.email ?? '';
    $('password').value = '';
    refresh();
  }
}

// ── 이벤트 ────────────────────────────────────────────────────────────────

$('auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  msg($('auth-msg'), '');
  const { error } = await sb.auth.signInWithPassword({
    email: $('email').value.trim(),
    password: $('password').value,
  });
  if (error) msg($('auth-msg'), authError(error));
});

$('signup').addEventListener('click', async () => {
  msg($('auth-msg'), '');
  const email = $('email').value.trim();
  const password = $('password').value;
  if (!email || password.length < 6) {
    msg($('auth-msg'), '이메일과 6자 이상의 비밀번호를 입력하세요.');
    return;
  }
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) return msg($('auth-msg'), authError(error));
  // 세션이 바로 오면 Confirm email 이 꺼져 있는 것이고, onAuthStateChange 가 화면을 넘긴다.
  if (!data.session) {
    msg($('auth-msg'),
      '가입 메일을 보냈습니다. 메일함에서 인증한 뒤 로그인하세요. ' +
      '혼자 쓸 거라면 대시보드 Authentication 에서 Confirm email 을 끄면 이 단계가 없어집니다.',
      'info');
  }
});

$('logout').addEventListener('click', async () => {
  await sb.auth.signOut();
  state.filter = 'all';
  state.q = '';
  state.tag = '';
});

$('add-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = $('title').value.trim();
  if (!title) {
    msg($('form-error'), '제목을 입력하세요.');
    $('title').focus();
    return;
  }
  try {
    const { error } = await sb.rpc('create_todo', {
      p_title: title,
      p_notes: null,
      p_due_date: $('due').value || null,
      p_tags: $('tags').value.split(',').map((s) => s.trim()).filter(Boolean),
    });
    if (error) throw new Error(error.message);
    $('title').value = '';
    $('due').value = '';
    $('tags').value = '';
    $('title').focus();
    await refresh();
  } catch (error) {
    msg($('form-error'), error.message);
  }
});

$('title').addEventListener('input', () => msg($('form-error'), ''));

for (const chip of document.querySelectorAll('[data-filter]')) {
  chip.addEventListener('click', () => {
    state.filter = chip.dataset.filter;
    refresh();
  });
}

let searchTimer;
$('search').addEventListener('input', (event) => {
  clearTimeout(searchTimer);
  const value = event.target.value;
  searchTimer = setTimeout(() => {
    state.q = value.trim();
    refresh();
  }, 200);
});

// ── 시작 ──────────────────────────────────────────────────────────────────

const config = await fetch('/api/config')
  .then((r) => r.json())
  .catch(() => ({ error: '서버에 연결할 수 없습니다.' }));

if (config.error) {
  $('setup-reason').textContent = config.error;
  show('setup', true);
} else {
  sb = createClient(config.url, config.anonKey);
  sb.auth.onAuthStateChange((_event, session) => route(session));
  const { data } = await sb.auth.getSession();
  route(data.session);
}
