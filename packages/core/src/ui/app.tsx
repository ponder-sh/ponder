import { Box, Newline, render as inkRender, Text } from "ink";
import React from "react";

import type { Source } from "@/config/sources.js";

import { HistoricalBar } from "./HistoricalBar.js";
import { IndexingBar } from "./IndexingBar.js";

export type UiState = {
  port: number;

  historicalSyncStats: {
    network: string;
    contract: string;
    rate: number;
    eta?: number;
  }[];
  isHistoricalSyncComplete: boolean;

  indexingError: boolean;
  processedEventCount: number;
  handledEventCount: number;
  totalMatchedEventCount: number;
  eventsProcessedToTimestamp: number;

  networks: string[];
};

export const buildUiState = ({ sources }: { sources: Source[] }) => {
  const ui: UiState = {
    port: 0,

    historicalSyncStats: [],
    isHistoricalSyncComplete: false,

    indexingError: false,
    processedEventCount: 0,
    handledEventCount: 0,
    totalMatchedEventCount: 0,
    eventsProcessedToTimestamp: 0,

    networks: [],
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
    processedEventCount,
    indexingError,
    networks,
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
      {/* Newline above interface */}
      <Text> </Text>
      <Box flexDirection="row">
        <Text bold={true}>Historical sync </Text>
        {isHistoricalSyncComplete ? (
          <Text color="green">
            (complete)
            <Newline />
          </Text>
        ) : (
          <Text color="yellow">(in progress)</Text>
        )}
      </Box>
      {!isHistoricalSyncComplete && (
        <Box flexDirection="column">
          {networks.map((network, idx) => {
            const contracts = historicalSyncStats.filter(
              (s) => s.network === network,
            );

            return (
              <Box flexDirection="column" key={idx}>
                <Text>{network}</Text>
                {contracts.length > 0 ? (
                  contracts.map(({ contract, rate, eta }, idx) => (
                    <Box flexDirection="column" key={idx}>
                      {contract}
                      <HistoricalBar key={idx} rate={rate} eta={eta} />
                    </Box>
                  ))
                ) : (
                  <Text>No contracts</Text>
                )}
              </Box>
            );
          })}
          <Text> </Text>
        </Box>
      )}

      <IndexingBar ui={ui} />

      {networks.length > 0 && (
        <Box flexDirection="column">
          <Text bold={true}>Networks</Text>
          {networks.map((network) => (
            <Box flexDirection="row" key={network}>
              <Text>
                {network.slice(0, 1).toUpperCase() + network.slice(1)} (live)
              </Text>
            </Box>
          ))}
          <Text> </Text>
        </Box>
      )}

      {processedEventCount > 0 && (
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
