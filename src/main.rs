mod api;
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

    let log_dir = config_dir.join("logs");

    let log_writer = MakerLogWriter::new(&log_dir);

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

    tracing::info!("Using config directory: {}", config_dir.display());
    tracing::info!("Maker logs directory: {}", log_dir.display());

    let config = ServerConfig {
        host: args.host,
        port: args.port,
        frontend_path: args.frontend_path,
        spa_index: args.spa_index,
        localhost_only: !args.allow_remote,
        config_dir,
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
