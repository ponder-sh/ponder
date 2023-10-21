import url from "node:url";

const __filename = url.fileURLToPath(import.meta.url);

/**
 * @typedef {import('vite').InlineConfig} InlineConfig
 * @typedef {import('vite').ViteDevServer} ViteDevServer
 * @typedef {import('vite-node/server').ViteNodeServer} ViteNodeServer
 * @typedef {import('vite-node/client').ViteNodeRunner} ViteNodeRunner
 */
export class Runtime {
  /**
   * @property {Array<string>} files to watch (can be a glob pattern)
   * @property {InlineConfig} viteServerConfig
   */
  #files;
  #viteServerConfig;

  /** @param {{ files: Array<string>, viteServerConfig?: InlineConfig }} constructorParams */
  constructor({ files, viteServerConfig }) {
    this.#files = files;
    this.#viteServerConfig = viteServerConfig;
  }

  /** @param {InlineConfig} viteServerConfig */
  async #createViteServer(
    viteServerConfig = {
      clearScreen: false,
      optimizeDeps: { disabled: true },
      ...this.#viteServerConfig,
    }
  ) {
    const { createServer } = await import("vite");
    const server = await createServer(viteServerConfig);
    await server.pluginContainer.buildStart({});
    return server;
  }

  /** @param {ViteDevServer} viteServer */
  async #createViteNodeServer(viteServer) {
    const { ViteNodeServer } = await import("vite-node/server");
    const { installSourcemapsSupport } = await import("vite-node/source-map");
    const viteNodeServer = new ViteNodeServer(viteServer);
    installSourcemapsSupport({
      getSourceMap: (source) => viteNodeServer.getSourceMap(source),
    });
    return viteNodeServer;
  }

  /**
   * @param {ViteDevServer} viteServer
   * @param {ViteNodeServer} viteNodeServer
   */
  async #createViteNodeRunner(viteServer, viteNodeServer) {
    const { ViteNodeRunner } = await import("vite-node/client");
    return new ViteNodeRunner({
      root: viteServer.config.root,
      base: viteServer.config.base,
      fetchModule: (id) => viteNodeServer.fetchModule(id),
      resolveId: (id, importer) => viteNodeServer.resolveId(id, importer),
    });
  }

  /**
   * @param {string} filePath
   * @param {ViteNodeRunner} viteNodeRunner
   */
  async #executeFile(filePath, viteNodeRunner) {
    try {
      await viteNodeRunner.executeFile(filePath);
    } catch (error) {
      console.error(`Encoutered an error: ${error}`);
    }
  }

  /**
   * @template T
   * @param {(module: Promise<T | any>, filePath?: string) => void} handleModule
   */
  async start(handleModule) {
    const viteServer = await this.#createViteServer();
    const viteNodeServer = await this.#createViteNodeServer(viteServer);
    let viteNodeRunner = await this.#createViteNodeRunner(
      viteServer,
      viteNodeServer
    );

    console.info("Listening for changes…\n");

    this.#files.forEach((file) => this.#executeFile(file, viteNodeRunner));

    viteServer.watcher.on("all", async (eventName, affectedPath) => {
      console.log(`detected ${eventName} in ${affectedPath}`);
      // ignore changes to this file
      if (affectedPath === __filename || eventName !== "change") return;
      const module = await viteNodeRunner.cachedRequest(
        affectedPath,
        affectedPath,
        []
      );
      handleModule(module, affectedPath);
      viteNodeRunner = await this.#createViteNodeRunner(
        viteServer,
        viteNodeServer
      );
    });
  }
}
