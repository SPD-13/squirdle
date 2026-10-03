// Pure game logic, shared by the page and the unit tests. No DOM access here.

// Changing either constant (or the contents of words.txt) changes the whole schedule.
export const SEED = 20261003;
// Calendar date (in Eastern time) whose 6 AM starts day index 0.
export const EPOCH = { year: 2026, month: 10, day: 3 };
export const TIME_ZONE = 'America/New_York';
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

const etFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  hourCycle: 'h23',
});

// Number of 6 AM Eastern rollovers between the epoch and `now`. Uses the
// Eastern wall clock, so the switch stays at 6 AM local time across DST.
export function dayIndex(now = new Date()) {
  const parts = {};
  for (const p of etFormatter.formatToParts(now)) parts[p.type] = Number(p.value);
  let day = Date.UTC(parts.year, parts.month - 1, parts.day);
  if (parts.hour < ROLLOVER_HOUR) day -= DAY_MS;
  const epoch = Date.UTC(EPOCH.year, EPOCH.month - 1, EPOCH.day);
  return Math.round((day - epoch) / DAY_MS);
}

export function answerForDay(shuffled, day) {
  const n = shuffled.length;
  return shuffled[((day % n) + n) % n];
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
