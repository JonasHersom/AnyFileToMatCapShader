import { type FileData, type FileFormat, type FormatHandler } from "../FormatHandler.ts";
import Formats from "src/Formats.ts";
import { changeExt, decode, encode } from "src/common/index.ts";

class cssHandler implements FormatHandler {
  public readonly name = "css";
  public supportedFormats = [
    Formats.CSS.builder("css").lossless().fromTo(),
    Formats.LESS.builder("less").from(),
    Formats.SCSS.builder("scss").from(),
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
    for (const file of inputFiles) {
      const source = decode(file.bytes);
      let css: string;
      if (inputFormat.internal === "less") {
        const [{ default: createLess }, { default: createFileManager }, { default: PluginLoader }] =
          await Promise.all([
            // @ts-ignore
            import("less/lib/less/index.js"),
            // @ts-ignore
            import("less/lib/less-browser/file-manager.js"),
            // @ts-ignore
            import("less/lib/less-browser/plugin-loader.js"),
          ]);
        const less = createLess();
        less.PluginLoader = PluginLoader;
        less.FileManager = createFileManager({}, less.logger);
        less.environment.addFileManager(new less.FileManager());
        const { css: compiled } = await less.render(source);
        css = compiled;
      } else if (inputFormat.internal === "scss") {
        const sass = await import("sass");
        const result = sass.compileString(source, { url: new URL(`file://${file.name}`) });
        css = result.css;
      } else {
        css = source;
      }

      outputFiles.push({
        name: changeExt(file.name, outputFormat.internal),
        bytes: encode(css),
      });
    }
    return outputFiles;
  }
}

export default cssHandler;
