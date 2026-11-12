import { join, relative } from "path";
import { parseSync } from "oxc-parser";
import { DOWNLOADS_DIR, ROOT_SCOPE, loadRequirements, subrecipeScope, type Scope } from "./common";
import { hashFile } from "./hash";
import { hasSource, isSubrecipe } from "./types";

export function insertSource(config: string, name: string, url: string, hash: string) {
  const parsed = parseSync("requirements.config.ts", config, null);
  if (parsed.errors.length) throw new Error("could not parse requirements.config.ts");
  const exported = parsed.program.body.find((d) => d.type === "ExportDefaultDeclaration");
  let expression = exported?.declaration;
  while (
    expression &&
    (expression.type === "TSSatisfiesExpression" ||
      expression.type === "TSAsExpression" ||
      expression.type === "ParenthesizedExpression")
  ) {
    expression = expression.expression;
  }
  if (!expression || expression.type !== "ArrayExpression") {
    throw new Error("requirements.config.ts must export an array literal to add a source.");
  }

  const entry = expression.elements.find((element) => {
    if (element?.type !== "ObjectExpression") return false;
    return element.properties.some(
      (property) =>
        property.type === "Property" &&
        property.key.type === "Identifier" &&
        property.key.name === "name" &&
        property.value.type === "Literal" &&
        property.value.value === name,
    );
  });
  const properties = `url: ${JSON.stringify(url)},\n    hash: ["sha256", ${JSON.stringify(hash)}],`;
  let container, members, addition;
  if (entry?.type === "ObjectExpression") {
    container = entry;
    members = container.properties;
    addition = `\n    ${properties}\n  `;
  } else {
    container = expression;
    members = container.elements;
    addition = `\n  {\n    name: ${JSON.stringify(name)},\n    ${properties}\n  },\n`;
  }
  const last = members.at(-1);
  const comma = last && !config.slice(last.end, container.end - 1).includes(",") ? "," : "";
  const position = container.end - 1;
  const before = config.slice(0, position);
  // A missing comma belongs before any trailing comments, immediately after the last member.
  const prefix =
    comma && last ? config.slice(0, last.end) + comma + config.slice(last.end, position) : before;
  return prefix.trimEnd() + addition + config.slice(position);
}

export async function addSource(path: string, url: string, root: Scope = ROOT_SCOPE) {
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\\"))) {
    throw new Error("Pass a requirement name, or subrecipe/name.");
  }
  if (new URL(url).protocol !== "https:") throw new Error("Source URLs must use HTTPS.");

  let scope = root;
  for (const part of parts.slice(0, -1)) {
    const requirement = (await loadRequirements(scope.recipeDir)).find(({ name }) => name === part);
    if (!requirement || !isSubrecipe(requirement)) throw new Error(`${part} is not a subrecipe.`);
    scope = subrecipeScope(scope, part);
  }
  const name = parts.at(-1)!;
  const existing = (await loadRequirements(scope.recipeDir)).find((entry) => entry.name === name);
  if (existing && hasSource(existing)) throw new Error(`${path} already has a source.`);

  const configPath = join(scope.recipeDir, "requirements.config.ts");
  const configFile = Bun.file(configPath);
  const config = (await configFile.exists())
    ? await configFile.text()
    : `import type { RequirementsConfig } from ${JSON.stringify(relative(scope.recipeDir, join(import.meta.dir, "types")).replaceAll("\\", "/"))};\n\nexport default [] satisfies RequirementsConfig;\n`;
  // Check that the file can be edited before downloading anything.
  insertSource(config, name, url, "");
  console.log(`Fetching file ${url}...`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch: ${response.status} ${response.statusText}`);
  const bytes = await response.bytes();
  const hash = hashFile("sha256", bytes);
  await Bun.write(join(DOWNLOADS_DIR, hash), bytes);
  const updated = insertSource(config, name, url, hash);
  const formatted = Bun.spawnSync(
    ["bun", "x", "--no-install", "oxfmt", "--stdin-filepath", configPath],
    {
      stdin: new TextEncoder().encode(updated),
    },
  );
  if (formatted.exitCode !== 0) throw new Error(formatted.stderr.toString());
  await Bun.write(configPath, formatted.stdout);
  console.log(`Added source for ${path} to ${relative(join(root.recipeDir, ".."), configPath)}.`);
}
