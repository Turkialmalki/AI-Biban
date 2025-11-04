// src/hooks/useSpeech.ts
import { useCallback, useEffect, useRef, useState } from "react";

type SpeechPiece = {
  text: string;
  lang: string;
  at: number;
};

export function useSpeech(lang: string = "ar-SA") {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SpeechPiece | null>(null);
  const recogRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const r: SpeechRecognition = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    recogRef.current = r;
    setSupported(true);

    r.onresult = (ev: SpeechRecognitionEvent) => {
      // ناخذ آخر نتيجة
      const res = ev.results[ev.results.length - 1];
      if (!res) return;
      const txt = res[0].transcript.trim();
      // لو النتيجة نهائية → نحفظها
      if (res.isFinal) {
        setLastResult({
          text: txt,
          lang,
          at: Date.now(),
        });
      }
    };

    r.onerror = (ev) => {
      console.warn("speech err", ev.error);
      setError(ev.error || "speech-error");
      setListening(false);
    };

    r.onend = () => {
      // عشان نستمر
      setListening(false);
    };
  }, [lang]);

  const start = useCallback(() => {
    setError(null);
    const r = recogRef.current;
    if (!r) return;
    try {
      r.lang = lang;
      r.start();
      setListening(true);
    } catch (e) {
      console.warn(e);
    }
  }, [lang]);

  const stop = useCallback(() => {
    const r = recogRef.current;
    if (!r) return;
    r.stop();
    setListening(false);
  }, []);

  return {
    supported,
    listening,
    error,
    start,
    stop,
    lastResult,
  };
}
