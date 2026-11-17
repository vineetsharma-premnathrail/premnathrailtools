# Requirement: Typing assist (2026-11-17)

Size: L (frontend shared components + several backend modules).

## In business words
Users type item, vendor, customer and machine names and free-text remarks on Windows desktop browsers. They make typos, which leads to failed searches and duplicate master records.
The owner approved all four parts:

1. **Typo-tolerant search** on Item, Vendor, Customer (CRM organization) and Machine lists. For example, "bearng" finds "Bearing".
2. **"Similar record already exists" warning** while creating an Item or a Vendor. It only suggests; the user decides. It never auto-merges or auto-matches.
3. **Autocomplete from our own data** for free-text fields, based on earlier values.
4. **Phone-keyboard-like word suggestion and autocorrect** in portal text inputs and textareas on desktop. Vocabulary comes from ERP data, not from an outside service.

## Core-flow position
Cross-cutting: Store/Purchase (Item, Vendor), Customer (CRM), Machine/Service, plus every form.

## Decisions taken by the Manager
- No AI/LLM and no data sent outside. Pure algorithms: trigram/edit-distance plus word frequency.
- No new migration. The alembic chain currently has 2 heads plus a duplicate revision from other sessions, so fuzzy matching runs in Python (or with plain SQL candidates) without a pg_trgm migration. A pg_trgm index can come later once the chain is clean.
- Fuzzy logic only suggests. It never auto-corrects stored master data, and it never matches lines by name (rule 19 stays).
- Autocorrect in text boxes is a suggestion chip that the user accepts with Tab or a click. The text the user typed is never silently replaced.
- A user setting can switch typing suggestions off.
- Windows' built-in text suggestions setting was told to the owner as a free complement.
