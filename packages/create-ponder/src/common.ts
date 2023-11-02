export enum TemplateKind {
  NONE,
  ETHERSCAN,
  SUBGRAPH_ID,
}

export type Template =
  | {
      kind: TemplateKind.ETHERSCAN;
      link: string;
    }
  | {
      kind: TemplateKind.SUBGRAPH_ID;
      id: string;
    };

export interface CreatePonderOptions {
  rootDir: string;
  projectName: string;
  template?: Template;
  etherscanApiKey?: string;
  eslint?: boolean;
}
