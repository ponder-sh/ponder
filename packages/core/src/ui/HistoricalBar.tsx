import { Box, Text } from "ink";
import React from "react";

import { formatEta, formatPercentage } from "@/utils/format.js";

import { ProgressBar } from "./ProgressBar.js";

export const HistoricalBar = ({
  rate,
  eta,
}: {
  rate: number;
  eta?: number;
}) => {
  const etaText = eta ? ` | ~${formatEta(eta)}` : null;

  const rateText = formatPercentage(rate);

  return (
    <Box flexDirection="row">
      <ProgressBar current={rate} end={1} />
      <Text>
        {" "}
        {rateText}
        {etaText}
      </Text>
    </Box>
  );
};
