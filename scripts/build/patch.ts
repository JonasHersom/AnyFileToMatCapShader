import { basename, dirname, join, relative } from "path";
import { cp, mkdir, rm } from "fs/promises";
import { $ } from "bun";
import { extractSource, fetchSource } from "./assemble";
import { CACHE_DIR, ROOT_SCOPE, loadRequirements, subrecipeScope, type Scope } from "./common";
import { hasSource, isSubrecipe, type SourceRequirement } from "./types";

const WORKSPACES_DIR = join(CACHE_DIR, "patches");
const BASE_TAG = "base";

type WorkspaceState = { patch: string };

// resolves "name", or "subrecipe/name" for requirements that live in a subrecipe
async function findSourceRequirement(path: string) {
  const parts = path.split("/");
  let scope: Scope = ROOT_SCOPE;
  for (const [i, part] of parts.entries()) {
    const requirement = (await loadRequirements(scope.recipeDir)).find(({ name }) => name === part);
    if (!requirement) throw new Error(`Unknown requirement ${parts.slice(0, i + 1).join("/")}.`);
    if (i === parts.length - 1) {
      if (!hasSource(requirement)) throw new Error(`${path} has no source to patch.`);
      return { requirement, recipePath: join(scope.recipeDir, requirement.name) };
    }
    if (!isSubrecipe(requirement))
      throw new Error(`${parts.slice(0, i + 1).join("/")} is not a subrecipe.`);
    scope = subrecipeScope(scope, requirement.name);
  }
  throw new Error("Pass a requirement name.");
}

export function workspacePath(name: string) {
  return join(WORKSPACES_DIR, name);
}

// a scratch repo, so the user's own git config can't change what ends up in the patch
function git(workspace: string) {
  return (args: string[]) =>
    $`git -c core.excludesFile=/dev/null -c core.autocrlf=false -c core.hooksPath=/dev/null -c commit.gpgSign=false -c user.name=convert-build -c user.email=convert-build@localhost ${args}`
      .cwd(workspace)
      .quiet();
}

function statePath(workspace: string) {
  return join(workspace, ".git", "convert-patch.json");
}

async function readState(workspace: string): Promise<WorkspaceState | undefined> {
  const file = Bun.file(statePath(workspace));
  return (await file.exists()) ? await file.json() : undefined;
}

async function requireState(name: string) {
  const workspace = workspacePath(name);
  const state = await readState(workspace);
  if (!state) {
    throw new Error(
      `No patch workspace for ${name}, run \`bun run build:patch edit ${name} <patch>\`.`,
    );
  }
  return { workspace, state };
}

// patches listed before this one make up the base, so the diff only holds this patch's changes
function precedingPatches(requirement: SourceRequirement, patch: string) {
  const patches = requirement.patches ?? [];
  const index = patches.indexOf(patch);
  return index === -1 ? patches : patches.slice(0, index);
}

export async function editPatch(name: string, patch: string, reset: boolean) {
  if (basename(patch) !== patch) throw new Error(`Patch name ${patch} must be a plain file name.`);
  const { requirement, recipePath } = await findSourceRequirement(name);
  const workspace = workspacePath(name);

  const existing = await readState(workspace);
  if (existing && !reset) {
    if (existing.patch !== patch) {
      throw new Error(
        `The ${name} workspace is editing ${existing.patch}, save and finish it first, or pass --reset.`,
      );
    }
    console.log(`Already editing ${patch}, workspace at:\n${workspace}`);
    return;
  }

  await rm(workspace, { recursive: true, force: true });
  await mkdir(dirname(workspace), { recursive: true });
  await extractSource(requirement, await fetchSource(requirement, {}), workspace);

  for (const [from, to] of Object.entries(requirement.copy || {})) {
    await cp(join(recipePath, from), join(workspace, to), { recursive: true });
  }

  const run = git(workspace);
  await run(["init", "-q"]);
  await run(["add", "-A", "-f"]);
  await run(["commit", "-q", "--allow-empty", "-m", "pristine"]);
  for (const earlier of precedingPatches(requirement, patch)) {
    await run(["apply", "-p1", "--index", join(recipePath, earlier)]);
    await run(["commit", "-q", "--allow-empty", "-m", earlier]);
  }
  await run(["tag", BASE_TAG]);

  const patchPath = join(recipePath, patch);
  const isNew = !(await Bun.file(patchPath).exists());
  if (!isNew) await run(["apply", "-p1", patchPath]);

  await Bun.write(statePath(workspace), JSON.stringify({ patch } satisfies WorkspaceState));

  console.log(
    `${isNew ? "Creating" : "Editing"} ${relative(ROOT_SCOPE.recipeDir, patchPath)}. I made a workspace at:`,
  );
  console.log(workspace);
  console.log(`Make your changes there, then run \`bun run build:patch save ${name}\`.`);
}

export async function savePatch(name: string, algorithm: string | undefined) {
  const { workspace, state } = await requireState(name);
  const { requirement, recipePath } = await findSourceRequirement(name);

  const run = git(workspace);
  await run(["add", "-A", "-f"]);
  const diff = await run([
    "diff",
    "--cached",
    "--binary",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    ...(algorithm ? [`--diff-algorithm=${algorithm}`] : []),
    BASE_TAG,
  ]).text();

  const patchPath = join(recipePath, state.patch);
  const shown = relative(join(ROOT_SCOPE.recipeDir, ".."), patchPath);
  if (!diff) {
    console.log(`No changes from the base, not writing ${shown}.`);
    return;
  }
  await Bun.write(patchPath, diff);
  console.log(`Wrote ${shown}.`);

  const patches = requirement.patches ?? [];
  if (!patches.includes(state.patch)) {
    console.log(
      `You should probably add "${state.patch}" to the patches of ${name} in its requirements.config.ts.`,
    );
  } else if (patches.indexOf(state.patch) < patches.length - 1) {
    console.log(`Later patches were not applied in the workspace, check they still apply.`);
  }
  console.log(`The workspace is kept, run \`bun run build:patch finish ${name}\` when done.`);
}

export async function finishPatch(name: string) {
  const { workspace } = await requireState(name);
  await rm(workspace, { recursive: true, force: true });
  console.log(`Removed the ${name} workspace.`);
}

export async function patchStatus(name: string) {
  const { workspace, state } = await requireState(name);
  console.log(`Editing ${state.patch}, workspace at:\n${workspace}`);
  process.stdout.write(await git(workspace)(["status", "--short"]).text());
}
