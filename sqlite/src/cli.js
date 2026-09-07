#!/usr/bin/env node
// 터미널 진입점. 서버도 브라우저도 없이 db.js 의 함수만 부른다.
// SQL 은 여기 없다 — server.js 와 같은 규칙이다.
// 웹 앱과 같은 todo.db 를 보므로, 여기서 완료로 표시하면 브라우저에도 그대로 보인다.
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

// db.js 는 불러오는 순간 DB_PATH 를 읽고 파일을 연다. 그래서 .env 를 먼저 읽어야 한다.
// import 문은 본문보다 먼저 실행되므로 db.js 만 동적 import 로 미룬다.
// (npm start 는 --env-file-if-exists 플래그로 같은 일을 하지만, `todo` 명령에는
//  플래그를 끼워 넣을 자리가 없다.)
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '..', '.env'));
} catch {
  // .env 가 없으면 db.js 의 기본값(todo.db)으로 간다.
}

const { dbPath, listTodos, listDoneOn, getTodo, createTodo, updateTodo, deleteTodo, normalizeTags } =
  await import('./db.js');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// public/app.js 와 같은 이유로 로컬 시각으로 만든다. SQL 의 date('now') 는 UTC 라서
// 한국 시간 오전 9시 전에는 어제 날짜가 나온다.
function todayLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

let failed = false;
function fail(message) {
  console.error(message);
  failed = true;
}

// PowerShell 은 `--tag 장보기,급함` 을 배열 리터럴로 보고 공백으로 이어 붙여 넘긴다.
// (Bash 는 그대로 넘긴다.) 두 셸에서 같게 동작하도록 쉼표와 공백을 모두 구분자로 받는다.
// 대신 터미널로는 공백이 든 태그 이름을 만들 수 없다 — 그런 이름은 화면에서 만든다.
function splitTags(value) {
  return normalizeTags(String(value ?? '').split(/[,\s]+/));
}

// 한 줄 = 할 일 하나. '#3   [ ]  2026-09-10  ' 까지가 23칸이고 그 뒤부터 제목이다.
// 마감일 칸은 ASCII 로만 채워야 줄이 어긋나지 않는다. 한글은 터미널에서 두 칸을
// 차지하므로 '지남' 같은 표시는 폭이 고정된 칸이 아니라 줄 맨 뒤에 붙인다.
const TITLE_COLUMN = 23;

function line(todo, today) {
  const tail = todo.tags.length ? [todo.tags.map((name) => `#${name}`).join(' ')] : [];
  if (!todo.done && todo.due_date) {
    if (todo.due_date < today) tail.push('(지남)');
    else if (todo.due_date === today) tail.push('(오늘)');
  }
  const id = `#${todo.id}`.padEnd(4);
  const box = todo.done ? '[x]' : '[ ]';
  const due = (todo.due_date ?? '').padEnd(10);
  return [id, box, due, todo.title, ...tail].join('  ');
}

// done_at 은 UTC 문자열이다. Date 가 'Z' 를 읽어 주므로 getHours() 는 로컬 시각을 준다.
function doneTime(stamp) {
  const d = new Date(stamp);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function printTodos(todos, today, { withTime = false } = {}) {
  for (const todo of todos) {
    // 시각 칸은 넓이를 고정한다. 완료 시각이 없는 행이 섞여도 줄이 어긋나지 않는다.
    const stamp = withTime ? (todo.done_at ? doneTime(todo.done_at) : '').padEnd(5) + '  ' : '';
    console.log(stamp + line(todo, today));
    if (todo.notes) console.log(' '.repeat(stamp.length + TITLE_COLUMN) + todo.notes);
  }
}

// parseArgs 는 옵션 값을 하나만 먹는다. `--notes 메모도 한글` 로 치면 '한글' 이 남아
// 제목 쪽 낱말로 붙어 버린다. 엉뚱한 제목이 조용히 저장되므로 입구에서 막는다.
function strayWords(tokens) {
  const firstOption = tokens.find((token) => token.kind === 'option');
  if (!firstOption) return [];
  return tokens
    .filter((token) => token.kind === 'positional' && token.index > firstOption.index)
    .map((token) => token.value);
}

function add(rest, options, tokens) {
  const stray = strayWords(tokens);
  if (stray.length) {
    return fail(
      `옵션 뒤에 낱말이 남았습니다: ${stray.join(' ')}\n` +
        '낱말이 여럿인 값은 따옴표로 묶으세요.  예: todo add 우유 사기 --notes "저지방으로 두 개"',
    );
  }

  // 따옴표 없이 `todo add 우유 사기` 로 쳐도 되도록 남은 낱말을 이어 붙인다.
  const title = rest.join(' ').trim();
  if (!title) return fail('제목을 입력하세요.  예: todo add 우유 사기 --due 2026-09-10');

  // server.js 와 schema.sql 이 막는 것과 같은 규칙이다. 여기서 먼저 걸러야
  // SQLite 의 CHECK 오류 대신 읽을 수 있는 문장이 나온다.
  const due = options.due ?? null;
  if (due !== null && !DATE_RE.test(due)) {
    return fail('마감일은 YYYY-MM-DD 형식이어야 합니다.');
  }

  const todo = createTodo({
    title,
    notes: options.notes?.trim() || null,
    due_date: due,
    tags: splitTags(options.tag),
  });

  console.log('추가함');
  printTodos([todo], todayLocal());
}

function list(rest, options) {
  // db.js 의 태그 필터는 한 번에 한 개다. 두 개를 받으면 조용히 하나를 버리는 대신 막는다.
  const tags = splitTags(options.tag);
  if (tags.length > 1) return fail('태그 필터는 한 번에 하나만 됩니다.');

  const filter = options.all ? 'all' : options.done ? 'done' : options.today ? 'today' : 'open';
  const today = todayLocal();
  const todos = listTodos({
    filter,
    q: options.q ?? rest.join(' ').trim(),
    tag: tags[0] ?? '',
    today,
  });

  const label = { all: '전체', open: '미완료', done: '완료', today: '오늘 마감' }[filter];
  console.log(`${label} ${todos.length}건`);
  if (todos.length === 0) console.log('표시할 할 일이 없습니다.');
  else printTodos(todos, today);
}

function done(rest, options) {
  if (rest.length === 0) return fail('완료할 번호를 넣으세요.  예: todo done 3');

  const value = !options.undo;
  const today = todayLocal();

  for (const raw of rest) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      fail(`'${raw}' 는 할 일 번호가 아닙니다.`);
      continue;
    }
    const todo = updateTodo(id, { done: value });
    if (!todo) {
      fail(`#${id} 인 할 일이 없습니다.`);
      continue;
    }
    console.log(`${value ? '완료' : '되돌림'}  ${line(todo, today)}`);
  }
}

// 삭제는 되돌릴 수 없다. 화면에서 확인을 한 번 묻는 것과 같은 자리를 여기에도 둔다.
// 터미널이 아닌 곳(파이프, 에이전트)에서는 물을 수단이 없다. 그럴 때 그냥 지우면
// 확인 절차가 있으나 마나이므로, 무엇이 지워질지만 보여주고 멈춘다. --yes 가 그 문을 연다.
async function rm(rest, options) {
  if (rest.length === 0) return fail('지울 번호를 넣으세요.  예: todo rm 7');

  const today = todayLocal();

  // 지우기 전에 전부 찾아 둔다. 번호 하나가 틀렸을 때 앞의 것만 지워진 채로
  // 멈추지 않도록, 보여주는 목록과 실제로 지우는 대상을 같게 맞춘다.
  const targets = [];
  for (const raw of rest) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      fail(`'${raw}' 는 할 일 번호가 아닙니다.`);
      continue;
    }
    const todo = getTodo(id);
    if (!todo) {
      fail(`#${id} 인 할 일이 없습니다.`);
      continue;
    }
    targets.push(todo);
  }
  if (targets.length === 0) return;

  console.log(`지울 할 일 ${targets.length}건`);
  printTodos(targets, today);

  if (!options.yes) {
    if (!process.stdin.isTTY) {
      return fail('\n되돌릴 수 없는 작업입니다. 확인했다면 --yes 를 붙여 다시 실행하세요.');
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('\n정말 지울까요? 되돌릴 수 없습니다. (y/N) ');
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      return console.log('취소했습니다.');
    }
  }

  for (const todo of targets) {
    if (deleteTodo(todo.id)) console.log(`지움  ${line(todo, today)}`);
    else fail(`#${todo.id} 를 지우지 못했습니다.`);
  }
}

function summary(_rest, options) {
  const date = options.date ?? todayLocal();
  if (!DATE_RE.test(date)) return fail('날짜는 YYYY-MM-DD 형식이어야 합니다.');

  const finished = listDoneOn(date);
  const open = listTodos({ filter: 'open' });
  const dueToday = open.filter((todo) => todo.due_date === date).length;
  const overdue = open.filter((todo) => todo.due_date && todo.due_date < date).length;

  console.log(`${date} 요약`);
  console.log(
    `끝낸 일 ${finished.length}건 · 남은 일 ${open.length}건` +
      ` (이 날 마감 ${dueToday}건, 지난 마감 ${overdue}건)`,
  );
  console.log('');

  if (finished.length === 0) console.log('이 날 끝낸 일이 없습니다.');
  else printTodos(finished, date, { withTime: true });
}

function help() {
  console.log(
    [
      'todo — 터미널에서 쓰는 할 일. 웹 앱과 같은 todo.db 를 본다.',
      '',
      '  todo add <제목> [--due YYYY-MM-DD] [--tag 공부,운동] [--notes 메모]',
      '  todo list [검색어] [--all | --done | --today] [--tag 공부]',
      '  todo done <번호> [번호 ...] [--undo]',
      '  todo rm <번호> [번호 ...] [--yes]',
      '  todo summary [--date YYYY-MM-DD]',
      '',
      'list 는 아무 것도 안 붙이면 미완료만 보여준다.',
      'summary 는 그날 완료로 표시한 일을 모아 보여준다.',
      'rm 은 되돌릴 수 없다. 확인을 묻고, 물을 수 없는 자리에서는 --yes 를 요구한다.',
      '',
      `데이터 파일: ${dbPath}`,
    ].join('\n'),
  );
}

const OPTIONS = {
  due: { type: 'string' },
  notes: { type: 'string' },
  tag: { type: 'string' },
  q: { type: 'string' },
  date: { type: 'string' },
  all: { type: 'boolean' },
  done: { type: 'boolean' },
  today: { type: 'boolean' },
  undo: { type: 'boolean' },
  yes: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

const COMMANDS = { add, list, done, rm, summary };

let parsed;
try {
  // tokens 를 켜야 낱말이 옵션 앞에 왔는지 뒤에 왔는지 알 수 있다(strayWords 참고).
  parsed = parseArgs({
    args: process.argv.slice(2),
    options: OPTIONS,
    allowPositionals: true,
    tokens: true,
  });
} catch (error) {
  // 없는 옵션이나 값 빠진 옵션은 parseArgs 가 던진다. 스택 대신 이유만 보여준다.
  console.error(error.message);
  console.error('');
  help();
  process.exit(1);
}

const [command, ...rest] = parsed.positionals;

// Object.hasOwn 없이 COMMANDS[command] 만 보면 'constructor' 같은 이름이 함수로 잡힌다.
if (command && Object.hasOwn(COMMANDS, command) && !parsed.values.help) {
  await COMMANDS[command](rest, parsed.values, parsed.tokens);
} else {
  if (command && !Object.hasOwn(COMMANDS, command)) fail(`'${command}' 는 없는 명령입니다.`);
  help();
}

process.exitCode = failed ? 1 : 0;
