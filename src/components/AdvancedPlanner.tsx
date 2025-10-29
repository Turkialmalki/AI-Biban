import { useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import QRCode from "qrcode";
import { SECTOR_PRIORS } from "../data/knowledge";
import type { SectorKey } from "../data/knowledge";
import { usePersona } from "../context/PersonaContext";

const BASE =
  (import.meta as any).env?.VITE_PUBLIC_BASE_URL ||
  (typeof window !== "undefined" ? window.location.origin : "");

type Plan = {
  roadmap: Array<{
    phase: string;
    weeks: number;
    outputs: string[];
    kpis: string[];
  }>;
  team: Array<{ role: string; count: number }>;
  headcountTotal: number;
  monthlyBurnUSD: number;
  market: {
    currentUSD: number;
    cagr: number;
    years: number;
    forecastUSD: number;
    yourShareUSD: number;
  };
  risks: string[];
  publicUrl?: string;
};

export default function AdvancedPlanner() {
  const [idea, setIdea] = useState("تطبيق صحي");
  const [sector, setSector] = useState<SectorKey>("health");
  const [horizon, setHorizon] = useState(5);

  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const qrRef = useRef<HTMLCanvasElement>(null);

  const priors = useMemo(() => SECTOR_PRIORS[sector], [sector]);
  const { persona } = usePersona();

  // قيَم افتراضية تتأثر بالشخصية
  const defaultScope =
    persona.goal === "Scale" ? 4 : persona.goal === "Launch" ? 3 : 2;
  const defaultAi = Math.min(
    5,
    persona.risk >= 4 ? 5 : persona.risk <= 2 ? 3 : 4
  );
  const [scope, setScope] = useState(defaultScope);
  const [aiDepth, setAiDepth] = useState(defaultAi);

  function computeRoadmap(): Plan["roadmap"] {
    const base = priors.milestones;
    // مؤثرات حسب الشخصية: المستثمر يميل للحوكمة/KPI، التنفيذي للامتثال، الريادي للسرعة
    const speedBoost =
      persona.role === "Founder"
        ? -0.3
        : persona.role === "Executive"
        ? +0.1
        : 0;
    const riskBoost = (persona.risk - 3) * 0.15;
    const factor =
      1 + (scope - 3) * 0.2 + (aiDepth - 3) * 0.15 + speedBoost + riskBoost;
    const weeks = (w: number) => Math.max(2, Math.round(w * factor));

    // لو الانطباع "happy" أو "surprised" نزود مساحة التجريب قليلاً
    const expr = (persona.emotion || "").toLowerCase();
    const kpiTone =
      persona.role === "Investor"
        ? "ROI/CAC/LTV"
        : persona.role === "Executive"
        ? "امتثال/SLAs"
        : "نمو وتفاعل";

    return [
      {
        phase: base[0] || "اكتشاف",
        weeks: weeks(2),
        outputs: ["أبحاث مستخدمين", "متطلبات أمان"],
        kpis: [`تصديق 3 شركاء مبكرين — تركيز ${kpiTone}`],
      },
      {
        phase: base[1] || "PoC",
        weeks: weeks(4),
        outputs: ["نموذج أولي", "قياس دقة/أداء"],
        kpis: ["< 300ms استجابة", "دقة > 85%"],
      },
      {
        phase: base[2] || "MVP",
        weeks: weeks(expr.includes("happy") ? 5 : 6),
        outputs: ["Core UX", "خدمات أساسية"],
        kpis: ["NPS أولي", "Retention أسبوعي"],
      },
      {
        phase: base[3] || "تكامل",
        weeks: weeks(5),
        outputs: ["تكاملات حرجة", "لوحات مراقبة"],
        kpis: ["زمن إتاحة > 99.5%"],
      },
      {
        phase: base[4] || "إطلاق محدود",
        weeks: weeks(4),
        outputs: ["طيّار مدفوع", "تحليل أخطاء"],
        kpis: ["تحويلات > 6%"],
      },
      {
        phase: base[5] || "إطلاق عام",
        weeks: weeks(4),
        outputs: ["تحسين تجربة", "RoI Dashboard"],
        kpis: ["CAC/LTV واضحة"],
      },
    ];
  }

  function estimateTeam() {
    const base = priors.typicalRoles;
    // التنفيذي يزيد أمان/امتثال، الريادي يقلّل العدد، المستثمر يوازن
    const roleFactor =
      persona.role === "Executive"
        ? 1.15
        : persona.role === "Founder"
        ? 0.9
        : 1;
    const riskFactor = persona.risk >= 4 ? 1.1 : persona.risk <= 2 ? 0.95 : 1;
    const scale =
      roleFactor * riskFactor * (1 + (scope - 3) * 0.25 + (aiDepth - 3) * 0.2);

    const team = base.map((r) => ({
      role: r.role,
      count: Math.max(r.min, Math.round(((r.min + r.max) / 2) * scale)),
    }));
    const headcountTotal = team.reduce((s, t) => s + t.count, 0);
    const avg = persona.role === "Executive" ? 7600 : 7000;
    const monthlyBurnUSD = headcountTotal * avg;
    return { team, headcountTotal, monthlyBurnUSD };
  }

  function forecastMarket() {
    const years = horizon;
    const cagr = priors.sampleCAGR + (aiDepth - 3) * 0.01; // عمق AI يرفع التوقع قليلًا
    const currentUSD = priors.baseMarketUSD * 1_000_000;
    const forecastUSD = Math.round(currentUSD * Math.pow(1 + cagr, years));
    // حصة السوق تتأثر بالهدف/المخاطرة
    const shareBase =
      persona.goal === "Scale"
        ? 0.03
        : persona.goal === "Launch"
        ? 0.015
        : 0.008;
    const riskAdj = persona.risk >= 4 ? +0.01 : persona.risk <= 2 ? -0.003 : 0;
    const share = Math.min(shareBase + riskAdj + (scope - 3) * 0.004, 0.08);
    const yourShareUSD = Math.round(forecastUSD * share);
    return { currentUSD, cagr, years, forecastUSD, yourShareUSD };
  }

  async function buildPlan() {
    setLoading(true);
    try {
      const roadmap = computeRoadmap();
      const { team, headcountTotal, monthlyBurnUSD } = estimateTeam();
      const market = forecastMarket();
      const risks = priors.risks;

      const p: Plan = {
        roadmap,
        team,
        headcountTotal,
        monthlyBurnUSD,
        market,
        risks,
      };
      setPlan(p);

      // ارفع تقرير HTML مصغّر كصورة لتوليد رابط عام للـ QR (اختياري)
      setTimeout(async () => {
        if (!qrRef.current) return;
        const node = document.getElementById("plan-card");
        if (!node) return;
        const canvas = await html2canvas(node, { scale: 2 });
        const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
        let publicUrl: string | undefined;
        try {
          const r = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: dataUrl,
          });
          if (r.ok) {
            const { url } = await r.json();
            publicUrl = url?.startsWith("/") ? `${BASE}${url}` : url;
          }
        } catch {}
        if (publicUrl) {
          await QRCode.toCanvas(qrRef.current, publicUrl, { width: 180 });
          setPlan((prev) => (prev ? { ...prev, publicUrl } : prev));
        } else {
          const ctx = qrRef.current.getContext("2d")!;
          ctx.clearRect(0, 0, 180, 180);
        }
      }, 50);
    } finally {
      setLoading(false);
    }
  }

  async function exportPDF() {
    const node = document.getElementById("plan-card");
    if (!node) return;
    const canvas = await html2canvas(node, { scale: 2 });
    const img = canvas.toDataURL("image/jpeg", 0.95);
    const pdf = new jsPDF("p", "pt", "a4");
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const ratio = Math.min(pageW / canvas.width, pageH / canvas.height);
    const w = canvas.width * ratio,
      h = canvas.height * ratio;
    const x = (pageW - w) / 2,
      y = 20;
    pdf.addImage(img, "JPEG", x, y, w, h);
    pdf.save(`plan-${Date.now()}.pdf`);
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Header
        title="مُخطِّط الابتكار المتقدم"
        subtitle="خارطة طريق + تقدير فريق + توقعات سوق (محليًا)"
      />

      {/* المدخلات */}
      <div style={box}>
        <div style={row}>
          <L>الفكرة</L>
          <input
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            style={input}
            placeholder="مثال: تطبيق صحي ذكي"
          />
        </div>
        <div style={row}>
          <L>القطاع</L>
          <select
            value={sector}
            onChange={(e) => setSector(e.target.value as SectorKey)}
            style={input}
          >
            <option value="health">الصحة</option>
            <option value="tourism">السياحة</option>
            <option value="fintech">فنتك</option>
            <option value="education">التعليم</option>
            <option value="retail">تجزئة</option>
          </select>
        </div>
        <div style={row}>
          <L> السنوات: {horizon}</L>
          <input
            type="range"
            min={3}
            max={7}
            value={horizon}
            onChange={(e) => setHorizon(parseInt(e.target.value))}
          />
        </div>
        <div style={row}>
          <L> النطاق: {scope}/5</L>
          <input
            type="range"
            min={1}
            max={5}
            value={scope}
            onChange={(e) => setScope(parseInt(e.target.value))}
          />
        </div>
        <div style={row}>
          <L>عمق الذكاء الاصطناعي: {aiDepth}/5</L>
          <input
            type="range"
            min={1}
            max={5}
            value={aiDepth}
            onChange={(e) => setAiDepth(parseInt(e.target.value))}
          />
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <button disabled={loading} onClick={buildPlan} style={btnPrimary}>
            {loading ? "...يجري الحساب" : "بناء الخطة"}
          </button>
          {plan && (
            <button onClick={exportPDF} style={btnGhost}>
              تصدير PDF
            </button>
          )}
        </div>
      </div>

      {/* المخرجات */}
      {plan && (
        <div id="plan-card" style={{ ...box, display: "grid", gap: 16 }}>
          <h3 style={{ margin: 0 }}>
            خطة {idea} — أفق {horizon} سنة
          </h3>

          <Section title="خارطة الطريق">
            <ol style={{ margin: 0, paddingInlineStart: 20 }}>
              {plan.roadmap.map((p, i) => (
                <li key={i} style={{ marginBottom: 10 }}>
                  <b>{p.phase}</b> — {p.weeks} أسابيع
                  <div style={{ opacity: 0.85 }}>
                    المخرجات: {p.outputs.join("، ")}
                  </div>
                  <div style={{ opacity: 0.7, fontSize: 13 }}>
                    KPIs: {p.kpis.join("، ")}
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          <Section title="تقدير الفريق والتكلفة">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                {plan.team.map((t, i) => (
                  <li key={i}>
                    {t.role}: {t.count}
                  </li>
                ))}
              </ul>
              <div>
                <div>
                  إجمالي الأفراد: <b>{plan.headcountTotal}</b>
                </div>
                <div>
                  تكلفة شهرية تقديرية: <b>${format(plan.monthlyBurnUSD)}</b>
                </div>
                <div style={{ opacity: 0.7, fontSize: 12 }}>
                  ملاحظة: تقدير مبسط؛ اضبط الرواتب لكل دور لاحقًا.
                </div>
              </div>
            </div>
          </Section>

          <Section title="توقعات السوق">
            <div>
              الحجم الحالي: <b>${format(plan.market.currentUSD)}</b>
            </div>
            <div>
              النمو السنوي المركب (CAGR):{" "}
              <b>{Math.round(plan.market.cagr * 100)}%</b>
            </div>
            <div>
              الحجم بعد {plan.market.years} سنوات:{" "}
              <b>${format(plan.market.forecastUSD)}</b>
            </div>
            <div>
              حصة مستهدفة تقديرية: <b>${format(plan.market.yourShareUSD)}</b>
            </div>
            <div style={{ opacity: 0.7, fontSize: 12, marginTop: 6 }}>
              وحدة اقتصادية: {priors.unitEconomicsNote}
            </div>
          </Section>

          <Section title="مخاطر رئيسية">
            <ul style={{ margin: 0, paddingInlineStart: 20 }}>
              {plan.risks.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </Section>

          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
                مشاركة عبر QR
              </div>
              <canvas
                ref={qrRef}
                width={180}
                height={180}
                style={{ background: "white", borderRadius: 8 }}
              />
            </div>
            {plan.publicUrl && (
              <a
                href={plan.publicUrl}
                target="_blank"
                rel="noreferrer"
                style={btnGhost}
              >
                فتح الرابط العام
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** ----- UI helpers ----- */
function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div
      style={{
        ...box,
        background:
          "linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.03))",
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 900 }}>{title}</div>
      {subtitle && <div style={{ opacity: 0.75 }}>{subtitle}</div>}
    </div>
  );
}
function Section({ title, children }: { title: string; children: any }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ fontWeight: 800 }}>{title}</div>
      <div>{children}</div>
    </div>
  );
}
const box: React.CSSProperties = {
  border: "1px solid #ffffff22",
  borderRadius: 16,
  padding: 16,
  background: "rgba(255,255,255,0.03)",
};
const row: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "180px 1fr",
  alignItems: "center",
  gap: 10,
};
const L = (props: any) => <div style={{ opacity: 0.85 }} {...props} />;
const input: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid #ffffff22",
  color: "white",
  padding: "10px 12px",
  borderRadius: 10,
  outline: "none",
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
const btnGhost: React.CSSProperties = {
  background: "transparent",
  color: "#fff",
  border: "1px solid #ffffff33",
  padding: "8px 12px",
  borderRadius: 10,
  textDecoration: "none",
};

function format(n: number) {
  return n.toLocaleString("en-US");
}
