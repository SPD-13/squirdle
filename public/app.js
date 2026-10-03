import {
  answerForDay,
  dayIndex,
  keyStates,
  maxGuesses,
  parseWords,
  scoreGuess,
  seededShuffle,
  winMessage,
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
};

const game = {
  day: 0,
  answer: '',
  rows: 0,
  valid: new Set(),
  guesses: [],
  current: '',
  busy: false,
  over: false,
};

// ---------- storage ----------

function loadGuesses(day) {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && saved.day === day && Array.isArray(saved.guesses)) return saved.guesses;
  } catch {
    // Storage unavailable or corrupt: start fresh.
  }
  return [];
}

function saveGuesses() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ day: game.day, guesses: game.guesses }));
  } catch {
    // Ignore: progress just won't survive a reload.
  }
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
  return game.guesses.includes(game.answer) || game.guesses.length >= game.rows;
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
  if (game.busy || game.over || !game.answer) return;
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

// Reload when the puzzle rolls over at 6 AM Eastern while the page is open.
function watchForNewDay() {
  const check = () => {
    if (!game.busy && dayIndex() !== game.day) location.reload();
  };
  setInterval(check, 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}

async function init() {
  buildKeyboard();
  bindInput();
  new ResizeObserver(sizeBoard).observe(els.boardContainer);

  let words;
  try {
    const res = await fetch('words.txt', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    words = parseWords(await res.text());
  } catch (err) {
    console.error(err);
    toast('Could not load the Pokémon list', Infinity);
    return;
  }

  game.day = dayIndex();
  game.answer = answerForDay(seededShuffle(words), game.day);
  game.rows = maxGuesses(game.answer);
  game.valid = new Set(words.filter((w) => w.length === game.answer.length));
  game.guesses = loadGuesses(game.day)
    .filter((g) => game.valid.has(g))
    .slice(0, game.rows);
  game.over = isOver();

  buildBoard();
  game.guesses.forEach((_, r) => renderSubmittedRow(r));
  renderKeyboard();
  if (game.over) showResult(game.guesses.length - 1, false);
  watchForNewDay();
}

init();
