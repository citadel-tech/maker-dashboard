use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use super::maker_pool::MakerId;
use super::MakerConfig;

fn default_network_port() -> u16 {
    6102
}
fn default_rpc_port() -> u16 {
    6103
}
fn default_socks_port() -> u16 {
    9050
}
fn default_control_port() -> u16 {
    9051
}
fn default_min_swap_amount() -> u64 {
    10000
}
fn default_fidelity_amount() -> u64 {
    50000
}
fn default_fidelity_timelock() -> u32 {
    13104
}
fn default_base_fee() -> u64 {
    100
}
fn default_amount_relative_fee_pct() -> f64 {
    0.1
}
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
    #[serde(default = "default_network_port")]
    network_port: u16,
    #[serde(default = "default_rpc_port")]
    rpc_port: u16,
    #[serde(default = "default_socks_port")]
    socks_port: u16,
    #[serde(default = "default_control_port")]
    control_port: u16,
    #[serde(default = "default_min_swap_amount")]
    min_swap_amount: u64,
    #[serde(default = "default_fidelity_amount")]
    fidelity_amount: u64,
    #[serde(default = "default_fidelity_timelock")]
    fidelity_timelock: u32,
    #[serde(default = "default_base_fee")]
    base_fee: u64,
    #[serde(default = "default_amount_relative_fee_pct")]
    amount_relative_fee_pct: f64,
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
            socks_port: c.socks_port,
            control_port: c.control_port,
            min_swap_amount: c.min_swap_amount,
            fidelity_amount: c.fidelity_amount,
            fidelity_timelock: c.fidelity_timelock,
            base_fee: c.base_fee,
            amount_relative_fee_pct: c.amount_relative_fee_pct,
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
            socks_port: s.socks_port,
            control_port: s.control_port,
            min_swap_amount: s.min_swap_amount,
            fidelity_amount: s.fidelity_amount,
            fidelity_timelock: s.fidelity_timelock,
            base_fee: s.base_fee,
            amount_relative_fee_pct: s.amount_relative_fee_pct,
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
