import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  answerFor,
  answerForDay,
  dateForDay,
  dayIndex,
  gameResult,
  guessesFor,
  makeSchedule,
  parsePuzzle,
  puzzleNumber,
  puzzleSearch,
  randomIndex,
  readState,
  withGuesses,
  keyStates,
  localTimeZone,
  maxGuesses,
  mulberry32,
  parseWords,
  scoreGuess,
  seededShuffle,
  winMessage,
} from '../../public/logic.js';

const words = parseWords(readFileSync(new URL('../../public/words.txt', import.meta.url), 'utf8'));

test('word list is clean', () => {
  assert.equal(words.length, 1025);
  assert.equal(new Set(words).size, words.length);
  for (const w of words) assert.match(w, /^[A-Z2]+$/, w);
});

test('parseWords trims, uppercases and drops blank lines', () => {
  assert.deepEqual(parseWords('pikachu\r\n  MEW \n\n'), ['PIKACHU', 'MEW']);
});

test('mulberry32 is deterministic', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});

test('seededShuffle is a stable permutation', () => {
  const s1 = seededShuffle(words);
  const s2 = seededShuffle(words);
  assert.deepEqual(s1, s2);
  assert.deepEqual([...s1].sort(), [...words].sort());
  assert.notDeepEqual(s1, words);
  assert.equal(words[0], 'BULBASAUR', 'input array must not be mutated');
});

const ET = 'America/New_York';

test('day index switches at 6 AM in the given time zone (Eastern)', () => {
  // EDT (UTC-4)
  assert.equal(dayIndex(new Date('2026-10-03T09:59:59Z'), ET), -1); // 05:59:59 EDT
  assert.equal(dayIndex(new Date('2026-10-03T10:00:00Z'), ET), 0); // 06:00 EDT
  assert.equal(dayIndex(new Date('2026-10-04T03:59:59Z'), ET), 0); // 23:59 EDT
  assert.equal(dayIndex(new Date('2026-10-04T05:00:00Z'), ET), 0); // 01:00 EDT next day
  assert.equal(dayIndex(new Date('2026-10-05T10:00:00Z'), ET), 2);
});

test('day index follows DST transitions', () => {
  // DST ends 2026-11-01: 6 AM is now EST (UTC-5) = 11:00Z
  assert.equal(dayIndex(new Date('2026-11-01T10:59:59Z'), ET), 28);
  assert.equal(dayIndex(new Date('2026-11-01T11:00:00Z'), ET), 29);
  // DST starts 2027-03-14: 6 AM EDT = 10:00Z
  assert.equal(dayIndex(new Date('2027-03-14T09:59:59Z'), ET), 161);
  assert.equal(dayIndex(new Date('2027-03-14T10:00:00Z'), ET), 162);
});

test('day index rolls over at 6 AM local time in other zones', () => {
  // Tokyo (UTC+9, no DST): 6 AM on 2026-10-03 is 2026-10-02T21:00Z.
  assert.equal(dayIndex(new Date('2026-10-02T20:59:59Z'), 'Asia/Tokyo'), -1);
  assert.equal(dayIndex(new Date('2026-10-02T21:00:00Z'), 'Asia/Tokyo'), 0);
  // Los Angeles (UTC-7 in October): 6 AM is 13:00Z.
  assert.equal(dayIndex(new Date('2026-10-03T12:59:59Z'), 'America/Los_Angeles'), -1);
  assert.equal(dayIndex(new Date('2026-10-03T13:00:00Z'), 'America/Los_Angeles'), 0);
  // At the same instant, players in different zones can be on different days.
  const instant = new Date('2026-10-10T00:00:00Z'); // Oct 10 09:00 Tokyo, Oct 9 17:00 LA
  assert.equal(dayIndex(instant, 'Asia/Tokyo'), 7);
  assert.equal(dayIndex(instant, 'America/Los_Angeles'), 6);
});

test('day index defaults to the local time zone', () => {
  const now = new Date('2026-11-19T12:00:00Z');
  assert.equal(dayIndex(now), dayIndex(now, localTimeZone()));
});

test('dateForDay is the calendar date of a puzzle day', () => {
  const iso = (day) => dateForDay(day).toISOString().slice(0, 10);
  assert.equal(iso(0), '2026-10-03');
  assert.equal(iso(12), '2026-10-15');
  assert.equal(iso(29), '2026-11-01'); // DST change day doesn't shift anything
  assert.equal(iso(47), '2026-11-19');
  assert.equal(iso(90), '2027-01-01');
});

test('dateForDay matches the local date after 6 AM, in any zone', () => {
  const localDate = (now, timeZone) =>
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  for (const timeZone of [ET, 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Auckland']) {
    for (let h = 0; h < 24 * 40; h += 7) {
      const now = new Date(Date.UTC(2026, 9, 20, h));
      const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now));
      if (hour < 6) continue;
      const day = dayIndex(now, timeZone);
      assert.equal(dateForDay(day).toISOString().slice(0, 10), localDate(now, timeZone), `${timeZone} ${now.toISOString()}`);
    }
  }
});

test('parsePuzzle reads ?day= and ?random=', () => {
  const today = 47;
  const n = 1025;
  const today47 = { kind: 'daily', day: 47 };
  assert.deepEqual(parsePuzzle('', today, n), today47);
  // ?day= is the 1-based puzzle number: #1 is day index 0, #48 is today (index 47).
  assert.deepEqual(parsePuzzle('?day=13', today, n), { kind: 'daily', day: 12 });
  assert.deepEqual(parsePuzzle('?day=1', today, n), { kind: 'daily', day: 0 });
  assert.deepEqual(parsePuzzle('?day=48', today, n), today47);
  assert.deepEqual(parsePuzzle('?random=0', today, n), { kind: 'random', index: 0 });
  assert.deepEqual(parsePuzzle('?random=1024', today, n), { kind: 'random', index: 1024 });
  // random wins if both are given
  assert.deepEqual(parsePuzzle('?day=3&random=5', today, n), { kind: 'random', index: 5 });
});

test('parsePuzzle falls back to today for future, negative or malformed values', () => {
  const today47 = { kind: 'daily', day: 47 };
  for (const search of ['?day=49', '?day=0', '?day=-1', '?day=abc', '?day=', '?day=1.5', '?day=1e3', '?day=+3', '?day= 3',
    '?random=1025', '?random=-1', '?random=x', '?random=', '?other=1']) {
    assert.deepEqual(parsePuzzle(search, 47, 1025), today47, search);
  }
});

test('puzzles are numbered from 1', () => {
  assert.equal(puzzleNumber(0), 1);
  assert.equal(puzzleNumber(47), 48);
});

test('puzzleSearch is the canonical URL and round-trips', () => {
  assert.equal(puzzleSearch({ kind: 'daily', day: 47 }, 47), '');
  assert.equal(puzzleSearch({ kind: 'daily', day: 12 }, 47), '?day=13');
  assert.equal(puzzleSearch({ kind: 'random', index: 437 }, 47), '?random=437');
  for (const p of [{ kind: 'daily', day: 0 }, { kind: 'daily', day: 47 }, { kind: 'random', index: 9 }]) {
    assert.deepEqual(parsePuzzle(puzzleSearch(p, 47), 47, 1025), p);
  }
});

test('random puzzles use their own order, separate from the daily schedule', () => {
  const schedule = makeSchedule(words);
  assert.deepEqual([...schedule.random].sort(), [...words].sort());
  assert.notDeepEqual(schedule.random, schedule.daily);
  assert.notDeepEqual(schedule.random, words, 'must not be Pokédex order');
  assert.equal(answerFor({ kind: 'daily', day: 5 }, schedule), answerForDay(schedule.daily, 5));
  assert.equal(answerFor({ kind: 'random', index: 5 }, schedule), schedule.random[5]);
});

test('randomIndex stays in range and avoids the current puzzle', () => {
  assert.equal(randomIndex(10, -1, () => 0), 0);
  assert.equal(randomIndex(10, -1, () => 0.999), 9);
  assert.equal(randomIndex(10, 0, () => 0), 1);
  assert.equal(randomIndex(10, 9, () => 0.999), 8);
  assert.equal(randomIndex(10, 4, () => 0.4), 3); // floor(0.4 * 9) = 3, below the skipped 4
  assert.equal(randomIndex(10, 4, () => 0.45), 5); // floor(0.45 * 9) = 4, shifted past it
  const seen = new Set();
  const rand = (() => { let i = 0; return () => (i++ % 100) / 100; })();
  for (let i = 0; i < 100; i++) {
    const r = randomIndex(10, 3, rand);
    assert.ok(r >= 0 && r < 10 && r !== 3);
    seen.add(r);
  }
  assert.equal(seen.size, 9);
});

test('gameResult reports where a game stands', () => {
  // PIKACHU: 8 rows
  assert.deepEqual(gameResult([], 'PIKACHU'), { status: 'unplayed', used: 0, rows: 8 });
  assert.deepEqual(gameResult(['RAICHU2'], 'PIKACHU'), { status: 'playing', used: 1, rows: 8 });
  assert.deepEqual(gameResult(['RAICHU2', 'PIKACHU'], 'PIKACHU'), { status: 'won', used: 2, rows: 8 });
  assert.deepEqual(gameResult(Array(8).fill('RAICHU2'), 'PIKACHU'), { status: 'lost', used: 8, rows: 8 });
  assert.deepEqual(gameResult([...Array(7).fill('RAICHU2'), 'PIKACHU'], 'PIKACHU'), { status: 'won', used: 8, rows: 8 });
});

test('readState migrates the original one-day format', () => {
  const old = JSON.stringify({ day: 46, guesses: ['PIKACHU'] });
  assert.deepEqual(readState(old), { daily: { 46: ['PIKACHU'] }, random: null });
});

test('readState returns empty progress for missing or corrupt data', () => {
  const empty = { daily: {}, random: null };
  for (const raw of [null, '', 'not json', '42', '"x"', '[]', '{}', '{"day":"3","guesses":[]}', '{"daily":5}']) {
    assert.deepEqual(readState(raw), empty, String(raw));
  }
  const mixed = JSON.stringify({ daily: { 1: ['MEW'], x: ['MEW'], 2: 'MEW', 3: [1] }, random: { index: '4', guesses: [] } });
  assert.deepEqual(readState(mixed), { daily: { 1: ['MEW'] }, random: null });
});

test('saved progress is kept per day, plus one random game', () => {
  let state = readState(null);
  state = withGuesses(state, { kind: 'daily', day: 3 }, ['MEW']);
  state = withGuesses(state, { kind: 'daily', day: 4 }, ['ABRA']);
  state = withGuesses(state, { kind: 'random', index: 9 }, ['ONIX']);
  state = readState(JSON.stringify(state));
  assert.deepEqual(guessesFor(state, { kind: 'daily', day: 3 }), ['MEW']);
  assert.deepEqual(guessesFor(state, { kind: 'daily', day: 4 }), ['ABRA']);
  assert.deepEqual(guessesFor(state, { kind: 'daily', day: 5 }), []);
  assert.deepEqual(guessesFor(state, { kind: 'random', index: 9 }), ['ONIX']);
  assert.deepEqual(guessesFor(state, { kind: 'random', index: 8 }), []);

  state = withGuesses(state, { kind: 'random', index: 8 }, ['MEW']);
  assert.deepEqual(guessesFor(state, { kind: 'random', index: 9 }), [], 'only the latest random game is kept');
  assert.deepEqual(guessesFor(state, { kind: 'daily', day: 3 }), ['MEW']);
});

test('answerForDay wraps in both directions', () => {
  const list = ['A', 'B', 'C'];
  assert.equal(answerForDay(list, 0), 'A');
  assert.equal(answerForDay(list, 4), 'B');
  assert.equal(answerForDay(list, -1), 'C');
});

test('schedule is pinned (changes to seed, epoch or words.txt break this)', () => {
  const shuffled = seededShuffle(words);
  const firstWeek = [0, 1, 2, 3, 4, 5, 6].map((d) => answerForDay(shuffled, d));
  assert.deepEqual(firstWeek, PINNED_FIRST_WEEK);
});

test('max guesses is length + 1', () => {
  assert.equal(maxGuesses('PIKACHU'), 8);
  assert.equal(maxGuesses('MEW'), 4);
});

test('scoreGuess basic', () => {
  assert.deepEqual(scoreGuess('PICHU', 'PUCHI'), ['correct', 'present', 'correct', 'correct', 'present']);
  assert.deepEqual(scoreGuess('ZZZZZ', 'PUCHI'), ['absent', 'absent', 'absent', 'absent', 'absent']);
});

test('scoreGuess handles repeated letters like Wordle', () => {
  // Answer has one E: the first E is yellow, the second is gray.
  assert.deepEqual(scoreGuess('SPEED', 'ABIDE'), ['absent', 'absent', 'present', 'absent', 'present']);
  // A green copy uses up the letter before any yellow is handed out.
  assert.deepEqual(scoreGuess('EEVEE', 'ABCDE'), ['absent', 'absent', 'absent', 'absent', 'correct']);
  assert.deepEqual(scoreGuess('EEVEE', 'EXXXX'), ['correct', 'absent', 'absent', 'absent', 'absent']);
  assert.deepEqual(scoreGuess('EEVEE', 'XEXEX'), ['absent', 'correct', 'absent', 'correct', 'absent']);
  assert.deepEqual(scoreGuess('EEVEE', 'EXEXX'), ['correct', 'present', 'absent', 'absent', 'absent']);
  assert.deepEqual(scoreGuess('PORYGON2', 'PORYGONZ'), [
    'correct', 'correct', 'correct', 'correct', 'correct', 'correct', 'correct', 'absent',
  ]);
});

test('keyStates keeps the best state per letter', () => {
  const states = keyStates(['ABCDE', 'BAXYZ'], 'BAQQQ');
  assert.equal(states.A, 'correct');
  assert.equal(states.B, 'correct');
  assert.equal(states.C, 'absent');
  assert.equal(states.X, 'absent');
});

test('win messages match Wordle for 6 rows and always end with Phew', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((r) => winMessage(r, 6)),
    ['Genius', 'Magnificent', 'Impressive', 'Splendid', 'Great', 'Phew'],
  );
  assert.equal(winMessage(0, 13), 'Genius');
  assert.equal(winMessage(12, 13), 'Phew');
  assert.equal(winMessage(3, 4), 'Phew');
});

// Spoilers! Regenerate deliberately if the schedule is meant to change.
const PINNED_FIRST_WEEK = ['CLEFFA', 'QUAXLY', 'DUOSION', 'CRESSELIA', 'LYCANROC', 'DUBWOOL', 'DOUBLADE'];
