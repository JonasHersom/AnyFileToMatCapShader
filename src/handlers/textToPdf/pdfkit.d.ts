// pdfkit >=0.20 browser APIs that @types/pdfkit doesn't cover yet
declare namespace PDFKit {
  interface PDFDocument {
    registerStdFonts(...fonts: object[]): void;
  }
}

declare module "pdfkit/standard-fonts/*" {
  const font: object;
  export default font;
}
