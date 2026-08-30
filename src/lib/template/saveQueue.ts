export type RevisionedSave<T> = (
  value: T,
  expectedRevision: string,
) => Promise<string>;

export type LatestSaveQueue<T> = {
  enqueue: (value: T) => Promise<void>;
  revision: () => string;
};

/**
 * Coalesces rapid edits and serializes full-document saves. Template saves
 * replace every slot, so allowing two requests to overlap lets an older
 * snapshot finish last and silently restore shifts the user already removed.
 */
export function createLatestSaveQueue<T>(
  initialRevision: string,
  save: RevisionedSave<T>,
): LatestSaveQueue<T> {
  let revision = initialRevision;
  let latestValue: T | undefined;
  let pending = false;
  let draining: Promise<void> | null = null;

  async function drain(): Promise<void> {
    while (pending) {
      const value = latestValue as T;
      pending = false;

      try {
        revision = await save(value, revision);
      } catch (error) {
        // Keep the newest draft available for the next explicit edit/retry.
        // Do not retry automatically: auth/network failures should surface
        // instead of creating a request loop.
        pending = true;
        throw error;
      }
    }
  }

  return {
    enqueue(value) {
      latestValue = value;
      pending = true;
      if (!draining) {
        draining = drain().finally(() => {
          draining = null;
        });
      }
      return draining;
    },
    revision() {
      return revision;
    },
  };
}
