import { Box, Newline, render as inkRender, Text } from "ink";
import React from "react";

import { Source } from "@/config/sources";

import { HistoricalBar } from "./HistoricalBar";
import { IndexingBar } from "./IndexingBar";

export type UiState = {
  port: number;

  historicalSyncEventSourceStats: Record<
    string,
    { rate: number; eta?: number }
  >;
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

    historicalSyncEventSourceStats: {},

    isHistoricalSyncComplete: false,

    indexingError: false,
    processedEventCount: 0,
    handledEventCount: 0,
    totalMatchedEventCount: 0,
    eventsProcessedToTimestamp: 0,

    networks: [],
  };

  const eventSourceNames = sources.map((s) => s.name);

  eventSourceNames.forEach((name) => {
    ui.historicalSyncEventSourceStats[name] = {
      rate: 0,
    };
  });

  return ui;
};

const App = (ui: UiState) => {
  const {
    port,
    historicalSyncEventSourceStats,
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
          {Object.entries(historicalSyncEventSourceStats).map(
            ([eventSourceName, stat]) => (
              <HistoricalBar
                key={eventSourceName}
                title={eventSourceName}
                stat={stat}
              />
            )
          )}
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
