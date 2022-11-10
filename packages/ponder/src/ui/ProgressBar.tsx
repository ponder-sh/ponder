import { Box, Text } from "ink";
import React from "react";

export const ProgressBar = ({
  start = 0,
  end = 100,
  current = 47,
  width = 50,
  left = 0,
  right = 0,
}) => {
  const fraction = (current - start) / (end - start);

  const screen = width || process.stdout.columns || 80;
  const maxCount = screen - right - left;
  const count = Math.min(Math.floor(maxCount * fraction), maxCount);
  const chars = "█".repeat(count);
  const bar = chars + "░".repeat(maxCount - count);

  return <Text>{bar}</Text>;
};
