import { Box, Text } from "ink";
import React from "react";

import { formatEta } from "@/common/utils";

import { UiState } from "./app";
import { ProgressBar } from "./ProgressBar";

export const BackfillBar = ({
  contract,
  stat,
}: {
  contract: string;
  stat: UiState["stats"][0];
}) => {
  const current = stat.logCurrent + stat.blockCurrent;
  const total = stat.logTotal + stat.blockTotal;

  // Only display the ETA text once 5 log tasks have been processed
  const backfillEtaText =
    stat.logTotal > 5 && stat.eta > 0 ? ` | ~${formatEta(stat.eta)}` : null;
  // const backfillCountText = total > 0 ? ` | ${current}/${total}` : null;

  // const cacheRateDecimal = Math.round(stat.cacheRate * 1000) / 10;
  // const cacheRateText = Number.isInteger(cacheRateDecimal)
  //   ? `${cacheRateDecimal}.0%`
  //   : `${cacheRateDecimal}%`;

  const rate =
    (current / Math.max(total, 1)) * (1 - stat.cacheRate) + stat.cacheRate;

  const completionDecimal = Math.round(rate * 1000) / 10;
  const completionText =
    Number.isInteger(completionDecimal) && completionDecimal < 100
      ? `${completionDecimal}.0%`
      : `${completionDecimal}%`;

  return (
    <Box flexDirection="column">
      <Text>
        {contract}
        {/* ({cacheRateText} cached) */}
      </Text>
      <Box flexDirection="row">
        <ProgressBar
          current={current}
          end={Math.max(total, 1)}
          cachedRate={stat.cacheRate}
        />
        <Text>
          {" "}
          {completionText}
          {backfillEtaText}
          {/* {backfillCountText} */}
        </Text>
      </Box>
      {/* <Text> </Text> */}
    </Box>
  );
};
