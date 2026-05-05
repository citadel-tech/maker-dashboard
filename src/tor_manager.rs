use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const SOCKS_PORT: u16 = 9050;
const CONTROL_PORT: u16 = 9051;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const DOCKER_DAEMON_TIMEOUT: Duration = Duration::from_secs(60);
const POLL_INTERVAL: Duration = Duration::from_millis(500);

enum TorSource {
    System,
    HostProcess,
    Docker,
}

pub struct TorManager {
    source: TorSource,
    process: Option<std::process::Child>,
    container_id: Option<String>,
}

impl TorManager {
    pub fn detect_or_start(config_dir: &Path) -> anyhow::Result<Self> {
        if port_reachable(SOCKS_PORT) {
            tracing::info!(
                "Tor already running on port {}, using system instance",
                SOCKS_PORT
            );
            return Ok(TorManager {
                source: TorSource::System,
                process: None,
                container_id: None,
            });
        }

        if let Some(binary) = find_binary("tor") {
            tracing::info!(
                "Found tor binary at {}, spawning host process",
                binary.display()
            );
            let child = spawn_host_process(&binary, config_dir)?;
            wait_for_port(SOCKS_PORT)?;
            return Ok(TorManager {
                source: TorSource::HostProcess,
                process: Some(child),
                container_id: None,
            });
        }

        if find_binary("docker").is_some() {
            tracing::info!("Found docker, ensuring daemon is running...");
            ensure_docker_daemon()?;
            tracing::info!("Docker daemon ready, spawning tor container");
            let container_id = spawn_docker()
                .map_err(|e| anyhow::anyhow!("Failed to start tor Docker container: {}", e))?;
            if let Err(e) = wait_for_port(SOCKS_PORT) {
                let _ = std::process::Command::new("docker")
                    .args(["stop", &container_id])
                    .output();
                return Err(e);
            }
            return Ok(TorManager {
                source: TorSource::Docker,
                process: None,
                container_id: Some(container_id),
            });
        }

        Err(anyhow::anyhow!(
            "Tor is not running and could not be started automatically. \
            Install tor (`brew install tor` / `apt install tor`) or Docker."
        ))
    }

    pub fn source_label(&self) -> &'static str {
        match self.source {
            TorSource::System => "system",
            TorSource::HostProcess => "host",
            TorSource::Docker => "docker",
        }
    }
}

impl Drop for TorManager {
    fn drop(&mut self) {
        match self.source {
            TorSource::System => {}
            TorSource::HostProcess => {
                if let Some(ref mut child) = self.process {
                    let _ = child.kill();
                    let _ = child.wait();
                    tracing::info!("Tor process stopped");
                }
            }
            TorSource::Docker => {
                if let Some(ref id) = self.container_id {
                    tracing::info!("Stopping tor Docker container {}", id);
                    let _ = std::process::Command::new("docker")
                        .args(["stop", id])
                        .output();
                }
            }
        }
    }
}

fn port_reachable(port: u16) -> bool {
    let addr: std::net::SocketAddr = ([127, 0, 0, 1], port).into();
    TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT).is_ok()
}

fn find_binary(name: &str) -> Option<PathBuf> {
    if let Ok(output) = std::process::Command::new("which").arg(name).output() {
        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path_str.is_empty() {
                return Some(PathBuf::from(path_str));
            }
        }
    }

    for prefix in ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"] {
        let candidate = PathBuf::from(prefix).join(name);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    None
}

fn spawn_host_process(binary: &Path, config_dir: &Path) -> anyhow::Result<std::process::Child> {
    let tor_dir = config_dir.join("tor");
    let data_dir = tor_dir.join("data");
    std::fs::create_dir_all(&data_dir)?;

    let torrc_path = tor_dir.join("torrc");
    let torrc_content = format!(
        "SocksPort 0.0.0.0:{SOCKS_PORT}\nControlPort 0.0.0.0:{CONTROL_PORT}\nCookieAuthentication 0\nDataDirectory {}\n",
        data_dir.display()
    );
    std::fs::write(&torrc_path, torrc_content)?;

    let child = std::process::Command::new(binary)
        .args([
            "-f",
            torrc_path
                .to_str()
                .ok_or_else(|| anyhow::anyhow!("torrc path is not valid UTF-8"))?,
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()?;

    Ok(child)
}

fn spawn_docker() -> anyhow::Result<String> {
    let cmd = format!(
        "printf 'SocksPort 0.0.0.0:{SOCKS_PORT}\\nControlPort 0.0.0.0:{CONTROL_PORT}\\nCookieAuthentication 0\\nDataDirectory /var/lib/tor\\n' > /tmp/torrc && exec tor -f /tmp/torrc"
    );

    let output = std::process::Command::new("docker")
        .args([
            "run",
            "-d",
            "--rm",
            "-p",
            "9050:9050",
            "-p",
            "9051:9051",
            "--entrypoint",
            "/bin/sh",
            "osminogin/tor-simple",
            "-c",
            &cmd,
        ])
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(anyhow::anyhow!("{}", stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn is_docker_daemon_running() -> bool {
    std::process::Command::new("docker")
        .args(["info"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn ensure_docker_daemon() -> anyhow::Result<()> {
    if is_docker_daemon_running() {
        return Ok(());
    }

    tracing::info!("Docker daemon not running, attempting to start it...");

    // Platform-appropriate start command — ignore errors, we'll poll below
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open")
        .args(["-a", "Docker"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("systemctl")
        .args(["start", "docker"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    let deadline = Instant::now() + DOCKER_DAEMON_TIMEOUT;
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_secs(2));
        if is_docker_daemon_running() {
            tracing::info!("Docker daemon is ready");
            return Ok(());
        }
    }

    Err(anyhow::anyhow!(
        "Docker daemon did not start within {}s. \
        On macOS: open Docker Desktop manually. \
        On Linux: run `sudo systemctl start docker`.",
        DOCKER_DAEMON_TIMEOUT.as_secs()
    ))
}

fn wait_for_port(port: u16) -> anyhow::Result<()> {
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    while Instant::now() < deadline {
        if port_reachable(port) {
            return Ok(());
        }
        std::thread::sleep(POLL_INTERVAL);
    }
    Err(anyhow::anyhow!(
        "Tor did not become reachable on port {} within {:?}",
        port,
        STARTUP_TIMEOUT
    ))
}
