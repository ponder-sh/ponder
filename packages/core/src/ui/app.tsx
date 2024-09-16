import type { getAppProgress, getSyncProgress } from "@/common/metrics.js";
import { formatEta, formatPercentage } from "@/utils/format.js";
import { Box, Text, render as inkRender } from "ink";
import React from "react";
import { ProgressBar } from "./ProgressBar.js";
import Table from "./Table.js";

export type UiState = {
  port: number;
  hostname: string;

  sync: Awaited<ReturnType<typeof getSyncProgress>>;

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
      count: number;
      averageDuration: number;
    }[];
  };

  app: Awaited<ReturnType<typeof getAppProgress>>;

  realtimeSyncNetworks: {
    name: string;
    isConnected: boolean;
  }[];
};

export const buildUiState = () => {
  const ui: UiState = {
    sync: [],

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

    app: {
      progress: 0,
      eta: undefined,
      mode: undefined,
    },

    port: 0,
    hostname: "localhost",
  };

  return ui;
};

const App = (ui: UiState) => {
  const { sync, indexing, app, port, hostname } = ui;

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

  const syncElement =
    sync.length === 0 ? (
      <>
        <Text bold={true}>Sync</Text>
        <Text> </Text>
        <Text>Waiting to start...</Text>
        <Text> </Text>
      </>
    ) : (
      <>
        <Text bold={true}>Sync</Text>
        <Text> </Text>
        <Table
          rows={sync}
          columns={[
            { title: "Network", key: "networkName", align: "left" },
            {
              title: "Block",
              key: "block",
              align: "right",
            },
            // {
            //   title: "Events",
            //   key: "events",
            //   align: "right",
            // },
            { title: "Status", key: "status", align: "right" },
            {
              title: "RPC req/s",
              key: "rps",
              align: "right",
              format: (_, row) => row.rps.toFixed(1),
            },
          ]}
        />
        <Text> </Text>
      </>
    );

  let indexingElement: JSX.Element;

  if (indexing.events.length === 0) {
    indexingElement = (
      <>
        <Text bold={true}>Indexing </Text>
        <Text> </Text>
        <Text>Waiting to start...</Text>
        <Text> </Text>
      </>
    );
  } else {
    indexingElement = (
      <>
        <Text bold={true}>Indexing </Text>

        <Text> </Text>

        <Table
          rows={indexing.events}
          columns={[
            { title: "Event", key: "eventName", align: "left" },
            { title: "Count", key: "count", align: "right" },
            {
              title: "Duration (avg)",
              key: "averageDuration",
              align: "right",
              format: (v) =>
                v > 0
                  ? v < 1
                    ? `${(v * 1_000).toFixed(2)}μs`
                    : `${v.toFixed(2)}ms`
                  : "-",
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

      {syncElement}
      {indexingElement}

      <>
        <Box flexDirection="row">
          <Text bold={true}>Progress </Text>
          {app.mode === undefined || app.progress === 0 ? null : (
            <Text>
              (
              {app.mode === "historical" ? (
                <Text color="yellowBright">backfilling</Text>
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
      </>

      <Box flexDirection="row">
        <Text> </Text>
        <Text>
          <ProgressBar current={app.progress} end={1} width={50} />
        </Text>
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
