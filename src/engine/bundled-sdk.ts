export function loadBundledSdk(): any {
  // Lazy load so SEA bootstrap can materialize native assets before the SDK initializes.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@cursor/sdk");
}
