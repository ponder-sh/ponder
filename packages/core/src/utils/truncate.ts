/**
 * Truncates a given string to a specified maximum length, adding ellipsis in the middle if necessary.
 *
 * @param string - The string to be truncated.
 * @param maxLength - The maximum length of the truncated string, including the ellipsis. Defaults to 36.
 * @returns The truncated string with ellipsis in the middle if it exceeds the maximum length.
 */
export const truncate = (string: string, maxLength = 36): string => {
  if (string.length <= maxLength) return string;

  const prefixLength = Math.floor(maxLength / 2) - 2; // Keep half the start
  const suffixLength = Math.ceil(maxLength / 2) - 2; // Keep half the end

  return `${string.slice(0, prefixLength)}...${string.slice(-suffixLength)}`;
};
