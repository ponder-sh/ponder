import { Box, Newline, render as inkRender, Text } from "ink";
import React from "react";

import { PonderOptions } from "@/common/options";
import { Source } from "@/sources/base";

import { BackfillBar } from "./BackfillBar";
import { ProgressBar } from "./ProgressBar";

export enum HandlersStatus {
  NOT_STARTED,
  IN_PROGRESS,
  UP_TO_LATEST,
}

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
      logCheckpointTimestamp: number;
      logAvgDurationInst: number;
      logAvgDurationTotal: number;
      logCheckpointBlockCount: number;
      logAvgBlockCountInst: number;
      logAvgBlockCountTotal: number;

      blockStartTimestamp: number;
      blockTotal: number;
      blockCurrent: number;
      blockCheckpointTimestamp: number;
      blockAvgDurationInst: number;
      blockAvgDurationTotal: number;

      eta: number;
    }
  >;

  backfillStartTimestamp: number;
  isBackfillComplete: boolean;
  backfillDuration: string;

  handlersStatus: HandlersStatus;
  handlersCurrent: number;
  handlersTotal: number;

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

    backfillStartTimestamp: 0,
    isBackfillComplete: false,
    backfillDuration: "",

    handlersStatus: HandlersStatus.NOT_STARTED,
    handlersCurrent: 0,
    handlersTotal: 0,

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
      logCheckpointTimestamp: 0,
      logAvgDurationInst: 0,
      logAvgDurationTotal: 0,
      logCheckpointBlockCount: 0,
      logAvgBlockCountInst: 0,
      logAvgBlockCountTotal: 0,
      blockStartTimestamp: 0,
      blockTotal: 0,
      blockCurrent: 0,
      blockCheckpointTimestamp: 0,
      blockAvgDurationInst: 0,
      blockAvgDurationTotal: 0,
      eta: 0,
    };
  });
};

const App = ({
  isSilent,
  isProd,
  timestamp,
  stats,
  isBackfillComplete,
  backfillDuration,
  handlersStatus,
  handlersCurrent,
  handlersTotal,
  configError,
  handlerError,
  networks,
}: UiState) => {
  if (isSilent) return null;

  const handlersStatusText = () => {
    switch (handlersStatus) {
      case HandlersStatus.NOT_STARTED:
        return <Text>(not started)</Text>;
      case HandlersStatus.IN_PROGRESS:
        return <Text color="yellowBright">(in progress)</Text>;
      case HandlersStatus.UP_TO_LATEST:
        return <Text color="greenBright">(up to date)</Text>;
    }
  };

  const handlersPercent = `${Math.round(
    100 * (handlersCurrent / Math.max(handlersTotal, 1))
  )}%`;

  const handlerBottomText =
    !isBackfillComplete &&
    handlersTotal > 0 &&
    handlersTotal === handlersCurrent
      ? ""
      : `/${handlersTotal}`;
  const handlersCountText =
    handlersTotal > 0
      ? ` | ${handlersCurrent}${handlerBottomText} events`
      : null;

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

      <Box flexDirection="row">
        <Text bold={true}>Handlers </Text>
        {handlersStatusText()}
      </Box>
      <Box flexDirection="row">
        <ProgressBar
          current={handlersCurrent}
          end={Math.max(handlersTotal, 1)}
        />
        <Text>
          {" "}
          {handlersPercent}
          {handlersCountText}
          {/* {handlersCurrent}/{handlersTotal} events */}
          {/* Newline below progress bar row */}
          <Newline />
        </Text>
      </Box>

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
                {/* Newline below progress bar row */}
                <Newline />
              </Text>
            ) : (
              <Text>
                Block {network.blockNumber} (
                {Math.max(timestamp - network.blockTimestamp, 0)}s ago)
                {/* Newline below progress bar row */}
                <Newline />
              </Text>
            )}
          </Box>
        ))}
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
