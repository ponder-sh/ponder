/** Formats a unix timestamp into a short date format (e.g. "Jan 1, 2021")
 *
 * @param unixTimestamp Unix timestamp to format
 * @returns Formatted date string
 */
export function formatShortDate(unixTimestamp: number) {
  const date = new Date(unixTimestamp * 1000);
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
  return `${month} ${day}, ${year}`;
}
