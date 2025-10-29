import { useState } from "react";
import CameraMirror from "./components/CameraMirror";
import SnapshotPanel from "./components/SnapshotPanel";
import TimeMachine from "./components/TimeMachine";
import AdvancedPlanner from "./components/AdvancedPlanner";
import PersonaWizard from "./components/PersonaWizard";
import { PersonaProvider } from "./context/PersonaContext";
import InteractiveCamera from "./components/InteractiveCamera";

export default function App() {
  const [emotion, setEmotion] = useState<string | null>(null);
  const [snap, setSnap] = useState<string | null>(null);
  const [openWizard, setOpenWizard] = useState(true); // افتح المعرف عند الدخول

  return (
    <PersonaProvider initialEmotion={emotion}>
      <div style={stage}>
        {/* رأس بسيط */}
        <div
          style={{ maxWidth: 1100, width: "100%", display: "grid", gap: 16 }}
        >
          {/* المرآة في الوسط */}
          <div style={card}>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 900 }}>مرآة الذكاء</div>
              <CameraMirror onEmotion={setEmotion} onSnapshot={setSnap} />
              <SnapshotPanel snapDataUrl={snap} />
              <div style={{ display: "flex", gap: 8 }}>
                <button style={btnPrimary} onClick={() => setOpenWizard(true)}>
                  ابدأ بتحديد شخصيتي
                </button>
              </div>
            </div>
          </div>

          {/* آلة الزمن */}
          <div style={card}>
            <InteractiveCamera />

            <TimeMachine />
          </div>

          {/* المخطط المتقدم */}
          <div style={card}>
            <AdvancedPlanner />
          </div>
        </div>
      </div>

      {/* مُعرّف الشخصية كنافذة وسط الشاشة */}
      <PersonaWizard
        open={openWizard}
        onClose={() => setOpenWizard(false)}
        lastEmotion={emotion}
      />
    </PersonaProvider>
  );
}

const stage: React.CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: "40px 16px",
};
const card: React.CSSProperties = {
  margin: "0 auto",
  maxWidth: 1100,
  width: "100%",
  border: "1px solid #ffffff22",
  borderRadius: 16,
  padding: 16,
  background: "rgba(255,255,255,.03)",
};
const btnPrimary: React.CSSProperties = {
  background: "linear-gradient(135deg,#16a34a,#0ea5e9)",
  color: "#fff",
  fontWeight: 800,
  padding: "10px 16px",
  borderRadius: 12,
  border: "none",
  cursor: "pointer",
};
