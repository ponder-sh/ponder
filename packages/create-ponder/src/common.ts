export enum TemplateKind {
  NONE,
  ETHERSCAN,
  SUBGRAPH_ID,
  SUBGRAPH_REPO,
}

export type Template =
  | {
      kind: TemplateKind.ETHERSCAN;
      link: string;
    }
  | {
      kind: TemplateKind.SUBGRAPH_ID;
      id: string;
    }
  | {
      kind: TemplateKind.SUBGRAPH_REPO;
      path: string;
    };

export interface CreatePonderOptions {
  rootDir: string;
  projectName: string;
  template?: Template;
  etherscanApiKey?: string;
}
