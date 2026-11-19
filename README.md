# squirdle

A daily Wordle-style game where the answer is a Pokémon. Static files in `public/`, served by nginx.

- The day's answer comes from `public/words.txt`, shuffled with a fixed seed. The schedule starts with puzzle #1 on 2026-10-03, and each new day begins at 6 AM in the player's own time zone (see `public/logic.js`), so players in different zones switch puzzles at different moments.
- You get name length + 1 guesses, and only Pokémon of the same length count as valid guesses.
- The URL picks the puzzle: `/` is today's, `/?day=N` is past puzzle #N, counting from #1 on 2026-10-03 (the calendar button lists them), and `/?random=N` is random puzzle N (the dice button picks one). Random puzzles use their own shuffle (`RANDOM_SEED`). Future or malformed values fall back to today.
- Progress is saved in `localStorage` per daily puzzle, plus the latest random game.

Everything runs through Docker; nothing needs to be installed locally.

| Command      | What it does                                              |
|--------------|-----------------------------------------------------------|
| `make dev`   | Serve `public/` on http://localhost (live edits)          |
| `make test`  | Unit tests + Playwright tests (OnePlus 13R viewport)      |
| `make build` | Build the production image `squirdle`                     |
| `make run`   | Build and run the production image on http://localhost    |

`make dev` and `make run` listen on port 80 on all interfaces, so you can open the site from a phone at `http://<this machine's LAN IP>`. Use another port with `make run PORT=8080`.

Editing `words.txt`, `SEED` or `EPOCH` changes the whole schedule; the pinned-schedule unit test will flag it.
