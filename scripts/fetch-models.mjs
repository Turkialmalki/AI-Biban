import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'

const BASE = 'https://justadudewhohacks.github.io/face-api.js/models'
const OUT = path.join(process.cwd(), 'public', 'models')

// الملفات المطلوبة لهذه الشبكات الأربع (11 ملفًا)
const FILES = [
  // tiny face detector
  'tiny_face_detector_model-weights_manifest.json',
  'tiny_face_detector_model-shard1.bin',

  // face landmark 68
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model-shard1.bin',
  'face_landmark_68_model-shard2.bin',

  // face expression
  'face_expression_model-weights_manifest.json',
  'face_expression_model-shard1.bin',

  // face recognition (re-ID)
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model-shard1.bin',
  'face_recognition_model-shard2.bin',
  'face_recognition_model-shard3.bin',
]

fs.mkdirSync(OUT, { recursive: true })

function fetchOne(file) {
  const url = `${BASE}/${file}`
  const dest = path.join(OUT, file)
  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(dest)
    https.get(url, res => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
      res.pipe(fileStream)
      fileStream.on('finish', () => fileStream.close(() => resolve()))
    }).on('error', reject)
  })
}

;(async () => {
  try {
    for (const f of FILES) {
      console.log('Downloading', f)
      // eslint-disable-next-line no-await-in-loop
      await fetchOne(f)
    }
    console.log('✅ Models saved to', OUT)
  } catch (e) {
    console.error('❌ Download failed:', e?.message || e)
    process.exit(1)
  }
})()
