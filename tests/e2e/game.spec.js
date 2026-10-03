import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { answerForDay, parseWords, seededShuffle } from '../../public/logic.js';

const words = parseWords(readFileSync(new URL('../../public/words.txt', import.meta.url), 'utf8'));
const shuffled = seededShuffle(words);
const answerOn = (day) => answerForDay(shuffled, day);
const firstDayWithLength = (len) => {
  for (let d = 0; d < shuffled.length; d++) if (answerOn(d).length === len) return d;
  throw new Error(`no answer of length ${len}`);
};
const wrongGuess = (answer) => words.find((w) => w.length === answer.length && w !== answer);

// Noon Eastern on the given puzzle day (well clear of the 6 AM rollover).
const noonOfDay = (day) => new Date(Date.UTC(2026, 9, 3, 16) + day * 86_400_000);

async function openDay(page, day) {
  await page.clock.setFixedTime(noonOfDay(day));
  await page.goto('/');
  const answer = answerOn(day);
  await expect(page.locator('.row')).toHaveCount(answer.length + 1);
  return answer;
}

async function typeGuess(page, word) {
  await page.keyboard.type(word.toLowerCase());
  await page.keyboard.press('Enter');
}

const row = (page, r) => page.locator('.row').nth(r);
const toast = (page, text) => page.locator('.toast', { hasText: text });

async function expectRowRevealed(page, r, guess) {
  const tiles = row(page, r).locator('.tile');
  await expect(tiles).toHaveText(guess.split(''));
  for (let i = 0; i < guess.length; i++) {
    await expect(tiles.nth(i)).toHaveAttribute('data-state', /^(correct|present|absent)$/);
  }
  // Input is locked until the flip animations end, as in Wordle.
  await row(page, r).evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
}

test.describe('layout on a OnePlus 13R', () => {
  for (const len of [3, 6, 12]) {
    test(`board and keyboard fit for a ${len}-letter day`, async ({ page }) => {
      const day = firstDayWithLength(len);
      const answer = await openDay(page, day);
      await typeGuess(page, wrongGuess(answer));
      await expectRowRevealed(page, 0, wrongGuess(answer));

      const viewport = page.viewportSize();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(viewport.width);

      const board = await page.locator('#board').boundingBox();
      const keyboard = await page.locator('#keyboard').boundingBox();
      expect(board.x).toBeGreaterThanOrEqual(0);
      expect(board.x + board.width).toBeLessThanOrEqual(viewport.width);
      expect(board.y + board.height).toBeLessThanOrEqual(keyboard.y);
      expect(keyboard.y + keyboard.height).toBeLessThanOrEqual(viewport.height);

      const tile = await page.locator('.tile').first().boundingBox();
      expect(tile.width).toBeGreaterThanOrEqual(26);
      expect(Math.abs(tile.width - tile.height)).toBeLessThan(1);

      await page.screenshot({ path: `test-results/screens/${len}-letters.png` });
    });
  }
});

test('rejects short guesses and unknown words', async ({ page }) => {
  const answer = await openDay(page, 0);

  await typeGuess(page, answer.slice(0, -1));
  await expect(toast(page, 'Not enough letters')).toBeVisible();

  for (let i = 0; i < answer.length; i++) await page.keyboard.press('Backspace');
  await expect(row(page, 0).locator('.tile').first()).toHaveText('');
  await typeGuess(page, 'Q'.repeat(answer.length));
  await expect(toast(page, 'Not in word list')).toBeVisible();
  await expect(row(page, 0).locator('.tile').first()).toHaveAttribute('data-state', 'tbd');
});

test('typing past the word length is ignored', async ({ page }) => {
  const answer = await openDay(page, 0);
  await page.keyboard.type('a'.repeat(answer.length + 3));
  await expect(row(page, 0).locator('.tile')).toHaveText(Array(answer.length).fill('A'));
  await expect(row(page, 1).locator('.tile').first()).toHaveText('');
});

test('win using the on-screen keyboard', async ({ page }) => {
  const answer = await openDay(page, 0);
  for (const ch of answer) await page.locator(`.key[data-key="${ch}"]`).tap();
  await page.locator('.key[data-key="ENTER"]').tap();

  const tiles = row(page, 0).locator('.tile');
  for (let i = 0; i < answer.length; i++) await expect(tiles.nth(i)).toHaveAttribute('data-state', 'correct');
  await expect(toast(page, 'Genius')).toBeVisible();
  await expect(page.locator(`.key[data-key="${answer[0]}"]`)).toHaveAttribute('data-state', 'correct');

  // Game over: further input is ignored.
  await page.keyboard.type('abc');
  await expect(row(page, 1).locator('.tile').first()).toHaveText('');
});

test('the 2 key works (PORYGON2)', async ({ page }) => {
  const day = firstDayWithLength(8);
  const answer = await openDay(page, day);
  test.skip(answer === 'PORYGON2', 'answer itself');
  for (const ch of 'PORYGON2') await page.locator(`.key[data-key="${ch}"]`).tap();
  await page.locator('.key[data-key="ENTER"]').tap();
  await expectRowRevealed(page, 0, 'PORYGON2');
  await expect(page.locator('.key[data-key="2"]')).toHaveAttribute('data-state', /./);
});

test('loss reveals the answer, and it survives a reload', async ({ page }) => {
  const day = firstDayWithLength(3);
  const answer = await openDay(page, day);
  const guess = wrongGuess(answer);
  for (let r = 0; r < answer.length + 1; r++) {
    await typeGuess(page, guess);
    await expectRowRevealed(page, r, guess);
  }
  await expect(toast(page, answer)).toBeVisible();

  await page.reload();
  await expect(toast(page, answer)).toBeVisible();
  await expectRowRevealed(page, answer.length, guess);
});

test('progress is kept on reload and reset on the next day', async ({ page }) => {
  const answer = await openDay(page, 0);
  const guess = wrongGuess(answer);
  await typeGuess(page, guess);
  await expectRowRevealed(page, 0, guess);

  await page.reload();
  await expectRowRevealed(page, 0, guess);

  const nextAnswer = await openDay(page, 1);
  await expect(page.locator('.tile').first()).toHaveAttribute('data-state', 'empty');
  await expect(page.locator('.row').first().locator('.tile')).toHaveCount(nextAnswer.length);
});

test('the puzzle switches at 6 AM Eastern, not midnight', async ({ page }) => {
  // 2026-10-05 05:59 EDT is still day 1; 06:00 EDT is day 2 (different word lengths).
  expect(answerOn(1).length).not.toBe(answerOn(2).length);
  await page.clock.setFixedTime(new Date('2026-10-05T09:59:00Z'));
  await page.goto('/');
  await expect(page.locator('.row')).toHaveCount(answerOn(1).length + 1);

  await page.clock.setFixedTime(new Date('2026-10-05T10:00:00Z'));
  await page.goto('/');
  await expect(page.locator('.row')).toHaveCount(answerOn(2).length + 1);
});
