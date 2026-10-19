import { TourConfig } from '../types'

// Covers the inline add/edit form of whichever Library tab is open. Only the
// open form's steps are found on screen; the others are skipped.
const config: TourConfig = {
  id: 'design-library-form',
  pageTitle: 'Design Library — Add / Edit',
  steps: [
    {
      target: 'design-lib-std-form',
      title: 'Standard',
      purpose: 'Fill in: Body (RDSO, IS, EN, ISO, IEC, UIC, DIN, ASME, Customer, Internal, Other); Code (required, e.g. IS 2062); Version / year (e.g. 2011); Title (required); tick "Current edition" if this is the edition in force; Remarks (e.g. superseded by 2023 edition for new projects).',
      why: 'Code + version identify exactly which edition a drawing was designed to.',
    },
    {
      target: 'design-lib-std-save-btn',
      title: 'Save Standard',
      after: 'The standard appears in the list. Attach its PDF with "Upload file" on its row.',
    },
    {
      target: 'design-lib-part-form',
      title: 'Standard part',
      purpose: 'Item (Item Master) — required, search by code or name; Discipline; Drawing (optional); Standard it conforms to (optional); Notes on when to use it (e.g. use for all M12 structural joints).',
    },
    {
      target: 'design-lib-part-save-btn',
      title: 'Save Standard Part',
      after: 'The item is listed as a preferred part.',
    },
    {
      target: 'design-lib-make-form',
      title: 'Approved make',
      purpose: 'Item (Item Master) — required; Make — the manufacturer (required, e.g. SKF); Make part no. (e.g. 6205-2RS); Status (Approved / Provisional / Withdrawn); Remarks (e.g. RDSO approved source).',
      why: 'Purchase can only buy approved makes, so quality is controlled at the source.',
    },
    {
      target: 'design-lib-make-save-btn',
      title: 'Save Make',
      after: 'Every BOM using this item now shows the make.',
    },
    {
      target: 'design-lib-tpl-form',
      title: 'Upload a template',
      purpose: 'Kind (Title block, Drawing sheet, BOM sheet, Specification, Transmittal cover note, ECN notice, Other); Name (required, e.g. A3 title block — 2026); File (required); Description — when to use it and what changed.',
    },
    {
      target: 'design-lib-tpl-save-btn',
      title: 'Upload Template',
      after: 'The template is available to everyone to download.',
    },
    {
      target: 'design-lib-cl-form',
      title: 'Review checklist',
      purpose: 'Name (required, e.g. Part drawing check — mechanical); Document type (fixed once created); Discipline (or All disciplines); Active tick; then the items the checker answers — one question per line, reorder with arrows, remove with x.',
      validExample: 'Title block complete — material, finish, tolerance class',
    },
    {
      target: 'design-lib-cl-add-item-btn',
      title: '+ Add Item',
      purpose: 'Add another question line.',
    },
    {
      target: 'design-lib-cl-save-btn',
      title: 'Save Checklist',
      after: 'From now on, checks of that document type use this checklist.',
    },
  ],
}

export default config
