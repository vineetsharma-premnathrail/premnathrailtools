import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-reservations',
  pageTitle: 'Stock Reservations',
  steps: [
    {
      target: 'res-add-btn',
      title: '+ New Reservation',
      purpose: 'Earmarks stock for a project or production order, blocking it from other allocation — doesn\'t move stock, only shifts it from Available to Reserved.',
    },
    {
      target: 'res-item',
      title: 'Item',
      required: true,
    },
    {
      target: 'res-location',
      title: 'Warehouse',
      required: true,
    },
    {
      target: 'res-quantity',
      title: 'Quantity',
      required: true,
      why: 'Rejected if it exceeds what\'s currently available (on-hand minus already-reserved) at that warehouse.',
    },
    {
      target: 'res-required-date',
      title: 'Required Date',
      purpose: 'When the reserved material is needed — for planning reference.',
    },
    {
      target: 'res-save-btn',
      title: 'Reserve Stock',
      purpose: 'Creates the reservation and immediately moves the quantity from Available to Reserved on the Stock page.',
    },
    {
      target: 'res-table',
      title: 'Reservation rows',
      purpose: 'Every reservation, with its status. Shows "No stock reservations yet" until one is created.',
    },
    {
      target: 'res-fulfill-btn',
      title: 'Fulfill',
      purpose: 'Marks the reservation as consumed and releases the earmark — use this once the material has actually been issued through a separate Material Issue. Fulfilling does NOT itself reduce stock.',
    },
    {
      target: 'res-cancel-btn',
      title: 'Cancel',
      purpose: 'Releases the earmark without any material ever being issued — the quantity returns to Available immediately.',
    },
  ],
}

export default config
