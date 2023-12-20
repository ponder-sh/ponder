import { Box, Text } from "ink";
import React from "react";

import { formatShortDate } from "@/utils/date.js";

import { ProgressBar } from "./ProgressBar.js";
import type { UiState } from "./app.js";

export const IndexingBar = ({ ui }: { ui: UiState }) => {
  const completionRate =
    ui.processedEventCount / Math.max(ui.handledEventCount, 1);
  const completionDecimal = Math.round(completionRate * 1000) / 10;
  const completionText =
    Number.isInteger(completionDecimal) && completionDecimal < 100
      ? `${completionDecimal}.0%`
      : `${completionDecimal}%`;

  const isStarted = ui.handledEventCount > 0;
  const isHistoricalSyncComplete = ui.isHistoricalSyncComplete;
  const isUpToDate = ui.processedEventCount === ui.handledEventCount;

  const titleText = () => {
    if (!isStarted) return <Text>(not started)</Text>;
    if (!isHistoricalSyncComplete || !isUpToDate) {
      return (
        <Text color="yellow">
          (up to {formatShortDate(ui.eventsProcessedToTimestamp)})
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
          | {ui.processedEventCount}/
          {"?".repeat(ui.processedEventCount.toString().length)} events (
          {ui.totalMatchedEventCount} total)
        </Text>
      );
    }
    return (
      <Text>
        {" "}
        | {ui.processedEventCount}/{ui.handledEventCount} events (
        {ui.totalMatchedEventCount} total)
      </Text>
    );
  };

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text bold={true}>Indexing </Text>
        <Text>{titleText()}</Text>
      </Box>
      <Box flexDirection="row">
        <ProgressBar
          current={ui.processedEventCount}
          end={Math.max(ui.handledEventCount, 1)}
        />
        <Text>
          {" "}
          {completionText}
          {countText()}
        </Text>
      </Box>
    </Box>
  );
};
