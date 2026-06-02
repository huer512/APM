import { invoke } from "@tauri-apps/api/core";
import type { DaemonStatus, DesktopContext } from "./types";

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
