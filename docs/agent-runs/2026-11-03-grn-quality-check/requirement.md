# Requirement — Quality check flag decides GRN posting (2026-11-03)

**Asked by the owner (chat):** "rename inspection to quality check, and if an item has no quality-check flag the GRN should update stock directly."

**Core-flow position:** Store/Purchase → QC (GRN inward).

## Business words
1. The Item Master flag is called **"Quality check on receipt"** (was "Inspection on receipt").
2. Item **with** the flag: GRN line goes to Quality stock under an inspection lot; Quality's usage decision releases / blocks it (unchanged).
3. Item **without** the flag: the GRN puts the received quantity **straight into Free stock** when the GRN is recorded. No second "complete inspection" step for that line. A GRN whose lines are all such items is **Completed** the moment it is saved.
4. Store-side wording "Inspection" becomes "Quality check" (Item Master, GRN screens, Store tab). Quality module's own documents (Inspection Plans, Inspection Lots) keep their names — they are the QC department's technical records.

## Why (ERP standard)
Standard ERP: the item master decides whether incoming goods need QC. Items not needing QC post to unrestricted stock on the goods receipt itself; only QC-relevant items go to quality inspection stock. Earlier every line sat in Quality stock until a store keeper "completed inspection" — a second click that added nothing for consumables and delayed availability.

## Size
M — p2p GRN route + posting service, store item wording, GRN/Item Master screens, tours, tests. No migration (receipt_posting is a free-text column; new value "free").
