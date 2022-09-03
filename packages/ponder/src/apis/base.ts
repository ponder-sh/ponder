export interface BaseApi {
  kind: ApiKind;
}

export enum ApiKind {
  GRAPHQL = "graphql",
}
