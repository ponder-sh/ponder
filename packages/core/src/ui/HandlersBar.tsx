import { Box, Text } from "ink";
import React from "react";

import { formatShortDate } from "@/utils/date";

import type { UiState } from "./app";
import { ProgressBar } from "./ProgressBar";

export const HandlersBar = ({ ui }: { ui: UiState }) => {
  const completionRate =
    ui.handlersCurrent / Math.max(ui.handlersHandledTotal, 1);
  const completionDecimal = Math.round(completionRate * 1000) / 10;
  const completionText =
    Number.isInteger(completionDecimal) && completionDecimal < 100
      ? `${completionDecimal}.0%`
      : `${completionDecimal}%`;

  const isStarted = ui.handlersTotal > 0;
  const isHistoricalSyncComplete = ui.isHistoricalSyncComplete;
  const isUpToDate = ui.handlersCurrent === ui.handlersHandledTotal;

  const titleText = () => {
    if (!isStarted) return <Text>(not started)</Text>;
    if (!isHistoricalSyncComplete || !isUpToDate) {
      return (
        <Text color="yellow">
          (up to {formatShortDate(ui.handlersToTimestamp)})
        </Text>
      );
    }
    return <Text color="green">(up to date)</Text>;
  };

  const countText = () => {
    if (!isStarted) return null;
    if (!isHistoricalSyncComplete) {
      return (
        <Text>
          {" "}
          | {ui.handlersCurrent}/
          {"?".repeat(ui.handlersCurrent.toString().length)} events (
          {ui.handlersTotal} total)
        </Text>
      );
    }
    return (
      <Text>
        {" "}
        | {ui.handlersCurrent}/{ui.handlersHandledTotal} events (
        {ui.handlersTotal} total)
      </Text>
    );
  };

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text bold={true}>Event handlers </Text>
        <Text>{titleText()}</Text>
      </Box>
      <Box flexDirection="row">
        <ProgressBar
          current={ui.handlersCurrent}
          end={Math.max(ui.handlersHandledTotal, 1)}
        />
        <Text>
          {" "}
          {completionText}
          {countText()}
        </Text>
      </Box>
      {/* )} */}

      <Text> </Text>
    </Box>
  );
};
