import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { answerForDay, makeSchedule, parseWords, seededShuffle } from '../../public/logic.js';

const words = parseWords(readFileSync(new URL('../../public/words.txt', import.meta.url), 'utf8'));
const shuffled = seededShuffle(words);
const answerOn = (day) => answerForDay(shuffled, day);
const randomAnswer = (index) => makeSchedule(words).random[index];
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

test('the puzzle switches at 6 AM, not midnight (Eastern)', async ({ page }) => {
  // 2026-10-05 05:59 EDT is still day 1; 06:00 EDT is day 2 (different word lengths).
  expect(answerOn(1).length).not.toBe(answerOn(2).length);
  await page.clock.setFixedTime(new Date('2026-10-05T09:59:00Z'));
  await page.goto('/');
  await expect(page.locator('.row')).toHaveCount(answerOn(1).length + 1);

  await page.clock.setFixedTime(new Date('2026-10-05T10:00:00Z'));
  await page.goto('/');
  await expect(page.locator('.row')).toHaveCount(answerOn(2).length + 1);
});

test.describe('in Tokyo', () => {
  test.use({ timezoneId: 'Asia/Tokyo' });

  test('the puzzle switches at 6 AM local time', async ({ page }) => {
    // 2026-10-05 05:59 JST is still day 1; 06:00 JST is day 2. Both are mid-afternoon
    // of Oct 4 in New York, where it would still be day 1.
    await page.clock.setFixedTime(new Date('2026-10-04T20:59:00Z'));
    await page.goto('/');
    await expect(page.locator('.row')).toHaveCount(answerOn(1).length + 1);

    await page.clock.setFixedTime(new Date('2026-10-04T21:00:00Z'));
    await page.goto('/');
    await expect(page.locator('.row')).toHaveCount(answerOn(2).length + 1);
  });
});

test('a puzzle started before 6 AM can be finished after it', async ({ page }) => {
  // Opened at 05:50 EDT on day 1; the clock then runs past the 06:00 rollover.
  await page.clock.install({ time: new Date('2026-10-05T09:50:00Z') });
  await page.goto('/');
  const answer = answerOn(1);
  await expect(page.locator('.row')).toHaveCount(answer.length + 1);

  const guess = wrongGuess(answer);
  await typeGuess(page, guess);
  await expectRowRevealed(page, 0, guess);

  await page.clock.fastForward('20:00');
  await expect(page.locator('.row')).toHaveCount(answer.length + 1);
  await expectRowRevealed(page, 0, guess);

  await typeGuess(page, answer);
  await expectRowRevealed(page, 1, answer);
  await expect(toast(page, /./)).toBeVisible();
});

// ---------- archive and random puzzles ----------

async function openUrl(page, today, url, answer) {
  await page.clock.setFixedTime(noonOfDay(today));
  await page.goto(url);
  await expect(page.locator('.row')).toHaveCount(answer.length + 1);
}

const subtitle = (page) => page.locator('#subtitle');
const archiveRows = (page) => page.locator('#archive-list .archive-day');

test('?day= opens a past puzzle', async ({ page }) => {
  const answer = answerOn(2);
  await openUrl(page, 5, '/?day=3', answer);
  await expect(subtitle(page)).toHaveText('#3 · Mon, Oct 5 · Back to today');

  await typeGuess(page, answer);
  await expectRowRevealed(page, 0, answer);
  await expect(toast(page, 'Genius')).toBeVisible();

  await page.getByRole('link', { name: 'Back to today' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.row')).toHaveCount(answerOn(5).length + 1);
  await expect(subtitle(page)).toHaveText('#6 · Thu, Oct 8');
});

test('future or malformed ?day= falls back to today', async ({ page }) => {
  for (const url of ['/?day=5', '/?day=0', '/?day=abc', '/?random=99999']) {
    await openUrl(page, 3, url, answerOn(3));
    await expect(page).toHaveURL(/\/$/);
    await expect(subtitle(page)).toHaveText('#4 · Tue, Oct 6');
  }
  await typeGuess(page, answerOn(3));
  await expect(toast(page, 'Genius')).toBeVisible();
});

test('archive lists past days with results and opens them', async ({ page }) => {
  // Day index 4 (#5, today): won in one. Index 1 (#2): one wrong guess. Others: not played.
  const today = 4;
  await openUrl(page, today, '/', answerOn(today));
  await typeGuess(page, answerOn(today));
  await expectRowRevealed(page, 0, answerOn(today));

  await openUrl(page, today, '/?day=2', answerOn(1));
  await typeGuess(page, wrongGuess(answerOn(1)));
  await expectRowRevealed(page, 0, wrongGuess(answerOn(1)));

  await page.locator('#archive-button').click();
  const dialog = page.getByRole('dialog', { name: 'Past puzzles' });
  await expect(dialog).toBeVisible();
  await expect(archiveRows(page)).toHaveCount(5);
  const rows = 'archive-result';
  const rowFor = (day) => archiveRows(page).filter({ hasText: `#${day + 1}` });
  await expect(rowFor(4)).toContainText('Today');
  await expect(rowFor(4).locator(`.${rows}`)).toHaveText(`✓ 1/${answerOn(4).length + 1}solved in 1 of ${answerOn(4).length + 1} guesses`);
  await expect(rowFor(1).locator(`.${rows}`)).toHaveAttribute('data-status', 'playing');
  await expect(rowFor(1)).toHaveAttribute('aria-current', 'page');
  await expect(rowFor(0)).toContainText('Sat, Oct 3');
  await expect(rowFor(0).locator(`.${rows}`)).toHaveAttribute('data-status', 'unplayed');
  // No answers in the list.
  for (let d = 0; d <= today; d++) await expect(dialog).not.toContainText(answerOn(d));
  await page.screenshot({ path: 'test-results/screens/archive.png' });

  // Typing while it's open doesn't reach the board; Escape closes it.
  await page.keyboard.type('ab');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(row(page, 1).locator('.tile').first()).toHaveText('');

  // Pick the first puzzle (#1).
  await page.locator('#archive-button').click();
  await rowFor(0).click();
  await expect(page).toHaveURL(/\?day=1$/);
  await expect(page.locator('.row')).toHaveCount(answerOn(0).length + 1);
  await expect(subtitle(page)).toContainText('#1 · Sat, Oct 3');

  // Today's row goes back to plain /.
  await page.locator('#archive-button').click();
  await rowFor(4).click();
  await expect(page).toHaveURL(/\/$/);
  await expectRowRevealed(page, 0, answerOn(4));
});

test('random puzzle: new one from the dice, kept on reload', async ({ page }) => {
  await openUrl(page, 0, '/', answerOn(0));
  await page.locator('#random-button').click();
  await expect(page).toHaveURL(/\?random=\d+$/);
  const index = Number(new URL(page.url()).searchParams.get('random'));
  const answer = randomAnswer(index);
  await expect(page.locator('.row')).toHaveCount(answer.length + 1);
  await expect(subtitle(page)).toHaveText('Random · Back to today');

  const guess = wrongGuess(answer);
  await typeGuess(page, guess);
  await expectRowRevealed(page, 0, guess);
  await page.reload();
  await expectRowRevealed(page, 0, guess);

  await typeGuess(page, answer);
  await expectRowRevealed(page, 1, answer);

  // Another roll is a different puzzle; the daily is untouched.
  await page.locator('#random-button').click();
  await expect(page).not.toHaveURL(new RegExp(`random=${index}$`));
  await page.goto('/');
  await expect(row(page, 0).locator('.tile').first()).toHaveAttribute('data-state', 'empty');
});

test('progress saved by the previous version is kept', async ({ page }) => {
  const answer = answerOn(2);
  const guess = wrongGuess(answer);
  await openUrl(page, 2, '/', answer);
  await page.evaluate((g) => localStorage.setItem('squirdle-state', JSON.stringify({ day: 2, guesses: [g] })), guess);
  await page.reload();
  await expectRowRevealed(page, 0, guess);

  // Playing another day no longer wipes it.
  await openUrl(page, 2, '/?day=2', answerOn(1));
  await typeGuess(page, wrongGuess(answerOn(1)));
  await expectRowRevealed(page, 0, wrongGuess(answerOn(1)));
  await page.goto('/');
  await expectRowRevealed(page, 0, guess);
});

test('a long archive scrolls in one place: the list, not the dialog or page', async ({ page }) => {
  const today = 60;
  await openUrl(page, today, '/', answerOn(today));
  await page.locator('#archive-button').click();
  await expect(archiveRows(page)).toHaveCount(today + 1);

  const sizes = await page.evaluate(() => {
    const box = (el) => ({ scroll: el.scrollHeight, client: el.clientHeight });
    return {
      dialog: box(document.getElementById('archive')),
      list: box(document.getElementById('archive-list')),
      page: box(document.documentElement),
    };
  });
  expect(sizes.list.scroll).toBeGreaterThan(sizes.list.client);
  expect(sizes.dialog.scroll).toBeLessThanOrEqual(sizes.dialog.client);
  expect(sizes.page.scroll).toBeLessThanOrEqual(sizes.page.client);

  // The last row can be scrolled into view and fits inside the dialog.
  const last = archiveRows(page).last();
  await last.scrollIntoViewIfNeeded();
  const dialogBox = await page.locator('#archive').boundingBox();
  const lastBox = await last.boundingBox();
  expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(dialogBox.y + dialogBox.height + 1);
});
