import type { Source } from "@/config/sources.js";
import { formatEta, formatPercentage } from "@/utils/format.js";
import { Box, Text, render as inkRender } from "ink";
import React from "react";
import { ProgressBar } from "./ProgressBar.js";

export type UiState = {
  port: number;

  historicalSyncStats: {
    network: string;
    contract: string;
    rate: number;
    eta?: number;
  }[];
  isHistoricalSyncComplete: boolean;

  realtimeSyncNetworks: {
    name: string;
    isConnected: boolean;
  }[];

  indexingStats: {
    totalSeconds: number | undefined;
    completedSeconds: number | undefined;
  };
  indexingCompletedToTimestamp: number;
  indexingError: boolean;

  indexingTable: {
    eventName: string;
    networkName: string;
    count: number;
    averageDuration: number;
    errorCount: number;
  }[];
};

export const buildUiState = ({ sources }: { sources: Source[] }) => {
  const ui: UiState = {
    port: 0,

    historicalSyncStats: [],
    isHistoricalSyncComplete: false,
    realtimeSyncNetworks: [],

    indexingStats: {
      completedSeconds: 0,
      totalSeconds: 0,
    },
    indexingCompletedToTimestamp: 0,
    indexingError: false,

    indexingTable: [],
  };

  sources.forEach((source) => {
    ui.historicalSyncStats.push({
      network: source.networkName,
      contract: source.contractName,
      rate: 0,
    });
  });

  return ui;
};

const App = (ui: UiState) => {
  const {
    port,
    historicalSyncStats,
    // isHistoricalSyncComplete,
    // TODO: Consider adding realtime back into the UI in some manner.
    // realtimeSyncNetworks,
    indexingStats,
    indexingError,
    indexingTable,
  } = ui;

  if (indexingError) {
    return (
      <Box flexDirection="column">
        <Text> </Text>

        <Text color="cyan">
          Resolve the error and save your changes to reload the server.
        </Text>
      </Box>
    );
  }

  const maxWidth = process.stdout.columns || 80;

  const titleWidth = Math.max(
    ...historicalSyncStats.map((s) => s.contract.length + s.network.length + 4),
  );

  const indexingTotalEventCount = indexingTable.reduce((acc, r) => {
    acc += r.count;
    return acc;
  }, 0);

  const metricsWidth = 15 + indexingTotalEventCount.toString().length;

  const barWidth = Math.min(
    Math.max(maxWidth - titleWidth - metricsWidth - 12, 24),
    48,
  );

  const rate =
    indexingStats.totalSeconds === undefined ||
    indexingStats.completedSeconds === undefined ||
    indexingStats.totalSeconds === 0
      ? 1
      : indexingStats.completedSeconds / indexingStats.totalSeconds;

  const rateText =
    rate === 1 ? <Text color="greenBright">done</Text> : formatPercentage(rate);

  return (
    <Box flexDirection="column">
      <Text> </Text>

      <Box flexDirection="row">
        <Text bold={true}>Historical sync</Text>
      </Box>
      <Box flexDirection="column">
        {historicalSyncStats.map(({ contract, network, rate, eta }) => {
          const etaText = eta ? ` | ~${formatEta(eta)}` : "";
          const rateText = formatPercentage(rate);

          const titleText = `${contract} (${network})`.padEnd(titleWidth, " ");
          const metricsText =
            rate === 1 ? (
              <Text color="greenBright">done</Text>
            ) : (
              `${rateText}${etaText}`
            );

          return (
            <Box flexDirection="column" key={`${contract}-${network}`}>
              <Box flexDirection="row">
                <Text>{titleText} </Text>
                <ProgressBar current={rate} end={1} width={barWidth} />
                <Text> {metricsText}</Text>
              </Box>
            </Box>
          );
        })}
      </Box>
      <Text> </Text>

      <Text bold={true}>Indexing progress</Text>
      <Box flexDirection="column">
        <Box flexDirection="row">
          {indexingStats.completedSeconds !== undefined &&
          indexingStats.totalSeconds !== undefined ? (
            <>
              <ProgressBar current={rate} end={1} width={barWidth} />
              <Text>
                {" "}
                {rateText} ({indexingTotalEventCount} events)
              </Text>
            </>
          ) : (
            <Text>Waiting to start...</Text>
          )}
        </Box>
      </Box>
      <Text> </Text>

      <Box flexDirection="column">
        <Box flexDirection="row" key="title" columnGap={1}>
          <Box width={16}>
            <Text>│ </Text>
            <Text bold>Event</Text>
          </Box>
          <Box width={12}>
            <Text>│ </Text>
            <Text bold>Network</Text>
          </Box>
          <Box width={10}>
            <Text>│ </Text>
            <Text bold>Count</Text>
          </Box>
          <Box width={16}>
            <Text>│ </Text>
            <Text bold>Duration (avg)</Text>
          </Box>
          <Box width={13}>
            <Text>│ </Text>
            <Text bold>Error count</Text>
          </Box>
          <Text>│</Text>
        </Box>

        <Box flexDirection="row" key="border">
          <Text>├</Text>
          <Text>{"─".repeat(16)}┼</Text>
          <Text>{"─".repeat(12)}┼</Text>
          <Text>{"─".repeat(10)}┼</Text>
          <Text>{"─".repeat(16)}┼</Text>
          <Text>{"─".repeat(13)}┤</Text>
        </Box>

        {indexingTable.map(
          ({ eventName, networkName, count, errorCount, averageDuration }) => {
            return (
              <Box
                flexDirection="row"
                key={`${eventName}-${networkName}`}
                columnGap={1}
              >
                <Box width={16}>
                  <Text>│ </Text>
                  <Text>{eventName}</Text>
                </Box>
                <Box width={12}>
                  <Text>│ </Text>
                  <Text>{networkName}</Text>
                </Box>
                <Box width={10} justifyContent="space-between">
                  <Text>│</Text>
                  <Text>{count}</Text>
                </Box>
                <Box width={16} justifyContent="space-between">
                  <Text>│</Text>
                  <Text>
                    {averageDuration > 0
                      ? `${averageDuration.toFixed(2)}ms`
                      : "-"}
                  </Text>
                </Box>
                <Box width={13} justifyContent="space-between">
                  <Text>│</Text>
                  <Text>{count > 0 ? errorCount : "-"}</Text>
                </Box>
                <Text>│</Text>
              </Box>
            );
          },
        )}
      </Box>
      <Text> </Text>

      {/* {realtimeSyncNetworks.length > 0 && (
        <Box flexDirection="column">
          <Text bold={true}>Realtime sync </Text>
          {realtimeSyncNetworks.map(({ name, isConnected }) => (
            <Box flexDirection="row" key={name}>
              <Text>
                {name.slice(0, 1).toUpperCase() + name.slice(1)} (
                {isConnected ? "live" : "disconnected"})
              </Text>
            </Box>
          ))}
          <Text> </Text>
        </Box>
      )} */}

      {true && (
        <Box flexDirection="column">
          <Text bold={true}>GraphQL </Text>
          <Box flexDirection="row">
            <Text>Server live at http://localhost:{port}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export const setupInkApp = (ui: UiState) => {
  const { rerender, unmount: inkUnmount, clear } = inkRender(<App {...ui} />);

  const render = (ui: UiState) => {
    rerender(<App {...ui} />);
  };

  const unmount = () => {
    clear();
    inkUnmount();
  };
  return { render, unmount };
};
