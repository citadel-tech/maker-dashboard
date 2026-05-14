use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const SOCKS_PORT: u16 = 9050;
const CONTROL_PORT: u16 = 9051;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);
const POLL_INTERVAL: Duration = Duration::from_millis(500);

enum TorSource {
    System,
    HostProcess,
    Embedded,
}

pub struct TorManager {
    source: TorSource,
    process: Option<std::process::Child>,
    _tor_thread: Option<std::thread::JoinHandle<Result<u8, libtor::Error>>>,
}

impl TorManager {
    pub fn noop() -> Self {
        TorManager {
            source: TorSource::System,
            process: None,
            _tor_thread: None,
        }
    }

    pub fn detect_or_start(config_dir: &Path) -> anyhow::Result<Self> {
        tracing::info!(
            "Checking if Tor is already running (SOCKS:{} control:{})",
            SOCKS_PORT,
            CONTROL_PORT
        );
        if port_reachable(SOCKS_PORT) {
            if port_reachable(CONTROL_PORT) {
                tracing::info!(
                    "Tor already running on ports {}/{}, using system instance",
                    SOCKS_PORT,
                    CONTROL_PORT
                );
                return Ok(TorManager {
                    source: TorSource::System,
                    process: None,
                    _tor_thread: None,
                });
            }
            tracing::warn!(
                "SOCKS port {} reachable but control port {} is not; \
                falling through to start a managed instance",
                SOCKS_PORT,
                CONTROL_PORT
            );
        }

        if let Some(binary) = find_binary("tor") {
            tracing::info!("Found system tor at {}", binary.display());
            let child = spawn_host_process(&binary, &config_dir.join("tor"))?;
            wait_for_port(SOCKS_PORT)?;
            return Ok(TorManager {
                source: TorSource::HostProcess,
                process: Some(child),
                _tor_thread: None,
            });
        }

        tracing::info!("Starting embedded Tor");
        let data_dir = config_dir.join("tor").join("data");
        std::fs::create_dir_all(&data_dir)?;

        let handle = libtor::Tor::new()
            .flag(libtor::TorFlag::DataDirectory(
                data_dir.to_string_lossy().into_owned(),
            ))
            .flag(libtor::TorFlag::SocksPort(SOCKS_PORT))
            .flag(libtor::TorFlag::ControlPort(CONTROL_PORT))
            .flag(libtor::TorFlag::CookieAuthentication(
                libtor::TorBool::False,
            ))
            .start_background();

        wait_for_port(SOCKS_PORT)?;
        tracing::info!("Embedded Tor ready");

        Ok(TorManager {
            source: TorSource::Embedded,
            process: None,
            _tor_thread: Some(handle),
        })
    }

    pub fn source_label(&self) -> &'static str {
        match self.source {
            TorSource::System => "system",
            TorSource::HostProcess => "host",
            TorSource::Embedded => "embedded",
        }
    }
}

impl Drop for TorManager {
    fn drop(&mut self) {
        if let TorSource::HostProcess = self.source {
            if let Some(ref mut child) = self.process {
                let _ = child.kill();
                let _ = child.wait();
                tracing::info!("Tor process stopped");
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

fn spawn_host_process(binary: &Path, tor_dir: &Path) -> anyhow::Result<std::process::Child> {
    let data_dir = tor_dir.join("data");
    std::fs::create_dir_all(&data_dir)?;

    let torrc_path = tor_dir.join("torrc");
    let torrc_content = format!(
        "SocksPort 127.0.0.1:{SOCKS_PORT}\nControlPort 127.0.0.1:{CONTROL_PORT}\nCookieAuthentication 0\nDataDirectory {}\n",
        data_dir.display()
    );
    std::fs::write(&torrc_path, &torrc_content)?;

    tracing::info!("Spawning tor: {}", binary.display());

    std::process::Command::new(binary)
        .args([
            "-f",
            torrc_path
                .to_str()
                .ok_or_else(|| anyhow::anyhow!("torrc path is not valid UTF-8"))?,
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(Into::into)
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
