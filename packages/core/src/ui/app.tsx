import { Box, Newline, render as inkRender, Text } from "ink";
import React from "react";

import { PonderOptions } from "@/common/options";

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
      logTotal: number;
      logCurrent: number;
      logCheckpointTimestamp: number;
      logAvgDuration: number;
      logCheckpointBlockCount: number;
      logAvgBlockCount: number;

      blockTotal: number;
      blockCurrent: number;
      blockCheckpointTimestamp: number;
      blockAvgDuration: number;
    }
  >;

  backfillStartTimestamp: number;
  backfillTaskCurrent: number;
  backfillTaskTotal: number;

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
    backfillTaskCurrent: 0,
    backfillTaskTotal: 0,

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

const App = ({
  isSilent,
  isProd,
  timestamp,

  backfillTaskCurrent,
  backfillTaskTotal,

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

  const backfillPercent = `${Math.round(
    100 * (backfillTaskCurrent / Math.max(backfillTaskTotal, 1))
  )}%`;
  const backfillEtaText = "";
  // backfillEta && backfillEta > 0 ? ` | ETA: ${backfillEta}s` : null;
  const backfillCountText =
    backfillTaskTotal > 0
      ? ` | ${backfillTaskCurrent}/${backfillTaskTotal}`
      : null;

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
        <Box flexDirection="row">
          <ProgressBar
            current={backfillTaskCurrent}
            end={Math.max(backfillTaskTotal, 1)}
          />
          <Text>
            {" "}
            {backfillPercent}
            {backfillEtaText}
            {backfillCountText}
            <Newline />
          </Text>
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
