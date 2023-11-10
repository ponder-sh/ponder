import { Box, Text } from "ink";
import React from "react";

import { formatEta, formatPercentage } from "@/utils/format.js";

import type { UiState } from "./app.js";
import { ProgressBar } from "./ProgressBar.js";

export const HistoricalBar = ({
  title,
  stat,
}: {
  title: string;
  stat: UiState["historicalSyncEventSourceStats"][0];
}) => {
  const { rate, eta } = stat;

  const etaText = eta ? ` | ~${formatEta(eta)}` : null;

  const rateText = formatPercentage(rate);

  return (
    <Box flexDirection="column">
      <Text>{title}</Text>
      <Box flexDirection="row">
        <ProgressBar current={rate} end={1} />
        <Text>
          {" "}
          {rateText}
          {etaText}
        </Text>
      </Box>
      {/* <Text> </Text> */}
    </Box>
  );
};
