use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

struct DaemonState {
    child: Mutex<Option<Child>>,
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

fn ensure_apm_dirs(home: &Path) -> Result<(), String> {
    for sub in ["prompts", "stages", "hosts", "entries", "state"] {
        fs::create_dir_all(home.join(sub)).map_err(|e| e.to_string())?;
    }
    Ok(())
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
    let http_base_url = if dev_mode {
        std::env::var("APM_HTTP_URL").ok()
    } else {
        http_base_from_config(&home)
    };
    let http_token = if dev_mode {
        std::env::var("APM_HTTP_TOKEN").ok()
    } else {
        read_token(&home)
    };
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

#[tauri::command]
fn daemon_start(state: State<DaemonState>) -> Result<DaemonStatus, String> {
    if is_dev_mode() {
        return Ok(daemon_status());
    }

    let home = apm_home_dir();
    ensure_http_enabled(&home)?;

    let mut guard = state.child.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Ok(daemon_status());
    }

    let sidecar = Command::new("apm-daemon")
        .env("APM_HOME", &home)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("无法启动 apm-daemon: {}", e))?;
    *guard = Some(sidecar);

    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
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
    if is_dev_mode() {
        return Ok(daemon_status());
    }
    let mut guard = state.child.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(daemon_status())
}

#[tauri::command]
fn daemon_restart(state: State<DaemonState>) -> Result<DaemonStatus, String> {
    if is_dev_mode() {
        return Ok(daemon_status());
    }
    {
        let mut guard = state.child.lock().map_err(|e| e.to_string())?;
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    daemon_start(state)
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

#[tauri::command]
fn import_minimal_template(app: AppHandle) -> Result<String, String> {
    let home = apm_home_dir();
    ensure_apm_dirs(&home)?;
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?;
    let examples = resource_dir.join("examples").join("minimal");
    let dev_examples = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .manage(DaemonState {
            child: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_desktop_context,
            daemon_status,
            daemon_start,
            daemon_stop,
            daemon_restart,
            open_apm_home,
            import_minimal_template,
        ])
        .setup(|app| {
            if !is_dev_mode() {
                let state = app.state::<DaemonState>();
                let _ = daemon_start(state);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
