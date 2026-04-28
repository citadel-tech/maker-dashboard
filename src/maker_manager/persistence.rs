use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
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
    10000
}
fn default_fidelity_timelock() -> u32 {
    15000
}
fn default_base_fee() -> u64 {
    1000
}
fn default_amount_relative_fee_pct() -> f64 {
    0.025
}
fn default_time_relative_fee_pct() -> f64 {
    0.001
}
fn default_required_confirms() -> u32 {
    1
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
    #[serde(default = "default_time_relative_fee_pct")]
    time_relative_fee_pct: f64,
    #[serde(default)]
    nostr_relays: Vec<String>,
    #[serde(default = "default_required_confirms")]
    required_confirms: u32,
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
            time_relative_fee_pct: c.time_relative_fee_pct,
            nostr_relays: c.nostr_relays.clone(),
            required_confirms: c.required_confirms,
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
            time_relative_fee_pct: s.time_relative_fee_pct,
            nostr_relays: s.nostr_relays,
            required_confirms: s.required_confirms,
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
    enc_key: Option<[u8; 32]>,
}

impl PersistenceManager {
    /// Creates a new PersistenceManager, ensuring the dashboard config directory exists.
    pub fn new(config_dir: PathBuf, enc_key: Option<[u8; 32]>) -> Result<Self> {
        fs::create_dir_all(&config_dir).with_context(|| {
            format!(
                "Failed to create dashboard config directory: {}",
                config_dir.display()
            )
        })?;

        Ok(Self {
            config_dir,
            enc_key,
        })
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

        let payload: Vec<u8> = if let Some(key) = &self.enc_key {
            let raw = crate::auth::aes_encrypt(key, json.as_bytes())
                .context("Failed to encrypt maker configs")?;
            let b64 = B64.encode(&raw);
            let envelope = serde_json::json!({ "v": 1, "data": b64 });
            serde_json::to_vec(&envelope).context("Failed to serialize encrypted envelope")?
        } else {
            json.into_bytes()
        };

        let path = self.state_file();
        let tmp_path = path.with_extension("tmp");

        // Write to a sibling temp file with restrictive perms applied at
        // creation, fsync, then atomically rename. This avoids both a
        // corrupted file on crash mid-write and a permission window where
        // the file is briefly world-readable.
        let _ = fs::remove_file(&tmp_path);
        {
            use std::io::Write as _;
            let mut opts = fs::OpenOptions::new();
            opts.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                opts.mode(0o600);
            }
            let mut file = opts.open(&tmp_path).with_context(|| {
                format!("Failed to open temp state file: {}", tmp_path.display())
            })?;
            file.write_all(&payload)
                .with_context(|| format!("Failed to write state file: {}", path.display()))?;
            file.sync_all()
                .with_context(|| format!("Failed to fsync state file: {}", tmp_path.display()))?;
        }

        fs::rename(&tmp_path, &path).with_context(|| {
            format!(
                "Failed to atomically rename {} -> {}",
                tmp_path.display(),
                path.display()
            )
        })?;

        Ok(())
    }

    /// Replaces the in-memory encryption key used for subsequent `save()` calls.
    /// Call this after rotating the dashboard password so the next save re-encrypts
    /// makers.json with the new key.
    pub fn update_enc_key(&mut self, new_key: Option<[u8; 32]>) {
        self.enc_key = new_key;
    }

    /// Loads all maker configs from disk. Returns empty map if file doesn't exist.
    pub fn load(&self) -> Result<HashMap<MakerId, MakerConfig>> {
        let path = self.state_file();
        if !path.exists() {
            return Ok(HashMap::new());
        }

        let raw_bytes = fs::read(&path)
            .with_context(|| format!("Failed to read state file: {}", path.display()))?;

        let value: serde_json::Value = serde_json::from_slice(&raw_bytes)
            .with_context(|| format!("Failed to parse state file: {}", path.display()))?;

        if value.get("v") == Some(&serde_json::json!(1)) && value.get("data").is_some() {
            // Encrypted envelope: { "v": 1, "data": "<base64>" }
            let b64_str = value["data"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("makers.json: \"data\" field is not a string"))?;
            let raw = B64
                .decode(b64_str)
                .context("makers.json: failed to base64-decode encrypted data")?;
            let key = self.enc_key.as_ref().ok_or_else(|| {
                anyhow::anyhow!("makers.json is encrypted but no password was provided")
            })?;
            let plaintext =
                crate::auth::aes_decrypt(key, &raw).context("makers.json: decryption failed")?;
            let stored: StoredState = serde_json::from_slice(&plaintext)
                .context("makers.json: failed to parse decrypted content")?;
            Ok(stored
                .makers
                .into_iter()
                .map(|(id, cfg)| (id, MakerConfig::from(cfg)))
                .collect())
        } else if value.get("makers").is_some() {
            // Legacy plaintext format: { "makers": { ... } }
            let stored: StoredState = serde_json::from_value(value)
                .context("makers.json: failed to parse legacy plaintext content")?;
            let configs: HashMap<MakerId, MakerConfig> = stored
                .makers
                .into_iter()
                .map(|(id, cfg)| (id, MakerConfig::from(cfg)))
                .collect();
            if self.enc_key.is_some() {
                self.save(&configs)?;
                tracing::info!("Migrated makers.json to encrypted format");
            }
            Ok(configs)
        } else {
            anyhow::bail!("unrecognized makers.json format")
        }
    }
}
