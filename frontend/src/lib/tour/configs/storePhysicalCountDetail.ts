import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-physical-count-detail',
  pageTitle: 'Physical Count',
  steps: [
    {
      target: 'store-count-back-btn',
      title: '← Back',
      purpose: 'Returns to the Physical Count list. Counts you have not saved yet are lost.',
    },
    {
      target: 'store-count-lines',
      title: 'Count lines',
      purpose: 'Enter what is physically on the shelf for each item, then Save counts. Enter 0 for anything not found. Re-entering a quantity is a recount — the first count is kept for the record.',
      why: 'Differences (counted minus book) are what the Store Manager approves; the first count shows whether a recount changed the result.',
    },
    {
      target: 'store-count-save-btn',
      title: 'Save counts',
      purpose: 'Saves the quantities and remarks entered since the last save. You can save in parts while counting.',
    },
    {
      target: 'store-count-submit',
      title: 'Submit count',
      purpose: 'Every line must be counted. All differences become one Stock Adjustment for the Store Manager you pick (never yourself); stock changes only when they approve it. With no difference the count closes at once.',
      after: 'The freeze is lifted. If the Store Manager rejects or returns the adjustment, the count reopens for a recount.',
    },
    {
      target: 'store-count-cancel-btn',
      title: 'Cancel count',
      purpose: 'Abandons the count with a reason. Nothing is posted and the frozen items can move again.',
    },
  ],
}

export default config
