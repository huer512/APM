#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { promises as fs } from "node:fs";

const TARGET_MATRIX = [
  { id: "linux-x64", os: "linux", arch: "x64", ext: "" },
  { id: "linux-arm64", os: "linux", arch: "arm64", ext: "" },
  { id: "darwin-x64", os: "darwin", arch: "x64", ext: "" },
  { id: "darwin-arm64", os: "darwin", arch: "arm64", ext: "" },
  { id: "win32-x64", os: "win32", arch: "x64", ext: ".exe" },
];

const root = process.cwd();
const bundleDir = path.join(root, "dist/bundle");
const outputDir = path.join(root, "dist/bin");
const selectedTargets = resolveSelectedTargets(process.argv.slice(2), resolveCurrentTarget());

await ensureFile(path.join(bundleDir, "apm.bundle.cjs"), "Missing apm bundle. Run `npm run build:bundle` first.");
await ensureFile(
  path.join(bundleDir, "apm-daemon.bundle.cjs"),
  "Missing apm-daemon bundle. Run `npm run build:bundle` first.",
);
await ensureFile(path.join(bundleDir, "assets-manifest.json"), "Missing assets manifest. Run collect-native-assets first.");
await fs.mkdir(outputDir, { recursive: true });

const manifest = JSON.parse(await fs.readFile(path.join(bundleDir, "assets-manifest.json"), "utf8"));
const built = [];
const failed = [];

for (const target of selectedTargets) {
  try {
    if (target.id !== `${process.platform}-${process.arch}`) {
      throw new Error(
        `Cross-compiling SEA for ${target.id} from ${process.platform}-${process.arch} is unsupported. Use CI matrix builds.`,
      );
    }

    const apmOut = path.join(outputDir, `apm-${target.os}-${target.arch}${target.ext}`);
    const daemonOut = path.join(outputDir, `apm-daemon-${target.os}-${target.arch}${target.ext}`);

    await buildSeaBinary({
      name: "apm",
      bundlePath: path.join(bundleDir, "apm.bundle.cjs"),
      outputPath: apmOut,
      assets: {},
    });
    await buildSeaBinary({
      name: "apm-daemon",
      bundlePath: path.join(bundleDir, "apm-daemon.bundle.cjs"),
      outputPath: daemonOut,
      assets: buildSeaAssets(manifest),
      assetsManifest: manifest,
    });

    built.push({
      target: target.id,
      files: [path.relative(root, apmOut), path.relative(root, daemonOut)],
    });
  } catch (error) {
    failed.push({
      target: target.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const manifestPath = path.join(outputDir, "manifest.json");
await fs.writeFile(
  manifestPath,
  JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      builder: "node-sea",
      nodeVersion: process.version,
      selectedTargets: selectedTargets.map((item) => item.id),
      built,
      failed,
    },
    null,
    2,
  ),
  "utf8",
);

if (failed.length > 0) {
  const lines = failed.map((item) => `- ${item.target}: ${item.error}`).join("\n");
  throw new Error(`SEA binary build failed for some targets:\n${lines}`);
}

process.stdout.write(`Built ${built.length} target(s). Manifest: ${path.relative(root, manifestPath)}\n`);

function buildSeaAssets(manifest) {
  const assets = {};
  for (const asset of manifest.assets) {
    assets[asset.key] = path.join(root, asset.source);
  }
  return assets;
}

async function removeOutputIfExists(outputPath) {
  try {
    await fs.unlink(outputPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function buildSeaBinary({ name, bundlePath, outputPath, assets, assetsManifest }) {
  await removeOutputIfExists(outputPath);
  const seaConfigPath = path.join(bundleDir, `${name}.sea-config.json`);
  const config = {
    main: path.resolve(bundlePath),
    mainFormat: "commonjs",
    output: path.resolve(outputPath),
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    useSnapshot: false,
    assets,
  };

  await fs.writeFile(seaConfigPath, JSON.stringify(config, null, 2), "utf8");

  // Native --build-sea on macOS can produce binaries that exit silently; postject is reliable.
  const preferPostject = process.platform === "darwin";
  if (!preferPostject) {
    const buildSea = spawnSync(process.execPath, ["--build-sea", seaConfigPath], {
      cwd: root,
      encoding: "utf8",
    });

    if (buildSea.status === 0) {
      await ensureFile(outputPath, `SEA output missing for ${name}`);
      await fs.chmod(outputPath, 0o755);
      return;
    }
  }

  await buildSeaWithPostject({ name, bundlePath, outputPath, assets, assetsManifest, seaConfigPath });
}

async function buildSeaWithPostject({ name, bundlePath, outputPath, assets, assetsManifest, seaConfigPath }) {
  const blobPath = path.join(bundleDir, `${name}.sea-prep.blob`);
  const postjectConfig = {
    main: path.resolve(bundlePath),
    mainFormat: "commonjs",
    output: path.resolve(blobPath),
    disableExperimentalSEAWarning: true,
    assets,
  };
  await fs.writeFile(seaConfigPath, JSON.stringify(postjectConfig, null, 2), "utf8");

  const generateBlob = spawnSync(process.execPath, ["--experimental-sea-config", seaConfigPath], {
    cwd: root,
    encoding: "utf8",
  });
  if (generateBlob.status !== 0) {
    throw new Error(
      [
        `Failed to generate SEA blob for ${name}.`,
        generateBlob.stderr || generateBlob.stdout || "",
        "Install Node 22+ for native --build-sea, or ensure postject is available.",
      ].join("\n"),
    );
  }

  await removeOutputIfExists(outputPath);
  await fs.copyFile(process.execPath, outputPath);
  const postject = spawnSync(
    "npx",
    [
      "postject",
      outputPath,
      "NODE_SEA_BLOB",
      blobPath,
      "--sentinel-fuse",
      "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
      "--overwrite",
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (postject.status !== 0) {
    throw new Error((postject.stderr || postject.stdout || `postject failed for ${name}`).trim());
  }

  if (assetsManifest) {
    process.stdout.write(`Built ${name} via postject fallback.\n`);
  }

  if (process.platform === "darwin") {
    spawnSync("codesign", ["--sign", "-", outputPath], { stdio: "inherit" });
  }
  await fs.chmod(outputPath, 0o755);
}

function resolveSelectedTargets(args, current) {
  const token = args.find((item) => item.startsWith("--targets="));
  if (!token) {
    return [current];
  }
  const raw = token.slice("--targets=".length).trim();
  if (raw === "all") {
    return [...TARGET_MATRIX];
  }
  if (raw === "current") {
    return [current];
  }
  const split = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return split.map((id) => {
    const found = TARGET_MATRIX.find((item) => item.id === id || item.id === normalizeLegacyTarget(id));
    if (!found) {
      throw new Error(`Unsupported target: ${id}`);
    }
    return found;
  });
}

function normalizeLegacyTarget(id) {
  const map = {
    "node20-linux-x64": "linux-x64",
    "node20-linux-arm64": "linux-arm64",
    "node20-macos-x64": "darwin-x64",
    "node20-macos-arm64": "darwin-arm64",
    "node20-win-x64": "win32-x64",
  };
  return map[id] ?? id;
}

function resolveCurrentTarget() {
  const found = TARGET_MATRIX.find((item) => item.os === process.platform && item.arch === process.arch);
  if (!found) {
    throw new Error(`Unsupported host platform for SEA target mapping: ${process.platform}-${process.arch}`);
  }
  return found;
}

async function ensureFile(filePath, message) {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(message);
  }
}
