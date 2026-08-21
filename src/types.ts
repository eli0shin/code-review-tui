export type CommandFailure = {
  readonly kind: 'message';
  readonly message: string;
};

export type CommandOutcome<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly failure: CommandFailure };

export type OperationResult<T = void> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string };

export type Platform = 'darwin' | 'linux';
export type Architecture = 'x64' | 'arm64';
export type UpdateBehavior = 'auto' | 'notify' | 'off';

export type ReviewConfig = {
  readonly config?: {
    readonly updateBehavior?: UpdateBehavior;
    readonly updateCheckIntervalHours?: number;
  };
};

export type UpdateState = {
  readonly lastCheckedAt: number;
  readonly pendingNotification?: string;
};

export type UpdateCommandOutcome = {
  readonly messages: readonly string[];
  readonly outcome: CommandOutcome<void>;
};
