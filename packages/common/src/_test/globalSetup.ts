import dotenv from "dotenv";

export default async function () {
  dotenv.config({ path: ".env.local" });
}
