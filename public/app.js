import {
  answerFor,
  answerForDay,
  dateForDay,
  dayIndex,
  gameResult,
  guessesFor,
  keyStates,
  makeSchedule,
  maxGuesses,
  parsePuzzle,
  parseWords,
  puzzleNumber,
  puzzleSearch,
  randomIndex,
  readState,
  scoreGuess,
  winMessage,
  withGuesses,
} from './logic.js';

const STORAGE_KEY = 'squirdle-state';
const FLIP_MS = 250;
const FLIP_STAGGER_MS = 300;

// Wordle's layout, with a '2' key filling the half-key spacers in row 2 (for PORYGON2).
const KEY_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', '2'],
  ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'BACKSPACE'],
];
const BACKSPACE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 3H7c-.69 0-1.23.35-1.59.88L0 12l5.41 8.11c.36.53.9.89 1.59.89h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H7.07L2.4 12l4.66-7H22v14zm-11.59-2L14 13.41 17.59 17 19 15.59 15.41 12 19 8.41 17.59 7 14 10.59 10.41 7 9 8.41 12.59 12 9 15.59z"/></svg>';
const INPUT_CHAR = /^[A-Z2]$/;

const els = {
  board: document.getElementById('board'),
  boardContainer: document.getElementById('board-container'),
  keyboard: document.getElementById('keyboard'),
  toasts: document.getElementById('toasts'),
  subtitle: document.getElementById('subtitle'),
  archiveButton: document.getElementById('archive-button'),
  randomButton: document.getElementById('random-button'),
  archive: document.getElementById('archive'),
  archiveList: document.getElementById('archive-list'),
  archiveClose: document.getElementById('archive-close'),
};

// Calendar dates of puzzle days (dateForDay returns UTC midnight).
const dateFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
const dateWithYearFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

let words = [];
let schedule = null;

const game = {
  puzzle: null, // { kind: 'daily', day } or { kind: 'random', index }
  answer: '',
  rows: 0,
  valid: new Set(),
  guesses: [],
  current: '',
  busy: false,
  over: false,
};

// ---------- storage ----------

function loadState() {
  try {
    return readState(localStorage.getItem(STORAGE_KEY));
  } catch {
    // Storage unavailable: start fresh.
    return readState(null);
  }
}

function saveGuesses() {
  try {
    const state = withGuesses(loadState(), game.puzzle, game.guesses);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore: progress just won't survive a reload.
  }
}

// ---------- header ----------

function formatDay(day, today) {
  const date = dateForDay(day);
  const sameYear = date.getUTCFullYear() === dateForDay(today).getUTCFullYear();
  return (sameYear ? dateFormat : dateWithYearFormat).format(date);
}

function todayLink() {
  const a = document.createElement('a');
  a.href = './';
  a.textContent = 'Back to today';
  return a;
}

function renderHeader(today) {
  const { puzzle } = game;
  els.subtitle.replaceChildren();
  if (puzzle.kind === 'random') {
    els.subtitle.append('Random · ', todayLink());
  } else if (puzzle.day === today) {
    els.subtitle.append(`#${puzzleNumber(puzzle.day)} · ${formatDay(puzzle.day, today)}`);
  } else {
    els.subtitle.append(`#${puzzleNumber(puzzle.day)} · ${formatDay(puzzle.day, today)} · `, todayLink());
  }
}

function resultLabel({ status, used, rows }) {
  switch (status) {
    case 'won':
      return [`✓ ${used}/${rows}`, `solved in ${used} of ${rows} guesses`];
    case 'lost':
      return ['✗', 'not solved'];
    case 'playing':
      return [`… ${used}/${rows}`, `in progress, ${used} of ${rows} guesses used`];
    default:
      return ['', 'not played'];
  }
}

function archiveRow(day, today, state) {
  const a = document.createElement('a');
  a.className = 'archive-day';
  a.href = `./${puzzleSearch({ kind: 'daily', day }, today)}`;
  if (game.puzzle.kind === 'daily' && game.puzzle.day === day) a.setAttribute('aria-current', 'page');

  const number = document.createElement('span');
  number.className = 'archive-number';
  number.textContent = `#${puzzleNumber(day)}`;

  const date = document.createElement('span');
  date.className = 'archive-date';
  date.textContent = day === today ? 'Today' : formatDay(day, today);

  const result = gameResult(state.daily[day] ?? [], answerForDay(schedule.daily, day));
  const [shown, spoken] = resultLabel(result);
  const status = document.createElement('span');
  status.className = 'archive-result';
  status.dataset.status = result.status;
  const visible = document.createElement('span');
  visible.setAttribute('aria-hidden', 'true');
  visible.textContent = shown;
  const hidden = document.createElement('span');
  hidden.className = 'sr-only';
  hidden.textContent = spoken;
  status.append(visible, hidden);

  a.append(number, date, status);
  const li = document.createElement('li');
  li.append(a);
  return li;
}

// Built fresh on every open, so a rollover since the page loaded shows up.
function openArchive() {
  const today = dayIndex();
  const state = loadState();
  const rows = [];
  for (let day = today; day >= 0; day--) rows.push(archiveRow(day, today, state));
  els.archiveList.replaceChildren(...rows);
  els.archive.showModal();
  els.archiveList.querySelector('[aria-current]')?.scrollIntoView({ block: 'center' });
}

function playRandom() {
  const avoid = game.puzzle.kind === 'random' ? game.puzzle.index : -1;
  location.assign(`./?random=${randomIndex(words.length, avoid)}`);
}

function bindHeader() {
  els.archiveButton.addEventListener('click', () => {
    els.archiveButton.blur();
    openArchive();
  });
  els.randomButton.addEventListener('click', () => {
    els.randomButton.blur();
    playRandom();
  });
  els.archiveClose.addEventListener('click', () => els.archive.close());
  // A click on the dialog element itself (not its panel) is a click on the backdrop.
  els.archive.addEventListener('click', (e) => {
    if (e.target === els.archive) els.archive.close();
  });
  els.archiveButton.disabled = false;
  els.randomButton.disabled = false;
}

// ---------- rendering ----------

function buildBoard() {
  els.board.innerHTML = '';
  els.board.style.gridTemplateRows = `repeat(${game.rows}, 1fr)`;
  for (let r = 0; r < game.rows; r++) {
    const row = document.createElement('div');
    row.className = 'row';
    row.style.gridTemplateColumns = `repeat(${game.answer.length}, 1fr)`;
    for (let c = 0; c < game.answer.length; c++) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.state = 'empty';
      row.appendChild(tile);
    }
    els.board.appendChild(row);
  }
  sizeBoard();
}

function sizeBoard() {
  const cols = game.answer.length;
  if (!cols) return;
  const style = getComputedStyle(els.boardContainer);
  const width = els.boardContainer.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const height = els.boardContainer.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const gap = cols > 9 ? 4 : 5;
  const size = Math.floor(
    Math.min(62, (width - gap * (cols - 1)) / cols, (height - gap * (game.rows - 1)) / game.rows),
  );
  els.board.style.setProperty('--gap', `${gap}px`);
  els.board.style.setProperty('--tile', `${Math.max(size, 16)}px`);
}

function rowEl(r) {
  return els.board.children[r];
}

function renderCurrentRow() {
  const row = rowEl(game.guesses.length);
  if (!row) return;
  [...row.children].forEach((tile, i) => {
    const ch = game.current[i] || '';
    tile.textContent = ch;
    tile.dataset.state = ch ? 'tbd' : 'empty';
  });
}

function renderSubmittedRow(r) {
  const guess = game.guesses[r];
  const score = scoreGuess(guess, game.answer);
  [...rowEl(r).children].forEach((tile, i) => {
    tile.textContent = guess[i];
    tile.dataset.state = score[i];
  });
}

function buildKeyboard() {
  els.keyboard.innerHTML = '';
  for (const keys of KEY_ROWS) {
    const row = document.createElement('div');
    row.className = 'keyboard-row';
    for (const key of keys) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'key';
      btn.dataset.key = key;
      if (key === 'ENTER') {
        btn.classList.add('wide');
        btn.textContent = 'enter';
      } else if (key === 'BACKSPACE') {
        btn.classList.add('wide');
        btn.innerHTML = BACKSPACE_ICON;
        btn.setAttribute('aria-label', 'backspace');
      } else {
        btn.textContent = key;
      }
      row.appendChild(btn);
    }
    els.keyboard.appendChild(row);
  }
}

function renderKeyboard() {
  const states = keyStates(game.guesses, game.answer);
  for (const btn of els.keyboard.querySelectorAll('.key')) {
    const state = states[btn.dataset.key];
    if (state) btn.dataset.state = state;
    else delete btn.dataset.state;
  }
}

// ---------- toasts ----------

function toast(message, duration = 1000) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  els.toasts.prepend(el);
  if (duration !== Infinity) {
    setTimeout(() => {
      el.classList.add('fade');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
    }, duration);
  }
}

// ---------- animations ----------

function pop(tile) {
  tile.animate(
    [
      { transform: 'scale(0.8)', opacity: 0 },
      { transform: 'scale(1.1)', opacity: 1, offset: 0.4 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    { duration: 100, easing: 'ease-in' },
  );
}

function shake(row) {
  row.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-1px)', offset: 0.1 },
      { transform: 'translateX(2px)', offset: 0.2 },
      { transform: 'translateX(-4px)', offset: 0.3 },
      { transform: 'translateX(4px)', offset: 0.4 },
      { transform: 'translateX(-4px)', offset: 0.5 },
      { transform: 'translateX(4px)', offset: 0.6 },
      { transform: 'translateX(-4px)', offset: 0.7 },
      { transform: 'translateX(2px)', offset: 0.8 },
      { transform: 'translateX(-1px)', offset: 0.9 },
      { transform: 'translateX(0)' },
    ],
    { duration: 600 },
  );
}

async function flip(tile, state, delay) {
  const flipIn = tile.animate([{ transform: 'rotateX(0)' }, { transform: 'rotateX(-90deg)' }], {
    duration: FLIP_MS,
    delay,
    easing: 'ease-in',
    fill: 'forwards',
  });
  await flipIn.finished;
  tile.dataset.state = state;
  flipIn.cancel();
  await tile.animate([{ transform: 'rotateX(-90deg)' }, { transform: 'rotateX(0)' }], {
    duration: FLIP_MS,
    easing: 'ease-out',
  }).finished;
}

function bounce(row) {
  return Promise.all(
    [...row.children].map(
      (tile, i) =>
        tile.animate(
          [
            { transform: 'translateY(0)' },
            { transform: 'translateY(-30px)', offset: 0.4 },
            { transform: 'translateY(5px)', offset: 0.5 },
            { transform: 'translateY(-15px)', offset: 0.6 },
            { transform: 'translateY(2px)', offset: 0.8 },
            { transform: 'translateY(0)' },
          ],
          { duration: 1000, delay: i * 100, easing: 'ease' },
        ).finished,
    ),
  );
}

// ---------- game flow ----------

function showResult(row, animate) {
  const won = game.guesses[game.guesses.length - 1] === game.answer;
  if (won) {
    if (animate) {
      toast(winMessage(row, game.rows), 2000);
      return bounce(rowEl(row));
    }
  } else {
    toast(game.answer, Infinity);
  }
  return Promise.resolve();
}

function isOver() {
  const { status } = gameResult(game.guesses, game.answer);
  return status === 'won' || status === 'lost';
}

async function submit() {
  const row = game.guesses.length;
  const guess = game.current;
  if (guess.length < game.answer.length) {
    shake(rowEl(row));
    toast('Not enough letters');
    return;
  }
  if (!game.valid.has(guess)) {
    shake(rowEl(row));
    toast('Not in word list');
    return;
  }

  game.busy = true;
  game.guesses.push(guess);
  game.current = '';
  game.over = isOver();
  saveGuesses();

  const score = scoreGuess(guess, game.answer);
  const tiles = [...rowEl(row).children];
  await Promise.all(tiles.map((tile, i) => flip(tile, score[i], i * FLIP_STAGGER_MS)));
  renderKeyboard();

  if (game.over) await showResult(row, true);
  game.busy = false;
}

function handleKey(key) {
  if (game.busy || game.over || !game.answer || els.archive.open) return;
  if (key === 'ENTER') {
    submit();
  } else if (key === 'BACKSPACE') {
    if (!game.current) return;
    game.current = game.current.slice(0, -1);
    renderCurrentRow();
  } else if (INPUT_CHAR.test(key) && game.current.length < game.answer.length) {
    game.current += key;
    renderCurrentRow();
    pop(rowEl(game.guesses.length).children[game.current.length - 1]);
  }
}

function bindInput() {
  els.keyboard.addEventListener('click', (e) => {
    const btn = e.target.closest('.key');
    if (!btn) return;
    btn.blur();
    handleKey(btn.dataset.key);
  });

  document.addEventListener('keydown', (e) => {
    // Leave keys alone while the archive is open (Enter follows links, Escape closes it).
    if (els.archive.open) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let key = null;
    if (e.key === 'Enter') key = 'ENTER';
    else if (e.key === 'Backspace') key = 'BACKSPACE';
    else if (e.key.length === 1) key = e.key.toUpperCase();
    if (key === null || (key.length === 1 && !INPUT_CHAR.test(key))) return;
    // Stops Enter from also "clicking" a focused on-screen key.
    e.preventDefault();
    handleKey(key);
  });
}

async function init() {
  buildKeyboard();
  bindInput();
  new ResizeObserver(sizeBoard).observe(els.boardContainer);

  try {
    const res = await fetch('words.txt', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    words = parseWords(await res.text());
  } catch (err) {
    console.error(err);
    toast('Could not load the Pokémon list', Infinity);
    return;
  }

  schedule = makeSchedule(words);
  const today = dayIndex();
  game.puzzle = parsePuzzle(location.search, today, words.length);
  // Show the canonical URL, e.g. a future ?day= becomes plain today.
  const search = puzzleSearch(game.puzzle, today);
  if (location.search !== search) {
    history.replaceState(null, '', location.pathname + search + location.hash);
  }

  game.answer = answerFor(game.puzzle, schedule);
  game.rows = maxGuesses(game.answer);
  game.valid = new Set(words.filter((w) => w.length === game.answer.length));
  game.guesses = guessesFor(loadState(), game.puzzle)
    .filter((g) => game.valid.has(g))
    .slice(0, game.rows);
  game.over = isOver();

  renderHeader(today);
  bindHeader();
  buildBoard();
  game.guesses.forEach((_, r) => renderSubmittedRow(r));
  renderKeyboard();
  if (game.over) showResult(game.guesses.length - 1, false);
}

init();
