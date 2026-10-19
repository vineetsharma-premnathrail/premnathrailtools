import { TourStep } from '../types'

// Steps for the shared HydDocumentsPanel (systems, components, circuits,
// tests, service records). One panel per page, so the hyd-docs-* targets are
// unique on any one screen. `what` names the files this record usually holds.
export function hydDocumentsSteps(what: string, readOnlyNote?: string): TourStep[] {
  return [
    {
      target: 'hyd-docs-panel',
      title: 'Documents',
      purpose: `Files attached to this record — ${what}. They are stored in SharePoint and the count is shown in the heading.`,
      why: 'Keeping the drawing, datasheet or certificate on the record itself means the shop floor and service team always open the right copy, not an old one from someone\'s e-mail.',
      ...(readOnlyNote ? { after: readOnlyNote } : {}),
    },
    {
      target: 'hyd-docs-upload-btn',
      title: '+ Upload',
      purpose: 'Opens the upload form as a popup. Cancel (or ✕) closes it without uploading. Shown only to people with Edit rights on this record’s tab.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'hyd-docs-title',
      title: 'Document Title',
      required: true,
      whatToEnter: 'A short name that says what the file is, so others can find it without opening it.',
      validExample: 'Power pack circuit — sheet 1',
      invalidExample: 'scan001.pdf',
    },
    {
      target: 'hyd-docs-type',
      title: 'Document Type',
      purpose: 'What kind of file this is — shown as a coloured tag in the list.',
      options: [
        { value: 'Circuit Diagram', meaning: 'The hydraulic/pneumatic circuit (ISO 1219 symbols).' },
        { value: 'Schematic', meaning: 'Any other schematic, e.g. electrical control of the valves.' },
        { value: 'GA Drawing', meaning: 'General Arrangement — the outline/layout drawing with dimensions.' },
        { value: 'Datasheet', meaning: 'Manufacturer\'s technical sheet for a component.' },
        { value: 'Test Certificate', meaning: 'Signed certificate proving a test was passed.' },
        { value: 'Test Report', meaning: 'Detailed readings / report from a test.' },
        { value: 'Manual', meaning: 'Operation & maintenance manual.' },
        { value: 'Photo', meaning: 'Site or product photograph.' },
        { value: 'Other', meaning: 'Anything not covered above.' },
      ],
    },
    {
      target: 'hyd-docs-files',
      title: 'Files',
      required: true,
      whatToEnter: 'Pick one or more files — PDF, image, Word/Excel, DWG/DXF, STEP or ZIP. Several files picked together are saved under the same title and type.',
    },
    {
      target: 'hyd-docs-description',
      title: 'Description',
      whatToEnter: 'Optional note — revision, sheet number, source, anything useful.',
    },
    {
      target: 'hyd-docs-submit-btn',
      title: 'Upload',
      purpose: 'Uploads the chosen files.',
      after: 'The popup closes and the files appear in the list below. If something is missing (title or file) the exact reason is shown at the top of the popup.',
    },
    {
      target: 'hyd-docs-list',
      title: 'Attached files',
      purpose: 'Each attached file with its type tag, file name, size, who uploaded it and when. "View" opens it in a new tab; "Delete" appears only for the person who uploaded it or an admin.',
    },
  ]
}
