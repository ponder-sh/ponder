import { Box, Text, render as inkRender } from "ink";
import React from "react";

import type { Source } from "@/config/sources.js";

import { formatEta, formatPercentage } from "@/utils/format.js";
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
    event: string;
    totalSeconds: number | undefined;
    completedSeconds: number | undefined;
    completedEventCount: number;
  }[];
  indexingCompletedToTimestamp: number;
  indexingError: boolean;
};

export const buildUiState = ({ sources }: { sources: Source[] }) => {
  const ui: UiState = {
    port: 0,

    historicalSyncStats: [],
    isHistoricalSyncComplete: false,
    realtimeSyncNetworks: [],

    indexingStats: [],
    indexingCompletedToTimestamp: 0,
    indexingError: false,
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
    ...indexingStats.map((s) => s.event.length + 1),
  );

  const maxEventCount = Math.max(
    ...indexingStats.map((s) => s.completedEventCount),
  );
  const metricsWidth = 15 + maxEventCount.toString().length;

  const barWidth = Math.min(
    Math.max(maxWidth - titleWidth - metricsWidth - 12, 24),
    48,
  );

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

      <Text bold={true}>Indexing </Text>
      {indexingStats.map(
        ({ event, totalSeconds, completedSeconds, completedEventCount }) => {
          const rate =
            totalSeconds === undefined ||
            completedSeconds === undefined ||
            totalSeconds === 0
              ? 1
              : completedSeconds / totalSeconds;

          const titleText = event.padEnd(titleWidth, " ");

          const rateText =
            rate === 1 ? (
              <Text color="greenBright">done</Text>
            ) : (
              formatPercentage(rate)
            );

          return (
            <Box flexDirection="column" key={event}>
              <Box flexDirection="row">
                <Text>{titleText} </Text>
                {completedSeconds !== undefined &&
                totalSeconds !== undefined ? (
                  <>
                    <ProgressBar current={rate} end={1} width={barWidth} />
                    <Text>
                      {" "}
                      {rateText} ({completedEventCount} events)
                    </Text>
                  </>
                ) : (
                  <Text>Waiting to start...</Text>
                )}
              </Box>
            </Box>
          );
        },
      )}
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
