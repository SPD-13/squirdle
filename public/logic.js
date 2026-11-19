// Pure game logic, shared by the page and the unit tests. No DOM access here.

// Changing either constant (or the contents of words.txt) changes the whole schedule.
export const SEED = 20261003;
// Order of the random puzzles. Changing it (or words.txt) changes where every ?random=N link points.
export const RANDOM_SEED = 20261119;
// Calendar date whose 6 AM (in the player's own time zone) starts day index 0.
export const EPOCH = { year: 2026, month: 10, day: 3 };
export const ROLLOVER_HOUR = 6;

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseWords(text) {
  return text
    .split(/\r?\n/)
    .map((w) => w.trim().toUpperCase())
    .filter((w) => w.length > 0);
}

// mulberry32: tiny deterministic PRNG returning floats in [0, 1).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates shuffle driven by the seeded PRNG. Returns a new array.
export function seededShuffle(items, seed = SEED) {
  const out = items.slice();
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// The player's IANA time zone, e.g. "Europe/Paris".
export function localTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const formatters = new Map();
function wallClockFormatter(timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

// Number of 6 AM rollovers between the epoch and `now`, on the wall clock of
// `timeZone` (the player's own by default), so the switch stays at 6 AM local
// time across DST.
export function dayIndex(now = new Date(), timeZone = localTimeZone()) {
  const parts = {};
  for (const p of wallClockFormatter(timeZone).formatToParts(now)) parts[p.type] = Number(p.value);
  let day = Date.UTC(parts.year, parts.month - 1, parts.day);
  if (parts.hour < ROLLOVER_HOUR) day -= DAY_MS;
  const epoch = Date.UTC(EPOCH.year, EPOCH.month - 1, EPOCH.day);
  return Math.round((day - epoch) / DAY_MS);
}

export function answerForDay(shuffled, day) {
  const n = shuffled.length;
  return shuffled[((day % n) + n) % n];
}

// Midnight UTC on the calendar date of a puzzle day. Format it with timeZone 'UTC'.
export function dateForDay(day) {
  return new Date(Date.UTC(EPOCH.year, EPOCH.month - 1, EPOCH.day) + day * DAY_MS);
}

// Answer lists for both kinds of puzzle; build once, then pass to answerFor.
export function makeSchedule(words) {
  return { daily: seededShuffle(words, SEED), random: seededShuffle(words, RANDOM_SEED) };
}

export function answerFor(puzzle, schedule) {
  if (puzzle.kind === 'random') return schedule.random[puzzle.index];
  return answerForDay(schedule.daily, puzzle.day);
}

// Players see daily puzzles numbered from 1 (header, archive, ?day=); internally
// `day` is the 0-based day index used by the schedule and saved progress.
export function puzzleNumber(day) {
  return day + 1;
}

const WHOLE_NUMBER = /^\d{1,9}$/;

// The puzzle a page's query string asks for:
//   ?random=N  random puzzle N (0 <= N < wordCount)
//   ?day=N     daily puzzle number N (1 <= N <= today's number)
// Anything else, including future days, means today's daily.
export function parsePuzzle(search, today, wordCount) {
  const params = new URLSearchParams(search);
  const random = params.get('random');
  if (random !== null && WHOLE_NUMBER.test(random) && Number(random) < wordCount) {
    return { kind: 'random', index: Number(random) };
  }
  const day = params.get('day');
  const number = day !== null && WHOLE_NUMBER.test(day) ? Number(day) : 0;
  if (number >= 1 && number <= puzzleNumber(today)) {
    return { kind: 'daily', day: number - 1 };
  }
  return { kind: 'daily', day: today };
}

// The canonical query string for a puzzle ('' for today's daily).
export function puzzleSearch(puzzle, today) {
  if (puzzle.kind === 'random') return `?random=${puzzle.index}`;
  return puzzle.day === today ? '' : `?day=${puzzleNumber(puzzle.day)}`;
}

// A uniformly random index below `count`, never equal to `avoid` (when there is a choice).
export function randomIndex(count, avoid = -1, rand = Math.random) {
  if (count < 2 || avoid < 0 || avoid >= count) return Math.floor(rand() * count);
  const i = Math.floor(rand() * (count - 1));
  return i >= avoid ? i + 1 : i;
}

export function maxGuesses(answer) {
  return answer.length + 1;
}

// Wordle scoring: greens first, then yellows limited by remaining letter counts.
export function scoreGuess(guess, answer) {
  const result = new Array(guess.length).fill('absent');
  const remaining = {};
  for (let i = 0; i < answer.length; i++) {
    if (guess[i] === answer[i]) {
      result[i] = 'correct';
    } else {
      remaining[answer[i]] = (remaining[answer[i]] || 0) + 1;
    }
  }
  for (let i = 0; i < guess.length; i++) {
    if (result[i] === 'correct') continue;
    const ch = guess[i];
    if (remaining[ch] > 0) {
      result[i] = 'present';
      remaining[ch]--;
    }
  }
  return result;
}

// Where a game stands: status is 'unplayed', 'playing', 'won' or 'lost'; `used` is how
// many of the `rows` allowed guesses have been made.
export function gameResult(guesses, answer) {
  const rows = maxGuesses(answer);
  const made = guesses.slice(0, rows);
  const win = made.indexOf(answer);
  if (win >= 0) return { status: 'won', used: win + 1, rows };
  if (made.length >= rows) return { status: 'lost', used: rows, rows };
  return { status: made.length ? 'playing' : 'unplayed', used: made.length, rows };
}

// ---------- saved progress ----------
// Stored as JSON: { daily: { [day]: guesses }, random: { index, guesses } | null }.
// Only the latest random game is kept.

const isGuessList = (g) => Array.isArray(g) && g.every((w) => typeof w === 'string');

// Parses stored progress. Also accepts the original format ({ day, guesses }, which
// only held one day) and returns empty progress for anything missing or corrupt.
export function readState(raw) {
  const state = { daily: {}, random: null };
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return state;
  }
  if (!data || typeof data !== 'object') return state;
  if (Number.isInteger(data.day) && isGuessList(data.guesses)) {
    state.daily[data.day] = data.guesses;
    return state;
  }
  if (data.daily && typeof data.daily === 'object') {
    for (const [day, guesses] of Object.entries(data.daily)) {
      if (/^-?\d+$/.test(day) && isGuessList(guesses)) state.daily[day] = guesses;
    }
  }
  const r = data.random;
  if (r && Number.isInteger(r.index) && isGuessList(r.guesses)) {
    state.random = { index: r.index, guesses: r.guesses };
  }
  return state;
}

export function guessesFor(state, puzzle) {
  if (puzzle.kind === 'random') return state.random?.index === puzzle.index ? state.random.guesses : [];
  return state.daily[puzzle.day] ?? [];
}

// A copy of `state` with `guesses` recorded for `puzzle`.
export function withGuesses(state, puzzle, guesses) {
  if (puzzle.kind === 'random') return { ...state, random: { index: puzzle.index, guesses } };
  return { ...state, daily: { ...state.daily, [puzzle.day]: guesses } };
}

const RANK = { absent: 1, present: 2, correct: 3 };

// Best known state per key, given all scored guesses so far.
export function keyStates(guesses, answer) {
  const states = {};
  for (const guess of guesses) {
    const score = scoreGuess(guess, answer);
    for (let i = 0; i < guess.length; i++) {
      const prev = states[guess[i]];
      if (!prev || RANK[score[i]] > RANK[prev]) states[guess[i]] = score[i];
    }
  }
  return states;
}

const WIN_MESSAGES = ['Genius', 'Magnificent', 'Impressive', 'Splendid', 'Great', 'Phew'];

// Spreads Wordle's six win messages over however many rows this puzzle has.
export function winMessage(row, totalRows) {
  if (row >= totalRows - 1) return WIN_MESSAGES[5];
  return WIN_MESSAGES[Math.min(4, Math.floor((row * 5) / (totalRows - 1)))];
}
