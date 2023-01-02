import { Box, Text } from "ink";
import React from "react";

import { UiState } from "./app";
import { ProgressBar } from "./ProgressBar";

export const HandlersBar = ({ ui }: { ui: UiState }) => {
  const completionRate = ui.handlersCurrent / Math.max(ui.handlersTotal, 1);
  const completionDecimal = Math.round(completionRate * 1000) / 10;
  const completionText =
    Number.isInteger(completionDecimal) && completionDecimal < 100
      ? `${completionDecimal}.0%`
      : `${completionDecimal}%`;

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

  const countText = () => {
    if (isUpToDate)
      return (
        <Text>
          {" "}
          | {ui.handlersCurrent}/{ui.handlersTotal} events
        </Text>
      );
    if (isStarted)
      return (
        <Text>
          {" "}
          | {ui.handlersCurrent}/
          {"?".repeat(ui.handlersCurrent.toString().length)} events
        </Text>
      );
    return null;
  };

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text bold={true}>Handlers </Text>
        <Text>{titleText()}</Text>
      </Box>
      {/* {!isUpToDate && ( */}
      <Box flexDirection="row">
        <ProgressBar
          current={ui.handlersCurrent}
          end={Math.max(ui.handlersTotal, 1)}
        />
        <Text>
          {" "}
          {completionText}
          {countText()}
        </Text>
      </Box>
      {/* )} */}

      <Text> </Text>
    </Box>
  );
};
