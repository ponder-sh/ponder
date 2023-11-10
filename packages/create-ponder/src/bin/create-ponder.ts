#!/usr/bin/env node
import { cac } from "cac";
import path from "node:path";
import prompts from "prompts";

import type { CreatePonderOptions, Template } from "@/common";
import { TemplateKind } from "@/common";
import { run } from "@/index";

// NOTE: This is a workaround for tsconfig `rootDir` nonsense.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import packageJson from "../../package.json";

const createPonder = async () => {
  const cli = cac(packageJson.name)
    .version(packageJson.version)
    .usage("[options]")
    .help()
    .option("--dir [path]", "Path to directory for generated project")
    .option("--from-subgraph-id [id]", "Subgraph deployment ID")
    .option("--from-etherscan [url]", "Link to etherscan contract page")
    .option("--etherscan-api-key [key]", "Etherscan API key");

  const parsed = cli.parse(process.argv);

  const options = parsed.options as {
    help?: boolean;
    dir?: string;
    fromSubgraphId?: string;
    fromEtherscan?: string;
    etherscanApiKey?: string;
  };

  if (options.help) {
    process.exit(0);
  }

  const { fromEtherscan, fromSubgraphId } = options;

  // Validate CLI options.
  if (fromSubgraphId && fromEtherscan) {
    throw new Error(
      `Cannot specify more than one "--from" option:\n  --from-subgraph\n  --from-etherscan-id\n`
    );
  }

  const { projectName } = await prompts({
    type: "text",
    name: "projectName",
    message: "What is your project named?",
    initial: "my-app",
  });

  // Get template from options if provided.
  let template: Template | undefined = undefined;
  if (fromEtherscan) {
    template = { kind: TemplateKind.ETHERSCAN, link: fromEtherscan };
  }
  if (fromSubgraphId) {
    template = { kind: TemplateKind.SUBGRAPH_ID, id: fromSubgraphId };
  }

  // Get template from prompts if not provided.
  if (!fromSubgraphId && !fromEtherscan) {
    const { template: templateKind } = await prompts({
      type: "select",
      name: "template",
      message: "Would you like to use a template for this project?",
      choices: [
        { title: "None" },
        { title: "Etherscan contract link" },
        { title: "Subgraph ID" },
      ],
    });

    if (templateKind === TemplateKind.ETHERSCAN) {
      const { link } = await prompts({
        type: "text",
        name: "link",
        message: "Enter an Etherscan contract link",
        initial: "https://etherscan.io/address/0x97...",
      });
      template = { kind: TemplateKind.ETHERSCAN, link };
    }

    if (templateKind === TemplateKind.SUBGRAPH_ID) {
      const { id } = await prompts({
        type: "text",
        name: "id",
        message: "Enter a subgraph deployment ID",
        initial: "QmNus...",
      });
      template = { kind: TemplateKind.SUBGRAPH_ID, id };
    }
  }

  const { eslint } = await prompts({
    type: "confirm",
    name: "eslint",
    message: "Would you like to use ESLint?",
    initial: true,
  });

  const validatedOptions: CreatePonderOptions = {
    projectName,
    rootDir: path.resolve(".", options.dir ? options.dir : projectName),
    template,
    etherscanApiKey: options.etherscanApiKey,
    eslint,
  };

  await run(validatedOptions);
};

createPonder();
