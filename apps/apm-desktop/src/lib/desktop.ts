import { Channel, invoke } from "@tauri-apps/api/core";
import type { Catalog, ConfigSpace, DaemonStatus, DesktopContext, UpdateDownloadEvent, UpdateMetadata } from "./types";

export async function getDesktopContext(): Promise<DesktopContext> {
  return invoke<DesktopContext>("get_desktop_context");
}

export async function getDaemonStatus(): Promise<DaemonStatus> {
  return invoke<DaemonStatus>("daemon_status");
}

export async function startDaemon(): Promise<DaemonStatus> {
  return invoke<DaemonStatus>("daemon_start");
}

export async function stopDaemon(): Promise<DaemonStatus> {
  return invoke<DaemonStatus>("daemon_stop");
}

export async function restartDaemon(): Promise<DaemonStatus> {
  return invoke<DaemonStatus>("daemon_restart");
}

export async function openApmHome(): Promise<void> {
  await invoke("open_apm_home");
}

export async function importMinimalTemplate(): Promise<string> {
  return invoke<string>("import_minimal_template");
}

export async function listConfigSpaces(): Promise<ConfigSpace[]> {
  return invoke<ConfigSpace[]>("list_config_spaces");
}

export async function createConfigSpace(name: string): Promise<ConfigSpace> {
  return invoke<ConfigSpace>("create_config_space", { name });
}

export async function deleteConfigSpace(name: string): Promise<void> {
  await invoke("delete_config_space", { name });
}

export async function listApmCatalog(space?: string): Promise<Catalog> {
  return invoke<Catalog>("list_apm_catalog", { space });
}

export async function readApmTextFile(relativePath: string): Promise<string> {
  return invoke<string>("read_apm_text_file", { relativePath });
}

export async function writeApmTextFile(relativePath: string, content: string): Promise<void> {
  await invoke("write_apm_text_file", { relativePath, content });
}

export async function renameApmFile(relativePath: string, newRelativePath: string): Promise<void> {
  await invoke("rename_apm_file", { relativePath, newRelativePath });
}

export async function deleteApmFile(relativePath: string): Promise<void> {
  await invoke("delete_apm_file", { relativePath });
}

export async function checkForUpdate(): Promise<UpdateMetadata | null> {
  return invoke<UpdateMetadata | null>("check_for_update");
}

export async function installUpdate(onEvent: (event: UpdateDownloadEvent) => void): Promise<void> {
  const channel = new Channel<UpdateDownloadEvent>(onEvent);
  await invoke("install_update", { onEvent: channel });
}

export async function restartApp(): Promise<void> {
  await invoke("restart_app");
}
