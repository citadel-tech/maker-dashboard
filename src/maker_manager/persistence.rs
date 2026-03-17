use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use super::maker_pool::MakerId;
use super::MakerConfig;

/// On-disk representation of a single maker's config.
#[derive(Debug, Serialize, Deserialize)]
struct StoredMakerConfig {
    data_directory: Option<String>,
    rpc: String,
    zmq: String,
    rpc_user: Option<String>,
    rpc_password: Option<String>,
    tor_auth: Option<String>,
    wallet_name: Option<String>,
    taproot: bool,
    password: Option<String>,
    network_port: Option<u16>,
    rpc_port: Option<u16>,
}

impl From<&MakerConfig> for StoredMakerConfig {
    fn from(c: &MakerConfig) -> Self {
        let (rpc_user, rpc_password) = match &c.auth {
            Some((u, p)) => (Some(u.clone()), Some(p.clone())),
            None => (None, None),
        };
        Self {
            data_directory: c.data_directory.as_ref().map(|p| p.display().to_string()),
            rpc: c.rpc.clone(),
            zmq: c.zmq.clone(),
            rpc_user,
            rpc_password,
            tor_auth: c.tor_auth.clone(),
            wallet_name: c.wallet_name.clone(),
            taproot: c.taproot,
            password: c.password.clone(),
            network_port: c.network_port,
            rpc_port: c.rpc_port,
        }
    }
}

impl From<StoredMakerConfig> for MakerConfig {
    fn from(s: StoredMakerConfig) -> Self {
        Self {
            data_directory: s.data_directory.map(PathBuf::from),
            rpc: s.rpc,
            zmq: s.zmq,
            auth: match (s.rpc_user, s.rpc_password) {
                (Some(u), Some(p)) => Some((u, p)),
                _ => None,
            },
            tor_auth: s.tor_auth,
            wallet_name: s.wallet_name,
            taproot: s.taproot,
            password: s.password,
            network_port: s.network_port,
            rpc_port: s.rpc_port,
        }
    }
}

/// On-disk representation of all maker registrations
#[derive(Debug, Serialize, Deserialize)]
struct StoredState {
    makers: HashMap<MakerId, StoredMakerConfig>,
}

/// Handles persisting maker configurations to disk.
///
/// This only manages the dashboard's own config (e.g. `~/.config/maker-dashboard/makers.json`).
/// Maker wallet/data directories live under `~/.coinswap/` and are managed by coinswap itself.
pub struct PersistenceManager {
    pub config_dir: PathBuf,
}

impl PersistenceManager {
    /// Creates a new PersistenceManager, ensuring the dashboard config directory exists.
    pub fn new(config_dir: PathBuf) -> Result<Self> {
        fs::create_dir_all(&config_dir).with_context(|| {
            format!(
                "Failed to create dashboard config directory: {}",
                config_dir.display()
            )
        })?;

        Ok(Self { config_dir })
    }

    /// Returns the path to the state file
    fn state_file(&self) -> PathBuf {
        self.config_dir.join("makers.json")
    }

    /// Saves all maker configs to disk
    pub fn save(&self, configs: &HashMap<MakerId, MakerConfig>) -> Result<()> {
        let stored = StoredState {
            makers: configs
                .iter()
                .map(|(id, cfg)| (id.clone(), StoredMakerConfig::from(cfg)))
                .collect(),
        };

        let json =
            serde_json::to_string_pretty(&stored).context("Failed to serialize maker configs")?;

        let path = self.state_file();
        fs::write(&path, json)
            .with_context(|| format!("Failed to write state file: {}", path.display()))?;

        Ok(())
    }

    /// Loads all maker configs from disk. Returns empty map if file doesn't exist.
    pub fn load(&self) -> Result<HashMap<MakerId, MakerConfig>> {
        let path = self.state_file();
        if !path.exists() {
            return Ok(HashMap::new());
        }

        let json = fs::read_to_string(&path)
            .with_context(|| format!("Failed to read state file: {}", path.display()))?;

        let stored: StoredState = serde_json::from_str(&json)
            .with_context(|| format!("Failed to parse state file: {}", path.display()))?;

        Ok(stored
            .makers
            .into_iter()
            .map(|(id, cfg)| (id, MakerConfig::from(cfg)))
            .collect())
    }
}
