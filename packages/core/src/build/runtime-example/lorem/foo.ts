import url from "node:url";

const __filename = url.fileURLToPath(import.meta.url);

export default class {
  constructor(public param: string = "foo") {}

  public getParams = () => ({
    timestamp: Date.now(),
    file: __filename,
    param: this.param,
  });
}
