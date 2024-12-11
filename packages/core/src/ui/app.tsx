import type {
  getAppProgress,
  getIndexingProgress,
  getSyncProgress,
} from "@/common/metrics.js";
import { formatEta, formatPercentage } from "@/utils/format.js";
import { Box, Text, render as inkRender } from "ink";
import React from "react";
import { ProgressBar } from "./ProgressBar.js";
import { Table } from "./Table.js";

export type UiState = {
  port: number;
  hostname: string;
  sync: Awaited<ReturnType<typeof getSyncProgress>>;
  indexing: Awaited<ReturnType<typeof getIndexingProgress>>;
  app: Awaited<ReturnType<typeof getAppProgress>>;
};

export const buildUiState = (): UiState => {
  return {
    port: 42069,
    hostname: "localhost",
    sync: [],
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
    app: {
      progress: 0,
      eta: undefined,
      mode: undefined,
    },
  };
};

const App = (ui: UiState) => {
  const { sync, indexing, app, port, hostname } = ui;

  return (
    <Box flexDirection="column">
      <Text> </Text>

      {indexing.hasError ? (
        <Text color="cyan">
          Resolve the error and save your changes to reload the server.
        </Text>
      ) : (
        <>
          <Text bold={true}>Sync</Text>
          <Text> </Text>
          {sync.length === 0 ? (
            <Text>Waiting to start...</Text>
          ) : (
            <Table
              rows={sync}
              columns={[
                {
                  title: "Network",
                  key: "networkName",
                  align: "left",
                },
                {
                  title: "Status",
                  key: "status",
                  align: "left",
                  format: (_, row) =>
                    row.status === "historical"
                      ? `${row.status} (${formatPercentage(row.progress)})`
                      : row.status,
                },
                {
                  title: "Block",
                  key: "block",
                  align: "right",
                },
                {
                  title: "RPC (req/s)",
                  key: "rps",
                  align: "right",
                  format: (_, row) => row.rps.toFixed(1),
                },
              ]}
            />
          )}
          <Text> </Text>

          <Text bold={true}>Indexing</Text>
          <Text> </Text>
          {indexing.events.length === 0 ? (
            <Text>Waiting to start...</Text>
          ) : (
            <Table
              rows={indexing.events}
              columns={[
                { title: "Event", key: "eventName", align: "left" },
                { title: "Count", key: "count", align: "right" },
                {
                  title: "Duration (ms)",
                  key: "averageDuration",
                  align: "right",
                  format: (v) =>
                    v > 0 ? (v < 0.001 ? "<0.001" : v.toFixed(3)) : "-",
                },
              ]}
            />
          )}
          <Text> </Text>

          <Box flexDirection="row">
            <Text bold={true}>Progress </Text>
            {app.mode === undefined || app.progress === 0 ? null : (
              <Text>
                (
                {app.mode === "historical" ? (
                  <Text color="yellowBright">historical</Text>
                ) : app.mode === "realtime" ? (
                  <Text color="greenBright">live</Text>
                ) : (
                  <Text color="greenBright">complete</Text>
                )}
                )
              </Text>
            )}
          </Box>
          <Text> </Text>
          <Box flexDirection="row">
            <ProgressBar current={app.progress} end={1} width={48} />
            <Text>
              {" "}
              {formatPercentage(app.progress)}
              {app.eta === undefined || app.eta === 0
                ? null
                : ` (${formatEta(app.eta)} eta)`}
            </Text>
          </Box>
          <Text> </Text>

          <Box flexDirection="column">
            <Text bold>GraphQL </Text>
            <Box flexDirection="row">
              <Text>
                Server live at http://{hostname}:{port}
              </Text>
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
};

export const setupInkApp = (ui: UiState) => {
  const app = inkRender(<App {...ui} />);

  return {
    render: (newUi: UiState) => {
      app.rerender(<App {...newUi} />);
    },
    unmount: () => {
      app.clear();
      app.unmount();
    },
  };
};
