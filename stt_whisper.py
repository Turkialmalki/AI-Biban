# stt_whisper.py
import io, os, subprocess, tempfile
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel

MODEL_NAME = os.getenv("WHISPER_MODEL", "small")  # 👈 خليها small
DEVICE = "cpu"  # لو عندك m1/m2 وجربت mps حلو
COMPUTE = "int8"  # سريع

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

print("[STT] loading whisper model…")
model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE, cpu_threads=4)
print("[STT] model loaded ✅")

def to_wav_16k(src_bytes: bytes) -> bytes:
  with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
    f.write(src_bytes)
    f.flush()
    in_path = f.name
  out_path = in_path + ".wav"
  subprocess.run(
    ["ffmpeg", "-y", "-i", in_path, "-ac", "1", "-ar", "16000", out_path],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
  )
  data = open(out_path, "rb").read()
  try: os.remove(in_path)
  except: ...
  try: os.remove(out_path)
  except: ...
  return data

@app.post("/stt")
async def stt(audio: UploadFile = File(...)):
  raw = await audio.read()
  wav16 = to_wav_16k(raw)

  segments, info = model.transcribe(
      io.BytesIO(wav16),
      language="ar",
      beam_size=1,          # 👈 أسرع
      vad_filter=True,      # 👈 يتجاهل السكتات
      vad_parameters={"min_silence_duration_ms": 350},
  )
  texts = [seg.text.strip() for seg in segments if seg.text.strip()]
  return {
      "text": " ".join(texts),
      "language": info.language,
      "duration": info.duration,
  }
