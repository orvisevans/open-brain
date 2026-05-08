// Fake GitOps for SyncEngine tests. Records every call so assertions can
// look at sequencing; lets each method be replaced with a custom impl when a
// test needs to simulate failure.

import type { NotePath } from '$lib/vault/types';

import type { GitAuthor, GitOps, PullResult } from '../types';

export interface FakeGitOpsCalls {
  changedPaths: number;
  stage: NotePath[][];
  commit: { message: string; author: GitAuthor }[];
  push: string[];
  pull: { token: string; author: GitAuthor }[];
}

export interface FakeGitOps extends GitOps {
  calls: FakeGitOpsCalls;
  // Override individual methods for failure-mode tests.
  pushImpl: (token: string) => Promise<void>;
  pullImpl: (token: string, author: GitAuthor) => Promise<PullResult>;
  stageImpl: (paths: NotePath[]) => Promise<void>;
  commitImpl: (message: string, author: GitAuthor) => Promise<string>;
  // Mutable HEAD oid the engine reads via headOid(). Tests bump this between
  // pulls to simulate remote-advancing merges.
  currentHead: string | undefined;
}

export function createFakeGitOps(): FakeGitOps {
  const calls: FakeGitOpsCalls = {
    changedPaths: 0,
    stage: [],
    commit: [],
    push: [],
    pull: [],
  };

  const ops: FakeGitOps = {
    calls,
    currentHead: 'oid-initial',
    pushImpl: () => Promise.resolve(),
    pullImpl: () => Promise.resolve({ kind: 'up-to-date' as const }),
    stageImpl: () => Promise.resolve(),
    commitImpl: () => Promise.resolve('fake-oid'),
    changedPaths: () => {
      calls.changedPaths += 1;
      return Promise.resolve([]);
    },
    stage: (paths) => {
      calls.stage.push([...paths]);
      return ops.stageImpl(paths);
    },
    commit: (message, author) => {
      calls.commit.push({ message, author });
      return ops.commitImpl(message, author);
    },
    push: (token) => {
      calls.push.push(token);
      return ops.pushImpl(token);
    },
    pull: (token, author) => {
      calls.pull.push({ token, author });
      return ops.pullImpl(token, author);
    },
    headOid: () => Promise.resolve(ops.currentHead),
  };

  return ops;
}
