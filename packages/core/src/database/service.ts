export interface DatabaseService {
  kind: "sqlite" | "postgres";

  // setup(): Promise<void>;

  // reset(): Promise<void>;

  // kill(): Promise<void>;

  // flush(): Promise<void>;

  // publish(): Promise<void>;
}
