import { Box, Text } from "ink";
import React from "react";

import { formatEta } from "@/utils/format";

import { UiState } from "./app";
import { ProgressBar } from "./ProgressBar";

export const HistoricalBar = ({
  title,
  stat,
}: {
  title: string;
  stat: UiState["historicalSyncLogFilterStats"][0];
}) => {
  const { startTimestamp, cachedBlocks, totalBlocks, completedBlocks } = stat;

  const currentCompletionRate =
    (cachedBlocks + completedBlocks) / (totalBlocks || 1);

  const eta =
    (Date.now() - startTimestamp) / // Elapsed time in milliseconds
    (completedBlocks / (totalBlocks - cachedBlocks)); // Progress

  // Only display the ETA text once 5 log tasks have been processed
  const etaText =
    completedBlocks > 5 && eta > 0 ? ` | ~${formatEta(eta)}` : null;

  const completionDecimal = Math.round(currentCompletionRate * 1000) / 10;
  const completionText =
    Number.isInteger(completionDecimal) && completionDecimal < 100
      ? `${completionDecimal}.0%`
      : `${completionDecimal}%`;

  return (
    <Box flexDirection="column">
      <Text>
        {title}
        {/* ({cacheRateText} cached) */}
      </Text>
      <Box flexDirection="row">
        <ProgressBar
          current={cachedBlocks + completedBlocks}
          end={totalBlocks || 1}
        />
        <Text>
          {" "}
          {completionText}
          {etaText}
        </Text>
      </Box>
      {/* <Text> </Text> */}
    </Box>
  );
};
