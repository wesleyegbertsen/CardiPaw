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
