export const formatEta = (ms: number) => {
  // If less than 1 second, return ms.
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.floor(ms / 1000);

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds - h * 3600) / 60);
  const s = seconds - h * 3600 - m * 60;

  const hstr = h > 0 ? `${h}h ` : "";
  const mstr = m > 0 || h > 0 ? `${m < 10 && h > 0 ? "0" : ""}${m}m ` : "";
  const sstr = s > 0 || m > 0 ? `${s < 10 && m > 0 ? "0" : ""}${s}s` : "";

  return `${hstr}${mstr}${sstr}`;
};

export const formatPercentage = (cacheRate: number) => {
  const decimal = Math.round(cacheRate * 1000) / 10;
  return Number.isInteger(decimal) && decimal < 100
    ? `${decimal}.0%`
    : `${decimal}%`;
};
