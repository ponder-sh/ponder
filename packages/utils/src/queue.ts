export type InnerQueue<returnType, parameter> = {
  parameter: parameter;
  resolve: (arg: returnType) => void;
  reject: (error: Error) => void;
}[];

export type Queue<returnType, parameter> = {
  queue: InnerQueue<returnType, parameter>;
  size: () => number;
  pending: () => Promise<number>;
  add: (task: parameter) => Promise<returnType>;
  clear: () => void;
  isStarted: () => boolean;
  start: () => void;
  pause: () => void;
  onIdle: () => Promise<void>;
  onEmpty: () => Promise<void>;
};
