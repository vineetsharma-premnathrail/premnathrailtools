import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'maintenance-asset-import',
  pageTitle: 'Import Assets from Excel',
  steps: [
    {
      target: 'maint-import-template',
      title: '1. Download template',
      purpose: 'Downloads the Excel template. Fill one machine per row. The Instructions sheet lists the allowed categories, criticality values and your plant names.',
      whatToEnter: 'Use exactly the plant names and category/criticality values from the Instructions sheet. Leave asset code blank to auto-number.',
    },
    {
      target: 'maint-import-file',
      title: '2. Choose file',
      purpose: 'Pick the filled-in .xlsx file.',
      invalidExample: 'A .csv or .xls file — save as .xlsx first.',
    },
    {
      target: 'maint-import-validate',
      title: '3. Validate',
      purpose: 'Checks every row without saving anything.',
      after: 'If any row has problems, only those rows are listed with the exact reason (e.g. unknown plant, duplicate code). Fix the file and validate again. When all rows are valid, the Import button is enabled.',
      why: 'A dry run first means a half-loaded register never happens.',
    },
    {
      target: 'maint-import-run',
      title: '4. Import',
      purpose: 'Saves all rows together — all or nothing.',
      after: 'A green message shows how many assets were imported and the register reloads. If anything fails, nothing is saved.',
    },
  ],
}

export default config
