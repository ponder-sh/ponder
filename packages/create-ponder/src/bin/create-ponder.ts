#!/usr/bin/env node
import { cac } from "cac";
import path from "node:path";
import prompts from "prompts";

import { CreatePonderOptions, Template, TemplateKind } from "@/common";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import packageJson from "../../../package.json";
import { run } from "../index";

const createPonder = async () => {
  const cli = cac(packageJson.name)
    .version(packageJson.version)
    .usage("[options]")
    .help()
    .option("--dir [path]", "Path to directory for generated project")
    .option("--from-subgraph-id [id]", "Subgraph deployment ID")
    .option("--from-subgraph-repo [path]", "Path to subgraph repository")
    .option("--from-etherscan [url]", "Link to etherscan contract page")
    .option("--etherscan-api-key [key]", "Etherscan API key");

  const parsed = cli.parse(process.argv);

  const options = parsed.options as {
    help?: boolean;
    dir?: string;
    fromSubgraphId?: string;
    fromSubgraphRepo?: string;
    fromEtherscan?: string;
    etherscanApiKey?: string;
  };

  if (options.help) {
    process.exit(0);
  }

  // Validate CLI options.
  if (
    (options.fromSubgraphId && options.fromSubgraphRepo) ||
    (options.fromSubgraphId && options.fromEtherscan) ||
    (options.fromSubgraphRepo && options.fromEtherscan)
  ) {
    throw new Error(
      `Cannot specify more than one "--from" option:\n  --from-subgraph\n  --from-etherscan-id\n  --from-etherscan-repo`
    );
  }

  const { projectName } = await prompts({
    type: "text",
    name: "projectName",
    message: "What is your project named?",
    initial: "my-app",
  });

  let template: Template | undefined = undefined;

  if (
    !options.fromSubgraphId &&
    !options.fromSubgraphRepo &&
    !options.fromEtherscan
  ) {
    const { template: templateKind } = await prompts({
      type: "select",
      name: "template",
      message: "Would you like to use a template for this project?",
      choices: [
        { title: "None" },
        { title: "Etherscan contract link" },
        { title: "Subgraph ID" },
        { title: "Subgraph repository" },
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

    if (templateKind === TemplateKind.SUBGRAPH_REPO) {
      const { path } = await prompts({
        type: "text",
        name: "path",
        message: "Enter a path to a subgraph repository",
        initial: "../subgraph",
      });
      template = { kind: TemplateKind.SUBGRAPH_REPO, path };
    }
  }

  const validatedOptions: CreatePonderOptions = {
    projectName,
    rootDir: path.resolve(".", options.dir ? options.dir : projectName),
    template,
    etherscanApiKey: options.etherscanApiKey,
  };

  await run(validatedOptions);
};

createPonder();
