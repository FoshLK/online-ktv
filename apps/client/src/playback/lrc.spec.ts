import assert from "node:assert/strict";
import test from "node:test";
import { activeLyricIndex, parseLrc } from "./lrc";

test("parses multiple timestamps, fractions and global offset", () => {
  const lines = parseLrc("[offset:100]\n[00:01.2][00:02.34]第一句\n[00:03.005]第二句");
  assert.deepEqual(lines, [
    { timeMs: 1_300, text: "第一句" },
    { timeMs: 2_440, text: "第一句" },
    { timeMs: 3_105, text: "第二句" },
  ]);
  assert.equal(activeLyricIndex(lines, 2_500), 1);
  assert.equal(activeLyricIndex(lines, 500), -1);
});
