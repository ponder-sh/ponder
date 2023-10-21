import url from "node:url";

const __filename = url.fileURLToPath(import.meta.url);

export default class {
  constructor(public param: string = "bar") {}

  public getParams = () =>
    JSON.stringify({ file: __filename, param: this.param }, null, 2);

  public getTimestamp = () =>
    JSON.stringify({ file: __filename, timestamp: Date.now() }, null, 2);
}
