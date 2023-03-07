import moduleAlias from "module-alias";
import path from "node:path";

const ponderCoreDir = path.resolve(__dirname, "../../");
moduleAlias.addAlias("@ponder/core", ponderCoreDir);
