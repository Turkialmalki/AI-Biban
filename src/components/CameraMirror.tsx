import * as faceapi from "face-api.js";
import { useEffect, useRef, useState, useCallback } from "react";

const MODEL_URL = "/models";

function toDataUrlResizedJPEG(srcCanvas: HTMLCanvasElement, maxW = 720, quality = 0.72) {
  const w = srcCanvas.width, h = srcCanvas.height
  if (w <= maxW) return srcCanvas.toDataURL('image/jpeg', quality)
  const scale = maxW / w
  const off = document.createElement('canvas')
  off.width = Math.round(w * scale)
  off.height = Math.round(h * scale)
  const ctx = off.getContext('2d')!
  ctx.drawImage(srcCanvas, 0, 0, off.width, off.height)
  return off.toDataURL('image/jpeg', quality)
}


// غيّر التوقيع كما هو
export default function CameraMirror({
  onEmotion,
  onSnapshot,
}: {
  onEmotion: (e: string | null) => void;
  onSnapshot: (dataUrlOrUrl: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [modelsReady, setModelsReady] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [lastSnapAt, setLastSnapAt] = useState(0);

  // ⛔️ قفل منع الرفع المتوازي
  const uploadingRef = useRef(false);

  // تحميل النماذج
  useEffect(() => {
    const load = async () => {
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        ]);
        setModelsReady(true);
      } catch {
        setError("تعذّر تحميل النماذج من /models — تأكّد أنها موجودة.");
      }
    };
    load();
  }, []);

  // تشغيل الكاميرا
  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await new Promise<void>((res) => {
          if (!videoRef.current) return res();
          videoRef.current.onloadedmetadata = () => res();
        });
        await videoRef.current.play();
        setCameraReady(true);
        setStarted(true);
      }
    } catch {
      setError("الكاميرا غير متاحة أو الإذن مرفوض.");
    }
  }, []);

  // رفع الصورة مع قفل + لوج يساعدك تشخّص
 async function saveAndEmit(canvas: HTMLCanvasElement) {
  if (uploadingRef.current) {
    console.log('[upload] skipped: already uploading')
    return
  }
  uploadingRef.current = true

  // JPEG + تصغير قوي لتقليل الحجم
  const dataUrl = toDataUrlResizedJPEG(canvas, 720, 0.72)

  // مهلة 12s لتفادي الشبكات البطيئة
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 12000)

  try {
    console.log('[upload] POST /api/upload …')
    const r = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' }, // ← نص خام بدل JSON
      body: dataUrl,                              // ← مباشرة
      signal: controller.signal,
    })
    if (!r.ok) throw new Error(`upload failed: ${r.status}`)
    const { url } = await r.json()
    console.log('[upload] ok ->', url)
    onSnapshot(url) // رابط قصير للـ QR
  } catch (e) {
    console.warn('[upload] timeout/fail, fallback to dataUrl', e)
    onSnapshot(dataUrl) // بديل: يظهر زر تنزيل حتى لو QR تعذّر
  } finally {
    clearTimeout(t)
    uploadingRef.current = false
  }
}


  // زر التقاط الآن
  const doSnapshot = useCallback(() => {
    if (!canvasRef.current) return;
    setLastSnapAt(Date.now()); // حدّث قبل البدء حتى لا نكرر
    saveAndEmit(canvasRef.current);
  }, []);

  // حلقة الريندر + الالتقاط التلقائي
  const tick = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    if (!video.videoWidth || !video.videoHeight) {
      requestAnimationFrame(tick);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // مرآة حقيقية
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();

    let dominant: string | null = null;
    try {
      const result = await faceapi
        .detectSingleFace(
          video,
          new faceapi.TinyFaceDetectorOptions({ inputSize: 320 })
        )
        .withFaceLandmarks()
        .withFaceExpressions();
      if (result?.expressions) {
        const entries = Object.entries(result.expressions).sort(
          (a, b) => b[1] - a[1]
        );
        dominant = entries[0]?.[0] ?? null;
      }
      onEmotion(dominant || null);
    } catch {}

    // ⏲️ لقطة كل 10 ثواني كحد أقصى، ولا ترفع أثناء رفع قائم
    const now = Date.now();
    if (dominant && !uploadingRef.current && now - lastSnapAt > 10000) {
      setLastSnapAt(now);
      saveAndEmit(canvas);
    }

    requestAnimationFrame(tick);
  }, [lastSnapAt, onEmotion]);

  useEffect(() => {
    if (started && modelsReady && cameraReady) {
      let raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }
  }, [started, modelsReady, cameraReady, tick]);

  return (
    <div style={{ position: "relative" }}>
      <video ref={videoRef} style={{ display: "none" }} playsInline muted />
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 24,
          background: "#0b0f19",
        }}
      />

      {/* أزرار الحالة */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          padding: 16,
          pointerEvents: "none",
        }}
      >
        {!modelsReady && <Badge text="جاري تحميل النماذج…" />}
        {started && cameraReady && (
          <div style={{ pointerEvents: "auto" }}>
            <ActionButton onClick={doSnapshot} label="التقاط الآن" />
          </div>
        )}
        {!started && modelsReady && (
          <div style={{ pointerEvents: "auto" }}>
            <ActionButton onClick={startCamera} label="ابدأ التجربة" />
          </div>
        )}
        {error && <ErrorBadge text={error} />}
      </div>
    </div>
  );
}

function Badge({ text }: { text: string }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.08)",
        border: "1px solid #ffffff33",
        padding: "8px 12px",
        borderRadius: 10,
        backdropFilter: "blur(6px)",
        fontSize: 13,
      }}
    >
      {text}
    </div>
  );
}
function ErrorBadge({ text }: { text: string }) {
  return (
    <div
      style={{
        background: "rgba(239,68,68,0.15)",
        border: "1px solid #ef4444",
        color: "#fff",
        padding: 10,
        borderRadius: 10,
      }}
    >
      {text}
    </div>
  );
}
function ActionButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "linear-gradient(135deg,#16a34a,#0ea5e9)",
        color: "white",
        fontSize: 14,
        fontWeight: 700,
        padding: "10px 14px",
        border: "none",
        borderRadius: 10,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
