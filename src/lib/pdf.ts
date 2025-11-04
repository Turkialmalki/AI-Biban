// src/lib/pdf.ts
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import type { SessionReport } from "../components/InteractiveCamera";

export async function exportSessionPdf(
  session: SessionReport,
  uniqueFaces: number
) {
  // 1) نبدأ PDF عادي
  const pdf = new jsPDF("p", "pt", "a4");
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const margin = 40;
  let y = margin;

  // صفحة 1: ملخص أرقام (ما يحتاج عربي متشكل)
  pdf.setFontSize(18);
  pdf.text("AI Smart Camera – Session Report", margin, y);
  y += 26;

  pdf.setFontSize(12);
  pdf.text(
    `Started at: ${new Date(session.startedAt).toLocaleString()}`,
    margin,
    y
  );
  y += 16;

  if (session.durationSec) {
    pdf.text(`Duration (sec): ${session.durationSec}`, margin, y);
    y += 16;
  }

  pdf.text(`Unique faces: ${uniqueFaces}`, margin, y);
  y += 16;

  pdf.text(
    `Peaks: ${session.kpis.peaks} – Avg motion: ${session.kpis.avgMotion.toFixed(
      1
    )}%`,
    margin,
    y
  );
  y += 22;

  const emos = Object.entries(session.kpis.dominantEmotions)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  pdf.text(`Top emotions: ${emos || "-"}`, margin, y);

  // 2) لو فيه لقطات، نحط صفحة لهم (بنفس الطريقة القديمة)
  const shots = session.timeline.filter((e) => e.kind === "snapshot") as any[];
  shots.slice(0, 2).forEach((s, i) => {
    pdf.addPage();
    pdf.setFontSize(14);
    pdf.text(
      `Highlight ${i + 1} – ${new Date(s.t).toLocaleTimeString()}`,
      40,
      40
    );
    pdf.addImage(s.dataUrl, "JPEG", 40, 60, pw - 80, (pw - 80) * 0.56);
  });

  // 3) 🟣 التفريغ الصوتي بالعربي → كصورة
  // حتى لو مافيه كلام، نعرض صندوق فاضي (عشان المستخدم يعرف أنها الصفحة حقة الصوت)
  pdf.addPage();

  // نبني عنصر DOM مخفي
  const holder = document.createElement("div");
  holder.id = "speech-block-to-print";
  holder.style.width = "800px";
  holder.style.background = "white";
  holder.style.color = "#000";
  holder.style.padding = "20px";
  holder.style.direction = "rtl";
  holder.style.textAlign = "right";
  holder.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, 'Noto Sans Arabic', 'Almarai', sans-serif";
  holder.style.lineHeight = "1.7";
  holder.style.border = "1px solid #ddd";
  holder.innerHTML = `
    <h2 style="margin-top:0;">التفريغ الصوتي (العربي)</h2>
    ${
      session.speech && session.speech.length > 0
        ? `<ul style="padding-right:18px;">${session.speech
            .map(
              (s) => `
          <li>
            <strong>${s.speakerId ? "المتحدث #" + s.speakerId : "متحدث"}:</strong>
            ${s.text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}
            <div style="font-size:11px;opacity:.55;">${new Date(
              s.t
            ).toLocaleTimeString()}</div>
          </li>
        `
            )
            .join("")}</ul>`
        : `<p style="opacity:.6;">لا يوجد كلام مفرّغ في هذه الجلسة.</p>`
    }
  `;
  // نحطه مؤقتًا في الصفحة
  document.body.appendChild(holder);

  // نصوّره
  const speechCanvas = await html2canvas(holder, {
    scale: 1.6,
    backgroundColor: "#ffffff",
  });

  // نشيله من الـ DOM
  document.body.removeChild(holder);

  const imgData = speechCanvas.toDataURL("image/png");
  // نحط الصورة في الصفحة الحالية
  // لو الصورة أطول من الصفحة، نصغّرها تلقائي
  const imgW = pw - 2 * margin;
  const imgH = (speechCanvas.height * imgW) / speechCanvas.width;
  pdf.addImage(imgData, "PNG", margin, 20, imgW, imgH);

  // 4) حفظ
  pdf.save(`camera-session-${Date.now()}.pdf`);
}
