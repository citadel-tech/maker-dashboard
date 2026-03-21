use std::net::IpAddr;
use std::path::PathBuf;

use clap::Parser;

/// Maker Dashboard — HTTP API server for managing coinswap makers
#[derive(Parser, Debug)]
#[command(
    name = "maker-dashboard",
    version,
    about = "HTTP dashboard for managing coinswap maker nodes",
    long_about = None,
)]
pub struct Cli {
    /// IP address to bind the server to
    #[arg(long, default_value = "127.0.0.1", env = "DASHBOARD_HOST")]
    pub host: IpAddr,

    /// Port to listen on
    #[arg(short, long, default_value_t = 3000, env = "DASHBOARD_PORT")]
    pub port: u16,

    /// Path to the frontend static files directory
    #[arg(
        long,
        default_value = "frontend/build/client",
        env = "DASHBOARD_FRONTEND_PATH"
    )]
    pub frontend_path: PathBuf,

    /// Path to the SPA fallback index.html file
    #[arg(
        long,
        default_value = "frontend/build/client/index.html",
        env = "DASHBOARD_SPA_INDEX"
    )]
    pub spa_index: PathBuf,

    /// Allow requests from non-localhost addresses (disabled by default for security)
    #[arg(long, default_value_t = false, env = "DASHBOARD_ALLOW_REMOTE")]
    pub allow_remote: bool,

    /// Log filter directive (e.g. "debug", "tower_http=debug,info")
    #[arg(
        long,
        default_value = "tower_http=debug,info",
        env = "DASHBOARD_LOG_FILTER"
    )]
    pub log_filter: String,

    /// Disable ANSI colors in log output (useful for log files / CI)
    #[arg(long, default_value_t = false, env = "DASHBOARD_NO_COLOR")]
    pub no_color: bool,

    /// Application config and data directory. Stores maker configs and wallet data.
    #[arg(long, env = "DASHBOARD_CONFIG_DIR")]
    pub config_dir: Option<PathBuf>,
}
