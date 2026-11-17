# Final report: R&D Experiments & Tests and Prototypes removed (2026-11-17)

## Outcome
Both features are removed from the web, mobile, API and database. The Prototype / Research project type, prototype-type R&D tasks, R&D Documents and the R&D calculators are unchanged.

## Decisions
- Tables are dropped (the owner chose this). Migration `b7e2d4f6a8c1` removes `rnd_experiments`, `rnd_prototypes`, `rnd_prototype_bom_items` and `rnd_documents.experiment_id/prototype_id`. Production BOMs released from a prototype stay.
- The old "R&D › Prototypes › BOM costs" switch becomes "R&D › Prototype / Research › Budget & costs" (`rnd:projects.costs`).
  - It inherits Prototype / Research View, so an uncustomised projects tab now shows the project budget card.
  - Editors always see the budget card.
  - The migration adds the grant explicitly only for customised projects tabs that saw the old costs. This avoids cutting inherited Project tasks / team features.
- Removed event `rnd.prototype_released`. It is stripped from role subscriptions and from personal overrides.
- Project delete is now blocked only by attachments/documents.

## Checks
- `pytest -k rnd`: 265 passed, 28 xfailed.
- The targeted R&D test files pass, plus the new `test_rnd_experiments_prototypes_removed.py` (17 tests).
- `ruff F821 py312`: clean.
- `import app.main`: OK.
- `npx tsc --noEmit`: clean in `src`. The only errors are in the stale `.next` types, which need a `.next` clear.
- `npm run test:ui`: 0 errors.
- Migration dry run on the local DB inside a transaction, then rolled back:
  - tables and columns dropped
  - 0 roles still hold removed grants
  - a second run is a no-op
- Reviewer: High 1 (alembic chain) is still open; see Risks. Mediums 2 and 4 and the Lows are fixed. Medium 3 (budget visibility) was decided as described above.

## Not done / risks
- Alembic chain fixed on 2026-11-17 at the owner's request.
  - The chain is now `d3f8b2e6a9c1` → `e4b9d2f7a1c3` (store) → `c5a8e2f4b6d9` (finance) → `b7e2d4f6a8c1`, with one head.
  - The finance migration (another session's) was renamed from the duplicate `f1a7c3e9b2d4` to `c5a8e2f4b6d9`.
  - The local DB is upgraded to `b7e2d4f6a8c1`, and 2 role/user rows were rewritten.
  - The store and finance migrations must be pushed together with this one, or before it.
- No live browser check was done (not seen live).
- The Dart code was not compiled; the mobile edits are string and map-line only.
- Release status: not committed, not pushed.
