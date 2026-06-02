import test from "node:test";
import assert from "node:assert/strict";
import {
  bootstrapSeaRuntime,
  isRunningInSea,
  resolvePlatformPackage,
  resolveSeaRuntimeDir,
} from "../src/utils/sea-bootstrap.js";

test("sea bootstrap is no-op outside SEA", () => {
  assert.equal(isRunningInSea(), false);
  assert.equal(bootstrapSeaRuntime(), undefined);
  assert.equal(resolveSeaRuntimeDir(), undefined);
});

test("sea platform package mapping covers CI matrix", () => {
  assert.equal(resolvePlatformPackage("linux-x64"), "@cursor/sdk-linux-x64");
  assert.equal(resolvePlatformPackage("linux-arm64"), "@cursor/sdk-linux-arm64");
  assert.equal(resolvePlatformPackage("darwin-x64"), "@cursor/sdk-darwin-x64");
  assert.equal(resolvePlatformPackage("darwin-arm64"), "@cursor/sdk-darwin-arm64");
  assert.equal(resolvePlatformPackage("win32-x64"), "@cursor/sdk-win32-x64");
  assert.equal(resolvePlatformPackage("unsupported"), undefined);
});
