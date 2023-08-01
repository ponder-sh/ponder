import os from "os";

type AnonymousMeta = {
  systemPlatform: NodeJS.Platform;
  systemRelease: string;
  systemArchitecture: string;
  cpuCount: number;
  cpuModel: string | null;
  cpuSpeed: number | null;
  memoryInMb: number;
  // TODO: detect docker
  // isDocker: boolean;
  // isNowDev: boolean;
  // isWsl: boolean;
  // isCI: boolean;
  // ciName: string | null;
  // nextVersion: string;
};

let traits: AnonymousMeta | undefined;

export function getAnonymousMeta(): AnonymousMeta {
  if (traits) {
    return traits;
  }

  const cpus = os.cpus() || [];

  traits = {
    // Software information
    systemPlatform: os.platform(),
    systemRelease: os.release(),
    systemArchitecture: os.arch(),
    // Machine information
    cpuCount: cpus.length,
    cpuModel: cpus.length ? cpus[0].model : null,
    cpuSpeed: cpus.length ? cpus[0].speed : null,
    memoryInMb: Math.trunc(os.totalmem() / Math.pow(1024, 2)),
    // Environment information
    // TODO: detect docker
  };

  return traits;
}
