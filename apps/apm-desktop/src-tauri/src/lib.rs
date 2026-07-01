use serde::{Deserialize, Serialize};
use std::fs;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

struct DaemonState {
    child: Mutex<Option<Child>>,
}

struct PendingUpdate {
    update: Mutex<Option<Update>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesktopContext {
    pub apm_home: String,
    pub dev_mode: bool,
    pub http_base_url: Option<String>,
    pub http_token: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonStatus {
    pub running: bool,
    pub http_reachable: bool,
    pub message: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    pub current_version: String,
    pub version: String,
    pub date: Option<String>,
    pub body: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "event", content = "data")]
pub enum UpdateDownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started { content_length: Option<u64> },
    #[serde(rename_all = "camelCase")]
    Progress { chunk_length: usize },
    Finished,
}

fn apm_home_dir() -> PathBuf {
    if let Ok(home) = std::env::var("APM_HOME") {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    dirs::home_dir()
        .map(|h| h.join(".apm"))
        .unwrap_or_else(|| PathBuf::from(".apm"))
}

fn is_dev_mode() -> bool {
    std::env::var("APM_DESKTOP_DEV")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn config_path(home: &Path) -> PathBuf {
    home.join("config.json")
}

fn token_path(home: &Path) -> PathBuf {
    home.join("state").join("http.token")
}

fn desktop_daemon_pid_path(home: &Path) -> PathBuf {
    home.join("state").join("desktop-daemon.pid")
}

fn desktop_daemon_log_path(home: &Path) -> PathBuf {
    home.join("state").join("desktop-daemon.log")
}

fn repo_root_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
}

fn ensure_apm_dirs(home: &Path) -> Result<(), String> {
    for sub in ["prompts", "stages", "hosts", "entries", "state"] {
        fs::create_dir_all(home.join(sub)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn append_daemon_log(home: &Path, message: &str) {
    let _ = ensure_apm_dirs(home);
    let path = desktop_daemon_log_path(home);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{}", message);
    }
}

fn daemon_log_file(home: &Path) -> Result<fs::File, String> {
    ensure_apm_dirs(home)?;
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(desktop_daemon_log_path(home))
        .map_err(|e| e.to_string())
}

fn daemon_log_tail(home: &Path) -> String {
    let raw = fs::read_to_string(desktop_daemon_log_path(home)).unwrap_or_default();
    const MAX_LEN: usize = 4000;
    let chars: Vec<char> = raw.chars().collect();
    if chars.len() <= MAX_LEN {
        return raw;
    }
    chars[chars.len() - MAX_LEN..].iter().collect()
}

fn read_token(home: &Path) -> Option<String> {
    fs::read_to_string(token_path(home))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn ensure_http_enabled(home: &Path) -> Result<(), String> {
    ensure_apm_dirs(home)?;
    let path = config_path(home);
    let mut value: serde_json::Value = if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    let http = value
        .as_object_mut()
        .and_then(|o| {
            if !o.contains_key("http") {
                o.insert(
                    "http".to_string(),
                    serde_json::json!({
                        "enabled": true,
                        "host": "127.0.0.1",
                        "port": 19740
                    }),
                );
            }
            o.get_mut("http")
        })
        .and_then(|h| h.as_object_mut());
    if let Some(http) = http {
        http.insert("enabled".to_string(), serde_json::json!(true));
        if !http.contains_key("host") {
            http.insert("host".to_string(), serde_json::json!("127.0.0.1"));
        }
        if !http.contains_key("port") {
            http.insert("port".to_string(), serde_json::json!(19740));
        }
    }
    fs::write(&path, serde_json::to_string_pretty(&value).unwrap_or_default())
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn http_base_from_config(home: &Path) -> Option<String> {
    let raw = fs::read_to_string(config_path(home)).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let http = value.get("http")?;
    let enabled = http.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
    if !enabled {
        return None;
    }
    let host = http
        .get("host")
        .and_then(|v| v.as_str())
        .unwrap_or("127.0.0.1");
    let port = http.get("port").and_then(|v| v.as_u64()).unwrap_or(19740);
    Some(format!("http://{}:{}", host, port))
}

fn parse_http_base(base_url: &str) -> Option<(String, u16)> {
    let rest = base_url.trim().strip_prefix("http://")?;
    if let Some((host, port_str)) = rest.split_once(':') {
        let port: u16 = port_str.parse().ok()?;
        return Some((host.to_string(), port));
    }
    Some((rest.to_string(), 19740))
}

fn check_http_health(base_url: &str) -> bool {
    let Some((host, port)) = parse_http_base(base_url) else {
        return false;
    };
    let addr = match format!("{}:{}", host, port).to_socket_addrs() {
        Ok(mut iter) => match iter.next() {
            Some(a) => a,
            None => return false,
        },
        Err(_) => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(500)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let request = format!(
        "GET /health HTTP/1.1\r\nHost: {}:{}\r\nConnection: close\r\n\r\n",
        host, port
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 256];
    let Ok(n) = stream.read(&mut buf) else {
        return false;
    };
    let response = String::from_utf8_lossy(&buf[..n]);
    response.contains("200") && response.contains("ok")
}

#[tauri::command]
fn get_desktop_context() -> DesktopContext {
    let home = apm_home_dir();
    let dev_mode = is_dev_mode();
    let http_base_url = std::env::var("APM_HTTP_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| http_base_from_config(&home));
    let http_token = std::env::var("APM_HTTP_TOKEN")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| read_token(&home));
    DesktopContext {
        apm_home: home.to_string_lossy().to_string(),
        dev_mode,
        http_base_url,
        http_token,
    }
}

#[tauri::command]
fn daemon_status() -> DaemonStatus {
    let home = apm_home_dir();
    let base = http_base_from_config(&home)
        .or_else(|| std::env::var("APM_HTTP_URL").ok());
    let Some(base) = base else {
        return DaemonStatus {
            running: false,
            http_reachable: false,
            message: "HTTP API 未配置".to_string(),
        };
    };
    let reachable = check_http_health(&base);
    DaemonStatus {
        running: reachable,
        http_reachable: reachable,
        message: if reachable {
            format!("Daemon 运行中 ({})", base)
        } else {
            "Daemon 未响应".to_string()
        },
    }
}

fn spawn_daemon_process(app: &AppHandle, home: &Path) -> Result<Child, String> {
    let stdout = daemon_log_file(home)?;
    let stderr = stdout.try_clone().map_err(|e| e.to_string())?;
    if let Ok(path) = std::env::var("APM_DAEMON_PATH") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            append_daemon_log(home, &format!("Starting daemon from APM_DAEMON_PATH: {}", trimmed));
            return Command::new(trimmed)
                .env("APM_HOME", home)
                .stdout(Stdio::from(stdout))
                .stderr(Stdio::from(stderr))
                .spawn()
                .map_err(|e| format!("无法启动 APM_DAEMON_PATH 指定的 daemon: {}", e));
        }
    }

    if is_dev_mode() || cfg!(debug_assertions) {
        let repo_root = repo_root_dir();
        let compiled_daemon = repo_root.join("dist").join("src").join("bin").join("apm-daemon.js");
        if compiled_daemon.exists() {
            append_daemon_log(
                home,
                &format!("Starting dev daemon via node: {}", compiled_daemon.display()),
            );
            return Command::new("node")
                .arg(compiled_daemon)
                .current_dir(&repo_root)
                .env("APM_HOME", home)
                .stdout(Stdio::from(stdout))
                .stderr(Stdio::from(stderr))
                .spawn()
                .map_err(|e| format!("无法在开发模式启动已编译 daemon: {}", e));
        }
        append_daemon_log(
            home,
            &format!("Starting dev daemon via npm in {}", repo_root.display()),
        );
        return Command::new("npm")
            .arg("run")
            .arg("dev:daemon")
            .current_dir(&repo_root)
            .env("APM_HOME", home)
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()
            .map_err(|e| format!("无法在开发模式启动 daemon: {}", e));
    }

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("无法定位应用资源目录: {}", e))?;
    let node_path = bundled_node_path(&resource_dir);
    let daemon_bundle = resource_dir.join("daemon").join("apm-daemon.bundle.cjs");
    let daemon_assets = resource_dir.join("daemon").join("assets");

    if !node_path.exists() {
        return Err(format!(
            "内置 Node runtime 不存在: {}。请先运行桌面资源打包脚本。",
            node_path.display()
        ));
    }
    if !daemon_bundle.exists() {
        return Err(format!(
            "内置 daemon bundle 不存在: {}。请先运行桌面资源打包脚本。",
            daemon_bundle.display()
        ));
    }

    append_daemon_log(
        home,
        &format!(
            "Starting bundled daemon. node={}, bundle={}, cwd={}, assets={}, APM_HOME={}",
            node_path.display(),
            daemon_bundle.display(),
            resource_dir.join("daemon").display(),
            daemon_assets.display(),
            home.display()
        ),
    );

    let mut command = Command::new(&node_path);
    command
        .arg(&daemon_bundle)
        .current_dir(resource_dir.join("daemon"))
        .env("APM_HOME", home)
        .env("APM_DAEMON_RUNTIME_DIR", &daemon_assets)
        .env("APM_SEA_RUNTIME_DIR", &daemon_assets)
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
        .spawn()
        .map_err(|e| {
            format!(
                "无法通过内置 Node runtime 启动 daemon: {}。runtime={}, bundle={}",
                e,
                node_path.display(),
                daemon_bundle.display()
            )
        })
}

fn bundled_node_path(resource_dir: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        resource_dir.join("runtime").join("node.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        resource_dir.join("runtime").join("node")
    }
}

fn write_desktop_daemon_pid(home: &Path, child: &Child) -> Result<(), String> {
    fs::write(desktop_daemon_pid_path(home), format!("{}\n", child.id())).map_err(|e| e.to_string())
}

fn clear_desktop_daemon_pid(home: &Path) {
    let _ = fs::remove_file(desktop_daemon_pid_path(home));
}

fn kill_pid(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let status = Command::new("taskkill")
        .arg("/PID")
        .arg(pid.to_string())
        .arg("/T")
        .arg("/F")
        .status()
        .map_err(|e| e.to_string())?;

    #[cfg(not(target_os = "windows"))]
    let status = Command::new("kill")
        .arg("-TERM")
        .arg(pid.to_string())
        .status()
        .map_err(|e| e.to_string())?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("无法停止 daemon 进程 {}", pid))
    }
}

fn stop_managed_daemon(home: &Path, state: &State<DaemonState>) -> Result<DaemonStatus, String> {
    let mut guard = state.child.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
        clear_desktop_daemon_pid(home);
        return Ok(daemon_status());
    }
    drop(guard);

    if let Ok(raw) = fs::read_to_string(desktop_daemon_pid_path(home)) {
        if let Ok(pid) = raw.trim().parse::<u32>() {
            let _ = kill_pid(pid);
        }
        clear_desktop_daemon_pid(home);
    }

    Ok(daemon_status())
}

#[tauri::command]
fn daemon_start(app: AppHandle, state: State<DaemonState>) -> Result<DaemonStatus, String> {
    let home = apm_home_dir();
    ensure_http_enabled(&home)?;

    let mut guard = state.child.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.as_mut() {
        if child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Ok(daemon_status());
        }
        *guard = None;
    }

    if let Some(base) = http_base_from_config(&home) {
        if check_http_health(&base) {
            return Ok(daemon_status());
        }
    }

    append_daemon_log(&home, "Daemon start requested by desktop.");
    let mut sidecar = spawn_daemon_process(&app, &home)?;

    let early_exit_deadline = Instant::now() + Duration::from_millis(900);
    while Instant::now() < early_exit_deadline {
        if let Some(status) = sidecar.try_wait().map_err(|e| e.to_string())? {
            clear_desktop_daemon_pid(&home);
            append_daemon_log(
                &home,
                &format!("Daemon exited during startup with status: {}", status),
            );
            return Err(format!(
                "Daemon 启动后立即退出。请查看日志: {}\n{}",
                desktop_daemon_log_path(&home).display(),
                daemon_log_tail(&home)
            ));
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    write_desktop_daemon_pid(&home, &sidecar)?;
    *guard = Some(sidecar);

    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        if let Some(child) = guard.as_mut() {
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                *guard = None;
                clear_desktop_daemon_pid(&home);
                append_daemon_log(
                    &home,
                    &format!("Daemon exited before HTTP health became reachable: {}", status),
                );
                return Err(format!(
                    "Daemon 未能启动 HTTP 服务并已退出。请查看日志: {}\n{}",
                    desktop_daemon_log_path(&home).display(),
                    daemon_log_tail(&home)
                ));
            }
        }
        if let Some(base) = http_base_from_config(&home) {
            if check_http_health(&base) {
                return Ok(daemon_status());
            }
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    Ok(daemon_status())
}

#[tauri::command]
fn daemon_stop(state: State<DaemonState>) -> Result<DaemonStatus, String> {
    let home = apm_home_dir();
    stop_managed_daemon(&home, &state)
}

#[tauri::command]
fn daemon_restart(app: AppHandle, state: State<DaemonState>) -> Result<DaemonStatus, String> {
    let home = apm_home_dir();
    let _ = stop_managed_daemon(&home, &state);
    daemon_start(app, state)
}

#[tauri::command]
fn open_apm_home() -> Result<(), String> {
    let home = apm_home_dir();
    ensure_apm_dirs(&home)?;
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&home)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&home)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&home)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    if !dst.exists() {
        fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    }
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let dest = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_all(&entry.path(), &dest)?;
        } else {
            fs::copy(entry.path(), dest).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn resolve_apm_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let rel = Path::new(relative_path);
    if rel.is_absolute() {
        return Err("路径必须是 APM_HOME 内的相对路径".to_string());
    }
    for component in rel.components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err("路径不能包含 ..".to_string());
        }
    }
    let home = apm_home_dir();
    Ok(home.join(rel))
}

#[tauri::command]
fn read_apm_text_file(relative_path: String) -> Result<String, String> {
    let path = resolve_apm_relative_path(&relative_path)?;
    fs::read_to_string(&path).map_err(|e| format!("无法读取 {}: {}", relative_path, e))
}

#[tauri::command]
fn write_apm_text_file(relative_path: String, content: String) -> Result<(), String> {
    let path = resolve_apm_relative_path(&relative_path)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, content).map_err(|e| format!("无法写入 {}: {}", relative_path, e))
}

#[tauri::command]
fn rename_apm_file(relative_path: String, new_relative_path: String) -> Result<(), String> {
    let old_path = resolve_apm_relative_path(&relative_path)?;
    let new_path = resolve_apm_relative_path(&new_relative_path)?;
    if new_path.exists() {
        return Err(format!("目标文件已存在: {}", new_relative_path));
    }
    if let Some(parent) = new_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&old_path, &new_path)
        .map_err(|e| format!("无法重命名 {} 到 {}: {}", relative_path, new_relative_path, e))
}

#[tauri::command]
fn delete_apm_file(relative_path: String) -> Result<(), String> {
    let path = resolve_apm_relative_path(&relative_path)?;
    if path.is_dir() {
        return Err("不能删除目录".to_string());
    }
    fs::remove_file(&path).map_err(|e| format!("无法删除 {}: {}", relative_path, e))
}

#[tauri::command]
fn import_minimal_template(app: AppHandle) -> Result<String, String> {
    let home = apm_home_dir();
    ensure_apm_dirs(&home)?;
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?;
    let examples = resource_dir.join("examples").join("minimal");
    let dev_examples = repo_root_dir()
        .join("examples")
        .join("minimal");
    let src = if examples.exists() {
        examples
    } else if dev_examples.exists() {
        dev_examples
    } else {
        return Err("找不到 examples/minimal 模板目录".to_string());
    };
    for sub in ["prompts", "stages", "hosts", "entries"] {
        copy_dir_all(&src.join(sub), &home.join(sub))?;
    }
    Ok(format!("已导入模板到 {}", home.display()))
}

fn update_metadata(update: &Update) -> UpdateMetadata {
    UpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date: update.date.map(|date| date.to_string()),
        body: update.body.clone(),
    }
}

#[tauri::command]
async fn check_for_update(
    app: AppHandle,
    pending_update: State<'_, PendingUpdate>,
) -> Result<Option<UpdateMetadata>, String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    let metadata = update.as_ref().map(update_metadata);
    let mut guard = pending_update.update.lock().map_err(|e| e.to_string())?;
    *guard = update;
    Ok(metadata)
}

#[tauri::command]
async fn install_update(
    pending_update: State<'_, PendingUpdate>,
    on_event: Channel<UpdateDownloadEvent>,
) -> Result<(), String> {
    let update = {
        let mut guard = pending_update.update.lock().map_err(|e| e.to_string())?;
        guard
            .take()
            .ok_or_else(|| "没有可安装的待处理更新，请先检查更新。".to_string())?
    };
    let mut started = false;
    update
        .download_and_install(
            |chunk_length, content_length| {
                if !started {
                    let _ = on_event.send(UpdateDownloadEvent::Started { content_length });
                    started = true;
                }
                let _ = on_event.send(UpdateDownloadEvent::Progress { chunk_length });
            },
            || {
                let _ = on_event.send(UpdateDownloadEvent::Finished);
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn restart_app(app: AppHandle) {
    app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(DaemonState {
            child: Mutex::new(None),
        })
        .manage(PendingUpdate {
            update: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_desktop_context,
            daemon_status,
            daemon_start,
            daemon_stop,
            daemon_restart,
            open_apm_home,
            import_minimal_template,
            read_apm_text_file,
            write_apm_text_file,
            rename_apm_file,
            delete_apm_file,
            check_for_update,
            install_update,
            restart_app,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let state = app.state::<DaemonState>();
            let _ = daemon_start(handle, state);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
