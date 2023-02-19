import { Box, Newline, render as inkRender, Text } from "ink";
import React from "react";

import { PonderOptions } from "@/common/options";
import { Contract } from "@/config/contracts";

import { BackfillBar } from "./BackfillBar";
import { HandlersBar } from "./HandlersBar";

export type UiState = {
  isSilent: boolean;
  timestamp: number;

  stats: Record<
    string,
    {
      cacheRate: number;

      logStartTimestamp: number;
      logTotal: number;
      logCurrent: number;
      logAvgDuration: number;
      logAvgBlockCount: number;

      blockStartTimestamp: number;
      blockTotal: number;
      blockCurrent: number;
      blockAvgDuration: number;

      eta: number;
    }
  >;

  isBackfillComplete: boolean;
  backfillDuration: string;

  handlerError: boolean;
  handlersCurrent: number;
  handlersTotal: number;
  handlersHandledTotal: number;
  handlersToTimestamp: number;

  networks: Record<
    string,
    {
      name: string;
      blockNumber: number;
      blockTimestamp: number;
      blockTxnCount: number;
      matchedLogCount: number;
    }
  >;
};

export const getUiState = (options: Pick<PonderOptions, "SILENT">): UiState => {
  return {
    isSilent: options.SILENT,

    timestamp: 0,

    stats: {},

    isBackfillComplete: false,
    backfillDuration: "",

    handlerError: false,
    handlersCurrent: 0,
    handlersTotal: 0,
    handlersHandledTotal: 0,
    handlersToTimestamp: 0,

    networks: {},
  };
};

export const hydrateUi = ({
  ui,
  contracts,
}: {
  ui: UiState;
  contracts: Contract[];
}) => {
  contracts
    .filter((contract) => contract.isIndexed)
    .forEach((contract) => {
      ui.stats[contract.name] = {
        cacheRate: 0,
        logStartTimestamp: 0,
        logTotal: 0,
        logCurrent: 0,
        logAvgDuration: 0,
        logAvgBlockCount: 0,
        blockStartTimestamp: 0,
        blockTotal: 0,
        blockCurrent: 0,
        blockAvgDuration: 0,
        eta: 0,
      };
    });
};

const App = (ui: UiState) => {
  const {
    isSilent,
    timestamp,
    stats,
    isBackfillComplete,
    backfillDuration,
    handlersCurrent,
    handlerError,
    networks,
  } = ui;

  if (isSilent) return null;

  if (handlerError) {
    return (
      <Box flexDirection="column">
        <Text> </Text>
        <Text color="cyan">
          Resolve the error and save your changes to reload the server.
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Newline above interface */}
      <Text> </Text>
      <Box flexDirection="row">
        <Text bold={true}>Backfill </Text>
        {isBackfillComplete ? (
          <Text color="greenBright">
            (done in {backfillDuration})<Newline />
          </Text>
        ) : (
          <Text color="yellowBright">(in progress)</Text>
        )}
      </Box>
      {!isBackfillComplete && (
        <Box flexDirection="column">
          {Object.entries(stats).map(([contract, stat]) => (
            <BackfillBar key={contract} contract={contract} stat={stat} />
          ))}
          <Text> </Text>
        </Box>
      )}

      <HandlersBar ui={ui} />

      {Object.values(networks).length > 0 && (
        <Box flexDirection="column">
          <Text bold={true}>Frontfill </Text>
          {Object.values(networks).map((network) => (
            <Box flexDirection="row" key={network.name}>
              <Text>
                {network.name.slice(0, 1).toUpperCase() + network.name.slice(1)}{" "}
                @{" "}
              </Text>
              {network.blockTxnCount !== -1 ? (
                <Text>
                  block {network.blockNumber} ({network.blockTxnCount} txs,{" "}
                  {network.matchedLogCount} matched logs,{" "}
                  {timestamp - network.blockTimestamp}s ago)
                </Text>
              ) : (
                <Text>
                  block {network.blockNumber} (
                  {Math.max(timestamp - network.blockTimestamp, 0)}s ago)
                </Text>
              )}
            </Box>
          ))}
          <Text> </Text>
        </Box>
      )}

      {handlersCurrent > 0 && (
        <Box flexDirection="column">
          <Text bold={true}>GraphQL </Text>
          <Box flexDirection="row">
            <Text>Server live at http://localhost:42069/graphql</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const {
  rerender,
  unmount: inkUnmount,
  clear,
} = inkRender(<App {...getUiState({ SILENT: true })} />);

export const render = (ui: UiState) => {
  rerender(<App {...ui} />);
};

export const unmount = () => {
  clear();
  inkUnmount();
};
