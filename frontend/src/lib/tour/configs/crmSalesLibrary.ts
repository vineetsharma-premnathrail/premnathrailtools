import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'crm-sales-library',
  pageTitle: 'CRM › Sales Library',
  steps: [
    {
      target: 'lib-upload',
      title: '+ Upload',
      purpose: 'Opens the upload form: pick a file (any type, videos and large files are fine), the folder, and optionally tags, an expiry date and the products, projects and customers it belongs to. Shown only if your role can create in the Sales Library.',
      why: 'One central copy of every catalogue, video and price list, so the team stops sending old versions around by email.',
      after: 'The file is stored in SharePoint and appears in its folder and under "Recently added".',
    },
    {
      target: 'lib-new-folder',
      title: '+ New folder',
      purpose: 'Creates a folder (or a sub-folder inside the folder you are viewing). A folder can be linked to a product, marked Confidential, or marked as a Pricing folder.',
      why: 'Folders keep material organised the way your team looks for it. Confidential folders are hidden from people without that access; Pricing folders force an expiry date on every document.',
    },
    {
      target: 'lib-counts',
      title: 'Counts',
      purpose: 'Folders, documents, videos and expired documents. Click a count to filter the list to it; click again to show everything.',
    },
    {
      target: 'lib-search',
      title: 'Search',
      purpose: 'Finds documents by title, description, tags, file name or linked product, word by word in any order.',
      whatToEnter: 'A few words of what you are looking for.',
      validExample: 'rrv demo',
    },
    {
      target: 'lib-filter',
      title: 'Filter',
      purpose: 'Narrow the documents by file type, product, project, customer, your favourites or expiry.',
    },
    {
      target: 'lib-tree',
      title: 'Folders',
      purpose: 'Click a folder to see its documents. The ⋯ menu on a folder lets you add a sub-folder, edit, move or delete it. Only an empty folder can be deleted, and a folder cannot be moved into itself.',
    },
    {
      target: 'lib-recent',
      title: 'Recently added',
      purpose: 'The latest files uploaded, on the main view. Click one to open it.',
    },
    {
      target: 'lib-table',
      title: 'Documents',
      purpose: 'Each document with its type, what it is linked to, version, expiry and last update. A red Expired badge means the date has passed (outdated price lists). The star adds it to your favourites. Click a row to open it.',
      after: 'The panel on the right shows a preview, details, links and all versions, and lets you download, share, edit, upload a new version or delete.',
    },
  ],
}

export default config
