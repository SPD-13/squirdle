import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  answerForDay,
  dayIndex,
  keyStates,
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

test('day index switches at 6 AM Eastern', () => {
  // EDT (UTC-4)
  assert.equal(dayIndex(new Date('2026-10-03T09:59:59Z')), -1); // 05:59:59 EDT
  assert.equal(dayIndex(new Date('2026-10-03T10:00:00Z')), 0); // 06:00 EDT
  assert.equal(dayIndex(new Date('2026-10-04T03:59:59Z')), 0); // 23:59 EDT
  assert.equal(dayIndex(new Date('2026-10-04T05:00:00Z')), 0); // 01:00 EDT next day
  assert.equal(dayIndex(new Date('2026-10-05T10:00:00Z')), 2);
});

test('day index follows DST transitions', () => {
  // DST ends 2026-11-01: 6 AM is now EST (UTC-5) = 11:00Z
  assert.equal(dayIndex(new Date('2026-11-01T10:59:59Z')), 28);
  assert.equal(dayIndex(new Date('2026-11-01T11:00:00Z')), 29);
  // DST starts 2027-03-14: 6 AM EDT = 10:00Z
  assert.equal(dayIndex(new Date('2027-03-14T09:59:59Z')), 161);
  assert.equal(dayIndex(new Date('2027-03-14T10:00:00Z')), 162);
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
