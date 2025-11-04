// src/components/InteractiveCamera.tsx
import * as faceapi from "face-api.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeArabicBlob } from "../lib/stt";
import { useSpeech } from "../hooks/useSpeech";
import { openHtmlReport } from "../lib/htmlReport";

const MODEL_URL = "/models";

const MAX_FACES = 8;
const TICK_MS = 140;
const REID_THRESH = 0.42;
const SCORE_THRESH = 0.5;
const MIN_HRATIO = 0.08;
const NEW_ID_CONFIRM_FRAMES = 3;
const ID_TTL_MS = 60_000;
const SPEAK_OPEN = 0.32;
const SPEAK_MIN_FRAMES = 4;
const MOTION_THRESHOLD = 8;
const INACTIVITY_SEC = 25;
const DEEP_EVERY = 8;

export type SessionEvent =
  | { t: number; kind: "face"; faces: number }
  | { t: number; kind: "emotion"; face: number; emotion: string }
  | { t: number; kind: "speakingStart"; face: number }
  | { t: number; kind: "speakingStop"; face: number }
  | { t: number; kind: "snapshot"; dataUrl: string; note: string };

type SpeechEntry = {
  t: number;
  speakerId: number | null;
  text: string;
};

export type SessionReport = {
  startedAt: number;
  endedAt?: number;
  durationSec?: number;
  highlights: Array<{ t: number; note: string; dataUrl?: string }>;
  kpis: {
    uniqueFaces: number;
    peaks: number;
    speakingTurns: number;
    avgMotion: number;
    dominantEmotions: Record<string, number>;
  };
  timeline: SessionEvent[];
  speech: SpeechEntry[];
  uploadUrl?: string;
};

type FaceTrack = {
  id: number;
  name?: string;
  bbox: faceapi.Box;
  emotion: string;
  emotionScore: number;
  speaking: boolean;
  motion: number;
  gaze: "Left" | "Right" | "Center";
  distance: "Near" | "Mid" | "Far";
  descriptor?: Float32Array;
};

type BankItem = { id: number; descriptor: Float32Array; lastSeen: number };
type Candidate = {
  descriptor: Float32Array;
  lastBox: faceapi.Box;
  frames: number;
  updatedAt: number;
};

export default function InteractiveCamera({
  onReport,
}: {
  onReport?: (r: SessionReport) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const diffRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));

  // ✅ Web Speech من المتصفح (اختياري كمصدر إضافي)
  const speech = useSpeech("ar-SA");
  const [liveTranscript, setLiveTranscript] = useState<string>("");

  const [modelsReady, setModelsReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [faces, setFaces] = useState<FaceTrack[]>([]);
  const [session, setSession] = useState<SessionReport | null>(null);

  // re-id
  const reidBank = useRef<BankItem[]>([]);
  const nextId = useRef(1);
  const candidates = useRef<Candidate[]>([]);

  const speakFrames = useRef<Record<number, number>>({});
  const speakingNow = useRef<number | null>(null);
  const edges = useRef<Map<string, number>>(new Map());
  const lastSnapshotAt = useRef(0);
  const lastSeenAt = useRef<number>(Date.now());

  // MIC + STT (باكند محلي)
  const [micOn, setMicOn] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const sttBusyRef = useRef(false);

  // 1) تحميل المودلز
  useEffect(() => {
    const load = async () => {
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ]);
        setModelsReady(true);
      } catch {
        setError("تعذّر تحميل النماذج من /models");
      }
    };
    load();
  }, []);

  // 2) لو Web Speech رجّع نص → ضيفه للجلسة
  useEffect(() => {
    if (!speech.lastResult?.text) return;
    const text = speech.lastResult.text.trim();
    if (!text) return;
    setLiveTranscript((prev) => (prev ? prev + " " + text : text));
    setSession((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        speech: [
          ...(prev.speech || []),
          { t: speech.lastResult.at, speakerId: 1, text },
        ],
      };
    });
  }, [speech.lastResult]);

  // تشغيل الكاميرا
  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // reset
      reidBank.current = [];
      candidates.current = [];
      nextId.current = 1;
      speakFrames.current = {};
      speakingNow.current = null;
      edges.current = new Map();
      lastSnapshotAt.current = 0;
      lastSeenAt.current = Date.now();
      setLiveTranscript("");

      setSession({
        startedAt: Date.now(),
        highlights: [],
        kpis: {
          uniqueFaces: 0,
          peaks: 0,
          speakingTurns: 0,
          avgMotion: 0,
          dominantEmotions: {},
        },
        timeline: [],
        speech: [],
      });

      setRunning(true);
    } catch {
      setError("لا يمكن الوصول للكاميرا");
    }
  }, []);

  const stopMic = useCallback(() => {
    mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    mediaRecorderRef.current = null;
    setMicOn(false);
  }, []);

  // إيقاف الكاميرا
  const stop = useCallback(() => {
    setRunning(false);
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream)
        .getTracks()
        .forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    if (micOn) stopMic();
    setFaces([]);
    setSession((prev) => {
      if (!prev) return prev;
      const dur = Math.max(1, Math.round((Date.now() - prev.startedAt) / 1000));
      return { ...prev, endedAt: Date.now(), durationSec: dur };
    });
  }, [micOn, stopMic]);

  const resetUnique = useCallback(() => {
    reidBank.current = [];
    candidates.current = [];
    nextId.current = 1;
  }, []);

  // ✅ المايك الخارجي → نسجّل chunks قصيرة ونرسلها للـ STT
  async function startMic() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(s, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mr;
      setMicOn(true);

      mr.ondataavailable = async (e) => {
        if (!e.data || e.data.size === 0) return;
        await flushAndTranscribe(e.data);
      };

      // chunks كل ثانية (أسرع)
      mr.start(1000);
    } catch (e) {
      console.warn("mic err", e);
    }
  }

  async function flushAndTranscribe(chunk?: Blob) {
    if (sttBusyRef.current) return;
    const blob = chunk;
    if (!blob || blob.size === 0) return;
    sttBusyRef.current = true;
    try {
      const speaker = speakingNow.current;
      const { text } = await transcribeArabicBlob(blob, { speakerId: speaker });
      if (text && text.trim().length > 0) {
        setLiveTranscript((prev) => (prev ? prev + " " + text : text));
        setSession((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            speech: [
              ...prev.speech,
              { t: Date.now(), speakerId: speaker ?? 1, text },
            ],
          };
        });
      }
    } catch (err) {
      console.warn("stt err", err);
    } finally {
      sttBusyRef.current = false;
    }
  }

  // motion
  function computeMotion(): number {
    const v = videoRef.current!;
    const c = diffRef.current;
    const w = (c.width = v.videoWidth);
    const h = (c.height = v.videoHeight);
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    const prev = ctx.getImageData(0, 0, w, h);
    ctx.drawImage(v, 0, 0, w, h);
    const curr = ctx.getImageData(0, 0, w, h);
    let diff = 0;
    for (let i = 0; i < curr.data.length; i += 4) {
      const d =
        Math.abs(curr.data[i] - prev.data[i]) +
        Math.abs(curr.data[i + 1] - prev.data[i + 1]) +
        Math.abs(curr.data[i + 2] - prev.data[i + 2]);
      if (d > 60) diff++;
    }
    return (diff / (w * h)) * 100;
  }

  function mouthOpenRatio(lms: faceapi.FaceLandmarks68): number {
    const mouth = lms.getMouth();
    const top = mouth[13];
    const bottom = mouth[19];
    const left = mouth[0];
    const right = mouth[6];
    const open = Math.hypot(top.y - bottom.y, top.x - bottom.x);
    const width = Math.hypot(left.x - right.x, left.y - right.y);
    return open / width;
  }

  function cosineDist(a: Float32Array, b: Float32Array) {
    let dot = 0,
      na = 0,
      nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  function iou(a: faceapi.Box, b: faceapi.Box) {
    const ax2 = a.x + a.width;
    const ay2 = a.y + a.height;
    const bx2 = b.x + b.width;
    const by2 = b.y + b.height;
    const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
    const inter = ix * iy;
    const ua = a.width * a.height + b.width * b.height - inter;
    return ua > 0 ? inter / ua : 0;
  }

  function overlayDraw(tracks: FaceTrack[]) {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d")!;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();

    drawHeatmap(ctx, diffRef.current);

    for (const ft of tracks) {
      const { x, y, width, height } = ft.bbox;
      ctx.strokeStyle = "rgba(34,197,94,0.9)";
      ctx.lineWidth = 3;
      ctx.strokeRect(canvas.width - (x + width), y, width, height);

      ctx.fillStyle = "rgba(0,0,0,.6)";
      ctx.fillRect(canvas.width - (x + width), y - 24, width, 24);
      ctx.fillStyle = "#fff";
      ctx.font = "700 14px system-ui";
      const label =
        `${ft.name ? ft.name : "#" + ft.id} ${emojiFor(ft.emotion)} ${
          ft.emotion
        }` +
        (ft.speaking ? " 🎙️" : "") +
        `  ${ft.gaze}/${ft.distance}  mot:${ft.motion.toFixed(0)}%`;
      ctx.fillText(label, canvas.width - (x + width) + 6, y - 6);
    }
  }

  function emojiFor(em: string) {
    const map: Record<string, string> = {
      happy: "😊",
      surprised: "😯",
      sad: "😔",
      angry: "😠",
      fearful: "😨",
      disgusted: "🤢",
      neutral: "😐",
    };
    return map[em] ?? "🙂";
  }

  function drawHeatmap(
    ctx: CanvasRenderingContext2D,
    diffCanvas: HTMLCanvasElement
  ) {
    const w = diffCanvas.width,
      h = diffCanvas.height;
    if (!w || !h) return;
    const cell = 48;
    const gridX = Math.ceil(w / cell),
      gridY = Math.ceil(h / cell);
    const dctx = diffCanvas.getContext("2d")!;
    const data = dctx.getImageData(0, 0, w, h).data;
    ctx.save();
    ctx.globalAlpha = 0.25;
    for (let gy = 0; gy < gridY; gy++) {
      for (let gx = 0; gx < gridX; gx++) {
        let hot = 0,
          count = 0;
        const x0 = gx * cell,
          y0 = gy * cell;
        for (let y = y0; y < Math.min(y0 + cell, h); y++) {
          for (let x = x0; x < Math.min(x0 + cell, w); x++) {
            const i = (y * w + x) * 4;
            const val = Math.max(data[i], data[i + 1], data[i + 2]);
            if (val > 180) hot++;
            count++;
          }
        }
        const p = hot / count;
        if (p > 0.05) {
          ctx.fillStyle = `rgba(255,165,0,${Math.min(0.4, p * 2)})`;
          ctx.fillRect(ctx.canvas.width - (x0 + cell), y0, cell, cell);
        }
      }
    }
    ctx.restore();
  }

  function handleClickAssignName(e: React.MouseEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const mx = canvas.width - x;
    const my = y;
    const hit = faces.find(
      (f) =>
        mx >= f.bbox.x &&
        mx <= f.bbox.x + f.bbox.width &&
        my >= f.bbox.y &&
        my <= f.bbox.y + f.bbox.height
    );
    if (hit) {
      const name = prompt(`اسم للشخص #${hit.id}`, hit.name || "");
      if (name) {
        setFaces((prev) =>
          prev.map((p) => (p.id === hit.id ? { ...p, name } : p))
        );
      }
    }
  }

  // الحلقة الرئيسية
  useEffect(() => {
    if (!modelsReady || !running) return;

    let raf = 0;
    let timer = 0;
    let frameCount = 0; // نعد الفريمات هنا فقط

    const loop = async () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !video.videoWidth) {
        raf = requestAnimationFrame(loop);
        return;
      }

      try {
        frameCount++;

        // 1) كشف وجوه خفيف (كل الفريمات)
        const baseDetections = await faceapi
          .detectAllFaces(
            video,
            new faceapi.TinyFaceDetectorOptions({
              inputSize: 224, // أخف
              scoreThreshold: SCORE_THRESH,
            })
          )
          .withFaceLandmarks()
          .withFaceExpressions();

        // نفلتر القريب/الصغير
        const filteredBase = baseDetections
          .filter(
            (d) => d.detection.box.height / video.videoHeight >= MIN_HRATIO
          )
          .sort((a, b) => b.detection.box.height - a.detection.box.height)
          .slice(0, MAX_FACES);

        // 2) كل كم فريم نجيب descriptors
        let detections: Array<any> = filteredBase;
        if (frameCount % DEEP_EVERY === 0) {
          const deep = await faceapi
            .detectAllFaces(
              video,
              new faceapi.TinyFaceDetectorOptions({
                inputSize: 224,
                scoreThreshold: SCORE_THRESH,
              })
            )
            .withFaceLandmarks()
            .withFaceExpressions()
            .withFaceDescriptors();

          detections = deep
            .filter((d) => d.descriptor && d.detection.score >= SCORE_THRESH)
            .filter(
              (d) => d.detection.box.height / video.videoHeight >= MIN_HRATIO
            )
            .sort((a, b) => b.detection.box.height - a.detection.box.height)
            .slice(0, MAX_FACES);
        }

        // 3) الحركة
        const motion = computeMotion();

        const tracks: FaceTrack[] = [];
        const now = Date.now();

        // تنظيف البنك
        reidBank.current = reidBank.current.filter(
          (p) => now - p.lastSeen < ID_TTL_MS
        );
        candidates.current = candidates.current.filter(
          (c) => now - c.updatedAt < 2000
        );

        // المصدر للفريم الحالي
        const sourceForTracking =
          frameCount % DEEP_EVERY === 0 ? detections : filteredBase;

        for (const det of sourceForTracking) {
          const box = det.detection.box;
          const { emotion, score } = topEmotion(det.expressions as any);
          const ratio = mouthOpenRatio(det.landmarks);
          const gaze = gazeFrom(det.landmarks);
          const hRatio = box.height / video.videoHeight;
          const distance =
            hRatio > 0.45 ? "Near" : hRatio > 0.28 ? "Mid" : "Far";

          if (frameCount % DEEP_EVERY === 0 && det.descriptor) {
            const descriptor = det.descriptor as Float32Array;

            // bank match
            let matchedId = -1;
            let best = 1e9;
            for (const p of reidBank.current) {
              const d = cosineDist(descriptor, p.descriptor);
              if (d < best) {
                best = d;
                matchedId = p.id;
              }
            }

            if (matchedId !== -1 && best <= REID_THRESH) {
              const bank = reidBank.current.find((p) => p.id === matchedId)!;
              bank.lastSeen = now;
              for (let i = 0; i < bank.descriptor.length; i++) {
                bank.descriptor[i] =
                  (bank.descriptor[i] * 3 + descriptor[i]) / 4;
              }

              const prevFrames = speakFrames.current[matchedId] || 0;
              if (ratio > SPEAK_OPEN)
                speakFrames.current[matchedId] = prevFrames + 1;
              else if (prevFrames > 0)
                speakFrames.current[matchedId] = prevFrames - 1;
              const speaking =
                speakFrames.current[matchedId] >= SPEAK_MIN_FRAMES;

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
              });
              continue;
            }

            // candidates
            let cand = -1;
            let candBest = 1e9;
            for (let i = 0; i < candidates.current.length; i++) {
              const c = candidates.current[i];
              const dd = cosineDist(descriptor, c.descriptor);
              const ov = iou(c.lastBox, box);
              const sc = dd - ov * 0.1;
              if (sc < candBest) {
                candBest = sc;
                cand = i;
              }
            }

            if (cand !== -1) {
              const c = candidates.current[cand];
              const cd = cosineDist(descriptor, c.descriptor);
              const ov = iou(c.lastBox, box);
              if (cd <= REID_THRESH && ov > 0.05) {
                c.frames += 1;
                c.updatedAt = now;
                c.lastBox = box;
                for (let i = 0; i < c.descriptor.length; i++) {
                  c.descriptor[i] = (c.descriptor[i] * 3 + descriptor[i]) / 4;
                }
                if (c.frames >= NEW_ID_CONFIRM_FRAMES) {
                  const newId = nextId.current++;
                  reidBank.current.push({
                    id: newId,
                    descriptor: c.descriptor,
                    lastSeen: now,
                  });

                  candidates.current.splice(cand, 1);

                  const speaking = ratio > SPEAK_OPEN;

                  tracks.push({
                    id: newId,
                    bbox: box,
                    emotion,
                    emotionScore: score,
                    speaking,
                    motion,
                    gaze,
                    distance,
                  });
                  continue;
                } else {
                  continue;
                }
              }
            }

            // جديد → مرشح
            candidates.current.push({
              descriptor: new Float32Array(descriptor),
              lastBox: box,
              frames: 1,
              updatedAt: now,
            });
          } else {
            // فريم خفيف
            tracks.push({
              id: -1,
              bbox: box,
              emotion,
              emotionScore: score,
              speaking: ratio > SPEAK_OPEN,
              motion,
              gaze,
              distance,
            });
          }
        }

        if (tracks.length > 0) lastSeenAt.current = Date.now();

        setFaces(tracks);
        overlayDraw(tracks);

        // 5) تحديث session
        setSession((prev) => {
          if (!prev) return prev;

          const tl = [
            ...prev.timeline,
            { t: Date.now(), kind: "face", faces: tracks.length },
          ];

          const dom: Record<string, number> = {
            ...prev.kpis.dominantEmotions,
          };
          tracks.forEach((ft) => {
            if (ft.emotion !== "neutral") {
              dom[ft.emotion] = (dom[ft.emotion] || 0) + 1;
            }
          });

          const currentSpeaker =
            tracks.find((t) => t.speaking && t.id > 0)?.id ?? null;
          if (
            currentSpeaker !== speakingNow.current &&
            currentSpeaker != null &&
            speakingNow.current != null
          ) {
            const key = `${speakingNow.current}->${currentSpeaker}`;
            edges.current.set(key, (edges.current.get(key) || 0) + 1);
            tl.push({
              t: Date.now(),
              kind: "speakingStart",
              face: currentSpeaker,
            });
          }
          speakingNow.current = currentSpeaker;

          const now2 = Date.now();
          const peak =
            tracks.some(
              (ft) => ft.emotion !== "neutral" && (ft.emotionScore || 0) > 0.9
            ) || motion > MOTION_THRESHOLD + 10;

          if (peak && now2 - lastSnapshotAt.current > 4000) {
            const snap = canvas.toDataURL("image/jpeg", 0.85);
            tl.push({
              t: now2,
              kind: "snapshot",
              dataUrl: snap,
              note: "Highlight moment",
            });
            lastSnapshotAt.current = now2;
          }

          const avgMotion =
            (prev.kpis.avgMotion * Math.max(1, tl.length - 1) +
              (tracks[0]?.motion || 0)) /
            Math.max(1, tl.length);

          return {
            ...prev,
            kpis: {
              uniqueFaces: Math.max(
                prev.kpis.uniqueFaces,
                reidBank.current.length
              ),
              peaks: prev.kpis.peaks + (peak ? 1 : 0),
              speakingTurns: prev.kpis.speakingTurns,
              avgMotion,
              dominantEmotions: dom,
            },
            timeline: tl,
          };
        });

        // 6) إيقاف تلقائي
        const idleFor = (Date.now() - lastSeenAt.current) / 1000;
        if (idleFor > INACTIVITY_SEC && motion < 1.2) {
          stop();
        }
      } catch {
        // ignore
      }

      raf = requestAnimationFrame(loop);
    };

    // نضمن التكرار
    timer = window.setInterval(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    }, TICK_MS);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
    };
  }, [modelsReady, running, stop]);

  function topEmotion(exps: Record<string, number>) {
    const sorted = Object.entries(exps).sort((a, b) => b[1] - a[1]);
    const [emotion, score] = sorted[0] as [string, number];
    return { emotion, score };
  }
  function gazeFrom(lm: faceapi.FaceLandmarks68) {
    const eye = lm.getLeftEye();
    return eye[0].y - eye[3].y > 2
      ? "Left"
      : eye[3].y - eye[0].y > 2
      ? "Right"
      : "Center";
  }

  // ✅ التصدير HTML (العربي يظهر تمام)
  const exportReport = useCallback(async () => {
    if (!session) return;
    openHtmlReport(session, reidBank.current.length);
    onReport?.(session);
  }, [session, onReport]);

  const exportJSON = useCallback(() => {
    if (!session) return;
    const social = Array.from(edges.current.entries()).map(([k, v]) => ({
      edge: k,
      count: v,
    }));
    const data = {
      ...session,
      uniqueFaces: reidBank.current.length,
      socialGraph: social,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `camera-session-${Date.now()}.json`;
    a.click();
  }, [session]);

  const exportCSV = useCallback(() => {
    if (!session) return;
    const lines = ["t,kind,meta"];
    session.timeline.forEach((ev) => {
      if (ev.kind === "face") lines.push(`${ev.t},face,${(ev as any).faces}`);
      else if (ev.kind === "emotion")
        lines.push(
          `${ev.t},emotion,${(ev as any).face}:${(ev as any).emotion}`
        );
      else if (ev.kind === "speakingStart")
        lines.push(`${ev.t},speakingStart,${(ev as any).face}`);
      else if (ev.kind === "speakingStop")
        lines.push(`${ev.t},speakingStop,${(ev as any).face}`);
      else if (ev.kind === "snapshot")
        lines.push(`${ev.t},snapshot,${(ev as any).note}`);
    });
    session.speech.forEach((s) => {
      lines.push(
        `${s.t},speech,${s.speakerId ?? "anon"}: ${s.text.replace(/,/g, " ")}`
      );
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `camera-session-${Date.now()}.csv`;
    a.click();
  }, [session]);

  function Coach({ faces }: { faces: FaceTrack[] }) {
    const f = faces;
    let msg = "اقترب من الكاميرا لبدء التجربة";
    if (f.length === 1) {
      msg = f[0].speaking
        ? "نسجّل كلامك ونعرضه في التقرير 👌"
        : "تقدر تتكلم بالعربي، راح نكتب كلامك ✨";
    } else if (f.length >= 2) {
      msg = "وضع مقابلة/نقاش: تقدروا تتكلمون، وراح نفرّغ الكلام";
    }
    return (
      <div
        style={{
          position: "absolute",
          left: 16,
          bottom: 16,
          background: "rgba(0,0,0,.5)",
          border: "1px solid #ffffff33",
          backdropFilter: "blur(6px)",
          color: "#fff",
          padding: "8px 12px",
          borderRadius: 10,
          fontSize: 13,
        }}
      >
        {msg}
      </div>
    );
  }

  const btn = (primary: boolean): React.CSSProperties => ({
    background: primary
      ? "linear-gradient(135deg,#ef4444,#f59e0b)"
      : "linear-gradient(135deg,#16a34a,#0ea5e9)",
    color: "#fff",
    fontWeight: 800,
    padding: "10px 14px",
    borderRadius: 12,
    border: "none",
    cursor: "pointer",
  });

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <button onClick={running ? stop : start} style={btn(running)}>
          {running ? "إيقاف الكاميرا" : "تشغيل الكاميرا"}
        </button>
        <button onClick={micOn ? stopMic : startMic} style={btn(false)}>
          {micOn
            ? "إيقاف الميكروفون + التفريغ"
            : "تشغيل المايك + التفريغ بالعربي"}
        </button>
        <button onClick={resetUnique} style={btn(false)}>
          تصفير إجمالي فريد
        </button>

        {/* أزرار التصدير بعد الإيقاف */}
        {session && !running && (
          <>
            <button onClick={exportReport} style={btn(false)}>
              تقرير الجلسة (HTML/PDF)
            </button>
            <button onClick={exportCSV} style={btn(false)}>
              CSV
            </button>
            <button onClick={exportJSON} style={btn(false)}>
              JSON
            </button>
          </>
        )}

        {!modelsReady && (
          <span style={{ opacity: 0.8 }}>جاري تحميل النماذج…</span>
        )}
        {error && <span style={{ color: "#ef4444" }}>{error}</span>}
      </div>

      {/* ✅ التفريغ الحي تحت الأزرار مباشرة */}
      {micOn && (
        <div
          style={{
            background: "rgba(0,0,0,.40)",
            border: "1px solid #ffffff22",
            borderRadius: 12,
            padding: "10px 12px",
            fontSize: 13,
            lineHeight: 1.7,
          }}
        >
          <div style={{ opacity: 0.7, marginBottom: 6 }}>التفريغ الحي:</div>
          <div dir="auto">{liveTranscript || "… تكلّم بالعربي"}</div>
          <div style={{ marginTop: 8 }}>
            <button
              onClick={() => setLiveTranscript("")}
              style={{
                background: "transparent",
                color: "#fff",
                border: "1px solid #ffffff33",
                borderRadius: 10,
                padding: "6px 10px",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              تفريغ النص
            </button>
          </div>
        </div>
      )}

      {/* شريط حالة Web Speech (اختياري) */}
      <div style={{ fontSize: 12, opacity: 0.7 }}>
        {speech.supported ? (
          speech.listening ? (
            <>🎤 Web Speech: يعمل الآن</>
          ) : (
            <>🎤 Web Speech متاح (يمكن تشغيله من الكود)</>
          )
        ) : (
          <>🎤 قد لا يدعم هذا المتصفح Web Speech API</>
        )}
      </div>

      <div
        style={{
          position: "relative",
          border: "1px solid #ffffff22",
          borderRadius: 16,
          overflow: "hidden",
        }}
        onClick={handleClickAssignName}
      >
        <video ref={videoRef} playsInline muted style={{ display: "none" }} />
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "56vh", background: "#0b0f19" }}
        />

        {running && (
          <div
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              background: "rgba(0,0,0,.45)",
              border: "1px solid #ffffff33",
              color: "#fff",
              padding: "6px 10px",
              borderRadius: 10,
              fontSize: 12,
            }}
          >
            الحضور الآن: <b>{reidBank.current.length}</b>
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
              “إجمالي فريد” = الأشخاص المختلفون المؤكدون خلال الجلسة
            </div>
          </div>
        )}

        {running && faces.length >= 3 && (
          <div
            style={{
              position: "absolute",
              right: 12,
              top: 12,
              background: "rgba(255,255,255,.08)",
              border: "1px solid #ffffff33",
              color: "#fff",
              padding: "6px 10px",
              borderRadius: 10,
              fontSize: 12,
            }}
          >
            وضع الحشود: تتبع حتى {MAX_FACES} أشخاص
          </div>
        )}

        {running && <Coach faces={faces} />}
      </div>
    </div>
  );
}
