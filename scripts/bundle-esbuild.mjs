#!/usr/bin/env node
import path from "node:path";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import esbuild from "esbuild";

const root = process.cwd();
const outDir = path.join(root, "dist/bundle");
const sdkCjs = path.join(root, "node_modules/@cursor/sdk/dist/cjs/index.js");

await fs.mkdir(outDir, { recursive: true });
await ensureFile(path.join(root, "dist/src/bin/apm.js"), "Run `npm run build:js` first.");
await ensureFile(path.join(root, "dist/src/bin/apm-daemon.js"), "Run `npm run build:js` first.");
await ensureFile(path.join(root, "dist/bundle/assets-manifest.json"), "Run `npm run build:assets` first.");
await ensureFile(sdkCjs, "Missing @cursor/sdk. Run `npm install` first.");

const assetsManifest = JSON.parse(
  await fs.readFile(path.join(root, "dist/bundle/assets-manifest.json"), "utf8"),
);
const embeddedManifest = JSON.stringify(
  JSON.stringify({
    platform: assetsManifest.platform,
    arch: assetsManifest.arch,
    platformPackage: assetsManifest.platformPackage,
    assets: assetsManifest.assets.map((asset) => ({
      key: asset.key,
      relativePath: asset.relativePath,
      mode: asset.mode,
    })),
  }),
);

const sdkCjsDir = path.dirname(sdkCjs);
const sqliteShimPath = path.join(root, "scripts/sea-sqlite3-shim.cjs");

const sqlite3ShimPlugin = {
  name: "sqlite3-shim-inline",
  setup(build) {
    build.onResolve({ filter: /^sqlite3$/ }, () => ({
      path: sqliteShimPath,
    }));
  },
};

const ignoreTypesPlugin = {
  name: "ignore-types-and-maps",
  setup(build) {
    build.onResolve({ filter: /\.d\.ts(\.map)?$/ }, (args) => ({
      path: args.path,
      external: true,
    }));
    build.onResolve({ filter: /\.map$/ }, (args) => ({
      path: args.path,
      external: true,
    }));
  },
};

const sdkChunkPlugin = {
  name: "sdk-webpack-chunks",
  setup(build) {
    build.onLoad({ filter: /\.map$/ }, () => ({
      contents: "module.exports = {};",
      loader: "js",
    }));
    build.onLoad({ filter: /\.d\.ts$/ }, () => ({
      contents: "module.exports = {};",
      loader: "js",
    }));
    build.onResolve({ filter: /.*/ }, (args) => {
      if (!args.importer.includes("@cursor/sdk/dist/cjs")) {
        return null;
      }
      if (args.path.endsWith(".d.ts") || args.path.endsWith(".map") || args.path.includes(".d.ts.")) {
        return { path: args.path, namespace: "sdk-empty-chunk" };
      }
      const baseDir = args.path.startsWith("vendor/")
        ? path.join(sdkCjsDir, path.dirname(args.path))
        : path.dirname(args.importer);
      const normalized = args.path.startsWith("vendor/")
        ? path.join(sdkCjsDir, args.path)
        : path.join(baseDir, args.path);
      const candidates = [normalized, `${normalized}.js`];
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          return { path: candidate };
        }
      }
      if (args.path.startsWith(".") || args.path.startsWith("vendor/")) {
        return { path: args.path, namespace: "sdk-empty-chunk" };
      }
      return null;
    });
    build.onLoad({ filter: /.*/, namespace: "sdk-empty-chunk" }, () => ({
      contents: "module.exports = {};",
      loader: "js",
    }));
  },
};

const nativeNodePlugin = {
  name: "native-node-external",
  setup(build) {
    build.onResolve({ filter: /\.node$/ }, (args) => ({
      path: path.isAbsolute(args.path) ? args.path : path.join(args.resolveDir, args.path),
      external: true,
    }));
  },
};

const blockDaemonPlugin = {
  name: "block-daemon-import",
  setup(build) {
    build.onResolve({ filter: /daemon\/server\.js$/ }, () => ({
      path: "apm-daemon-server-external",
      external: true,
    }));
  },
};

const common = {
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  logLevel: "info",
  mainFields: ["main"],
  resolveExtensions: [".js", ".cjs", ".json"],
};

const sdkBundlePath = path.join(outDir, "cursor-sdk.bundle.cjs");

await esbuild.build({
  ...common,
  entryPoints: [sdkCjs],
  outfile: sdkBundlePath,
  bundle: true,
  alias: {
    sqlite3: sqliteShimPath,
  },
  plugins: [sqlite3ShimPlugin, ignoreTypesPlugin, sdkChunkPlugin, nativeNodePlugin],
});

await rewriteBareSqliteRequires(sdkBundlePath);

await esbuild.build({
  ...common,
  entryPoints: [path.join(root, "dist/src/bin/apm.js")],
  outfile: path.join(outDir, "apm.bundle.cjs"),
  bundle: true,
  plugins: [ignoreTypesPlugin, blockDaemonPlugin],
  define: {
    "process.env.APM_BUNDLED": '"1"',
  },
});

await esbuild.build({
  ...common,
  entryPoints: [path.join(root, "dist/src/bin/apm-daemon.js")],
  outfile: path.join(outDir, "apm-daemon.bundle.cjs"),
  bundle: true,
  inject: [path.join(root, "dist/src/utils/sea-bootstrap.js")],
  alias: {
    "@cursor/sdk": sdkBundlePath,
    sqlite3: sqliteShimPath,
  },
  plugins: [sqlite3ShimPlugin, ignoreTypesPlugin, nativeNodePlugin],
  define: {
    "process.env.APM_BUNDLED": '"1"',
    "process.env.APM_SEA_ASSETS_MANIFEST": embeddedManifest,
  },
});

await rewriteBareSqliteRequires(path.join(outDir, "apm-daemon.bundle.cjs"));

process.stdout.write("Bundled dist/bundle/apm.bundle.cjs, apm-daemon.bundle.cjs, cursor-sdk.bundle.cjs\n");

async function rewriteBareSqliteRequires(bundlePath) {
  let content = await fs.readFile(bundlePath, "utf8");
  if (!content.includes('require("sqlite3")')) {
    return;
  }
  const shimSource = await fs.readFile(sqliteShimPath, "utf8");
  const inlineShim = `(function(){\n${shimSource.replace(
    "module.exports = resolveSqlite3Module();",
    "return resolveSqlite3Module();",
  )}\n})()`;
  content = content.replace(/require\("sqlite3"\)/g, inlineShim);
  await fs.writeFile(bundlePath, content, "utf8");
}

async function ensureFile(filePath, message) {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(message);
  }
}
