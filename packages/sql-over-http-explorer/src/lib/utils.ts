import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Get the URL of the server. */
export function getServerUrl() {
  if (process.env.NODE_ENV === "development") {
    return "http://localhost:42069";
  }
  return window.location.origin;
}
