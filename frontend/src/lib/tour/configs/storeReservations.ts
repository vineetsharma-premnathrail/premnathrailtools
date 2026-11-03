import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-reservations',
  pageTitle: 'Stock Reservations',
  steps: [
    {
      target: 'res-add-btn',
      title: '+ New Reservation',
      purpose: 'Earmarks stock for a project or production order, blocking it from other allocation — doesn\'t move stock, only shifts it from Available to Reserved.',
      why: 'Without a reservation, material bought for one order can be issued to another job and the first order then stalls for want of it.',
      after: 'Opens the reservation form — the next steps walk through it.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'res-location',
      title: 'Store',
      required: true,
      purpose: 'The store every line is held in. Picking it shows live available stock on each line.',
    },
    {
      target: 'res-item',
      title: 'Item',
      required: true,
      purpose: 'Search by code or name — the second line shows make, part no. and specification so look-alike items can be told apart.',
    },
    {
      target: 'res-quantity',
      title: 'Quantity',
      required: true,
      why: 'Rejected if it exceeds what\'s currently available (on-hand minus already-reserved) at that store.',
    },
    {
      target: 'res-add-line',
      title: '+ Add Item',
      purpose: 'Adds another item line — one reservation can hold many items for the same store and purpose.',
    },
    {
      target: 'res-import-btn',
      title: 'Import from Excel',
      purpose: 'Loads item lines (item_code, quantity, remarks) from a file — use Download template for the right columns. Rows with unknown codes are listed so you can fix them.',
    },
    {
      target: 'res-required-date',
      title: 'Required Date',
      purpose: 'When the reserved material is needed — for planning reference.',
    },
    {
      target: 'res-save-btn',
      title: 'Reserve Stock',
      purpose: 'Reserves every line at once — all or nothing: if one line is short of stock, nothing is reserved and the line is named. Each line gets its own reservation number so it can be fulfilled or cancelled on its own.',
    },
    {
      target: 'res-modal-cancel-btn',
      title: 'Cancel (form)',
      purpose: 'Closes the form without reserving anything.',
      autoActivateOnAdvance: true,
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
