import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import Formats from "src/Formats.ts";
import { encode as encodeToon, decode as decodeToon } from "@toon-format/toon";
import { changeExt, decode, encode } from "src/common/index.ts";

class toonHandler implements FormatHandler {
  public readonly name = "toon";
  public supportedFormats = [
    Formats.JSON.builder("json").lossless().fromTo(),
    Formats.TOON.builder("toon").lossless().fromTo(),
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
    switch (inputFormat.mime) {
      case Formats.JSON.mime:
        if (outputFormat.mime !== Formats.TOON.mime) {
          throw new TypeError(`Unsupported output format MIME: ${outputFormat.mime}`);
        }

        return inputFiles.map((file) => {
          const text = decode(file.bytes);
          let jsonData = JSON.parse(text);

          const toonData = encodeToon(jsonData);
          const name = changeExt(file.name, "toon");

          return {
            name,
            bytes: encode(toonData),
          };
        });

      case Formats.TOON.mime:
        if (outputFormat.mime !== Formats.JSON.mime) {
          throw new TypeError(`Unsupported output format MIME: ${outputFormat.mime}`);
        }

        return inputFiles.map((file) => {
          const toonData = decode(file.bytes);
          const jsonData = JSON.stringify(decodeToon(toonData));

          const name = changeExt(file.name, "json");

          return {
            name,
            bytes: encode(jsonData),
          };
        });

      default:
        throw new TypeError(`Unsupported input format: ${inputFormat.internal}`);
    }
  }
}

export default toonHandler;
