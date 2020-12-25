export function pausePromise(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface CancelablePromise<T> extends Promise<T> {
  cancel: () => Promise<any>;
}

class CancelToken {
  protected canceled = false;

  public cancel() {
    this.canceled = true;
  }

  public isCanceled() {
    return this.canceled;
  }
}

export function createCancelablePromise<T>(
  fn: (cancel: CancelToken) => Promise<T>,
): CancelablePromise<T> {
  const token = new CancelToken();

  const promise: any = fn(token);
  promise.cancel = async () => {
    token.cancel();

    await promise;
  };

  return promise;
}

export interface CancelableInterval {
  cancel: () => Promise<void>,
}

/**
 * It's helps to create an interval that can be canceled with awaiting latest execution
 */
export function createCancelableInterval<T>(
  fn: (token: CancelToken) => Promise<T>,
  interval: number,
): CancelableInterval {
  let execution: CancelablePromise<T>|null = null;

  const timeout = setInterval(
    async () => {
      execution = createCancelablePromise(fn);

      await execution;

      execution = null;
    },
    interval,
  );

  return {
    cancel: async () => {
      clearInterval(timeout);

      if (execution) {
        await execution.cancel();

        await execution;
      }
    }
  };
}
