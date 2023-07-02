import { Text } from "ink";
import React from "react";

export const ProgressBar = ({ current = 5, end = 10, width = 36 }) => {
  const maxCount = width || process.stdout.columns || 80;

  const fraction = current / end;
  const count = Math.min(Math.floor(maxCount * fraction), maxCount);

  return (
    <Text>
      <Text>{"█".repeat(count)}</Text>
      <Text>{"░".repeat(maxCount - count)}</Text>
    </Text>
  );
};
