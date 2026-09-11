declare module '*.css' {}

// pdf.js sin worker-modul har ingen typer; vi bruker den bare som verdi for
// å registrere `globalThis.pdfjsWorker` (se lib/rom-pdf-vektor.ts).
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs'
