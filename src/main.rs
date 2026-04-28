mod api;
mod auth;
mod cli;
mod maker_manager;
mod middlewares;
mod server;
mod utils;

use clap::Parser;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use cli::Cli;
use server::{Server, ServerConfig};
use utils::log_writer::MakerLogWriter;

#[tokio::main]
async fn main() {
    let args = Cli::parse();

    let config_dir = args
        .config_dir
        .unwrap_or_else(maker_dashboard::utils::default_config_dir);

    let log_writer = MakerLogWriter::new();

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(!args.no_color)
                .with_thread_names(true)
                .with_target(false)
                .with_writer(log_writer),
        )
        .with(tracing_subscriber::EnvFilter::new(&args.log_filter))
        .init();

    let password = match std::env::var("DASHBOARD_PASSWORD") {
        Ok(p) if !p.is_empty() => p,
        _ => match std::env::var("DASHBOARD_PASSWORD_FILE") {
            Ok(path) => match std::fs::read_to_string(&path) {
                Ok(contents) => {
                    let p = contents.trim().to_string();
                    if p.is_empty() {
                        tracing::error!("DASHBOARD_PASSWORD_FILE is empty: {path}");
                        std::process::exit(1);
                    }
                    p
                }
                Err(e) => {
                    tracing::error!("Failed to read DASHBOARD_PASSWORD_FILE ({path}): {e}");
                    std::process::exit(1);
                }
            },
            Err(_) => {
                tracing::error!(
                    "No password set. Set DASHBOARD_PASSWORD or DASHBOARD_PASSWORD_FILE."
                );
                tracing::error!("Example: DASHBOARD_PASSWORD=mysecretpass maker-dashboard");
                std::process::exit(1);
            }
        },
    };

    tracing::info!("Using config directory: {}", config_dir.display());
    let config = ServerConfig {
        host: args.host,
        port: args.port,
        frontend_path: args.frontend_path,
        spa_index: args.spa_index,
        localhost_only: !args.allow_remote,
        config_dir,
        password,
    };

    match Server::new(config) {
        Ok(server) => {
            server
                .run()
                .await
                .unwrap_or_else(|e| tracing::error!("Server error: {}", e));
        }
        Err(e) => {
            tracing::error!("Failed to initialize server: {}", e);
            std::process::exit(1);
        }
    }
}
