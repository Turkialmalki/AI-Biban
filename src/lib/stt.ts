// src/lib/stt.ts
export async function transcribeArabicBlob(
  blob: Blob,
  opts?: { speakerId?: number }
) {
  const fd = new FormData();
  fd.append("audio", blob, "chunk.webm");

  const res = await fetch("http://127.0.0.1:8000/stt", {
    method: "POST",
    body: fd,
  });

  if (!res.ok) {
    return { text: "", speakerId: opts?.speakerId ?? null };
  }

  const data = await res.json();
  return {
    text: (data.text || "").trim(),
    speakerId: opts?.speakerId ?? null,
  };
}
