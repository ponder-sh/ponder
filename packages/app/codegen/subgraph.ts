import { gql } from 'urql';
import * as Urql from 'urql';

export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: string;
  String: string;
  Boolean: boolean;
  Int: number;
  Float: number;
  BigDecimal: any;
  BigInt: any;
  Bytes: any;
};

export type BlockChangedFilter = {
  readonly number_gte: Scalars['Int'];
};

export type Block_Height = {
  readonly hash?: InputMaybe<Scalars['Bytes']>;
  readonly number?: InputMaybe<Scalars['Int']>;
  readonly number_gte?: InputMaybe<Scalars['Int']>;
};

/** Defines the order direction, either ascending or descending */
export enum OrderDirection {
  Asc = 'asc',
  Desc = 'desc'
}

export type Query = {
  readonly __typename?: 'Query';
  /** Access to subgraph metadata */
  readonly _meta?: Maybe<_Meta_>;
  readonly token?: Maybe<Token>;
  readonly tokens: ReadonlyArray<Token>;
};


export type Query_MetaArgs = {
  block?: InputMaybe<Block_Height>;
};


export type QueryTokenArgs = {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID'];
  subgraphError?: _SubgraphErrorPolicy_;
};


export type QueryTokensArgs = {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']>;
  orderBy?: InputMaybe<Token_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<Token_Filter>;
};

export type Subscription = {
  readonly __typename?: 'Subscription';
  /** Access to subgraph metadata */
  readonly _meta?: Maybe<_Meta_>;
  readonly token?: Maybe<Token>;
  readonly tokens: ReadonlyArray<Token>;
};


export type Subscription_MetaArgs = {
  block?: InputMaybe<Block_Height>;
};


export type SubscriptionTokenArgs = {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID'];
  subgraphError?: _SubgraphErrorPolicy_;
};


export type SubscriptionTokensArgs = {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']>;
  orderBy?: InputMaybe<Token_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<Token_Filter>;
};

export type Token = {
  readonly __typename?: 'Token';
  readonly id: Scalars['ID'];
  readonly owner: Scalars['Bytes'];
  readonly tokenURI: Scalars['String'];
};

export type Token_Filter = {
  /** Filter for the block changed event. */
  readonly _change_block?: InputMaybe<BlockChangedFilter>;
  readonly id?: InputMaybe<Scalars['ID']>;
  readonly id_gt?: InputMaybe<Scalars['ID']>;
  readonly id_gte?: InputMaybe<Scalars['ID']>;
  readonly id_in?: InputMaybe<ReadonlyArray<Scalars['ID']>>;
  readonly id_lt?: InputMaybe<Scalars['ID']>;
  readonly id_lte?: InputMaybe<Scalars['ID']>;
  readonly id_not?: InputMaybe<Scalars['ID']>;
  readonly id_not_in?: InputMaybe<ReadonlyArray<Scalars['ID']>>;
  readonly owner?: InputMaybe<Scalars['Bytes']>;
  readonly owner_contains?: InputMaybe<Scalars['Bytes']>;
  readonly owner_in?: InputMaybe<ReadonlyArray<Scalars['Bytes']>>;
  readonly owner_not?: InputMaybe<Scalars['Bytes']>;
  readonly owner_not_contains?: InputMaybe<Scalars['Bytes']>;
  readonly owner_not_in?: InputMaybe<ReadonlyArray<Scalars['Bytes']>>;
  readonly tokenURI?: InputMaybe<Scalars['String']>;
  readonly tokenURI_contains?: InputMaybe<Scalars['String']>;
  readonly tokenURI_contains_nocase?: InputMaybe<Scalars['String']>;
  readonly tokenURI_ends_with?: InputMaybe<Scalars['String']>;
  readonly tokenURI_ends_with_nocase?: InputMaybe<Scalars['String']>;
  readonly tokenURI_gt?: InputMaybe<Scalars['String']>;
  readonly tokenURI_gte?: InputMaybe<Scalars['String']>;
  readonly tokenURI_in?: InputMaybe<ReadonlyArray<Scalars['String']>>;
  readonly tokenURI_lt?: InputMaybe<Scalars['String']>;
  readonly tokenURI_lte?: InputMaybe<Scalars['String']>;
  readonly tokenURI_not?: InputMaybe<Scalars['String']>;
  readonly tokenURI_not_contains?: InputMaybe<Scalars['String']>;
  readonly tokenURI_not_contains_nocase?: InputMaybe<Scalars['String']>;
  readonly tokenURI_not_ends_with?: InputMaybe<Scalars['String']>;
  readonly tokenURI_not_ends_with_nocase?: InputMaybe<Scalars['String']>;
  readonly tokenURI_not_in?: InputMaybe<ReadonlyArray<Scalars['String']>>;
  readonly tokenURI_not_starts_with?: InputMaybe<Scalars['String']>;
  readonly tokenURI_not_starts_with_nocase?: InputMaybe<Scalars['String']>;
  readonly tokenURI_starts_with?: InputMaybe<Scalars['String']>;
  readonly tokenURI_starts_with_nocase?: InputMaybe<Scalars['String']>;
};

export enum Token_OrderBy {
  Id = 'id',
  Owner = 'owner',
  TokenUri = 'tokenURI'
}

export type _Block_ = {
  readonly __typename?: '_Block_';
  /** The hash of the block */
  readonly hash?: Maybe<Scalars['Bytes']>;
  /** The block number */
  readonly number: Scalars['Int'];
};

/** The type for the top-level _meta field */
export type _Meta_ = {
  readonly __typename?: '_Meta_';
  /**
   * Information about a specific subgraph block. The hash of the block
   * will be null if the _meta field has a block constraint that asks for
   * a block number. It will be filled if the _meta field has no block constraint
   * and therefore asks for the latest  block
   *
   */
  readonly block: _Block_;
  /** The deployment ID */
  readonly deployment: Scalars['String'];
  /** If `true`, the subgraph encountered indexing errors at some past block */
  readonly hasIndexingErrors: Scalars['Boolean'];
};

export enum _SubgraphErrorPolicy_ {
  /** Data will be returned even if the subgraph has indexing errors */
  Allow = 'allow',
  /** If the subgraph has indexing errors, data will be omitted. The default. */
  Deny = 'deny'
}

export type InventoryQueryVariables = Exact<{
  owner: Scalars['Bytes'];
}>;


export type InventoryQuery = { readonly __typename?: 'Query', readonly tokens: ReadonlyArray<{ readonly __typename?: 'Token', readonly id: string, readonly tokenURI: string }> };


export const InventoryDocument = gql`
    query Inventory($owner: Bytes!) {
  tokens(where: {owner: $owner}, first: 100) {
    id
    tokenURI
  }
}
    `;

export function useInventoryQuery(options: Omit<Urql.UseQueryArgs<InventoryQueryVariables>, 'query'> = {}) {
  return Urql.useQuery<InventoryQuery>({ query: InventoryDocument, ...options });
};