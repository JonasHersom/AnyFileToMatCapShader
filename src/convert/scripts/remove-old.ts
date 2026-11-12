import { rm } from "node:fs/promises";
import { join } from "node:path";
for (const name of [
  "envelope",
  "espeakng.js",
  "gimper",
  "image-to-txt",
  "qoa-fu",
  "qoi-fu",
  "rpgmvp-decrypter",
  "sppd",
  "terraria-wld-parser",
  "turbowarp/unpackager",
  "typst-assets",
]) {
  const path = join(import.meta.dir, "../src/handlers", name);
  const gitFile = Bun.file(join(path, ".git"));
  if ((await gitFile.exists()) && (await gitFile.text()).startsWith("gitdir:")) {
    await rm(path, { recursive: true, force: true });
  }
}
