import type { PullRequestSummary } from '../domain/pull-request.ts';

export type ToolKind = 'lumen' | 'reviewCommand';
export type ToolId = string;
export type ShutdownReason = 'quit' | 'endOfInput' | 'queueClosed' | 'signal';

export type ToolRequest = {
  readonly kind: ToolKind;
  readonly pullRequest: PullRequestSummary;
};

export type ToolFailure = {
  readonly kind: 'precondition' | 'couldNotStart' | 'control';
  readonly message: string;
  readonly code?: string;
};

export type ToolLaunchOutcome =
  | { readonly phase: 'running' | 'ended'; readonly toolId: ToolId }
  | { readonly phase: 'indeterminate'; readonly toolId: ToolId }
  | { readonly phase: 'rejected'; readonly failure: ToolFailure };

export type ToolNotice =
  | {
      readonly type: 'phaseChanged';
      readonly toolId: ToolId;
      readonly kind: ToolKind;
      readonly phase: 'running' | 'ended';
    }
  | {
      readonly type: 'indeterminate';
      readonly toolId: ToolId;
      readonly kind: ToolKind;
      readonly message: string;
    }
  | {
      readonly type:
        'lifecycleDegraded' | 'lifecycleRestored' | 'reviewQueueClosed';
      readonly message: string;
    }
  | {
      readonly type: 'controlFailure';
      readonly toolId?: ToolId;
      readonly message: string;
      readonly code?: string;
    };

export type ToolShutdownOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly failures: readonly ToolFailure[];
    };

export type ToolTabs = {
  launch(request: ToolRequest): Promise<ToolLaunchOutcome>;
  acknowledgeIndeterminateLaunch(toolId: ToolId): void;
  subscribe(listener: (notice: ToolNotice) => void): () => void;
  shutdown(reason: ShutdownReason): Promise<ToolShutdownOutcome>;
};
