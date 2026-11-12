import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import Formats from "src/Formats.ts";
import { Chess } from "chess.js";
import { changeExt, decode, encode } from "src/common/index.ts";

class chessjsHandler implements FormatHandler {
  public readonly name = "chessjs";
  public supportedFormats = [
    Formats.FEN.builder("fen").fromTo(),
    Formats.PGN.builder("pgn").lossless().fromTo(),
    Formats.TEXT.builder("txt").to(),
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
    const outputFiles: FileData[] = [];
    for (const inputFile of inputFiles) {
      const chess = new Chess();

      const input = decode(inputFile.bytes).trim();
      if (inputFormat.internal === "fen") {
        chess.load(input, { skipValidation: true });
      } else if (inputFormat.internal === "pgn") {
        chess.loadPgn(input);
      } else {
        throw new TypeError(`chessjsHandler cannot convert from ${inputFormat.mime}`);
      }

      let output;
      if (outputFormat.internal === "fen") {
        output = chess.fen();
      } else if (outputFormat.internal === "pgn") {
        output = chess.pgn();
      } else if (outputFormat.internal === "txt") {
        output = chess.ascii();
      } else {
        throw new TypeError(`chessjsHandler cannot convert to ${outputFormat.mime}`);
      }

      const bytes = encode(output);
      const name = changeExt(inputFile.name, outputFormat.extension);
      outputFiles.push({ name, bytes });
    }
    return outputFiles;
  }
}

export default chessjsHandler;
