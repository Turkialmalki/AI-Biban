// src/lib/htmlReport.ts
import type { SessionReport } from "../components/InteractiveCamera";

function fmtTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleString("ar-SA", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function openHtmlReport(session: SessionReport, uniqueCount: number) {
  const win = window.open("", "_blank", "width=1000,height=800");
  if (!win) return;

  const dur =
    session.durationSec ??
    Math.max(1, Math.round((Date.now() - session.startedAt) / 1000));

  const topEmotions = Object.entries(session.kpis.dominantEmotions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `<span class="chip">${k}: ${v}</span>`)
    .join(" ");

  const speechHtml =
    session.speech && session.speech.length
      ? session.speech
          .map(
            (s) => `
        <div class="speech-line">
          <div class="meta">${fmtTime(s.t)} · المتحدث ${s.speakerId ?? "غير محدد"}</div>
          <div class="text">${escapeHtml(s.text)}</div>
        </div>
      `
          )
          .join("")
      : `<div class="empty">لا يوجد كلام مفرّغ في هذه الجلسة.</div>`;

  const snaps = session.timeline.filter((e) => e.kind === "snapshot") as Array<
    any
  >;

  win.document.write(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<title>تقرير جلسة الكاميرا الذكية</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root {
    color-scheme: dark;
  }
  body {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #0f172a;
    color: #fff;
    margin: 0;
    padding: 24px;
  }
  h1,h2,h3 {
    margin: 0 0 12px 0;
  }
  .section {
    background: rgba(15,23,42,.4);
    border: 1px solid rgba(255,255,255,.05);
    border-radius: 16px;
    padding: 16px 20px;
    margin-bottom: 16px;
  }
  .grid {
    display: grid;
    gap: 16px;
  }
  @media (min-width: 900px) {
    .grid-2 {
      grid-template-columns: 1.1fr 0.9fr;
    }
  }
  .chip {
    display: inline-block;
    background: rgba(148,163,184,.12);
    border: 1px solid rgba(148,163,184,.35);
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 12px;
    margin: 2px;
  }
  .speech-line {
    background: rgba(15,23,42,.35);
    border: 1px solid rgba(148,163,184,.12);
    border-radius: 10px;
    padding: 8px 10px;
    margin-bottom: 6px;
  }
  .speech-line .meta {
    font-size: 11px;
    opacity: .6;
    margin-bottom: 4px;
  }
  .speech-line .text {
    font-size: 14px;
    line-height: 1.6;
  }
  .empty {
    opacity: .45;
    font-size: 13px;
  }
  .snaps {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .snap {
    width: 180px;
    background: rgba(15,23,42,.35);
    border: 1px solid rgba(148,163,184,.12);
    border-radius: 10px;
    overflow: hidden;
  }
  .snap img {
    width: 100%;
    display: block;
  }
  .snap small {
    display: block;
    padding: 6px 8px 10px;
    font-size: 11px;
    opacity: .6;
  }
  .print-btn {
    position: fixed;
    top: 18px;
    left: 18px;
    background: #22c55e;
    color: #0f172a;
    border: none;
    border-radius: 999px;
    padding: 8px 16px;
    font-size: 13px;
    cursor: pointer;
    box-shadow: 0 10px 40px rgba(34,197,94,.3);
  }
  .header-title {
    font-size: 26px;
    font-weight: 800;
    margin-bottom: 4px;
  }
  .muted {
    opacity: .6;
    font-size: 13px;
  }
</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">🖨️ طباعة / PDF</button>
  <div class="section">
    <div class="header-title">تقرير جلسة الكاميرا الذكية</div>
    <div class="muted">بداية الجلسة: ${fmtTime(
      session.startedAt
    )} — المدة: ${dur} ثانية</div>
  </div>

  <div class="grid grid-2">
    <div class="section">
      <h2>نظرة عامة</h2>
      <div>إجمالي الحضور الفريد: <b>${uniqueCount}</b></div>
      <div>القمم التفاعلية: <b>${session.kpis.peaks}</b></div>
      <div>متوسط الحركة: <b>${session.kpis.avgMotion.toFixed(1)}%</b></div>
      <div style="margin-top:8px">المشاعر الأكثر ظهورًا:</div>
      <div>${topEmotions || "<span class='muted'>لا يوجد بيانات مشاعر</span>"}</div>
    </div>

    <div class="section">
      <h2>الزمنية</h2>
      <div class="muted" style="margin-bottom:6px">أحداث مختارة</div>
      <ul style="margin:0;padding-right:18px;line-height:1.6;font-size:13px">
        ${session.timeline
          .slice(-8)
          .reverse()
          .map((e) => {
            if (e.kind === "face")
              return `<li>${fmtTime(e.t)} · عدد الوجوه: ${(e as any).faces}</li>`;
            if (e.kind === "snapshot")
              return `<li>${fmtTime(e.t)} · لقطة مميّزة</li>`;
            if (e.kind === "speakingStart")
              return `<li>${fmtTime(e.t)} · بدأ التحدث للشخص #${
                (e as any).face
              }</li>`;
            return `<li>${fmtTime(e.t)} · ${e.kind}</li>`;
          })
          .join("")}
      </ul>
    </div>
  </div>

  <div class="section">
    <h2>التفريغ الصوتي (العربي)</h2>
    ${speechHtml}
  </div>

  <div class="section">
    <h2>اللقطات (Snapshots)</h2>
    <div class="snaps">
      ${
        snaps.length
          ? snaps
              .slice(0, 6)
              .map(
                (s) => `<div class="snap">
          <img src="${s.dataUrl}" alt="snapshot"/>
          <small>${fmtTime(s.t)} · ${s.note || ""}</small>
        </div>`
              )
              .join("")
          : `<div class="empty">لا يوجد لقطات</div>`
      }
    </div>
  </div>

</body>
</html>
  `);

  win.document.close();
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
