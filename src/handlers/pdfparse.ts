import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import Formats from "src/Formats.ts";
import { PDFParse } from "pdf-parse";
import pdfWorkerUrl from "../../node_modules/pdf-parse/dist/pdf-parse/web/pdf.worker.mjs?url";
import { changeExt, encode } from "src/common/index.ts";

class pdfparseHandler implements FormatHandler {
  public readonly name = "pdfparse";
  public supportedFormats = [Formats.PDF.builder("pdf").from(), Formats.TEXT.builder("txt").to()];
  public ready = false;

  async init() {
    PDFParse.setWorker(pdfWorkerUrl);
    this.ready = true;
  }

  async doConvert(
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat,
  ): Promise<FileData[]> {
    const outputFiles: FileData[] = [];

    for (const inputFile of inputFiles) {
      const parser = new PDFParse({ data: new Uint8Array(inputFile.bytes) });
      const text = await parser.getText();
      await parser.destroy();

      outputFiles.push({
        bytes: encode(text.text),
        name: changeExt(inputFile.name, "txt"),
      });
    }

    return outputFiles;
  }
}

export default pdfparseHandler;
