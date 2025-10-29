import { motion } from 'framer-motion'

export type Persona = {
  title: string
  subtitle: string
  color: string
}

export const personaFromEmotion = (emotion: string | null): Persona => {
  switch (emotion) {
    case 'happy':
      return { title: 'مبتكر متفائل', subtitle: 'يرى الحلول قبل المشاكل', color: '#22c55e' }
    case 'surprised':
      return { title: 'مغامر رقمي', subtitle: 'يكتشف فرصًا غير متوقعة', color: '#06b6d4' }
    case 'neutral':
      return { title: 'مصمم أنظمة', subtitle: 'دقيق.. يبني الأسس المتينة', color: '#a3a3a3' }
    case 'angry':
      return { title: 'مصلح جريء', subtitle: 'يحل جذور المشكلة', color: '#ef4444' }
    case 'sad':
      return { title: 'متعاطف مع المستخدم', subtitle: 'يضع التجربة أولًا', color: '#3b82f6' }
    case 'fearful':
      return { title: 'حارس الموثوقية', subtitle: 'أمان وخصوصية أولًا', color: '#8b5cf6' }
    case 'disgusted':
      return { title: 'ناقد الجودة', subtitle: 'لا يرضى بأقل من الممتاز', color: '#f59e0b' }
    default:
      return { title: 'مبتكر', subtitle: 'جاهز لصناعة المستقبل', color: '#10b981' }
  }
}

export default function PersonaBadge({ emotion }: { emotion: string | null }) {
  const persona = personaFromEmotion(emotion)
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 120 }}
      style={{
        background: 'rgba(255,255,255,0.06)',
        border: `1px solid ${persona.color}44`,
        boxShadow: `0 0 30px ${persona.color}33 inset`,
        padding: '16px 20px',
        borderRadius: 16,
        backdropFilter: 'blur(8px)',
        minWidth: 280,
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 0.3 }}>{persona.title}</div>
      <div style={{ fontSize: 13, opacity: 0.9, marginTop: 6 }}>{persona.subtitle}</div>
    </motion.div>
  )
}
