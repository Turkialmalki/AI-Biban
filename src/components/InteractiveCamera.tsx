// src/components/InteractiveCamera.tsx
import * as faceapi from 'face-api.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import QRCode from 'qrcode'

const MODEL_URL = '/models'

// Tunables / anti-inflation guards
const MAX_FACES = 8
const TICK_MS = 100
const REID_THRESH = 0.42            // tighter matching
const SCORE_THRESH = 0.60           // ignore weak detections
const MIN_HRATIO = 0.18             // ignore tiny faces
const NEW_ID_CONFIRM_FRAMES = 3     // need N consecutive frames before assigning a new unique id
const ID_TTL_MS = 60_000            // unique bank expiry
const SPEAK_OPEN = 0.32
const SPEAK_MIN_FRAMES = 4
const MOTION_THRESHOLD = 8
const INACTIVITY_SEC = 25

export type SessionEvent =
  | { t: number; kind: 'face'; faces: number }
  | { t: number; kind: 'emotion'; face: number; emotion: string }
  | { t: number; kind: 'speakingStart'; face: number }
  | { t: number; kind: 'speakingStop'; face: number }
  | { t: number; kind: 'snapshot'; dataUrl: string; note: string }

export type SessionReport = {
  startedAt: number
  endedAt?: number
  durationSec?: number
  highlights: Array<{ t: number; note: string; dataUrl?: string }>
  kpis: {
    uniqueFaces: number
    peaks: number
    speakingTurns: number
    avgMotion: number
    dominantEmotions: Record<string, number>
  }
  timeline: SessionEvent[]
  uploadUrl?: string
}

type FaceTrack = {
  id: number
  name?: string
  bbox: faceapi.Box
  emotion: string
  emotionScore: number
  speaking: boolean
  motion: number
  gaze: 'Left' | 'Right' | 'Center'
  distance: 'Near' | 'Mid' | 'Far'
  descriptor?: Float32Array
}

type BankItem = { id: number; descriptor: Float32Array; lastSeen: number }
type Candidate = {
  descriptor: Float32Array
  lastBox: faceapi.Box
  frames: number
  updatedAt: number
}

export default function InteractiveCamera({ onReport }: { onReport?: (r: SessionReport) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const diffRef = useRef<HTMLCanvasElement>(document.createElement('canvas'))

  const [modelsReady, setModelsReady] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [faces, setFaces] = useState<FaceTrack[]>([])
  const [session, setSession] = useState<SessionReport | null>(null)

  // Re-ID state
  const reidBank = useRef<BankItem[]>([])
  const nextId = useRef(1)
  const candidates = useRef<Candidate[]>([]) // pending new identities (need confirmation frames)

  // Speech / social
  const speakFrames = useRef<Record<number, number>>({})
  const speakingNow = useRef<number | null>(null)
  const edges = useRef<Map<string, number>>(new Map()) // "from->to" -> count
  const lastSnapshotAt = useRef(0)
  const lastSeenAt = useRef<number>(Date.now())

  // Mic optional
  const [enableMic, setEnableMic] = useState(false)
  const micRef = useRef<{ stream?: MediaStream; analyser?: AnalyserNode; ctx?: AudioContext } | null>(null)

  // Load models
  useEffect(() => {
    const load = async () => {
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL), // re-ID
        ])
        setModelsReady(true)
      } catch {
        setError('تعذّر تحميل النماذج من /models')
      }
    }
    load()
  }, [])

  const start = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      // reset session + banks
      reidBank.current = []
      candidates.current = []
      nextId.current = 1
      speakFrames.current = {}
      speakingNow.current = null
      edges.current = new Map()
      lastSnapshotAt.current = 0
      lastSeenAt.current = Date.now()

      setSession({
        startedAt: Date.now(),
        highlights: [],
        kpis: { uniqueFaces: 0, peaks: 0, speakingTurns: 0, avgMotion: 0, dominantEmotions: {} },
        timeline: [],
      })
      setRunning(true)
    } catch {
      setError('لا يمكن الوصول للكاميرا')
    }
  }, [])

  const stop = useCallback(() => {
    setRunning(false)
    if (videoRef.current?.srcObject) {
      ;(videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop())
      videoRef.current.srcObject = null
    }
    setFaces([])
    setSession(prev => {
      if (!prev) return prev
      const dur = Math.max(1, Math.round((Date.now() - prev.startedAt) / 1000))
      return { ...prev, endedAt: Date.now(), durationSec: dur }
    })
  }, [])

  // Reset unique (manual)
  const resetUnique = useCallback(() => {
    reidBank.current = []
    candidates.current = []
    nextId.current = 1
  }, [])

  // Mic helpers
  async function toggleMic() {
    if (!enableMic) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const ctx = new AudioContext()
        const src = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 2048
        src.connect(analyser)
        micRef.current = { stream, analyser, ctx }
        setEnableMic(true)
      } catch {
        // ignore
      }
    } else {
      micRef.current?.stream?.getTracks().forEach(t => t.stop())
      micRef.current?.ctx?.close()
      micRef.current = null
      setEnableMic(false)
    }
  }
  function micEnergy(): number {
    const an = micRef.current?.analyser
    if (!an) return 0
    const arr = new Uint8Array(an.frequencyBinCount)
    an.getByteTimeDomainData(arr)
    let sum = 0
    for (let i = 0; i < arr.length; i++) {
      const v = (arr[i] - 128) / 128
      sum += v * v
    }
    return Math.sqrt(sum / arr.length) // ~0..0.5
  }

  // Motion via frame diff
  function computeMotion(): number {
    const v = videoRef.current!
    const c = diffRef.current
    const w = (c.width = v.videoWidth)
    const h = (c.height = v.videoHeight)
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    const prev = ctx.getImageData(0, 0, w, h)
    ctx.drawImage(v, 0, 0, w, h)
    const curr = ctx.getImageData(0, 0, w, h)
    let diff = 0
    for (let i = 0; i < curr.data.length; i += 4) {
      const d =
        Math.abs(curr.data[i] - prev.data[i]) +
        Math.abs(curr.data[i + 1] - prev.data[i + 1]) +
        Math.abs(curr.data[i + 2] - prev.data[i + 2])
      if (d > 60) diff++
    }
    return (diff / (w * h)) * 100
  }

  function mouthOpenRatio(lms: faceapi.FaceLandmarks68): number {
    const mouth = lms.getMouth()
    const top = mouth[13] // inner top
    const bottom = mouth[19] // inner bottom
    const left = mouth[0]
    const right = mouth[6]
    const open = Math.hypot(top.y - bottom.y, top.x - bottom.x)
    const width = Math.hypot(left.x - right.x, left.y - right.y)
    return open / width
  }

  // Cosine distance (1 - cosine similarity)
  function cosineDist(a: Float32Array, b: Float32Array) {
    let dot = 0,
      na = 0,
      nb = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      na += a[i] * a[i]
      nb += b[i] * b[i]
    }
    return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb))
  }

  // Box Intersection-over-Union (rough spatial consistency for candidates)
  function iou(a: faceapi.Box, b: faceapi.Box) {
    const ax2 = a.x + a.width
    const ay2 = a.y + a.height
    const bx2 = b.x + b.width
    const by2 = b.y + b.height
    const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x))
    const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y))
    const inter = ix * iy
    const ua = a.width * a.height + b.width * b.height - inter
    return ua > 0 ? inter / ua : 0
  }

  // Draw overlay
  function overlayDraw(tracks: FaceTrack[]) {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return
    const ctx = canvas.getContext('2d')!
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    // mirror video
    ctx.save()
    ctx.scale(-1, 1)
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height)
    ctx.restore()

    // heatmap
    drawHeatmap(ctx, diffRef.current)

    // draw face tracks
    for (const ft of tracks) {
      const { x, y, width, height } = ft.bbox
      // bbox (mirrored)
      ctx.strokeStyle = 'rgba(34,197,94,0.9)'
      ctx.lineWidth = 3
      ctx.strokeRect(canvas.width - (x + width), y, width, height)
      // label bar
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(canvas.width - (x + width), y - 24, width, 24)
      ctx.fillStyle = '#fff'
      ctx.font = '700 14px system-ui'
      const label =
        `${ft.name ? ft.name : '#' + ft.id} ${emojiFor(ft.emotion)} ${ft.emotion}` +
        (ft.speaking ? ' 🎙️' : '') +
        `  ${ft.gaze}/${ft.distance}  mot:${ft.motion.toFixed(0)}%`
      ctx.fillText(label, canvas.width - (x + width) + 6, y - 6)
    }
  }

  function emojiFor(em: string) {
    const map: Record<string, string> = {
      happy: '😊',
      surprised: '😯',
      sad: '😔',
      angry: '😠',
      fearful: '😨',
      disgusted: '🤢',
      neutral: '😐',
    }
    return map[em] ?? '🙂'
  }

  function drawHeatmap(ctx: CanvasRenderingContext2D, diffCanvas: HTMLCanvasElement) {
    const w = diffCanvas.width,
      h = diffCanvas.height
    if (!w || !h) return
    const cell = 48
    const gridX = Math.ceil(w / cell),
      gridY = Math.ceil(h / cell)
    const dctx = diffCanvas.getContext('2d')!
    const data = dctx.getImageData(0, 0, w, h).data
    ctx.save()
    ctx.globalAlpha = 0.25
    for (let gy = 0; gy < gridY; gy++) {
      for (let gx = 0; gx < gridX; gx++) {
        let hot = 0,
          count = 0
        const x0 = gx * cell,
          y0 = gy * cell
        for (let y = y0; y < Math.min(y0 + cell, h); y++) {
          for (let x = x0; x < Math.min(x0 + cell, w); x++) {
            const i = (y * w + x) * 4
            const val = Math.max(data[i], data[i + 1], data[i + 2])
            if (val > 180) hot++
            count++
          }
        }
        const p = hot / count
        if (p > 0.05) {
          ctx.fillStyle = `rgba(255,165,0,${Math.min(0.4, p * 2)})`
          ctx.fillRect(ctx.canvas.width - (x0 + cell), y0, cell, cell)
        }
      }
    }
    ctx.restore()
  }

  // Click to assign name
  function handleClickAssignName(e: React.MouseEvent) {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const mx = canvas.width - x
    const my = y
    const hit = faces.find(
      f => mx >= f.bbox.x && mx <= f.bbox.x + f.bbox.width && my >= f.bbox.y && my <= f.bbox.y + f.bbox.height
    )
    if (hit) {
      const name = prompt(`اسم للشخص #${hit.id}`, hit.name || '')
      if (name) {
        setFaces(prev => prev.map(p => (p.id === hit.id ? { ...p, name } : p)))
      }
    }
  }

  // Main loop
  useEffect(() => {
    if (!modelsReady || !running) return
    let raf = 0
    let timer = 0

    const loop = async () => {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || !video.videoWidth) {
        raf = requestAnimationFrame(loop)
        return
      }
      try {
        const detectionsRaw = await faceapi
          .detectAllFaces(
            video,
            new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: SCORE_THRESH })
          )
          .withFaceLandmarks()
          .withFaceExpressions()
          .withFaceDescriptors()

        // filter tiny faces and sort by size desc
        const detections = detectionsRaw
          .filter(d => d.descriptor && d.detection.score >= SCORE_THRESH)
          .filter(d => d.detection.box.height / video.videoHeight >= MIN_HRATIO)
          .sort((a, b) => b.detection.box.height - a.detection.box.height)
          .slice(0, MAX_FACES)

        const motion = computeMotion()
        const energy = micEnergy()
        const tracks: FaceTrack[] = []

        const now = Date.now()
        // expire old bank items (keep memory bounded)
        reidBank.current = reidBank.current.filter(p => now - p.lastSeen < ID_TTL_MS)
        // expire old candidates fast
        candidates.current = candidates.current.filter(c => now - c.updatedAt < 2000)

        for (const det of detections) {
          const descriptor = det.descriptor as Float32Array
          const box = det.detection.box

          // 1) try bank match (cosine distance)
          let matchedId = -1
          let best = 1e9
          for (const p of reidBank.current) {
            const d = cosineDist(descriptor, p.descriptor)
            if (d < best) {
              best = d
              matchedId = p.id
            }
          }

          if (matchedId !== -1 && best <= REID_THRESH) {
            // confirmed existing id
            const bank = reidBank.current.find(p => p.id === matchedId)!
            bank.lastSeen = now
            // (optional) light descriptor average to stabilize
            for (let i = 0; i < bank.descriptor.length; i++) {
              bank.descriptor[i] = (bank.descriptor[i] * 3 + descriptor[i]) / 4
            }

            const { emotion, score } = topEmotion(det.expressions as any)
            const ratio = mouthOpenRatio(det.landmarks)
            const prevFrames = speakFrames.current[matchedId] || 0
            if (ratio > SPEAK_OPEN || energy > 0.08) speakFrames.current[matchedId] = prevFrames + 1
            else if (prevFrames > 0) speakFrames.current[matchedId] = prevFrames - 1
            const speaking = speakFrames.current[matchedId] >= SPEAK_MIN_FRAMES

            const gaze = gazeFrom(det.landmarks)
            const hRatio = box.height / video.videoHeight
            const distance = hRatio > 0.45 ? 'Near' : hRatio > 0.28 ? 'Mid' : 'Far'

            tracks.push({
              id: matchedId,
              bbox: box,
              emotion,
              emotionScore: score,
              speaking,
              motion,
              gaze,
              distance,
              descriptor,
            })
            continue
          }

          // 2) no bank match → try candidate stabilization
          let cand = -1
          let candBest = 1e9
          for (let i = 0; i < candidates.current.length; i++) {
            const c = candidates.current[i]
            const dd = cosineDist(descriptor, c.descriptor)
            const ov = iou(c.lastBox, box)
            const score = dd - ov * 0.1 // prefer spatially consistent
            if (score < candBest) {
              candBest = score
              cand = i
            }
          }

          if (cand !== -1) {
            const c = candidates.current[cand]
            const cd = cosineDist(descriptor, c.descriptor)
            const ov = iou(c.lastBox, box)
            if (cd <= REID_THRESH && ov > 0.05) {
              // update candidate
              c.frames += 1
              c.updatedAt = now
              c.lastBox = box
              // average descriptor
              for (let i = 0; i < c.descriptor.length; i++) {
                c.descriptor[i] = (c.descriptor[i] * 3 + descriptor[i]) / 4
              }
              // promote to real ID after enough frames
              if (c.frames >= NEW_ID_CONFIRM_FRAMES) {
                const newId = nextId.current++
                reidBank.current.push({ id: newId, descriptor: c.descriptor, lastSeen: now })
                candidates.current.splice(cand, 1)

                const { emotion, score } = topEmotion(det.expressions as any)
                const ratio = mouthOpenRatio(det.landmarks)
                const speaking = ratio > SPEAK_OPEN || energy > 0.08 ? true : false

                const gaze = gazeFrom(det.landmarks)
                const hRatio = box.height / video.videoHeight
                const distance = hRatio > 0.45 ? 'Near' : hRatio > 0.28 ? 'Mid' : 'Far'

                tracks.push({
                  id: newId,
                  bbox: box,
                  emotion,
                  emotionScore: score,
                  speaking,
                  motion,
                  gaze,
                  distance,
                  descriptor,
                })
                continue
              } else {
                // not yet promoted → we don't create a visible track this frame (prevents flicker IDs)
                continue
              }
            }
          }

          // 3) brand-new candidate (first time seen)
          candidates.current.push({
            descriptor: new Float32Array(descriptor),
            lastBox: box,
            frames: 1,
            updatedAt: now,
          })
          // not promoted yet → no track this frame
        }

        // Update people last seen
        if (tracks.length > 0) lastSeenAt.current = Date.now()

        // Draw overlay
        setFaces(tracks)
        overlayDraw(tracks)

        // Session metrics and timeline
        setSession(prev => {
          if (!prev) return prev
          const tl = [...prev.timeline]
          tl.push({ t: Date.now(), kind: 'face', faces: tracks.length })

          // dominant emotion accumulation
          const dom: Record<string, number> = { ...prev.kpis.dominantEmotions }
          tracks.forEach(ft => (dom[ft.emotion] = (dom[ft.emotion] || 0) + 1))

          // speaking turns + social graph
          const currentSpeaker = tracks.find(t => t.speaking)?.id ?? null
          if (currentSpeaker !== speakingNow.current && currentSpeaker != null && speakingNow.current != null) {
            const key = `${speakingNow.current}->${currentSpeaker}`
            edges.current.set(key, (edges.current.get(key) || 0) + 1)
            tl.push({ t: Date.now(), kind: 'speakingStart', face: currentSpeaker })
          }
          speakingNow.current = currentSpeaker

          // emotional/motion highlight
          const now2 = Date.now()
          const peak =
            tracks.some(ft => ft.emotion !== 'neutral' && ft.emotionScore > 0.9) || motion > MOTION_THRESHOLD + 10
          if (peak && now2 - lastSnapshotAt.current > 4000) {
            const snap = canvas.toDataURL('image/jpeg', 0.85)
            tl.push({ t: now2, kind: 'snapshot', dataUrl: snap, note: 'Highlight moment' })
            lastSnapshotAt.current = now2
          }

          const avgMotion =
            (prev.kpis.avgMotion * Math.max(1, tl.length - 1) + (tracks[0]?.motion || 0)) / Math.max(1, tl.length)

          return {
            ...prev,
            kpis: {
              uniqueFaces: Math.max(prev.kpis.uniqueFaces, reidBank.current.length),
              peaks: prev.kpis.peaks + (peak ? 1 : 0),
              speakingTurns:
                prev.kpis.speakingTurns + (speakingNow.current != null && currentSpeaker != null ? 1 : 0),
              avgMotion,
              dominantEmotions: dom,
            },
            timeline: tl,
          }
        })

        // Auto stop on inactivity
        const idleFor = (Date.now() - lastSeenAt.current) / 1000
        if (idleFor > INACTIVITY_SEC && motion < 1.2) {
          stop()
        }
      } catch (e) {
        // ignore frame errors
      }

      raf = requestAnimationFrame(loop)
    }

    // throttle
    timer = window.setInterval(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(loop)
    }, TICK_MS)

    return () => {
      cancelAnimationFrame(raf)
      clearInterval(timer)
    }
  }, [modelsReady, running, stop])

  // Helpers: emotions, gaze
  function topEmotion(exps: Record<string, number>) {
    const sorted = Object.entries(exps).sort((a: any, b: any) => (b[1] as number) - (a[1] as number))
    const [emotion, score] = sorted[0] as [string, number]
    return { emotion, score }
  }
  function gazeFrom(lm: faceapi.FaceLandmarks68) {
    const eye = lm.getLeftEye()
    return eye[0].y - eye[3].y > 2 ? 'Left' : eye[3].y - eye[0].y > 2 ? 'Right' : 'Center'
  }

  // Export PDF
  const exportReport = useCallback(async () => {
    if (!session) return

    const holder = document.createElement('div')
    holder.id = 'report-summary'
    holder.style.width = '880px'
    holder.style.padding = '16px'
    holder.style.background = '#0b0f19'
    holder.style.color = 'white'
    holder.innerHTML = `
      <h2 style="margin:0 0 8px 0">ملخص جلسة الكاميرا</h2>
      <div>المدة: ${session.durationSec ?? 0}s</div>
      <div>الحضور الآن/الفريد: ${faces.length} / ${reidBank.current.length}</div>
      <div>القمم العاطفية: ${session.kpis.peaks}</div>
      <div>تناوبات الحديث (تقديرية): ${session.kpis.speakingTurns}</div>
      <div>الحركة المتوسطة: ${session.kpis.avgMotion.toFixed(1)}%</div>
      <div style="margin-top:8px;font-size:13px;opacity:.8">المشاعر السائدة: ${
        Object.entries(session.kpis.dominantEmotions)
          .sort((a, b) => (b[1] as number) - (a[1] as number))
          .slice(0, 4)
          .map(([k, v]) => `${k} (${v})`)
          .join('، ')
      }</div>
    `
    document.body.appendChild(holder)
    const summaryCanvas = await html2canvas(holder, { scale: 2 })
    document.body.removeChild(holder)
    const summaryImg = summaryCanvas.toDataURL('image/jpeg', 0.92)

    const pdf = new jsPDF('p', 'pt', 'a4')
    const pw = pdf.internal.pageSize.getWidth()
    const ph = pdf.internal.pageSize.getHeight()
    const ratio = Math.min(pw / summaryCanvas.width, ph / summaryCanvas.height)
    pdf.addImage(summaryImg, 'JPEG', (pw - summaryCanvas.width * ratio) / 2, 24, summaryCanvas.width * ratio, summaryCanvas.height * ratio)

    const shots = session.timeline.filter(e => e.kind === 'snapshot') as Array<any>
    shots.slice(0, 6).forEach((s, i) => {
      if (i % 2 === 0) pdf.addPage()
      const y = 40 + (i % 2) * (ph / 2)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(14)
      pdf.text(`Highlight ${i + 1}: ${new Date(s.t).toLocaleTimeString()}`, 40, y)
      pdf.addImage(s.dataUrl, 'JPEG', 40, y + 10, pw - 80, (pw - 80) * 0.56)
    })

    const blob = pdf.output('blob')
    const fileReader = new FileReader()
    fileReader.onload = async () => {
      let url: string | undefined
      const last = shots.at(-1)?.dataUrl
      if (last) {
        try {
          const r = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: last })
          if (r.ok) {
            const j = await r.json()
            url = j.url?.startsWith('/') ? `${location.origin}${j.url}` : j.url
          }
        } catch {}
      }
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `camera-session-${Date.now()}.pdf`
      a.click()

      if (url) {
        const w = window.open('', '_blank', 'width=360,height=420')
        if (w) {
          w.document.write('<h3>شارك التقرير عبر QR (صورة ملخّص)</h3><canvas id="qr" width="240" height="240"></canvas>')
          const cv = w.document.getElementById('qr') as HTMLCanvasElement
          await QRCode.toCanvas(cv, url, { width: 240 })
        }
      }
    }
    fileReader.readAsArrayBuffer(blob)

    onReport?.(session)
  }, [session, faces.length, onReport])

  // Export JSON
  const exportJSON = useCallback(() => {
    if (!session) return
    const social = Array.from(edges.current.entries()).map(([k, v]) => ({ edge: k, count: v }))
    const data = { ...session, uniqueFaces: reidBank.current.length, socialGraph: social }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `camera-session-${Date.now()}.json`
    a.click()
  }, [session])

  // Export CSV
  const exportCSV = useCallback(() => {
    if (!session) return
    const lines = ['t,kind,meta']
    session.timeline.forEach(ev => {
      if (ev.kind === 'face') lines.push(`${ev.t},face,${(ev as any).faces}`)
      else if (ev.kind === 'emotion') lines.push(`${ev.t},emotion,${(ev as any).face}:${(ev as any).emotion}`)
      else if (ev.kind === 'speakingStart') lines.push(`${ev.t},speakingStart,${(ev as any).face}`)
      else if (ev.kind === 'speakingStop') lines.push(`${ev.t},speakingStop,${(ev as any).face}`)
      else if (ev.kind === 'snapshot') lines.push(`${ev.t},snapshot,${(ev as any).note}`)
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `camera-session-${Date.now()}.csv`
    a.click()
  }, [session])

  function Coach({ faces }: { faces: FaceTrack[] }) {
    const f = faces
    let msg = 'اقترب من الكاميرا لبدء التجربة'
    if (f.length === 1) {
      msg =
        f[0].speaking ? 'نتابع حديثك — استمر 👌' : f[0].emotion === 'happy' ? 'ابتسامة رائعة! 😄' : 'لوّح ليلتقط لحظة مميزة ✨'
    } else if (f.length >= 2) {
      const speaking = f.filter(x => x.speaking).length
      msg = speaking >= 1 ? 'تسجيل تناوب الحديث… 🎙️' : 'جميل! شخصان أو أكثر — تحدثوا الآن'
    }
    return (
      <div
        style={{
          position: 'absolute',
          left: 16,
          bottom: 16,
          background: 'rgba(0,0,0,.5)',
          border: '1px solid #ffffff33',
          backdropFilter: 'blur(6px)',
          color: '#fff',
          padding: '8px 12px',
          borderRadius: 10,
          fontSize: 13,
        }}
      >
        {msg}
      </div>
    )
  }

  const btn = (primary: boolean): React.CSSProperties => ({
    background: primary ? 'linear-gradient(135deg,#ef4444,#f59e0b)' : 'linear-gradient(135deg,#16a34a,#0ea5e9)',
    color: '#fff',
    fontWeight: 800,
    padding: '10px 14px',
    borderRadius: 12,
    border: 'none',
    cursor: 'pointer',
  })

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={running ? stop : start} style={btn(running)}>
          {running ? 'إيقاف الكاميرا' : 'تشغيل الكاميرا'}
        </button>
        <button onClick={() => toggleMic()} style={btn(false)}>
          {enableMic ? 'إيقاف الميكروفون' : 'تشغيل الميكروفون'}
        </button>
        <button onClick={resetUnique} style={btn(false)}>تقليل إجمالي المختلفيين</button>
        {session && !running && (
          <>
            <button onClick={exportReport} style={btn(false)}>
              توليد تقرير الجلسة (PDF)
            </button>
            <button onClick={exportCSV} style={btn(false)}>
              تصدير CSV
            </button>
            <button onClick={exportJSON} style={btn(false)}>
              تصدير JSON
            </button>
          </>
        )}
        {!modelsReady && <span style={{ opacity: 0.8 }}>جاري تحميل النماذج…</span>}
        {error && <span style={{ color: '#ef4444' }}>{error}</span>}
      </div>

      <div
        style={{ position: 'relative', border: '1px solid #ffffff22', borderRadius: 16, overflow: 'hidden' }}
        onClick={handleClickAssignName}
      >
        <video ref={videoRef} playsInline muted style={{ display: 'none' }} />
        <canvas ref={canvasRef} style={{ width: '100%', height: '56vh', background: '#0b0f19' }} />

        {/* People counter */}
        {running && (
          <div
            style={{
              position: 'absolute',
              top: 12,
              left: 12,
              background: 'rgba(0,0,0,.45)',
              border: '1px solid #ffffff33',
              color: '#fff',
              padding: '6px 10px',
              borderRadius: 10,
              fontSize: 12,
            }}
          >
            الحضور الآن: <b>{faces.length}</b> — إجمالي الاشخاص المختلفيين: <b>{reidBank.current.length}</b>
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
              “إجمالي الاشخاص المختلفون = الأشخاص المختلفون المؤكدون خلال الجلسة
            </div>
          </div>
        )}

        {/* Crowd mode hint */}
        {running && faces.length >= 3 && (
          <div
            style={{
              position: 'absolute',
              right: 12,
              top: 12,
              background: 'rgba(255,255,255,.08)',
              border: '1px solid #ffffff33',
              color: '#fff',
              padding: '6px 10px',
              borderRadius: 10,
              fontSize: 12,
            }}
          >
            وضع الحشود: تتبع حتى {MAX_FACES} أشخاص
          </div>
        )}

        {/* Coach bubble */}
        {running && <Coach faces={faces} />}
      </div>
    </div>
  )
}
