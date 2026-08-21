'use client'

import { useEffect, useRef, useState } from 'react'

// Live in-browser camera capture (getUserMedia), for platforms where the
// `capture` attribute on a file input has no effect — every desktop browser
// (Chrome/Edge/Firefox) ignores it and just opens the plain file picker, so
// "Take Photo" needs an actual video-preview + snapshot flow to hit a real
// webcam there. Mobile browsers get this same flow too, for consistency.
export default function CameraCapture({
  onCapture,
  onClose,
}: {
  onCapture: (file: File) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
        setReady(true)
      })
      .catch((err) => {
        if (cancelled) return
        setError(
          err?.name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow camera access in the browser and try again.'
            : err?.name === 'NotFoundError'
            ? 'No camera was found on this device.'
            : 'Could not access the camera.'
        )
      })
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const capture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob) return
      onCapture(new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }))
      onClose()
    }, 'image/jpeg', 0.92)
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#111', borderRadius: 14, overflow: 'hidden', width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
      >
        <div style={{ position: 'relative', aspectRatio: '4 / 3', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {error ? (
            <p style={{ color: '#fff', fontSize: 13.5, padding: 24, textAlign: 'center', margin: 0 }}>{error}</p>
          ) : (
            <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, padding: 14, background: '#1a1a1a' }}>
          <button
            type="button"
            onClick={onClose}
            style={{ flex: 1, padding: '10px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
          >
            Cancel
          </button>
          {!error && (
            <button
              type="button"
              onClick={capture}
              disabled={!ready}
              style={{ flex: 2, padding: '10px 16px', borderRadius: 10, border: 'none', background: ready ? 'linear-gradient(140deg,#fa9b9b,#ffe3d0)' : 'rgba(255,255,255,0.2)', color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: ready ? 'pointer' : 'wait' }}
            >
              📷 Capture
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
