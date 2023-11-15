#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cac } from "cac";
import cpy from "cpy";
import { execa } from "execa";
import fs from "fs-extra";
import pico from "picocolors";
import { default as prompts } from "prompts";

// NOTE: This is a workaround for tsconfig `rootDir` nonsense.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import rootPackageJson from "../package.json" assert { type: "json" };
import { getPackageManager } from "./helpers/getPackageManager.js";
import { notifyUpdate } from "./helpers/notifyUpdate.js";
import {
  validateProjectName,
  validateTemplateName,
  ValidationError,
} from "./helpers/validate.js";

const log = console.log;

export type Template = {
  title: string;
  description: string;
  id: string;
};

export type CLIArgs = readonly string[];
export type CLIOptions = {
  [k: string]: any;
};

const templates = [
  {
    title: "default",
    description: "Empty Ponder project",
    id: "default",
  },
  {
    title: "feature-factory",
    description: "Ponder app using a factory contract",
    id: "factory",
  },
  {
    title: "feature-filter",
    description: "Ponder app using an event filter",
    id: "filter",
  },
  {
    title: "feature-multichain",
    description: "Ponder app using a multichain configuration",
    id: "multichain",
  },
  {
    title: "feature-proxy",
    description: "Ponder app using a proxy contract",
    id: "proxy",
  },
  {
    title: "feature-read-contract",
    description: "Ponder app using a read contract call",
    id: "read-contract",
  },
  {
    title: "project-friendtech",
    description: "",
    id: "friendtech",
  },
  {
    title: "project-uniswap-v3-flash",
    description: "",
    id: "uniswap-v3",
  },
  {
    title: "reference-erc20",
    description: "Refence ERC20 Ponder app",
    id: "erc20",
  },
  {
    title: "reference-erc721",
    description: "Refence ERC721 Ponder app",
    id: "erc721",
  },
] as const satisfies readonly Template[];

async function run({
  args,
  options,
  templates,
}: {
  args: CLIArgs;
  options: CLIOptions;
  templates: readonly Template[];
}) {
  if (options.help) return;

  log();
  log(
    `Welcome to ${pico.bold(
      pico.blue("create-ponder"),
    )} – the quickest way to get started with Ponder!`,
  );
  log();

  const __dirname = fileURLToPath(new URL(".", import.meta.url));
  const templatesPath = path.join(__dirname, "..", "templates");
  let templateId = options.template || options.t;

  // Validate template if provided
  let templateValidation = await validateTemplateName({
    isNameRequired: false,
    templateId,
    templates,
  });
  if (!templateValidation.valid) throw new ValidationError(templateValidation);

  // Validate project name
  let projectName: string;
  let projectPath: string;
  if (args[0]) {
    projectPath = args[0].trim();
    const splitPath = projectPath.split("/");
    projectName = splitPath[splitPath.length - 1]?.trim() || "";
    log(pico.green("✔"), pico.bold(`Using project name:`), projectName);
  } else {
    const res = await prompts({
      initial: "my-app",
      name: "projectName",
      message: "What is your project named?",
      type: "text",
      async validate(projectName) {
        const validation = await validateProjectName({
          projectName,
          projectPath: projectName,
        });
        if (!validation.valid) return validation.message;
        return true;
      },
    });
    projectName = res.projectName?.trim();
    projectPath = projectName;
  }

  // Validate project name
  const nameValidation = await validateProjectName({
    projectName,
    projectPath,
  });
  if (!nameValidation.valid) throw new ValidationError(nameValidation);

  // Extract template ID from CLI or prompt
  if (!templateId) {
    templateId = (
      await prompts({
        name: "templateId",
        message: "What template would you like to use?",
        type: "select",
        choices: templates.map(({ id, ...t }) => ({
          ...t,
          value: id,
        })),
      })
    ).templateId;
  }

  // Get template meta
  const templateMeta = templates.find(({ id }) => id === templateId);
  if (!templateMeta) return;

  // Validate template name
  templateValidation = await validateTemplateName({
    templateId,
    templates,
  });
  if (!templateValidation.valid) throw new ValidationError(templateValidation);

  const targetPath = path.join(process.cwd(), projectPath);
  log(`Creating a new ponder app in ${pico.green(targetPath)}.`);
  log();
  log(`Using with ${pico.bold(templateMeta.title)}.`);
  log();

  // Copy template contents into the target path
  const templatePath = path.join(templatesPath, templateMeta.title);
  await cpy(path.join(templatePath, "**", "*"), targetPath, {
    rename: (name) => name.replace(/^_dot_/, "."),
  });

  // Create package.json for project
  const packageJson = await fs.readJSON(path.join(targetPath, "package.json"));
  packageJson.name = projectName;
  await fs.writeFile(
    path.join(targetPath, "package.json"),
    JSON.stringify(packageJson, null, 2),
  );

  const packageManager = await getPackageManager({ options });
  if (packageManager === "npm") {
    await fs.appendFile(
      path.join(targetPath, ".npmrc"),
      "\nlegacy-peer-deps = true",
    );
  }

  // Create git repository
  if (!options.skipGit) {
    await execa("git", ["init"], { cwd: targetPath });
    await execa("git", ["add", "."], { cwd: targetPath });
    await execa(
      "git",
      [
        "commit",
        "--no-verify",
        "--message",
        "Initial commit from create-wagmi",
      ],
      { cwd: targetPath },
    );
    log(pico.green("✔"), "Initialized git repository.");
    log();
  }

  log("―――――――――――――――――――――");
  log();
  log(
    `${pico.green("Success!")} Created ${pico.bold(
      projectName,
    )} at ${pico.green(path.resolve(projectPath))}`,
  );
  log();
  log(
    `To start your app, run \`${pico.bold(
      pico.cyan(`cd ${projectPath}`),
    )}\` and then \`${pico.bold(
      pico.cyan(
        `${packageManager}${packageManager === "npm" ? " run" : ""} dev`,
      ),
    )}\``,
  );
  log();
  log("―――――――――――――――――――――");
  log();
}

(async () => {
  const cli = cac(rootPackageJson.name)
    .version(rootPackageJson.version)
    .usage(`${pico.green("<project-directory>")} [options]`)
    .option(
      "-t, --template [name]",
      `A template to bootstrap with. Available: ${templates
        .map(({ id }) => id)
        .join(", ")}`,
    )
    .option("--npm", "Use npm as your package manager")
    .option("--pnpm", "Use pnpm as your package manager")
    .option("--yarn", "Use yarn as your package manager")
    .option("--skip-git", "Skips initializing the project as a git repository")
    .help();

  const { args, options } = cli.parse(process.argv);

  try {
    await run({ args, options, templates });
    log();
    await notifyUpdate({ options });
  } catch (error) {
    log(
      error instanceof ValidationError
        ? error.message
        : pico.red((<Error>error).message),
    );
    log();
    await notifyUpdate({ options });
    process.exit(1);
  }
})();
