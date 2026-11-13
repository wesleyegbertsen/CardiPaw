// Settings for the PDF report that need to stay the same on every device. Kept
// free of DOM code so a Node test can build a real jsPDF document with them.

/**
 * jsPDF stores streams uncompressed unless asked to; a PNG is then written as raw
 * pixels (4 bytes each), which made a one-reading report 6 MB.
 */
export const PDF_DOC_OPTIONS = {
  orientation: 'p',
  unit: 'mm',
  format: 'a4',
  compress: true,
} as const;

/** The chart canvas is drawn at this size and printed 182 mm wide on the page. */
export const CHART_WIDTH_PX = 800;
export const CHART_HEIGHT_PX = 280;

/**
 * Pixel ratio the chart is rendered at. Chart.js otherwise uses the screen's
 * devicePixelRatio, so the same report got a bigger chart on a denser phone.
 * 2 prints at about 223 dpi.
 */
export const CHART_PIXEL_RATIO = 2;
