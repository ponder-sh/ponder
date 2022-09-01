import { exec as execCallback } from "node:child_process";
import util from "node:util";

const exec = util.promisify(execCallback);

const runGraphCodegen = async () => {
  const { stdout, stderr } = await exec("graph codegen");
};

export { runGraphCodegen };
