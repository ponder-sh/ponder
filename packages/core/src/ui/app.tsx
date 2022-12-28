import { Box, Newline, render as inkRender, Text } from "ink";
import React from "react";

import { PonderOptions } from "@/common/options";
import { Source } from "@/sources/base";

import { BackfillBar } from "./BackfillBar";
import { HandlersBar } from "./HandlersBar";

export type UiState = {
  isSilent: boolean;
  isProd: boolean;

  timestamp: number;

  // See src/README.md. This maps source name to backfill stats.
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

  handlersCurrent: number;
  handlersTotal: number;
  handlersToTimestamp: number;

  configError: string | null;
  handlerError: Error | null;

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

export const getUiState = (options: PonderOptions): UiState => {
  return {
    isSilent: options.SILENT,
    isProd: false,

    timestamp: 0,

    stats: {},

    isBackfillComplete: false,
    backfillDuration: "",

    handlersCurrent: 0,
    handlersTotal: 0,
    handlersToTimestamp: 0,

    configError: null,
    handlerError: null,

    networks: {},
  };
};

export const hydrateUi = ({
  ui,
  sources,
}: {
  ui: UiState;
  sources: Source[];
}) => {
  sources.forEach((source) => {
    ui.stats[source.name] = {
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
    isProd,
    timestamp,
    stats,
    isBackfillComplete,
    backfillDuration,
    handlersCurrent,
    configError,
    handlerError,
    networks,
  } = ui;

  if (isSilent) return null;

  if (isProd) return null;

  if (configError) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="redBright" bold={true}>
            [Config error]{" "}
          </Text>
          <Text>
            {configError}
            <Newline />
          </Text>
        </Box>
      </Box>
    );
  }

  if (handlerError) {
    return (
      <Box flexDirection="column">
        <Text> </Text>
        <Text>{handlerError.stack}</Text>
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
          {Object.entries(stats).map(([source, stat]) => (
            <BackfillBar key={source} source={source} stat={stat} />
          ))}
          <Text> </Text>
        </Box>
      )}

      <HandlersBar ui={ui} />

      <Box flexDirection="column">
        {Object.values(networks).map((network) => (
          <Box flexDirection="row" key={network.name}>
            <Text color="cyanBright" bold={true}>
              [{network.name}]{" "}
            </Text>
            {network.blockTxnCount !== -1 ? (
              <Text>
                Block {network.blockNumber} ({network.blockTxnCount} txs,{" "}
                {network.matchedLogCount} matched logs,{" "}
                {timestamp - network.blockTimestamp}s ago)
              </Text>
            ) : (
              <Text>
                Block {network.blockNumber} (
                {Math.max(timestamp - network.blockTimestamp, 0)}s ago)
              </Text>
            )}
          </Box>
        ))}
        <Text> </Text>
      </Box>

      {handlersCurrent > 0 && (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text color="magentaBright" bold={true}>
              [graphql]{" "}
            </Text>
            <Text>Server live at http://localhost:42069/graphql</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export const render = (props: UiState) => {
  inkRender(<App {...props} />);
};
