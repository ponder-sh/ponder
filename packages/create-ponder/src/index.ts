#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Abi, AbiEvent } from "abitype";
import { cac } from "cac";
import cpy from "cpy";
import { execa } from "execa";
import fs from "fs-extra";
import { oraPromise } from "ora";
import pico from "picocolors";
import prettier from "prettier";
import { default as prompts } from "prompts";

// NOTE: This is a workaround for tsconfig `rootDir` nonsense.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import rootPackageJson from "../package.json" assert { type: "json" };
import { fromEtherscan } from "./etherscan.js";
import { getPackageManager } from "./helpers/getPackageManager.js";
import { notifyUpdate } from "./helpers/notifyUpdate.js";
import {
  validateProjectName,
  validateTemplateName,
  ValidationError,
} from "./helpers/validate.js";

const log = console.log;

export type SerializableNetwork = {
  chainId: number;
  transport: string;
};

export type SerializableContract = {
  abi:
    | { abi: Abi; name: string; dir: string }
    | { abi: Abi; name: string; dir: string }[];
  address: string;
  network: Record<string, any> | string;
  startBlock?: number;
};

export type SerializableConfig = {
  networks: Record<string, SerializableNetwork>;
  contracts: Record<string, SerializableContract>;
};

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
  { id: "empty", title: "Default", description: "A blank-slate Ponder app" },
  {
    id: "etherscan",
    title: "Etherscan contract link",
    description: "Bootstrap from an Etherscan contract link",
  },
  {
    id: "feature-factory",
    title: "Feature - Factory contract",
    description: "A Ponder app using a factory contract",
  },
  {
    id: "feature-filter",
    title: "Feature - Custom event filter",
    description: "A Ponder app using an event filter",
  },
  {
    id: "feature-multichain",
    title: "Feature - Multichain contract",
    description: "A Ponder app using multiple chains",
  },
  {
    id: "feature-proxy",
    title: "Feature - Proxy contract",
    description: "A Ponder app that uses a proxy contract",
  },
  {
    id: "feature-read-contract",
    title: "Feature - Read from a contract",
    description: "A Ponder app that uses contract calls",
  },
  {
    id: "project-friendtech",
    title: "project-friendtech",
    description: "A Ponder app for Friendtech",
  },
  {
    id: "project-uniswap-v3-flash",
    title: "Project - Uniswap V3 flash loans",
    description: "A Ponder app for Uniswap V3 flash loans",
  },
  {
    id: "reference-erc20",
    title: "Reference - ERC20 token",
    description: "A Ponder app for an ERC20 token",
  },
  {
    id: "reference-erc721",
    title: "Reference - ERC721",
    description: "A Ponder app for an ERC721 token",
  },
] as const satisfies readonly Template[];

export async function run({
  args,
  options,
}: {
  args: CLIArgs;
  options: CLIOptions;
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
      message: "What's the name of your project?",
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

  // Automatically use etherscan as a template when appropriate.
  if (options.etherscanContractLink && !templateId) templateId = "etherscan";

  // Extract template ID from CLI or prompt
  if (!templateId) {
    templateId = (
      await prompts({
        name: "templateId",
        message: "Which template would you like to use?",
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
  if (!templateMeta) throw new ValidationError(templateValidation);

  // Validate template name
  templateValidation = await validateTemplateName({
    templateId,
    templates,
  });
  if (!templateValidation.valid) throw new ValidationError(templateValidation);

  let config: SerializableConfig | undefined;

  const targetPath = path.join(process.cwd(), projectPath);

  if (templateMeta.id === "etherscan") {
    let link = options.etherscanContractLink;
    if (!link) {
      const result = await prompts({
        type: "text",
        name: "link",
        message: "Enter an Etherscan contract link",
        initial: "https://etherscan.io/address/0x97...",
      });
      link = result.link;
    }

    config = await fromEtherscan({
      rootDir: targetPath,
      etherscanLink: link,
      etherscanApiKey: options.etherscanApiKey,
    });
  }

  log(`Creating a repo at: ${pico.green(targetPath)}`);
  log();
  log(`Using template: ${pico.bold(templateMeta.title)}`);
  log();

  // Copy template contents into the target path
  const templatePath = path.join(templatesPath, templateMeta.id);
  await cpy(path.join(templatePath, "**", "*"), targetPath, {
    rename: (name) => name.replace(/^_dot_/, "."),
  });

  if (config) {
    // Write the config file.
    const configContent = `
      import { createConfig${
        Object.values(config.contracts).some((c) => Array.isArray(c.abi))
          ? ", mergeAbis"
          : ""
      } } from "@ponder/core";
      import { http } from "viem";

      ${Object.values(config.contracts)
        .map((c) => c.abi)
        .flat()
        .map(
          (abi) =>
            `import {${abi.name}} from "${abi.dir.slice(
              0,
              abi.dir.length - 3,
            )}"`,
        )
        .join("\n")}

      export default createConfig({
        networks: ${JSON.stringify(config.networks)
          .replaceAll(
            /"process.env.PONDER_RPC_URL_(.*?)"/g,
            "process.env.PONDER_RPC_URL_$1",
          )
          .replaceAll(/"http\((.*?)\)"/g, "http($1)")},
        contracts: ${JSON.stringify(
          Object.entries(config.contracts).reduce<Record<string, any>>(
            (acc, [name, c]) => {
              acc[name] = {
                ...c,
                abi: Array.isArray(c.abi)
                  ? `mergeAbis([${c.abi.map((a) => a.name).join(",")}])`
                  : c.abi.name,
              };
              return acc;
            },
            {},
          ),
        ).replaceAll(/"abi":"(.*?)"/g, "abi:$1")},
      });
    `;

    writeFileSync(
      path.join(targetPath, "ponder.config.ts"),
      await prettier.format(configContent, { parser: "typescript" }),
    );

    // Write the indexing function files.
    for (const [name, contract] of Object.entries(config.contracts)) {
      // If it's an array of ABIs, use the 2nd one (the implementation ABI).
      const abi = Array.isArray(contract.abi)
        ? contract.abi[1].abi!
        : contract.abi.abi;

      const abiEvents = abi.filter(
        (item): item is AbiEvent => item.type === "event",
      );

      const eventNamesToWrite = abiEvents
        .map((event) => event.name)
        .slice(0, 2);

      const indexingFunctionFileContents = `
      import { ponder } from '@/generated'

      ${eventNamesToWrite
        .map(
          (eventName) => `
          ponder.on("${name}:${eventName}", async ({ event, context }) => {
            console.log(event.args)
          })`,
        )
        .join("\n")}
    `;

      writeFileSync(
        path.join(targetPath, `./src/${name}.ts`),
        await prettier.format(indexingFunctionFileContents, {
          parser: "typescript",
        }),
      );
    }
  }

  // Create package.json for project
  const packageJson = await fs.readJSON(path.join(targetPath, "package.json"));
  packageJson.name = projectName;
  packageJson.dependencies["@ponder/core"] = `^${rootPackageJson.version}`;
  packageJson.devDependencies["eslint-config-ponder"] =
    `^${rootPackageJson.version}`;
  await fs.writeFile(
    path.join(targetPath, "package.json"),
    JSON.stringify(packageJson, null, 2),
  );

  const packageManager = getPackageManager({ options });

  // Install in background to not clutter screen
  log(`Installing with: ${pico.bold(packageManager)}`);
  log();
  const installArgs = [
    "install",
    packageManager === "npm" ? "--quiet" : "--silent",
  ];
  await oraPromise(
    execa(packageManager, installArgs, {
      cwd: targetPath,
      env: {
        ...process.env,
        ADBLOCK: "1",
        DISABLE_OPENCOLLECTIVE: "1",
        // we set NODE_ENV to development as pnpm skips dev
        // dependencies when production
        NODE_ENV: "development",
      },
    }),
    {
      text: "Installing packages. This may take a few seconds.",
      failText: "Failed to install packages.",
      successText: "Installed packages.",
    },
  );
  log();

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
        "chore: initial commit from create-ponder",
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
        `${packageManager}${
          packageManager === "npm" || packageManager === "bun" ? " run" : ""
        } dev`,
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
    .option("--etherscan-contract-link [link]", "Etherscan contract link")
    .option("--etherscan-api-key [key]", "Etherscan API key")
    .option("--npm", "Use npm as your package manager")
    .option("--pnpm", "Use pnpm as your package manager")
    .option("--yarn", "Use yarn as your package manager")
    .option("--skip-git", "Skips initializing the project as a git repository")
    .help();

  // Check Nodejs version
  if (Number(process.version.split(".")[0].slice(1)) < 18)
    throw Error(
      pico.red(
        `Node version:${process.version} does not meet the >=18 requirement`,
      ),
    );

  const { args, options } = cli.parse(process.argv);

  try {
    await run({ args, options });
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
