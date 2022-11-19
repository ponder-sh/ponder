import { Text } from "ink";
import React from "react";

export const ProgressBar = ({
  end = 10,
  current = 5,
  start = 0,
  width = 50,
}) => {
  const fraction = (current - start) / (end - start);

  const maxCount = width || process.stdout.columns || 80;
  const count = Math.min(Math.floor(maxCount * fraction), maxCount);
  const chars = "█".repeat(count);
  const bar = chars + "░".repeat(maxCount - count);

  return <Text>{bar}</Text>;
};
