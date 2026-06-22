#!/usr/bin/env node
import { createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import https from "node:https";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const version = (process.env.NODE_RUNTIME_VERSION ?? process.versions.node).replace(/^v/, "");
const platformKey = `${process.platform}-${process.arch}`;
const outputDir = path.join(root, "apps/apm-desktop/src-tauri/resources/runtime");
const cacheDir = path.join(root, ".cache/node-runtime", version, platformKey);
const downloadsDir = path.join(root, ".cache/node-runtime/downloads");

const target = resolveTarget();
const archivePath = path.join(downloadsDir, target.archiveName);
const extractedRoot = path.join(cacheDir, target.rootName);

await fs.mkdir(downloadsDir, { recursive: true });
await fs.mkdir(cacheDir, { recursive: true });

if (!(await exists(extractedRoot))) {
  if (!(await exists(archivePath))) {
    await download(target.url, archivePath);
  }
  await extractArchive(archivePath, cacheDir);
}

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });

if (process.platform === "win32") {
  await fs.copyFile(path.join(extractedRoot, "node.exe"), path.join(outputDir, "node.exe"));
  for (const entry of await fs.readdir(extractedRoot)) {
    if (entry.toLowerCase().endsWith(".dll")) {
      await fs.copyFile(path.join(extractedRoot, entry), path.join(outputDir, entry));
    }
  }
} else {
  const nodePath = path.join(outputDir, "node");
  await fs.copyFile(path.join(extractedRoot, "bin", "node"), nodePath);
  await fs.chmod(nodePath, 0o755);
}

await fs.writeFile(path.join(outputDir, ".gitkeep"), "", "utf8");
process.stdout.write(`Packaged Node.js ${version} runtime to ${path.relative(root, outputDir)}\n`);

function resolveTarget() {
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : undefined;
  if (!arch) {
    throw new Error(`Unsupported Node runtime architecture: ${process.arch}`);
  }
  if (process.platform === "linux") {
    return archiveTarget(`node-v${version}-linux-${arch}`, "tar.xz");
  }
  if (process.platform === "darwin") {
    return archiveTarget(`node-v${version}-darwin-${arch}`, "tar.gz");
  }
  if (process.platform === "win32") {
    return archiveTarget(`node-v${version}-win-${arch}`, "zip");
  }
  throw new Error(`Unsupported Node runtime platform: ${process.platform}`);
}

function archiveTarget(rootName, extension) {
  const archiveName = `${rootName}.${extension}`;
  return {
    rootName,
    archiveName,
    url: `https://nodejs.org/dist/v${version}/${archiveName}`,
  };
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function download(url, destination) {
  process.stdout.write(`Downloading ${url}\n`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
        response.resume();
        download(response.headers.location, destination).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${response.statusCode}: ${url}`));
        return;
      }
      const file = createWriteStream(destination);
      response.pipe(file);
      file.on("finish", () => {
        file.close(resolve);
      });
      file.on("error", reject);
    });
    request.on("error", reject);
  });
}

async function extractArchive(archive, destination) {
  await fs.rm(extractedRoot, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  if (archive.endsWith(".zip")) {
    const result = spawnSync(
      "powershell",
      ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${destination}' -Force`],
      { stdio: "inherit" },
    );
    if (result.status !== 0) {
      throw new Error(`Failed to extract ${archive}`);
    }
    return;
  }
  const result = spawnSync("tar", ["-xf", archive, "-C", destination], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`Failed to extract ${archive}`);
  }
}
