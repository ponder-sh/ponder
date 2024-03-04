export type InnerQueue<returnType, taskType> = {
  task: taskType;
  resolve: (arg: returnType) => void;
  reject: (error: Error) => void;
}[];

export type Queue<returnType, taskType> = {
  size: () => number;
  pending: () => Promise<number>;
  add: (task: taskType) => Promise<returnType>;
  clear: () => void;
  isStarted: () => boolean;
  start: () => void;
  pause: () => void;
  onIdle: () => Promise<void>;
  onEmpty: () => Promise<void>;
};
