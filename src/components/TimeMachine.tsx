import { useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { usePersona } from "../context/PersonaContext";

const BASE =
  (import.meta as any).env?.VITE_PUBLIC_BASE_URL ||
  (typeof window !== "undefined" ? window.location.origin : "");

type Result = {
  posterDataUrl: string;
  bullets: string[];
  headline: string;
  publicUrl?: string;
};

export default function TimeMachine() {
  const [idea, setIdea] = useState("");
  const [years, setYears] = useState(5);
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const qrRef = useRef<HTMLCanvasElement>(null);
  const { persona } = usePersona();

  const targetYear = useMemo(
    () => new Date().getFullYear() + years,
    [years]
  );

  async function onGenerate() {
    if (!idea.trim()) return;
    setLoading(true);
    try {
      // 1) نصوص المستقبل تتأثر بالشخصية
      const { headline, bullets } = generateFuture(
        idea.trim(),
        years,
        targetYear,
        persona
      );

      // 2) (اختياري) اطلب صورة مولدة من الذكاء الاصطناعي
      let aiUrl: string | undefined;
      try {
        const pr = `${idea}, futuristic concept art, product mock, cinematic lighting, clean, arabic locale`;
        const rr = await fetch("/api/gen-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: pr }),
        });
        if (rr.ok) {
          const j = await rr.json().catch(() => null);
          aiUrl = j?.url;
        }
      } catch {
        // لا مفاتيح/مزوّد → نكمل بدون صورة
      }

      // 3) بوستر مرئي
      const posterDataUrl = await renderPoster(
        idea.trim(),
        headline,
        bullets,
        targetYear,
        aiUrl
      );

      // 4) رفع للحصول على رابط عام للـ QR
      let publicUrl: string | undefined;
      try {
        const r = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: posterDataUrl,
        });
        if (r.ok) {
          const { url } = await r.json();
          publicUrl = url?.startsWith("/") ? `${BASE}${url}` : url;
        }
      } catch {
        /* fallback: نبقي dataURL */
      }

      const result: Result = { posterDataUrl, bullets, headline, publicUrl };
      setRes(result);

      // 5) ارسم QR إن وُجد رابط عام
      if (qrRef.current) {
        const final = publicUrl || posterDataUrl; // dataURL كبديل
        const isHttp = /^https?:\/\//.test(final);
        if (isHttp) {
          await QRCode.toCanvas(qrRef.current, final, { width: 180 });
        } else {
          const ctx = qrRef.current.getContext("2d")!;
          ctx.clearRect(0, 0, 180, 180);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <SectionTitle
        title="آلة زمن الابتكار"
        subtitle="تصوّر كيف سيبدو مشروعك بعد عدة سنوات"
      />

      <div style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ opacity: 0.8, fontSize: 13 }}>الفكرة / المجال</span>
          <input
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="مثال: تطبيق سياحي ذكي"
            style={inputStyle}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ opacity: 0.8, fontSize: 13 }}>
            عدد السنوات إلى الأمام: {years} (العام المستهدف: {targetYear})
          </span>
          <input
            type="range"
            min={1}
            max={10}
            value={years}
            onChange={(e) => setYears(parseInt(e.target.value))}
            style={{ width: 320 }}
          />
        </label>

        <div>
          <button
            onClick={onGenerate}
            disabled={loading || !idea.trim()}
            style={btnPrimary}
          >
            {loading ? "… جاري التوليد" : "تخيل المستقبل"}
          </button>
        </div>
      </div>

      {res && (
        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "minmax(260px, 420px) 1fr",
          }}
        >
          {/* المعاينة */}
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              بوستر المستقبل (قابل للتنزيل)
            </div>
            <img
              src={res.posterDataUrl}
              alt="poster"
              style={{
                width: "100%",
                borderRadius: 16,
                border: "1px solid #ffffff22",
              }}
            />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <a
                href={res.posterDataUrl}
                download={`future-${targetYear}.jpg`}
                style={btnGhost}
              >
                تنزيل الصورة
              </a>

              {res.publicUrl && (
                <a
                  href={res.publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={btnGhost}
                >
                  فتح الرابط العام
                </a>
              )}
            </div>
          </div>

          {/* النصوص + QR */}
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 6 }}>
                العنوان
              </div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>
                {res.headline}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 6 }}>
                توقعات أساسية
              </div>
              <ul
                style={{ lineHeight: 1.8, paddingInlineStart: 20, margin: 0 }}
              >
                {res.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>

            <div>
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
                شارك عبر QR
              </div>
              <canvas
                ref={qrRef}
                width={180}
                height={180}
                style={{ background: "white", borderRadius: 8 }}
              />
              <div style={{ fontSize: 11, opacity: 0.65, marginTop: 6 }}>
                {res.publicUrl
                  ? res.publicUrl
                  : "سيظهر QR عند توفر رابط عام (.env.local)"}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** -------------------- أدوات التوليد والرسم -------------------- **/

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid #ffffff22",
  color: "white",
  padding: "10px 12px",
  borderRadius: 10,
  outline: "none",
};

const btnPrimary: React.CSSProperties = {
  background: "linear-gradient(135deg,#16a34a,#0ea5e9)",
  color: "white",
  fontWeight: 800,
  padding: "10px 16px",
  borderRadius: 12,
  border: "none",
  cursor: "pointer",
};

const btnGhost: React.CSSProperties = {
  background: "transparent",
  color: "white",
  border: "1px solid #ffffff33",
  padding: "8px 12px",
  borderRadius: 10,
  textDecoration: "none",
  display: "inline-block",
  fontSize: 14,
};

function SectionTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div
      style={{
        background:
          "linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.03))",
        border: "1px solid #ffffff22",
        borderRadius: 16,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 900 }}>{title}</div>
      {subtitle && <div style={{ opacity: 0.7, marginTop: 6 }}>{subtitle}</div>}
    </div>
  );
}

/** 1) توليد نصوص مبسطة (تتأثر بالشخصية) */
function generateFuture(
  idea: string,
  years: number,
  year: number,
  persona: any
) {
  const role = persona?.role ?? "Founder";
  const kpiFocus =
    role === "Investor"
      ? ["CAC", "LTV", "ARR"]
      : role === "Executive"
      ? ["SLA", "Compliance", "Security"]
      : ["Growth", "Engagement", "NPS"];

  const tags = pick3([
    "تخصيص عميق",
    "واقع معزز",
    "تحليل تنبؤي",
    "وكلاء محادثة",
    "أتمتة ذكية",
    "توصيات فورية",
    "أمان وخصوصية",
  ]);
  const streams = pick3([
    "اشتراكات Pro",
    "عمولة معاملات",
    "API مدفوعة",
    "إعلانات ذكية",
    "Partnerships",
  ]);

  const headline = `مستقبل ${idea} في ${year}`;
  const bullets = [
    `انتقال تدريجي إلى **${tags[0]}** يرفع ${kpiFocus[0]} خلال ${years} سنوات.`,
    `دمج **${tags[1]}** مع تخصيص لحظي وتجارب محادثية للمستخدم.`,
    `خارطة تقنية: **${tags[2]}** + مراقبة ${kpiFocus[1]}/${kpiFocus[2]}.`,
    `نموذج عائدات: ${streams.join(" + ")}.`,
  ];

  return { headline, bullets };
}

function pick3(arr: string[]) {
  const s = new Set<string>();
  while (s.size < 3) s.add(arr[Math.floor(Math.random() * arr.length)]);
  return Array.from(s);
}

/** 2) رسم بوستر جذاب على Canvas وإرجاع DataURL */
async function renderPoster(
  idea: string,
  headline: string,
  bullets: string[],
  year: number,
  aiImageUrl?: string
): Promise<string> {
  return new Promise(async (resolve) => {
    const W = 1080,
      H = 1350;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d")!;

    // خلفية
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#0b1020");
    g.addColorStop(1, "#081d2e");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // توهجات
    drawGlow(ctx, W * 0.2, H * 0.2, 220, "#0ea5e980");
    drawGlow(ctx, W * 0.8, H * 0.3, 260, "#22c55e80");

    // لوحة صورة AI (اختياري)
    if (aiImageUrl) {
      try {
        const img = await loadImg(aiImageUrl);
        const ratio = img.width / img.height;
        const boxW = 420,
          boxH = 560;
        const drawW = ratio > boxW / boxH ? boxW : boxH * ratio;
        const drawH = drawW / ratio;
        ctx.save();
        roundedRect(
          ctx,
          W - boxW - 60,
          320,
          boxW,
          boxH,
          24,
          "rgba(255,255,255,0.06)",
          "#ffffff22"
        );
        ctx.clip();
        ctx.drawImage(
          img,
          W - boxW - 60 + (boxW - drawW) / 2,
          320 + (boxH - drawH) / 2,
          drawW,
          drawH
        );
        ctx.restore();
      } catch {}
    }

    // العنوان
    ctx.fillStyle = "white";
    ctx.font = "900 64px system-ui, -apple-system, Segoe UI, Roboto";
    wrapText(ctx, headline, 70, 180, W - 140 - 0, 72);

    // سطر ثانوي
    ctx.globalAlpha = 0.8;
    ctx.font = "700 36px system-ui, -apple-system";
    ctx.fillText(`آلة زمن الابتكار — ${year}`, 70, 250);
    ctx.globalAlpha = 1;

    // صندوق نقاط
    roundedRect(
      ctx,
      60,
      320,
      aiImageUrl ? W - 120 - 420 - 20 : W - 120,
      680,
      24,
      "rgba(255,255,255,0.06)",
      "#ffffff22"
    );
    ctx.save();
    ctx.translate(90, 370);
    ctx.font = "500 34px system-ui, -apple-system";
    ctx.fillStyle = "white";
    let y = 0;
    for (const b of bullets) {
      drawBullet(ctx, b, aiImageUrl ? 680 - 40 : 780, 44, y);
      y += 140;
    }
    ctx.restore();

    // تذييل
    ctx.globalAlpha = 0.8;
    ctx.font = "500 26px system-ui, -apple-system";
    ctx.fillText(`الفكرة: ${idea}`, 70, H - 80);
    ctx.globalAlpha = 1;

    resolve(c.toDataURL("image/jpeg", 0.9));
  });
}

function loadImg(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

function drawGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string
) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "transparent");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  stroke?: string
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function drawBullet(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  lh: number,
  offsetY: number
) {
  // نقطة •
  ctx.beginPath();
  ctx.fillStyle = "#22c55e";
  ctx.arc(0, offsetY + 10, 6, 0, Math.PI * 2);
  ctx.fill();
  // نص
  ctx.fillStyle = "white";
  wrapText(ctx, text, 20, offsetY + 0, maxW, lh);
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.replace(/\*\*/g, "").split(" ");
  let line = "";
  let yy = y;
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    const { width } = ctx.measureText(testLine);
    if (width > maxWidth && n > 0) {
      ctx.fillText(line, x, yy);
      line = words[n] + " ";
      yy += lineHeight;
    } else line = testLine;
  }
  ctx.fillText(line, x, yy);
}
