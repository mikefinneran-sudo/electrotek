import assert from "node:assert/strict";
import { fetchAllRows } from "./pagination";

const rows = Array.from({ length: 2505 }, (_, index) => ({ id: index + 1 }));
const ranges: [number, number][] = [];

const result = await fetchAllRows((from, to) => {
  ranges.push([from, to]);
  return Promise.resolve({
    data: rows.slice(from, to + 1),
    error: null,
  });
});

assert.equal(result.error, null);
assert.equal(result.data.length, 2505);
assert.deepEqual(ranges, [
  [0, 999],
  [1000, 1999],
  [2000, 2999],
]);

const failed = await fetchAllRows<{ id: number }>((from) =>
  Promise.resolve({
    data: from === 0 ? [{ id: 1 }] : null,
    error: from === 1000 ? { message: "boom" } : null,
  }),
);

assert.equal(failed.error, null);
assert.deepEqual(failed.data, [{ id: 1 }]);
