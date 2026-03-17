pub mod bidirectional_channel;
pub mod log_writer;

/// Returns the default config directory for the application: ~/.config/maker-dashboard
pub fn default_config_dir() -> std::path::PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("maker-dashboard")
}
