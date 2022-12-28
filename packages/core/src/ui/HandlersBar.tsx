import { Box, Text } from "ink";
import React from "react";

import { UiState } from "./app";
import { ProgressBar } from "./ProgressBar";

export const HandlersBar = ({ ui }: { ui: UiState }) => {
  const completionRate = ui.handlersCurrent / Math.max(ui.handlersTotal, 1);
  const completionDecimal = Math.round(completionRate * 1000) / 10;
  const completionText = Number.isInteger(completionDecimal)
    ? `${completionDecimal}.0%`
    : `${completionDecimal}%`;

  // const handlerBottomText =
  //   !isBackfillComplete &&
  //   handlersTotal > 0 &&
  //   handlersTotal === handlersCurrent
  //     ? ""
  //     : `/${handlersTotal}`;
  // const handlersCountText =
  //   handlersTotal > 0
  //     ? ` | ${handlersCurrent}${handlerBottomText} events`
  //     : null;

  // // Only display the ETA text once 50 log tasks have been processed
  // const backfillEtaText =
  //   stat.logTotal > 50 && stat.eta > 0 ? ` | ~${formatEta(stat.eta)}` : null;
  // const backfillCountText = total > 0 ? ` | ${current}/${total}` : null;

  const date = new Date(ui.handlersToTimestamp * 1000);
  const year = date.getFullYear();
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const month = months[date.getMonth()];
  const day = date.getDate();
  const dateText = `${month} ${day}, ${year}`;

  const isUpToDate =
    ui.isBackfillComplete && ui.handlersCurrent === ui.handlersTotal;
  const isStarted = ui.handlersToTimestamp > 0;

  const titleText = () => {
    if (isUpToDate) return <Text color="greenBright">(up to date)</Text>;
    if (isStarted)
      return (
        <Text color="yellowBright">
          (up to {ui.handlersToTimestamp === 0 ? "" : dateText})
        </Text>
      );
    return <Text>(not started)</Text>;
  };

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text bold={true}>Handlers </Text>
        <Text>{titleText()}</Text>
      </Box>
      {!isUpToDate && (
        <Box flexDirection="row">
          <ProgressBar
            current={ui.handlersCurrent}
            end={Math.max(ui.handlersTotal, 1)}
          />
          <Text>
            {" "}
            {completionText}
            {/* {backfillEtaText}
          {backfillCountText} */}
          </Text>
        </Box>
      )}

      <Text> </Text>
    </Box>
  );
};
