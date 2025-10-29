import { createContext, useContext, useState, ReactNode } from 'react'

export type Persona = {
  name?: string
  role: 'Founder' | 'Investor' | 'Student' | 'Executive'
  goal: 'Prototype' | 'Launch' | 'Scale'
  risk: 1 | 2 | 3 | 4 | 5
  emotion?: string | null
}

const DEFAULT: Persona = {
  role: 'Founder',
  goal: 'Prototype',
  risk: 3,
  emotion: null,
}

type Ctx = {
  persona: Persona
  setPersona: (p: Partial<Persona>) => void
}

const PersonaCtx = createContext<Ctx>({ persona: DEFAULT, setPersona: () => {} })

export function PersonaProvider({ children, initialEmotion }: { children: ReactNode; initialEmotion?: string | null }) {
  const [persona, setPersonaState] = useState<Persona>({ ...DEFAULT, emotion: initialEmotion ?? null })
  const setPersona = (p: Partial<Persona>) => setPersonaState(prev => ({ ...prev, ...p }))
  return <PersonaCtx.Provider value={{ persona, setPersona }}>{children}</PersonaCtx.Provider>
}

export function usePersona() {
  return useContext(PersonalCtxFix())
}

// workaround for hot-reload type edge
function PersonalCtxFix(){ return PersonaCtx }
