import { createCancelablePromise, createCancelableInterval, pausePromise } from '../src';

test('createCancelablePromise', async () => {
  let canceled = false;

  const promise = createCancelablePromise(async (token) => {
    await pausePromise(250);

    if (token.isCanceled()) {
      canceled = true;

      return;
    }

    await pausePromise(250);
  });
  promise.cancel();

  await pausePromise(250);

  expect(canceled).toBe(true);
});

test('createCancelablePromise(simple interval)', async () => {
  let started = 0;
  let finished = 0;
  let canceled = false;

  const interval = createCancelableInterval(async (token) => {
    started++;

    await pausePromise(25);

    if (token.isCanceled()) {
      console.log('canceling');

      canceled = true;

      return;
    }

    await pausePromise(25);

    finished++;
  }, 100);

  await pausePromise(100 + 25 + 25 + 10);

  expect(started).toEqual(1);
  expect(finished).toEqual(1);

  await pausePromise(50);

  await interval.cancel();

  expect(canceled).toEqual(true);
  expect(started).toEqual(2);
  expect(finished).toEqual(1);
});

test('createCancelablePromise(cancel should wait latest execution)', async () => {
  let started = 0;
  let finished = 0;

  const interval = createCancelableInterval(async (token) => {
    started++;

    await pausePromise(250);

    finished++;
  }, 100);

  await pausePromise(100);

  await interval.cancel();

  expect(started).toEqual(1);
  expect(finished).toEqual(1);
});
