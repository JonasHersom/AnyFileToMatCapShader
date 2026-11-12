import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";

import Formats from "src/Formats.ts";
import { InitializationError } from "src/errors.ts";
import { changeExt } from "src/common/index.ts";
import { blobToCanvas, canvasToBlob, createCanvas, type CanvasBundle } from "src/common/canvas.ts";

class rgbaHandler implements FormatHandler {
  public readonly name = "rgba";
  public supportedFormats = [
    Formats.PNG.builder("png").lossless().fromTo(),
    Formats.RGB.builder("rgb").fromTo(),
    Formats.RGBA.builder("rgba").lossless().fromTo(),
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
    const outputFiles: FileData[] = [];

    if (!this.#bundle) {
      throw new InitializationError("Handler not initialized.");
    }
    const { canvas, ctx } = this.#bundle;

    for (const file of inputFiles) {
      let new_file_bytes = new Uint8Array(file.bytes);

      if (inputFormat.mime === Formats.PNG.mime) {
        if (outputFormat.internal === "rgba") {
          // Some code copied from mcmap.ts
          await blobToCanvas(this.#bundle, file.bytes, inputFormat.mime);

          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);

          new_file_bytes = new Uint8Array(pixels.data);
        } else if (outputFormat.internal === "rgb") {
          throw new TypeError(
            "This handler doesn't need to convert png to rgb, let ImageMagik do that.",
          );
        } else {
          throw new TypeError(
            `Unsupported conversion path: ${inputFormat.internal} -> ${outputFormat.internal}`,
          );
        }
      } else if (inputFormat.internal === "rgb") {
        if (new_file_bytes.length % 3 !== 0) {
          throw new RangeError("Invalid RGB file size; not a whole number of samples.");
        }

        if (outputFormat.internal === "rgba") {
          // Fill in with 255 in alpha channel
          let writer_array = new Uint8Array(
            new_file_bytes.length + Math.floor(new_file_bytes.length / 3),
          );
          let writer_counter = 0;
          for (let i = 0; i < new_file_bytes.length; i++) {
            if (i % 3 === 2) {
              writer_array.set(new Uint8Array([new_file_bytes[i]]), writer_counter);
              writer_counter += 1;
              writer_array.set(new Uint8Array([0xff]), writer_counter);
              writer_counter += 1;
            } else {
              writer_array.set(new Uint8Array([new_file_bytes[i]]), writer_counter);
              writer_counter += 1;
            }
          }
          new_file_bytes = new Uint8Array(writer_array);
        } else if (outputFormat.mime === Formats.PNG.mime) {
          throw new TypeError(
            "This handler doesn't need to convert rgb to png, let ImageMagik do that.",
          );
        } else {
          throw new TypeError(
            `Unsupported conversion path: ${inputFormat.internal} -> ${outputFormat.internal}`,
          );
        }
      } else if (inputFormat.internal === "rgba") {
        if (new_file_bytes.length % 4 !== 0) {
          throw new RangeError("Invalid RGBA file size; not a whole number of samples.");
        }

        if (outputFormat.internal === "rgb") {
          // Remove every fourth, byte! Every fourth, byte!
          let writer_array = new Uint8Array(
            new_file_bytes.length - Math.floor(new_file_bytes.length / 4),
          );
          let writer_counter = 0;
          for (let i = 0; i < new_file_bytes.length; i++) {
            if (i % 4 !== 3) {
              writer_array.set(new Uint8Array([new_file_bytes[i]]), writer_counter);
              writer_counter += 1;
            }
          }
          new_file_bytes = new Uint8Array(writer_array);
        } else if (outputFormat.mime === Formats.PNG.mime) {
          // Determine image dimensions: smallest number x such that x^2 is >= total samples
          const total_samples = new_file_bytes.length / 4;
          let image_sw = 0;

          while (true) {
            if (image_sw * image_sw >= total_samples) {
              break;
            }
            image_sw += 1;
          }

          // Set canvas dimensions to this value
          canvas.width = image_sw;
          canvas.height = image_sw;

          // Determine color per-pixel and write that value to the buffer
          let color = [0, 0, 0];
          const rgba: number[] = [];
          for (let i = 0; i < canvas.width * canvas.height; i++) {
            try {
              color = [
                new_file_bytes[0 + i * 4],
                new_file_bytes[1 + i * 4],
                new_file_bytes[2 + i * 4],
              ];
              rgba.push(...color, new_file_bytes[3 + i * 4]);
            } catch {
              color = [0, 0, 0];
              rgba.push(...color, 255);
            }
          }

          // Writes our results to the canvas
          const image_data = new ImageData(
            new Uint8ClampedArray(rgba),
            canvas.width,
            canvas.height,
          );

          ctx.putImageData(image_data, 0, 0);

          new_file_bytes = await canvasToBlob(this.#bundle, outputFormat.mime);
        } else {
          throw new TypeError(
            `Unsupported conversion path: ${inputFormat.internal} -> ${outputFormat.internal}`,
          );
        }
      } else {
        throw new TypeError(`Unsupported input format: ${inputFormat.internal}`);
      }

      outputFiles.push({
        name: changeExt(file.name, outputFormat.extension),
        bytes: new_file_bytes,
      });
    }
    return outputFiles;
  }
}

export default rgbaHandler;
