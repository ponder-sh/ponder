/** Get the URL of the server. */
export function getServerUrl() {
  if (process.env.NODE_ENV === "development") {
    return "http://localhost:42069";
  }
  return window.location.origin;
}
