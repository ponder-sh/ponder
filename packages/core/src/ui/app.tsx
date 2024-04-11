import { formatEta, formatPercentage } from "@/utils/format.js";
import { Box, Text, render as inkRender } from "ink";
import React from "react";
import { ProgressBar } from "./ProgressBar.js";
import Table from "./Table.js";

export type UiState = {
  port: number;

  historical: {
    overall: {
      totalBlocks: number;
      cachedBlocks: number;
      completedBlocks: number;
      progress: number;
    };
    contracts: {
      contractName: string;
      networkName: string;
      totalBlocks: number;
      completedBlocks: number;
      cachedBlocks?: number;
      progress?: number;
      eta?: number;
    }[];
  };

  indexing: {
    hasError: boolean;
    overall: {
      completedSeconds: number;
      totalSeconds: number;
      progress: number;
      completedToTimestamp: number;
      totalEvents: number;
    };
    events: {
      eventName: string;
      networkName: string;
      count: number;
      averageDuration: number;
      errorCount: number;
    }[];
  };

  realtimeSyncNetworks: {
    name: string;
    isConnected: boolean;
  }[];
};

export const buildUiState = () => {
  const ui: UiState = {
    historical: {
      overall: {
        totalBlocks: 0,
        cachedBlocks: 0,
        completedBlocks: 0,
        progress: 0,
      },
      contracts: [],
    },

    realtimeSyncNetworks: [],

    indexing: {
      hasError: false,
      overall: {
        completedSeconds: 0,
        totalSeconds: 0,
        progress: 0,
        completedToTimestamp: 0,
        totalEvents: 0,
      },
      events: [],
    },

    port: 0,
  };

  return ui;
};

const App = (ui: UiState) => {
  const { historical, indexing, port } = ui;

  if (indexing.hasError) {
    return (
      <Box flexDirection="column">
        <Text> </Text>

        <Text color="cyan">
          Resolve the error and save your changes to reload the server.
        </Text>
      </Box>
    );
  }

  let historicalElement: JSX.Element;
  if (historical.overall.progress === 0) {
    historicalElement = (
      <>
        <Text bold={true}>Historical sync</Text>
        <Text>Waiting to start...</Text>
        <Text> </Text>
      </>
    );
  } else if (historical.overall.progress === 1) {
    historicalElement = (
      <>
        <Text>
          <Text bold={true}>Historical sync </Text>(
          <Text color="greenBright">done</Text>)
        </Text>
        <Text> </Text>
      </>
    );
  } else {
    historicalElement = (
      <>
        <Text>
          <Text bold={true}>Historical sync </Text>(
          <Text color="yellowBright">in progress</Text>)
        </Text>
        <Box flexDirection="row">
          <ProgressBar
            current={historical.overall.progress}
            end={1}
            width={50}
          />
          <Text>
            {" "}
            {historical.overall.progress === 1 ? (
              <Text color="greenBright">done</Text>
            ) : (
              formatPercentage(historical.overall.progress)
            )}{" "}
            (
            {historical.overall.cachedBlocks +
              historical.overall.completedBlocks}{" "}
            blocks)
          </Text>
        </Box>
        <Text> </Text>

        <Table
          rows={historical.contracts}
          columns={[
            { title: "Contract", key: "contractName", align: "left" },
            { title: "Network", key: "networkName", align: "left" },
            {
              title: "Cached",
              key: "cachedBlocks",
              align: "right",
              format: (_, row) =>
                row.cachedBlocks !== undefined ? row.cachedBlocks : "-",
            },
            {
              title: "Completed",
              key: "completedBlocks",
              align: "right",
            },
            { title: "Total", key: "totalBlocks", align: "right" },
            {
              title: "Progress",
              key: "progress",
              align: "right",
              format: (v) => (v ? formatPercentage(v) : "-"),
            },
            {
              title: "ETA",
              key: "eta",
              align: "right",
              format: (v) => (v ? formatEta(v) : "-"),
            },
          ]}
        />
        <Text> </Text>
      </>
    );
  }

  let indexingElement: JSX.Element;
  if (indexing.overall.progress === 0) {
    indexingElement = (
      <>
        <Text bold={true}>Indexing </Text>
        <Text>Waiting to start...</Text>
        <Text> </Text>
      </>
    );
  } else {
    const effectiveProgress =
      indexing.overall.progress * historical.overall.progress;

    indexingElement = (
      <>
        <Text>
          <Text bold={true}>Indexing </Text>(
          {effectiveProgress === 1 ? (
            <Text color="greenBright">done</Text>
          ) : (
            <Text color="yellowBright">in progress</Text>
          )}
          )
        </Text>
        <Box flexDirection="row">
          <ProgressBar current={effectiveProgress} end={1} width={50} />
          <Text> ({indexing.overall.totalEvents} events)</Text>
        </Box>
        <Text> </Text>

        <Table
          rows={indexing.events}
          columns={[
            { title: "Event", key: "eventName", align: "left" },
            { title: "Network", key: "networkName", align: "left" },
            { title: "Count", key: "count", align: "right" },
            {
              title: "Error count",
              key: "errorCount",
              align: "right",
              format: (v, row) => (row.count > 0 ? v : "-"),
            },
            {
              title: "Duration (avg)",
              key: "averageDuration",
              align: "right",
              format: (v) => (v > 0 ? `${v.toFixed(2)}ms` : "-"),
            },
          ]}
        />
        <Text> </Text>
      </>
    );
  }

  return (
    <Box flexDirection="column">
      <Text> </Text>

      {historicalElement}

      {indexingElement}

      {/* <Text bold={true}>Historical sync</Text>
      {historical.overall.progress > 0 ? (
        <>
          <Box flexDirection="row">
            <ProgressBar
              current={historical.overall.progress}
              end={1}
              width={40}
            />
            <Text>
              {" "}
              {historical.overall.progress === 1 ? (
                <Text color="greenBright">done</Text>
              ) : (
                formatPercentage(historical.overall.progress)
              )}{" "}
              ({historical.overall.totalBlocks} blocks)
            </Text>
          </Box>
          <Text> </Text>

          <Table
            rows={historical.contracts}
            columns={[
              { title: "Contract", key: "contractName", align: "left" },
              { title: "Network", key: "networkName", align: "left" },
              { title: "Total blocks", key: "totalBlocks", align: "right" },
              {
                title: "Cached %",
                key: "cachedBlocks",
                align: "right",
                format: (_, row) =>
                  row.cachedBlocks !== undefined
                    ? formatPercentage(row.cachedBlocks / row.totalBlocks)
                    : "-",
              },
              {
                title: "Progress",
                key: "progress",
                align: "right",
                format: (v) => (v ? formatPercentage(v) : "-"),
              },
              {
                title: "ETA",
                key: "eta",
                align: "right",
                format: (v) => (v ? formatEta(v) : "-"),
              },
            ]}
          />
        </>
      ) : (
        <Text>Waiting to start...</Text>
      )} */}

      {/* <Text bold={true}>Indexing</Text>
      {indexing.overall.progress > 0 ? (
        <>
          <Box flexDirection="row">
            <ProgressBar
              current={indexing.overall.progress}
              end={1}
              width={40}
            />
            <Text>
              {" "}
              {indexing.overall.progress === 1 ? (
                <Text color="greenBright">up to date</Text>
              ) : (
                formatPercentage(indexing.overall.progress)
              )}{" "}
              ({indexing.overall.totalEvents} events)
            </Text>
          </Box>
          <Text> </Text>

          <Table
            rows={indexing.events}
            columns={[
              { title: "Event", key: "eventName", align: "left" },
              { title: "Network", key: "networkName", align: "left" },
              { title: "Count", key: "count", align: "right" },
              {
                title: "Error count",
                key: "errorCount",
                align: "right",
                format: (v, row) => (row.count > 0 ? v : "-"),
              },
              {
                title: "Duration (avg)",
                key: "averageDuration",
                align: "right",
                format: (v) => (v > 0 ? `${v.toFixed(2)}ms` : "-"),
              },
            ]}
          />
        </>
      ) : (
        <Text>Waiting to start...</Text>
      )}
      <Text> </Text> */}

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

      <Box flexDirection="column">
        <Text bold>GraphQL </Text>
        <Box flexDirection="row">
          <Text>Server live at http://localhost:{port}</Text>
        </Box>
      </Box>
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
