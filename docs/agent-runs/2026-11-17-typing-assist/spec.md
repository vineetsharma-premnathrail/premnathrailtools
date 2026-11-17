# Spec: Typing assist

## Constraint that shaped the design
The list endpoints and pages were already modified by other sessions, so they are protected: store/routes/items.py, p2p/routes/vendors.py, crm/routes/organizations.py, erp/routes/projects.py, lib/api.ts, main.py, store/page.tsx, p2p/vendors/page.tsx, crm/organizations/page.tsx and erp/page.tsx.
The feature therefore lives in NEW files. The only shared touches are one `include_router` line in main.py (made by the Manager) and the mount in `dashboard/layout.tsx`.
There is no migration. The alembic chain has 2 heads that belong to another session.

## Backend: new module `backend/app/modules/typing_assist/`
Mounted at prefix `/api/v1`, router prefix `/typing-assist`.

### GET /typing-assist/vocabulary
Response:
```json
{ "words": [["bearing", 120], ["hydraulic", 88]], "bigrams": [["hydraulic", "pump", 14]], "sources": ["store_items", "vendors"] }
```
- Words are lower-case tokens of 2 to 30 letters and digits, with frequency. Top 20,000 by frequency.
- Bigrams are consecutive word pairs. Top 20,000.
- Sources are read only for modules the user can VIEW (same permission check as that module's list route):
  - store item names, descriptions, make and specification
  - vendor names
  - CRM organization names
  - machine model names and client names
  - products (product master names)
- Text only. No ids, no prices, no personal data such as emails, phones, PAN or GSTIN.
- Cached in memory for 10 minutes per (sources set). Any logged-in user may call it; an empty source set returns empty lists.

### GET /typing-assist/similar?kind=item|vendor|organization|machine&q=&limit=5
Response:
```json
{ "kind": "item", "query": "hydrolic pump", "matches": [{ "id": 12, "code": "0142", "name": "Hydraulic Pump", "score": 0.91 }] }
```
- The same permission AND data-scope filter as the module's list endpoint. If the user lacks view permission: 403 with a real message, e.g. "You don't have permission to view Store items. Ask your admin for Store › Items view access."
- `q` must be at least 3 characters, otherwise return empty matches. `limit` is at most 10.
- Score: the best of
  - difflib ratio on normalised keys (lower case, collapsed spaces, noise words removed for vendor/org: pvt, ltd, limited, llp, co, the, m/s), and
  - a token-sort ratio, and
  - a substring/prefix bonus.
  Threshold 0.6. Sorted by score desc, then code asc.
- Machines: name = model_name + serial_number; code = serial_number.
- Only the needed columns are loaded (id, code, name), never full ORM rows. Keep it under 150 ms for about 10k rows.
- Reuse `name_key` / `_NOISE` ideas from p2p/routes/vendor_duplicates.py by importing them, not by copying.

## Frontend
### 1. Global `TypingAssist` (mounted once in dashboard/layout.tsx)
- It listens at document level (focusin, input, keydown) on `input[type=text|search|'']` and `textarea`. It skips:
  - password, email, number, date, tel and url inputs
  - inputs with `readOnly`
  - inputs with `autocomplete="off"` that have `data-assist` unset? No: it skips only when `data-no-assist` is present on the element or an ancestor
  - contentEditable
  - R&D calculator routes (/dashboard/rnd/...)
- It shows a small suggestion strip with up to 3 chips. The strip is rendered by createPortal to body and anchored under the focused field. It never covers the field.
- **Word completion:** the current partial word (2+ characters) gives prefix matches from the vocabulary plus personal words, ranked by frequency.
- **Next word:** after a space, bigram followers of the previous word are offered.
- **Spelling:** when the user finishes a word (types a space or punctuation) and the word is not known, it offers the closest known word (edit distance ≤ 2, length ≥ 4) as a chip "bearng → bearing".
  - Default: suggestion only.
  - User option "Autocorrect as I type": the word is replaced at once, and Backspace right after restores the original (like phone keyboards).
- **Accepting:** a click on a chip, or Tab accepts the first chip ONLY while the strip shows a suggestion for the current word. Otherwise Tab behaves normally. Alt+1/2/3 picks a chip. Esc hides the strip until the next word.
- **Setting value:** use the native value setter plus `input` event dispatch so that React-controlled inputs update. Keep the caret position.
- **Personal learning:** words the user types that are not in the vocabulary, after they are used 2 times, plus the user's own bigrams. Stored in localStorage per user id (try/catch). Max 5,000 entries.
- **Field history (part 3):**
  - On blur with a non-empty value, remember the value under the key `pathname-pattern + field name|id|placeholder` (localStorage, last 20 per field).
  - On focus of an empty field, show recent values as chips.
  - Never remember password-like or numeric-only values, or values longer than 200 characters.
- **Search boxes (part 1):** for an input that is type=search, or whose placeholder starts with "Search", on these pages:
  - /dashboard/store → item
  - /dashboard/p2p/vendors → vendor
  - /dashboard/crm/organizations → organization
  - /dashboard/erp → machine
  After 400 ms debounce with 3+ characters, call /typing-assist/similar and show "Did you mean: <name>" chips. Clicking one puts that name into the search box. Hide them when there is an exact (score 1) match.
- **Off switch:** a small "⚙" in the strip opens a mini menu: "Word suggestions on/off", "Autocorrect as I type on/off", "Clear what I've typed". It is stored per user in localStorage.
- Vocabulary is fetched once per session, lazily on first focus.
- Accessibility: the strip has `role="listbox"` + `aria-live="polite"`, the chips are buttons, and it never steals focus. Z-index comes from shared `Z`.

### 2. `SimilarRecordsHint` (part 2)
`<SimilarRecordsHint kind="item"|"vendor" name={value} excludeId? />`
- Debounced 400 ms.
- Shows an amber box under the name field: "Similar already exists: 0142 · Hydraulic Pump (91%)". Each line opens the record in a new tab via its signed record link.
- It does not block saving. It is placed in store/new/page.tsx (item create) and components/p2p/VendorFormDialog.tsx (create mode).

### API client
New file `frontend/src/lib/typingAssistApi.ts`, using `apiClient` from lib/api.ts. Do NOT edit lib/api.ts.

## Acceptance
1. In any portal textarea, typing "hydr" shows "hydraulic" as a chip, and Tab inserts it.
2. Typing "bearng " shows "bearng → bearing". The text is not changed unless the user accepts it or turns autocorrect on.
3. With autocorrect on, "bearng " becomes "bearing ", and Backspace right after brings back "bearng".
4. Searching "bearng" on the Store page shows "Did you mean: Bearing …"; a click fills the search box.
5. Creating an item named "Hydrolic Pump" while "Hydraulic Pump" exists shows the similar-exists box. Saving still works.
6. A user without Store view gets no item words and 403 on similar?kind=item.
7. Password, number and date fields never show the strip. R&D calculator pages never show it.
8. Turning suggestions off hides the strip on every page.
