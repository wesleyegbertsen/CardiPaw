import { ref } from 'vue';
import { jsPDF } from 'jspdf';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
} from 'chart.js';
import type { Pet, Reading } from '../types';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler);

const ML = 14;   // margin left
const MR = 14;   // margin right
const MT = 16;   // margin top
const MB = 20;   // margin bottom (leave room for footer)
const PW = 210;  // page width (A4 mm)
const PH = 297;  // page height (A4 mm)
const UW = PW - ML - MR; // usable width = 182mm

function aggregateByDay(readings: Reading[], monthKey: string): { date: string; rate: number }[] {
  const inMonth = readings.filter(r => r.date.startsWith(monthKey));
  const groups = new Map<string, number[]>();
  for (const r of inMonth) {
    const day = r.date.slice(0, 10);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(r.rate);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, rates]) => ({
      date: `${day}T12:00:00`,
      rate: Math.round(rates.reduce((s, r) => s + r, 0) / rates.length),
    }));
}

function renderChartToDataUrl(dailyAverages: { date: string; rate: number }[]): string {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 280;

  const labels = dailyAverages.map(r =>
    new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(r.date))
  );
  const rates = dailyAverages.map(r => r.rate);

  const chart = new ChartJS(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Breaths/min',
          data: rates,
          borderColor: '#e05c7a',
          backgroundColor: 'rgba(224, 92, 122, 0.1)',
          borderWidth: 2.5,
          pointBackgroundColor: '#e05c7a',
          pointRadius: 5,
          tension: 0.3,
          fill: true,
        },
        {
          label: 'Normal max (30)',
          data: labels.map(() => 30),
          borderColor: 'rgba(22, 163, 74, 0.5)',
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      animation: false,
      responsive: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: {
          ticks: { font: { size: 11 }, color: '#6b7280', maxTicksLimit: 8 },
          grid: { display: false },
        },
        y: {
          min: 0,
          suggestedMax: 80,
          title: { display: true, text: 'Breaths / min', color: '#6b7280', font: { size: 11 } },
          ticks: { font: { size: 11 }, color: '#6b7280' },
          grid: { color: 'rgba(0,0,0,0.05)' },
        },
      },
    },
  } as ConstructorParameters<typeof ChartJS>[1]);

  const dataUrl = canvas.toDataURL('image/png');
  chart.destroy();
  return dataUrl;
}

function calcAge(birthdate: string): string {
  const birth = new Date(birthdate);
  const now = new Date();
  const totalMonths =
    (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  if (totalMonths < 12) return `${totalMonths} month${totalMonths !== 1 ? 's' : ''}`;
  const y = Math.floor(totalMonths / 12);
  const m = totalMonths % 12;
  if (m === 0) return `${y} year${y !== 1 ? 's' : ''}`;
  return `${y}y ${m}mo`;
}

function statusOf(rate: number): { text: string; color: string } {
  if (rate <= 30) return { text: 'Normal', color: '#16a34a' };
  if (rate <= 35) return { text: 'Elevated', color: '#d97706' };
  return { text: 'High', color: '#dc2626' };
}

function drawNotesHeader(doc: jsPDF, curY: number): void {
  doc.setFillColor('#f3f4f6');
  doc.rect(ML, curY, UW, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor('#374151');
  doc.text('Date / Time', ML + 2, curY + 5);
  doc.text('Note', ML + 62, curY + 5);
}

function drawTableHeader(doc: jsPDF, curY: number): void {
  doc.setFillColor('#f3f4f6');
  doc.rect(ML, curY, UW, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor('#374151');
  doc.text('Date / Time', ML + 2, curY + 5);
  doc.text('Rate (breaths/min)', ML + 70 + 2, curY + 5);
  doc.text('Status', ML + 130 + 2, curY + 5);
  doc.text('Rest', ML + 158, curY + 5);
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/(<p>\s*<\/p>)+$/gi, '')          // strip trailing empty paragraphs
    .replace(/<li[^>]*>\s*<p[^>]*>/gi, '- ')   // tiptap: <li><p> → dash prefix
    .replace(/<\/p>\s*<\/li>/gi, '\n')          // tiptap: </p></li> → newline
    .replace(/<li[^>]*>/gi, '- ')               // fallback bare <li>
    .replace(/<\/li>/gi, '\n')                  // fallback bare </li>
    .replace(/<\/p>/gi, '\n')                   // </p> → newline
    .replace(/<\/h[1-6]>/gi, '\n')              // headings
    .replace(/<br\s*\/?>/gi, '\n')              // line breaks
    .replace(/<[^>]+>/g, '')                    // strip remaining tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')                 // collapse excess blank lines
    .trim();
}

export function usePdfExport() {
  const isGenerating = ref(false);

  async function generatePdf(pet: Pet, readings: Reading[], selectedMonths: string[], newestFirst = true, includeNotes = false): Promise<void> {
    isGenerating.value = true;
    try {
      const doc = new jsPDF('p', 'mm', 'a4');
      let curY = MT;

      // ── Cover header ──
      const hasPhoto = !!pet.photo;
      if (hasPhoto) {
        const format = pet.photo!.startsWith('data:image/png') ? 'PNG' : 'JPEG';
        try {
          doc.addImage(pet.photo!, format, ML, curY, 18, 18);
        } catch {
          // silently skip photo if it fails to load
        }
      }
      const textX = hasPhoto ? ML + 22 : ML;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor('#e05c7a');
      doc.text(pet.name, textX, curY + 7);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor('#6b7280');
      const speciesAge = `${pet.species.charAt(0).toUpperCase() + pet.species.slice(1)} · ${calcAge(pet.birthdate)}`;
      doc.text(speciesAge, textX, curY + 14);

      doc.setFontSize(9);
      doc.setTextColor('#9ca3af');
      doc.text('CardiPaw Respiratory Rate Report', PW - MR, curY + 5, { align: 'right' });
      const exportDate = new Date().toLocaleDateString('en', {
        year: 'numeric', month: 'long', day: 'numeric',
      });
      doc.text(exportDate, PW - MR, curY + 11, { align: 'right' });

      curY += 22;
      doc.setDrawColor('#e5e7eb');
      doc.setLineWidth(0.3);
      doc.line(ML, curY, PW - MR, curY);
      curY += 8;

      // ── Month sections ──
      const sortedMonths = [...selectedMonths].sort((a, b) =>
        newestFirst ? b.localeCompare(a) : a.localeCompare(b)
      );

      for (const monthKey of sortedMonths) {
        const monthReadings = readings
          .filter(r => r.date.startsWith(monthKey))
          .sort((a, b) => a.date.localeCompare(b.date));

        if (monthReadings.length === 0) continue;

        const dailyAverages = aggregateByDay(readings, monthKey);
        const chartDataUrl = renderChartToDataUrl(dailyAverages);

        // Each month starts on its own page (skip addPage for the very first section)
        if (sortedMonths.indexOf(monthKey) > 0) {
          doc.addPage();
          curY = MT;
        }

        // Month heading bar
        const monthLabel = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(
          new Date(monthKey + '-15')
        );
        doc.setFillColor('#fce4ec');
        doc.rect(ML, curY, UW, 9, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor('#c0405e');
        doc.text(monthLabel, ML + 3, curY + 6.5);
        curY += 11;

        // Chart image (800×280 px → 182×63.7mm at A4 ratio)
        doc.addImage(chartDataUrl, 'PNG', ML, curY, UW, 64);
        curY += 70; // +4mm gap before summary line

        // Summary line
        const rateValues = monthReadings.map(r => r.rate);
        const avg = Math.round(rateValues.reduce((s, r) => s + r, 0) / rateValues.length);
        const min = Math.min(...rateValues);
        const max = Math.max(...rateValues);
        const n = monthReadings.length;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor('#6b7280');
        doc.text(
          `${n} reading${n !== 1 ? 's' : ''} · Avg: ${avg} · Min: ${min} · Max: ${max} breaths/min`,
          ML,
          curY
        );
        curY += 7;

        // Readings section label
        doc.setFillColor('#f3f4f6');
        doc.rect(ML, curY, UW, 7, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor('#374151');
        doc.text('Readings', ML + 2, curY + 5);
        curY += 7;

        // Table header
        drawTableHeader(doc, curY);
        curY += 7;

        // Table rows
        let rowAlt = false;
        for (const r of monthReadings) {
          if (curY + 7 > PH - MB) {
            doc.addPage();
            curY = MT;
            drawTableHeader(doc, curY);
            curY += 7;
            rowAlt = false;
          }

          if (rowAlt) {
            doc.setFillColor('#f9fafb');
            doc.rect(ML, curY, UW, 7, 'F');
          }

          const d = new Date(r.date);
          const dateStr = new Intl.DateTimeFormat('en', {
            month: 'short', day: 'numeric', year: 'numeric',
          }).format(d);
          const timeStr = new Intl.DateTimeFormat('en', {
            hour: 'numeric', minute: '2-digit', hour12: true,
          }).format(d);

          const status = statusOf(r.rate);

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.setTextColor('#1a1a1a');
          doc.text(`${dateStr}, ${timeStr}`, ML + 2, curY + 5);
          doc.text(String(r.rate), ML + 72, curY + 5);
          doc.setTextColor(status.color);
          doc.text(status.text, ML + 132, curY + 5);

          if (r.restState) {
            const isResting = r.restState === 'resting';
            doc.setFillColor(isResting ? '#16a34a' : '#d97706');
            doc.circle(ML + 159, curY + 3.5, 1.5, 'F');
            doc.setTextColor(isResting ? '#16a34a' : '#d97706');
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.text(isResting ? 'Resting' : 'Sleeping', ML + 162, curY + 5);
          }

          doc.setTextColor('#1a1a1a');
          curY += 7;
          rowAlt = !rowAlt;
        }

        curY += 10;

        if (includeNotes) {
          const notedReadings = monthReadings.filter(r => htmlToPlainText(r.notes ?? '').trim());
          if (notedReadings.length > 0) {
            doc.setFillColor('#f3f4f6');
            doc.rect(ML, curY, UW, 7, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.setTextColor('#374151');
            doc.text('Reading Notes', ML + 2, curY + 5);
            curY += 7;

            drawNotesHeader(doc, curY);
            curY += 7;

            const noteColX = ML + 62;
            const noteWidth = UW - 62;
            let noteRowAlt = false;
            for (const r of notedReadings) {
              doc.setFont('helvetica', 'normal');
              doc.setFontSize(9);
              const plainNote = htmlToPlainText(r.notes!);
              const lines = doc.splitTextToSize(plainNote, noteWidth);
              const lineH = doc.getFontSize() / 72 * 25.4 * doc.getLineHeightFactor();
              const rowH = Math.max(7, (lines.length - 1) * lineH + 7);
              if (curY + rowH > PH - MB) {
                doc.addPage();
                curY = MT;
                drawNotesHeader(doc, curY);
                curY += 7;
                noteRowAlt = false;
                doc.setFont('helvetica', 'normal');
              }
              if (noteRowAlt) {
                doc.setFillColor('#f9fafb');
                doc.rect(ML, curY, UW, rowH, 'F');
              }
              const d = new Date(r.date);
              const noteDateStr = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
              const noteTimeStr = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
              doc.setTextColor('#1a1a1a');
              doc.text(`${noteDateStr}, ${noteTimeStr}`, ML + 2, curY + 5);
              doc.text(lines, noteColX, curY + 5);
              curY += rowH;
              noteRowAlt = !noteRowAlt;
            }
            curY += 6;
          }
        }
      }

      // ── Page footers ──
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor('#9ca3af');
        doc.text(`Page ${i} of ${totalPages}`, PW / 2, PH - 8, { align: 'center' });
      }

      const dateSlug = new Date().toISOString().slice(0, 10);
      const safeName = pet.name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
      doc.save(`cardipaw-${safeName}-${dateSlug}.pdf`);
    } finally {
      isGenerating.value = false;
    }
  }

  return { isGenerating, generatePdf };
}
