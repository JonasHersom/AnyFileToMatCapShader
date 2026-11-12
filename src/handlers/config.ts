import {
  parseJSON,
  parseJSON5,
  parseJSONC,
  parseYAML,
  parseTOML,
  parseINI,
  stringifyJSON,
  stringifyJSON5,
  stringifyJSONC,
  stringifyYAML,
  stringifyTOML,
  stringifyINI,
} from "confbox";
import Formats from "src/Formats.ts";
import { type FileData, type FileFormat, type FormatHandler } from "../FormatHandler.ts";
import { changeExt, decode, encode } from "src/common/index.ts";

class configHandler implements FormatHandler {
  public readonly name = "config";
  public supportedFormats = [
    // JSON maintains exact data equivalence to JS Objects natively
    Formats.JSON.builder("json").lossless().fromTo(),
    // JSON5, YAML, and TOML have comments and other features lost when parsed to JS Objects
    Formats.JSON5.builder("json5").fromTo(),
    Formats.JSONC.builder("jsonc").fromTo(),
    Formats.YML.builder("yaml").fromTo(),
    Formats.TOML.builder("toml").fromTo(),
    Formats.INI.builder("ini").fromTo(),
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
    return inputFiles.map((file) => {
      const text = decode(file.bytes);

      let object: any;
      switch (inputFormat.internal) {
        case "json":
          object = parseJSON(text);
          break;
        case "json5":
          object = parseJSON5(text);
          break;
        case "jsonc":
          object = parseJSONC(text);
          break;
        case "yaml":
          object = parseYAML(text);
          break;
        case "toml":
          object = parseTOML(text);
          break;
        case "ini":
          object = parseINI(text);
          break;
        default:
          throw new TypeError(`Unsupported input internal format: ${inputFormat.internal}`);
      }

      let outText = "";
      switch (outputFormat.internal) {
        case "json":
          outText = stringifyJSON(object);
          break;
        case "json5":
          outText = stringifyJSON5(object);
          break;
        case "jsonc":
          outText = stringifyJSONC(object);
          break;
        case "yaml":
          // confbox carries over a detected indent of 0 from compact input, which flattens nested YAML
          outText = stringifyYAML(
            object,
            inputFormat.internal === "yaml" ? undefined : { indent: 2 },
          );
          break;
        case "toml":
          outText = stringifyTOML(object);
          break;
        case "ini":
          outText = stringifyINI(object);
          break;
        default:
          throw new TypeError(`Unsupported output internal format: ${outputFormat.internal}`);
      }

      return {
        name: changeExt(file.name, outputFormat.extension),
        bytes: encode(outText),
      };
    });
  }
}

export default configHandler;
