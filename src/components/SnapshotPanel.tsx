import { useEffect, useRef, useMemo } from 'react'
import QRCode from 'qrcode'

const BASE =
  (import.meta as any).env?.VITE_PUBLIC_BASE_URL ||
  (typeof window !== 'undefined' ? window.location.origin : '')

export default function SnapshotPanel({ snapDataUrl }: { snapDataUrl: string | null }) {
  const qrRef = useRef<HTMLCanvasElement>(null)

  const finalUrl = useMemo(() => {
    if (!snapDataUrl) return null
    if (snapDataUrl.startsWith('http://') || snapDataUrl.startsWith('https://')) return snapDataUrl
    if (snapDataUrl.startsWith('/')) return `${BASE}${snapDataUrl}`   // ← يبني /snaps/.. على الدومين العام
    return snapDataUrl // dataURL: نعيده للتنزيل فقط ولا نرسم QR
  }, [snapDataUrl])

  useEffect(() => {
    if (!qrRef.current || !finalUrl) return
    const isHttp = /^https?:\/\//.test(finalUrl)
    if (!isHttp) {
      const ctx = qrRef.current.getContext('2d')!
      ctx.clearRect(0, 0, 180, 180)
      return
    }
    console.log('[QR] using URL:', finalUrl)   // ← لوج للتأكد
    QRCode.toCanvas(qrRef.current, finalUrl, { width: 180 }).catch(() => {
      const ctx = qrRef.current!.getContext('2d')!
      ctx.clearRect(0, 0, 180, 180)
    })
  }, [finalUrl])

  const downloadHref = finalUrl || '#'
  const isHttp = !!finalUrl && /^https?:\/\//.test(finalUrl)

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>حمّل لقطة تجربتك</div>
        <a
          href={downloadHref}
          download={`innovation-persona-${Date.now()}.jpg`}
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid #ffffff33',
            textDecoration: 'none',
            color: 'white',
            fontSize: 14,
            display: 'inline-block'
          }}
        >
          تنزيل الصورة
        </a>
      </div>

      <div>
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>أو امسح QR</div>
        <canvas ref={qrRef} width={180} height={180} style={{ background: 'white', borderRadius: 8 }} />
        {isHttp && (
          <div style={{ marginTop: 8, maxWidth: 280, wordBreak: 'break-all', fontSize: 12, opacity: 0.8 }}>
            الرابط المستخدم: <a href={finalUrl!} target="_blank" rel="noreferrer">{finalUrl}</a>
          </div>
        )}
      </div>
    </div>
  )
}
