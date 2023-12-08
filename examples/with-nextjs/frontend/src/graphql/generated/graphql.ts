/* eslint-disable */
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  BigInt: { input: string; output: string; }
};

export type DepositEvent = {
  __typename?: 'DepositEvent';
  account: Scalars['String']['output'];
  amount: Scalars['BigInt']['output'];
  id: Scalars['String']['output'];
  timestamp: Scalars['Int']['output'];
};

export type DepositEventFilter = {
  account: InputMaybe<Scalars['String']['input']>;
  account_contains: InputMaybe<Scalars['String']['input']>;
  account_ends_with: InputMaybe<Scalars['String']['input']>;
  account_in: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
  account_not: InputMaybe<Scalars['String']['input']>;
  account_not_contains: InputMaybe<Scalars['String']['input']>;
  account_not_ends_with: InputMaybe<Scalars['String']['input']>;
  account_not_in: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
  account_not_starts_with: InputMaybe<Scalars['String']['input']>;
  account_starts_with: InputMaybe<Scalars['String']['input']>;
  amount: InputMaybe<Scalars['BigInt']['input']>;
  amount_gt: InputMaybe<Scalars['BigInt']['input']>;
  amount_gte: InputMaybe<Scalars['BigInt']['input']>;
  amount_in: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>;
  amount_lt: InputMaybe<Scalars['BigInt']['input']>;
  amount_lte: InputMaybe<Scalars['BigInt']['input']>;
  amount_not: InputMaybe<Scalars['BigInt']['input']>;
  amount_not_in: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>;
  id: InputMaybe<Scalars['String']['input']>;
  id_contains: InputMaybe<Scalars['String']['input']>;
  id_ends_with: InputMaybe<Scalars['String']['input']>;
  id_in: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
  id_not: InputMaybe<Scalars['String']['input']>;
  id_not_contains: InputMaybe<Scalars['String']['input']>;
  id_not_ends_with: InputMaybe<Scalars['String']['input']>;
  id_not_in: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
  id_not_starts_with: InputMaybe<Scalars['String']['input']>;
  id_starts_with: InputMaybe<Scalars['String']['input']>;
  timestamp: InputMaybe<Scalars['Int']['input']>;
  timestamp_gt: InputMaybe<Scalars['Int']['input']>;
  timestamp_gte: InputMaybe<Scalars['Int']['input']>;
  timestamp_in: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>;
  timestamp_lt: InputMaybe<Scalars['Int']['input']>;
  timestamp_lte: InputMaybe<Scalars['Int']['input']>;
  timestamp_not: InputMaybe<Scalars['Int']['input']>;
  timestamp_not_in: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>;
};

export type Query = {
  __typename?: 'Query';
  depositEvent: Maybe<DepositEvent>;
  depositEvents: Array<DepositEvent>;
};


export type QueryDepositEventArgs = {
  id: Scalars['String']['input'];
  timestamp: InputMaybe<Scalars['Int']['input']>;
};


export type QueryDepositEventsArgs = {
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<Scalars['String']['input']>;
  orderDirection?: InputMaybe<Scalars['String']['input']>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  timestamp: InputMaybe<Scalars['Int']['input']>;
  where: InputMaybe<DepositEventFilter>;
};

export type DepositsQueryQueryVariables = Exact<{ [key: string]: never; }>;


export type DepositsQueryQuery = { __typename?: 'Query', depositEvents: Array<{ __typename?: 'DepositEvent', id: string, timestamp: number, account: string, amount: string }> };


export const DepositsQueryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"DepositsQuery"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"depositEvents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orderDirection"},"value":{"kind":"StringValue","value":"desc","block":false}},{"kind":"Argument","name":{"kind":"Name","value":"orderBy"},"value":{"kind":"StringValue","value":"timestamp","block":false}},{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"IntValue","value":"10"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"timestamp"}},{"kind":"Field","name":{"kind":"Name","value":"account"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}}]}}]}}]} as unknown as DocumentNode<DepositsQueryQuery, DepositsQueryQueryVariables>;