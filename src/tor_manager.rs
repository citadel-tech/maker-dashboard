use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const SOCKS_PORT: u16 = 9050;
const CONTROL_PORT: u16 = 9051;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const POLL_INTERVAL: Duration = Duration::from_millis(500);

// Update this when the Tor Project releases a new stable version.
const TOR_VERSION: &str = "14.0.7";
const TOR_ARCHIVE_BASE: &str = "https://archive.torproject.org/tor-package-archive/torbrowser";

enum TorSource {
    System,
    HostProcess,
    Downloaded,
}

pub struct TorManager {
    source: TorSource,
    process: Option<std::process::Child>,
}

impl TorManager {
    #[allow(dead_code)]
    pub fn noop() -> Self {
        TorManager {
            source: TorSource::System,
            process: None,
        }
    }

    pub fn detect_or_start(config_dir: &Path) -> anyhow::Result<Self> {
        // 1. Already running?
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
                });
            }
            tracing::warn!(
                "SOCKS port {} reachable but control port {} is not; \
                falling through to start a managed instance",
                SOCKS_PORT,
                CONTROL_PORT
            );
        } else {
            tracing::debug!("Tor not running on port {}", SOCKS_PORT);
        }

        // 2. System tor binary on PATH?
        tracing::info!("Searching for tor binary on PATH and known locations");
        if let Some(binary) = find_binary("tor") {
            tracing::info!("Found system tor at {}", binary.display());
            let child = spawn_host_process(&binary, None)?;
            wait_for_port(SOCKS_PORT)?;
            return Ok(TorManager {
                source: TorSource::HostProcess,
                process: Some(child),
            });
        }
        tracing::info!("No system tor binary found");

        // 3. Previously downloaded bundle?
        let bundle_dir = config_dir.join("tor-bundle");
        let bundle_binary = tor_binary_in_bundle(&bundle_dir);
        tracing::info!("Checking for cached bundle at {}", bundle_binary.display());
        if bundle_binary.exists() {
            tracing::info!("Using cached Tor bundle");
            let lib_dir = bundle_binary.parent().map(Path::to_path_buf);
            let child = spawn_host_process(&bundle_binary, lib_dir.as_deref())?;
            wait_for_port(SOCKS_PORT)?;
            return Ok(TorManager {
                source: TorSource::Downloaded,
                process: Some(child),
            });
        }
        tracing::info!("No cached bundle found");

        // 4. Download and extract
        tracing::info!(
            "Downloading Tor Expert Bundle v{} for {}/{}",
            TOR_VERSION,
            std::env::consts::OS,
            std::env::consts::ARCH
        );
        let binary = download_tor_bundle(&bundle_dir)
            .map_err(|e| anyhow::anyhow!("Failed to download Tor Expert Bundle: {}", e))?;
        let lib_dir = binary.parent().map(Path::to_path_buf);
        let child = spawn_host_process(&binary, lib_dir.as_deref())?;
        wait_for_port(SOCKS_PORT)?;
        Ok(TorManager {
            source: TorSource::Downloaded,
            process: Some(child),
        })
    }

    pub fn source_label(&self) -> &'static str {
        match self.source {
            TorSource::System => "system",
            TorSource::HostProcess => "host",
            TorSource::Downloaded => "downloaded",
        }
    }
}

impl Drop for TorManager {
    fn drop(&mut self) {
        match self.source {
            TorSource::System => {}
            TorSource::HostProcess | TorSource::Downloaded => {
                if let Some(ref mut child) = self.process {
                    let _ = child.kill();
                    let _ = child.wait();
                    tracing::info!("Tor process stopped");
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

fn coinswap_tor_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".coinswap")
        .join("tor")
}

fn spawn_host_process(
    binary: &Path,
    lib_dir: Option<&Path>,
) -> anyhow::Result<std::process::Child> {
    let tor_dir = coinswap_tor_dir();
    let data_dir = tor_dir.join("data");
    std::fs::create_dir_all(&data_dir)?;

    let torrc_path = tor_dir.join("torrc");
    let torrc_content = format!(
        "SocksPort 127.0.0.1:{SOCKS_PORT}\nControlPort 127.0.0.1:{CONTROL_PORT}\nCookieAuthentication 0\nDataDirectory {}\n",
        data_dir.display()
    );
    std::fs::write(&torrc_path, &torrc_content)?;

    tracing::info!("Tor config: {}", torrc_path.display());
    tracing::info!("Tor data dir: {}", data_dir.display());
    tracing::debug!("torrc contents:\n{}", torrc_content.trim());

    let mut cmd = std::process::Command::new(binary);
    cmd.args([
        "-f",
        torrc_path
            .to_str()
            .ok_or_else(|| anyhow::anyhow!("torrc path is not valid UTF-8"))?,
    ]);

    if let Some(dir) = lib_dir {
        #[cfg(target_os = "linux")]
        cmd.env("LD_LIBRARY_PATH", dir);
        #[cfg(target_os = "macos")]
        cmd.env("DYLD_LIBRARY_PATH", dir);
    }

    tracing::info!("Spawning tor: {}", binary.display());

    cmd.stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(Into::into)
}

fn tor_binary_in_bundle(bundle_dir: &Path) -> PathBuf {
    let name = if cfg!(windows) { "tor.exe" } else { "tor" };
    bundle_dir.join("tor").join(name)
}

fn download_tor_bundle(bundle_dir: &Path) -> anyhow::Result<PathBuf> {
    let os = match std::env::consts::OS {
        "macos" => "macos",
        "windows" => "windows",
        _ => "linux",
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "aarch64",
        _ => "x86_64",
    };
    let ext = if os == "windows" { "zip" } else { "tar.gz" };
    let filename = format!("tor-expert-bundle-{os}-{arch}-{TOR_VERSION}.{ext}");
    let url = format!("{TOR_ARCHIVE_BASE}/{TOR_VERSION}/{filename}");

    std::fs::create_dir_all(bundle_dir)?;
    let archive_path = bundle_dir.join(&filename);

    tracing::info!("Downloading {}", url);
    let response = ureq::get(&url)
        .call()
        .map_err(|e| anyhow::anyhow!("Download failed: {}", e))?;
    {
        let mut file = std::fs::File::create(&archive_path)?;
        let bytes = std::io::copy(&mut response.into_reader(), &mut file)?;
        tracing::info!("Downloaded {:.1} MB", bytes as f64 / 1_048_576.0);
    }

    let checksum_url = format!("{TOR_ARCHIVE_BASE}/{TOR_VERSION}/sha256sums-unsigned-build.txt");
    match verify_checksum_from_manifest(&checksum_url, &filename, &archive_path) {
        Ok(()) => tracing::info!("SHA256 checksum verified"),
        Err(e) => tracing::warn!("Checksum verification skipped: {}", e),
    }

    extract_archive(&archive_path, bundle_dir)?;
    let _ = std::fs::remove_file(&archive_path);

    let binary = tor_binary_in_bundle(bundle_dir);
    if !binary.exists() {
        return Err(anyhow::anyhow!(
            "Tor binary not found at {} after extraction",
            binary.display()
        ));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755))?;
    }

    // Apple Silicon requires all binaries to be signed; ad-hoc signing works without a certificate.
    #[cfg(target_os = "macos")]
    adhoc_sign_bundle(&binary)?;

    tracing::info!("Tor Expert Bundle ready at {}", binary.display());
    Ok(binary)
}

fn verify_checksum_from_manifest(
    manifest_url: &str,
    filename: &str,
    file_path: &Path,
) -> anyhow::Result<()> {
    let response = ureq::get(manifest_url)
        .call()
        .map_err(|e| anyhow::anyhow!("Could not fetch checksum manifest: {}", e))?;
    let manifest = response.into_string()?;

    let expected_hash = manifest
        .lines()
        .find(|l| l.contains(filename))
        .and_then(|l| l.split_whitespace().next())
        .ok_or_else(|| anyhow::anyhow!("Filename not found in checksum manifest"))?
        .to_string();

    let actual_hash = sha256_of_file(file_path)?;
    if actual_hash.to_lowercase() != expected_hash.to_lowercase() {
        return Err(anyhow::anyhow!(
            "SHA256 mismatch: expected {}, got {}",
            expected_hash,
            actual_hash
        ));
    }
    Ok(())
}

fn sha256_of_file(path: &Path) -> anyhow::Result<String> {
    #[cfg(target_os = "macos")]
    let output = std::process::Command::new("shasum")
        .args(["-a", "256"])
        .arg(path)
        .output()?;

    #[cfg(target_os = "linux")]
    let output = std::process::Command::new("sha256sum").arg(path).output()?;

    #[cfg(target_os = "windows")]
    let output = std::process::Command::new("certutil")
        .args(["-hashfile", path.to_str().unwrap_or(""), "SHA256"])
        .output()?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    #[cfg(target_os = "windows")]
    let hash = stdout.lines().nth(1).unwrap_or("").trim().to_string();
    #[cfg(not(target_os = "windows"))]
    let hash = stdout.split_whitespace().next().unwrap_or("").to_string();

    Ok(hash)
}

fn extract_archive(archive: &Path, dest: &Path) -> anyhow::Result<()> {
    let archive_str = archive
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("archive path is not valid UTF-8"))?;
    let dest_str = dest
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("dest path is not valid UTF-8"))?;

    #[cfg(not(target_os = "windows"))]
    {
        let status = std::process::Command::new("tar")
            .args(["-xzf", archive_str, "-C", dest_str])
            .status()?;
        if !status.success() {
            return Err(anyhow::anyhow!("tar extraction failed"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        let ok = std::process::Command::new("tar")
            .args(["-xf", archive_str, "-C", dest_str])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !ok {
            let ps_cmd = format!(
                "Expand-Archive -Force -Path '{}' -DestinationPath '{}'",
                archive_str, dest_str
            );
            let status = std::process::Command::new("powershell")
                .args(["-Command", &ps_cmd])
                .status()?;
            if !status.success() {
                return Err(anyhow::anyhow!("Failed to extract zip archive"));
            }
        }
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn adhoc_sign_bundle(binary: &Path) -> anyhow::Result<()> {
    let lib_dir = binary
        .parent()
        .ok_or_else(|| anyhow::anyhow!("binary has no parent directory"))?;

    for entry in std::fs::read_dir(lib_dir)? {
        let path = entry?.path();
        if path.extension().map_or(false, |e| e == "dylib") {
            std::process::Command::new("codesign")
                .args(["--force", "--sign", "-"])
                .arg(&path)
                .status()
                .map_err(|e| anyhow::anyhow!("codesign failed for {}: {}", path.display(), e))?;
        }
    }

    let status = std::process::Command::new("codesign")
        .args(["--force", "--sign", "-"])
        .arg(binary)
        .status()
        .map_err(|e| anyhow::anyhow!("codesign failed: {}", e))?;

    if !status.success() {
        return Err(anyhow::anyhow!("codesign exited with {}", status));
    }

    Ok(())
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
