import { Text } from "ink";
import React from "react";

export const ProgressBar = ({
  end = 10,
  current = 5,
  width = 36,
  cachedRate = 0,
}) => {
  const maxTotalCount = width || process.stdout.columns || 80;

  const cachedCount = Math.min(
    Math.floor(maxTotalCount * cachedRate),
    maxTotalCount
  );

  const maxCount = maxTotalCount - cachedCount;

  const fraction = current / end;
  const count = Math.min(Math.floor(maxCount * fraction), maxCount);

  return (
    <Text>
      <Text color="yellow">{"█".repeat(cachedCount)}</Text>
      <Text>{"█".repeat(count)}</Text>
      <Text>{"░".repeat(maxCount - count)}</Text>
    </Text>
  );
};
