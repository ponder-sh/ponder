import { Box, Newline, render, Text } from "ink";
import React from "react";

import { ProgressBar } from "./ProgressBar";

export enum HandlersStatus {
  SOURCE_NOT_READY,
  UP_TO_DATE,
}

export type InterfaceState = {
  backfillStartTimestamp: number;
  backfillEta: number;
  backfillTaskCurrent: number;
  backfillTaskTotal: number;

  isBackfillComplete: boolean;
  backfillDuration: string;

  handlersStatus: HandlersStatus;
  logsCurrent: number;
  logsTotal: number;

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

export const initialInterfaceState: InterfaceState = {
  backfillStartTimestamp: 0,
  backfillEta: 0,
  backfillTaskCurrent: 0,
  backfillTaskTotal: 0,

  isBackfillComplete: false,
  backfillDuration: "",

  handlersStatus: HandlersStatus.SOURCE_NOT_READY,
  logsCurrent: 0,
  logsTotal: 0,

  networks: {},
};

const App = (props: InterfaceState) => {
  const {
    backfillEta,
    backfillTaskCurrent,
    backfillTaskTotal,

    isBackfillComplete,
    backfillDuration,

    handlersStatus,
    logsCurrent,
    logsTotal,

    networks,
  } = props;

  const [timestamp, setTimestamp] = React.useState(
    Math.floor(Date.now() / 1000)
  );
  React.useEffect(() => {
    const interval = setInterval(() => {
      setTimestamp(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Box flexDirection="column">
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
          <ProgressBar end={backfillTaskTotal} current={backfillTaskCurrent} />
          <Text>
            {" "}
            {Math.round(100 * (backfillTaskCurrent / backfillTaskTotal))}% |
            ETA: {backfillEta}s | {backfillTaskCurrent}/{backfillTaskTotal}
            {/* Newline below progress bar row */}
            <Newline />
          </Text>
        </Box>
      )}

      <Box flexDirection="row">
        <Text bold={true}>Handlers </Text>
        {handlersStatus === HandlersStatus.SOURCE_NOT_READY ? (
          <Text color="redBright">(blocked)</Text>
        ) : (
          <Text color="greenBright">(up to date)</Text>
        )}
      </Box>
      <Box flexDirection="row">
        <ProgressBar end={logsCurrent} current={logsTotal} />
        <Text>
          {" "}
          {logsCurrent}/{logsCurrent}
          {/* Newline below progress bar row */}
          <Newline />
        </Text>
      </Box>

      <Box flexDirection="column">
        {Object.values(networks).map((network) => (
          <Box flexDirection="row" key={network.name}>
            <Text>
              [{network.name}] Matched {network.matchedLogCount} logs from block{" "}
              {network.blockNumber}, {timestamp - network.blockTimestamp}s ago
            </Text>
          </Box>
        ))}
      </Box>

      {/* <Text color="greenBright">
        {handlersStatus === HandlersStatus.SOURCE_NOT_READY
          ? "Blocked"
          : "Up to date"}
      </Text> */}
    </Box>
  );
};

export const renderApp = (props: InterfaceState) => {
  render(<App {...props} />);
};
