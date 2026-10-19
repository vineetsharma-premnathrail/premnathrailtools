'use client'

// "Feedback" (top bar icon / sidebar row): a FormSheet popup that sends a
// message to the admin.

import { useState } from 'react'
import { feedbackApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { ChatCenteredDots } from '@phosphor-icons/react'

export default function FeedbackButton({ variant = 'icon' }: { variant?: 'icon' | 'row' }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  useEscapeKey(open && !submitting, () => setOpen(false))

  const openSheet = () => {
    setSubmitted(false)
    setError('')
    setOpen(true)
  }

  const handleSubmit = async () => {
    if (!message.trim()) return
    setSubmitting(true)
    setError('')
    try {
      await feedbackApi.submit(message.trim())
      setMessage('')
      setSubmitted(true)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not send feedback. Please try again.').join(' '))
    } finally {
      setSubmitting(false)
    }
  }

  const icon = (
    <ChatCenteredDots size={17} />
  )
  const disabled = submitting || !message.trim()

  return (
    <>
      {variant === 'row' ? (
        <button
          onClick={openSheet}
          className="sidebar-flat-btn"
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 11,
            padding: '10px 14px',
            marginBottom: 6,
            borderRadius: 12,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 500,
            color: '#57534e',
            fontFamily: 'inherit',
          }}
        >
          {icon}
          Feedback
        </button>
      ) : (
        <button
          onClick={openSheet}
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            border: '1px solid rgba(0,0,0,0.1)',
            background: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#57534e',
          }}
          aria-label="Feedback"
          title="Feedback"
        >
          {icon}
        </button>
      )}

      {open && (
        <FormSheet tour="feedback-form" width={580} icon="chat" title="Send Feedback" subtitle="Report an issue or suggest what you'd like to see next — it goes to the admin."
          onClose={() => setOpen(false)} busy={submitting}
          footer={submitted ? (
            <button type="button" onClick={() => setOpen(false)} style={sheetBtn('primary', SHEET.BLUE)}><SheetIcon name="check" size={16} />Done</button>
          ) : (<>
            <button type="button" onClick={() => setOpen(false)} disabled={submitting} style={sheetBtn('secondary', SHEET.INK, submitting)}>Cancel</button>
            <button type="button" onClick={handleSubmit} disabled={disabled} style={sheetBtn('primary', SHEET.BLUE, disabled)}>
              <SheetIcon name="send" size={16} />{submitting ? 'Sending…' : 'Submit'}
            </button>
          </>)}>
          <div style={{ padding: '20px 24px' }}>
            {submitted ? (
              <p style={{ fontSize: 13.5, color: '#047857', margin: 0 }}>
                Thanks! Your feedback has been sent to the admin.
              </p>
            ) : (
              <>
                {error && (
                  <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                    {error}
                  </div>
                )}
                <SheetSection icon="chat" title="Your feedback">
                  <label style={sheetLabel}>Message <Req /></label>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Type your feedback or suggestion..."
                    rows={5}
                    maxLength={4000}
                    autoFocus
                    style={{ ...sheetInput, resize: 'vertical' }}
                  />
                  <p style={{ ...sheetHint, textAlign: 'right' }}>{message.length}/4000</p>
                </SheetSection>
              </>
            )}
          </div>
        </FormSheet>
      )}
    </>
  )
}
