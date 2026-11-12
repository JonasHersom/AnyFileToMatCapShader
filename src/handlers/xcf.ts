import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import Formats from "src/Formats.ts";
import XCF from "built/gimper/src/main.js";
import { InitializationError } from "src/errors.ts";
import { changeExt } from "src/common/index.ts";
import { canvasToBlob, createCanvas, type CanvasBundle } from "src/common/canvas.ts";

class xcfHandler implements FormatHandler {
  public readonly name = "xcf";
  public supportedFormats = [
    Formats.XCF.builder("xcf").lossless().from(),
    Formats.PNG.builder("png").lossless().to(),
  ];
  public ready = false;

  #bundle?: CanvasBundle;

  async init() {
    this.#bundle = createCanvas();

    this.ready = true;
  }

  async doConvert(
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat,
  ): Promise<FileData[]> {
    if (!this.ready || !this.#bundle) {
      throw new InitializationError("Handler not initialized.");
    }
    const { canvas, ctx } = this.#bundle;

    const outputFiles: FileData[] = [];

    if (inputFormat.internal !== "xcf" || outputFormat.internal !== "png") {
      throw new TypeError(
        `Unsupported conversion path: ${inputFormat.internal} -> ${outputFormat.internal}`,
      );
    }

    for (const inputFile of inputFiles) {
      const xcf = XCF.from_bytes(new Uint8Array(inputFile.bytes));

      if (xcf.layers.length === 0) {
        throw new RangeError("No layers to convert.");
      }

      for (let i = 0; i < xcf.layers.length; i++) {
        const layer = xcf.layers[i];
        const bpp = layer.hierarchy.bpp;

        if (![3, 4].includes(bpp)) {
          throw new RangeError("Only RGB and RGBA in 8-bit precision is supported.");
        }

        canvas.width = layer.width;
        canvas.height = layer.height;
        ctx.clearRect(0, 0, layer.width, layer.height);

        const pixel_data = xcf.getLayerPixels(i);

        const image_data = ctx.createImageData(layer.width, layer.height);

        for (let y = 0; y < layer.height; y++) {
          for (let x = 0; x < layer.width; x++) {
            const pixel = pixel_data[y][x];
            const [r, g, b] = bpp === 4 ? pixel.slice(0, -1) : pixel;

            let a = 255;
            if (bpp === 4) {
              a = pixel.at(-1)!;
            }

            const i = (y * layer.width + x) * 4;
            image_data.data[i] = r;
            image_data.data[i + 1] = g;
            image_data.data[i + 2] = b;
            image_data.data[i + 3] = a;
          }
        }

        ctx.putImageData(image_data, 0, 0);

        const bytes = await canvasToBlob(this.#bundle, "image/png");

        const name = changeExt(inputFile.name, outputFormat.extension, `_${layer.name}`);
        outputFiles.push({ bytes, name });
      }
    }

    return outputFiles;
  }
}

export default xcfHandler;
