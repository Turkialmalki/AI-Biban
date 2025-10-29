import { useEffect, useState } from 'react'
import { usePersona } from '../context/PersonaContext'

export default function PersonaWizard({ open, onClose, lastEmotion }: { open: boolean; onClose: () => void; lastEmotion?: string | null }) {
  const { persona, setPersona } = usePersona()
  const [name, setName] = useState(persona.name ?? '')
  const [role, setRole] = useState(persona.role)
  const [goal, setGoal] = useState(persona.goal)
  const [risk, setRisk] = useState<number>(persona.risk)
  useEffect(() => { if (lastEmotion) setPersona({ emotion: lastEmotion }) }, [lastEmotion])

  if (!open) return null
  return (
    <div style={backdrop}>
      <div style={modal}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
          <div style={{fontSize:18, fontWeight:800}}>نتعرف على شخصيتك</div>
          <button onClick={onClose} style={xBtn}>×</button>
        </div>

        <div style={{display:'grid', gap:12}}>
          <L>الاسم (اختياري)</L>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="مثال: تركي" style={input}/>

          <L>دورك اليوم</L>
          <div style={chips}>
            {(['Founder','Investor','Student','Executive'] as const).map(r=>(
              <button key={r} onClick={()=>setRole(r)} style={chip(role===r)}>{arRole(r)}</button>
            ))}
          </div>

          <L>هدفك القريب</L>
          <div style={chips}>
            {(['Prototype','Launch','Scale'] as const).map(g=>(
              <button key={g} onClick={()=>setGoal(g)} style={chip(goal===g)}>{arGoal(g)}</button>
            ))}
          </div>

          <L>مدى تقبّل المخاطرة: {risk}/5</L>
          <input type="range" min={1} max={5} value={risk} onChange={e=>setRisk(parseInt(e.target.value))}/>

          <div style={{opacity:.7, fontSize:12}}>
            آخر انطباع من الكاميرا: <b>{lastEmotion ?? '—'}</b>
          </div>

          <div style={{display:'flex', gap:8, marginTop:6}}>
            <button
              onClick={()=>{
                setPersona({ name, role, goal, risk: risk as any, emotion: lastEmotion ?? persona.emotion })
                onClose()
              }}
              style={btnPrimary}
            >احفظ وابدأ</button>
            <button onClick={onClose} style={btnGhost}>إغلاق</button>
          </div>
        </div>
      </div>
    </div>
  )
}

const backdrop: React.CSSProperties = { position:'fixed', inset:0, background:'rgba(0,0,0,.5)', display:'grid', placeItems:'center', zIndex:1000 }
const modal: React.CSSProperties = { width:680, maxWidth:'95vw', background:'rgba(16,22,35,.96)', border:'1px solid #ffffff22', borderRadius:16, padding:16 }
const input: React.CSSProperties = { background:'rgba(255,255,255,.06)', border:'1px solid #ffffff22', color:'#fff', padding:'10px 12px', borderRadius:10, outline:'none' }
const chips: React.CSSProperties = { display:'flex', gap:8, flexWrap:'wrap' }
const chip = (active:boolean): React.CSSProperties => ({ padding:'8px 12px', borderRadius:999, cursor:'pointer', border:'1px solid '+(active?'#22c55e':'#ffffff33'), background: active?'#22c55e33':'transparent', color:'#fff' })
const btnPrimary: React.CSSProperties = { background:'linear-gradient(135deg,#16a34a,#0ea5e9)', color:'#fff', fontWeight:800, padding:'10px 16px', borderRadius:12, border:'none', cursor:'pointer' }
const btnGhost: React.CSSProperties = { background:'transparent', color:'#fff', border:'1px solid #ffffff33', padding:'8px 12px', borderRadius:10 }
const xBtn: React.CSSProperties = { background:'transparent', color:'#fff', border:'none', fontSize:22, cursor:'pointer' }

function L({children}:{children:any}){ return <div style={{opacity:.85}}>{children}</div> }
function arRole(r: any){ return r==='Founder'?'ريادي':r==='Investor'?'مستثمر':r==='Student'?'طالب':'تنفيذي' }
function arGoal(g:any){ return g==='Prototype'?'نموذج أوّلي':g==='Launch'?'إطلاق':'توسّع' }
