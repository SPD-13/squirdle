# squirdle

A daily Wordle-style game where the answer is a Pokémon. Static files in `public/`, served by nginx.

- The day's answer comes from `public/words.txt`, shuffled with a fixed seed. The schedule starts at day 0 = 2026-10-03, and each new day begins at 6 AM Eastern (see `public/logic.js`).
- You get name length + 1 guesses, and only Pokémon of the same length count as valid guesses.

Everything runs through Docker; nothing needs to be installed locally.

| Command      | What it does                                              |
|--------------|-----------------------------------------------------------|
| `make dev`   | Serve `public/` on http://localhost:8080 (live edits)     |
| `make test`  | Unit tests + Playwright tests (OnePlus 13R viewport)      |
| `make build` | Build the production image `squirdle`                     |
| `make run`   | Build and run the production image on port 8080           |

Editing `words.txt`, `SEED` or `EPOCH` changes the whole schedule; the pinned-schedule unit test will flag it.
