import { imageTracer } from "imagetracer";

import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import Formats from "src/Formats.ts";
import { changeExt, encode } from "src/common/index.ts";
import { blobToCanvas, createCanvas } from "src/common/canvas.ts";

class svgTraceHandler implements FormatHandler {
  public readonly name = "svgTrace";
  public supportedFormats = [
    Formats.PNG.builder("png").from(),
    Formats.JPEG.builder("jpeg").from(),
    // note there is both animated svgs, and animted webPs, although this converter does not support either
    Formats.WEBP.builder("webp").from(),
    Formats.SVG.builder("svg").to(),
  ];
  public ready = false;

  async init() {
    this.ready = true;
  }

  async doConvert(
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat,
  ): Promise<FileData[]> {
    if (outputFormat.internal !== "svg")
      throw new TypeError(`Unsupported output format: ${outputFormat.internal}`);

    const outputFiles: FileData[] = [];

    for (const inputFile of inputFiles) {
      const bundle = createCanvas();
      await blobToCanvas(bundle, inputFile.bytes, inputFormat.mime);
      const { canvas, ctx } = bundle;
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const traced = imageTracer.imageDataToSVG(imageData); // return the full svg string
      const name = changeExt(inputFile.name, "svg");
      const bytes = encode(traced);

      outputFiles.push({ bytes, name });
    }
    return outputFiles;
  }
}

export default svgTraceHandler;
