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
    totalSeconds: number;
    completedSeconds: number;
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
    isHistoricalSyncComplete,
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

  return (
    <Box flexDirection="column">
      <Text> </Text>

      <Box flexDirection="row">
        <Text bold={true}>Historical sync </Text>
        {isHistoricalSyncComplete ? (
          <Text color="green">(complete)</Text>
        ) : (
          <Text color="yellow">(in progress)</Text>
        )}
      </Box>
      {!isHistoricalSyncComplete && (
        <Box flexDirection="column">
          {historicalSyncStats.map(({ contract, network, rate, eta }) => {
            const etaText = eta ? `~${formatEta(eta)}` : null;
            const rateText = formatPercentage(rate);

            return (
              <Box flexDirection="column" key={`${contract}-${network}`}>
                <Box flexDirection="row">
                  <Text>
                    {contract} <Text dimColor>({network}) </Text>
                  </Text>
                  <ProgressBar current={rate} end={1} />
                  <Text>
                    {" "}
                    {rateText}
                    {" | "}
                    {etaText}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
      <Text> </Text>

      <Text bold={true}>Indexing </Text>
      {indexingStats.map(
        ({ event, totalSeconds, completedSeconds, completedEventCount }) => {
          const rate = completedSeconds / totalSeconds;
          const rateText = formatPercentage(rate);

          return (
            <Box flexDirection="column" key={event}>
              {completedSeconds > 0 ? (
                <Box flexDirection="row">
                  <Text>{event} </Text>
                  <ProgressBar current={rate} end={1} />
                  <Text> {rateText}</Text>
                  <Text> ({completedEventCount} events)</Text>
                </Box>
              ) : (
                <Text>Waiting to start...</Text>
              )}
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
