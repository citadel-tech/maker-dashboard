pub mod maker_pool;
pub mod message;
pub mod persistence;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{anyhow, Result};
use coinswap::bitcoind::bitcoincore_rpc::Auth;
use coinswap::maker::{Maker, MakerBehavior, TaprootMaker};
use coinswap::wallet::RPCConfig;
use maker_pool::{MakerHandle as MakerInner, MakerId, MakerPool};
use message::{MessageRequest, MessageResponse};
use persistence::PersistenceManager;

/// Configuration for creating a new maker
#[derive(Debug, Clone)]
pub struct MakerConfig {
    /// Optional data directory. Default: "~/.coinswap/maker"
    pub data_directory: Option<PathBuf>,
    /// Bitcoin Core RPC network address (e.g. "127.0.0.1:38332")
    pub rpc: String,
    /// Bitcoin Core ZMQ address (e.g. "tcp://127.0.0.1:28332")
    pub zmq: String,
    /// Bitcoin Core RPC authentication (username, password).
    /// Must be explicitly provided — no default credentials are assumed.
    pub auth: Option<(String, String)>,
    /// Optional Tor authentication string
    pub tor_auth: Option<String>,
    /// Optional wallet name
    pub wallet_name: Option<String>,
    /// Use experimental Taproot-based coinswap protocol
    pub taproot: bool,
    /// Optional password for wallet encryption
    pub password: Option<String>,
}

impl Default for MakerConfig {
    fn default() -> Self {
        Self {
            data_directory: None,
            rpc: "127.0.0.1:38332".to_string(),
            zmq: "tcp://127.0.0.1:28332".to_string(),
            auth: None,
            tor_auth: None,
            wallet_name: None,
            taproot: false,
            password: None,
        }
    }
}

/// Operational state of a maker
#[derive(Debug, Clone, PartialEq)]
pub enum MakerState {
    Running,
    Stopped,
}

/// Full information about a registered maker
#[derive(Debug, Clone)]
pub struct MakerInfo {
    pub id: MakerId,
    pub state: MakerState,
    pub config: MakerConfig,
}

/// High-level manager for creating and interacting with makers
pub struct MakerManager {
    pool: MakerPool,
    /// Persisted configs keyed by maker ID
    configs: HashMap<MakerId, MakerConfig>,
    /// Handles saving/loading maker state to disk
    persistence: PersistenceManager,
}

impl MakerManager {
    /// Creates a new MakerManager with persistence at the given config directory.
    /// Loads any previously saved maker configs and re-initializes them (but does NOT start servers).
    pub fn new(config_dir: PathBuf) -> Result<Self> {
        let persistence = PersistenceManager::new(config_dir.clone())?;
        let saved_configs = persistence.load()?;

        let mut mgr = Self {
            pool: MakerPool::new(),
            configs: HashMap::new(),
            persistence,
        };

        // Restore previously registered makers (init only, not started)
        for (id, config) in saved_configs {
            tracing::info!("Restoring maker '{}'", id);
            match mgr.create_maker_internal(id.clone(), config, false) {
                Ok(()) => tracing::info!("Maker '{}' restored successfully (stopped)", id),
                Err(e) => {
                    tracing::warn!(
                        "Failed to restore maker '{}': {}. Config retained for manual start.",
                        id,
                        e
                    );
                }
            }
        }

        Ok(mgr)
    }

    /// Returns the default coinswap data directory for a maker.
    /// Defaults to `~/.coinswap/{id}`.
    fn default_maker_data_dir(id: &MakerId) -> PathBuf {
        let home = dirs::home_dir().expect("Failed to determine home directory");
        home.join(".coinswap").join(id)
    }

    /// Internal create_maker that initializes the maker and registers it in the pool.
    /// Does NOT start the coinswap server.
    fn create_maker_internal(
        &mut self,
        id: MakerId,
        config: MakerConfig,
        persist: bool,
    ) -> Result<()> {
        let (user, pass) = config.auth.clone().ok_or_else(|| {
            anyhow!("RPC authentication credentials must be provided in MakerConfig.auth")
        })?;

        let mut config = config;
        if config.data_directory.is_none() {
            let maker_dir = Self::default_maker_data_dir(&id);
            std::fs::create_dir_all(&maker_dir)?;
            config.data_directory = Some(maker_dir);
        }

        let rpc_config = RPCConfig {
            url: config.rpc.clone(),
            auth: Auth::UserPass(user, pass),
            wallet_name: config
                .wallet_name
                .clone()
                .unwrap_or_else(|| "random".to_string()),
        };

        if config.taproot {
            let maker = Arc::new(
                TaprootMaker::init(
                    config.data_directory.clone(),
                    config.wallet_name.clone(),
                    Some(rpc_config),
                    None,
                    None,
                    None,
                    config.tor_auth.clone(),
                    None,
                    config.zmq.clone(),
                    config.password.clone(),
                )
                .map_err(|e| anyhow!("Failed to initialize taproot maker: {:?}", e))?,
            );
            self.pool
                .spawn_maker(id.clone(), MakerInner::Taproot(maker))?;
        } else {
            let maker = Arc::new(
                Maker::init(
                    config.data_directory.clone(),
                    config.wallet_name.clone(),
                    Some(rpc_config),
                    None,
                    None,
                    None,
                    config.tor_auth.clone(),
                    None,
                    MakerBehavior::Normal,
                    config.zmq.clone(),
                    config.password.clone(),
                )
                .map_err(|e| anyhow!("Failed to initialize maker: {:?}", e))?,
            );
            self.pool
                .spawn_maker(id.clone(), MakerInner::Legacy(maker))?;
        }

        self.configs.insert(id, config);
        if persist {
            self.persist();
        }
        Ok(())
    }

    /// Creates and registers a new maker (init + message loop only, NOT started).
    /// Use `start_maker` to start the coinswap server.
    pub fn create_maker(&mut self, id: MakerId, config: MakerConfig) -> Result<()> {
        self.create_maker_internal(id, config, true)
    }

    /// Saves current configs to disk.
    fn persist(&self) {
        if let Err(e) = self.persistence.save(&self.configs) {
            tracing::error!("Failed to persist maker configs: {}", e);
        }
    }

    /// Starts the coinswap server for a registered maker.
    /// The maker must already be created (via `create_maker`).
    pub fn start_maker(&mut self, id: &MakerId) -> Result<(), MakerManagerError> {
        if !self.configs.contains_key(id) {
            return Err(MakerManagerError::NotFound(id.clone()));
        }
        if self.pool.is_server_running(id) {
            return Err(MakerManagerError::AlreadyRunning(id.clone()));
        }
        if !self.pool.contains(id) {
            return Err(MakerManagerError::Other(anyhow!(
                "Maker '{}' is not registered in the pool (needs re-init)",
                id
            )));
        }
        self.pool.start_server(id).map_err(MakerManagerError::Other)
    }

    /// Stops the coinswap server for a running maker.
    /// The maker remains registered — wallet queries still work.
    pub fn stop_maker(&mut self, id: &MakerId) -> Result<(), MakerManagerError> {
        if !self.configs.contains_key(id) {
            return Err(MakerManagerError::NotFound(id.clone()));
        }
        if !self.pool.is_server_running(id) {
            return Err(MakerManagerError::AlreadyStopped(id.clone()));
        }
        self.pool.stop_server(id).map_err(MakerManagerError::Other)
    }

    /// Returns full info (id, state, config) for a maker
    pub fn get_maker_info(&self, id: &MakerId) -> Option<MakerInfo> {
        self.configs.get(id).map(|config| MakerInfo {
            id: id.clone(),
            state: if self.pool.is_server_running(id) {
                MakerState::Running
            } else {
                MakerState::Stopped
            },
            config: config.clone(),
        })
    }

    /// Sends a ping to a maker to check connectivity
    pub async fn ping(&self, id: &MakerId) -> Result<()> {
        match self.request(id, MessageRequest::Ping).await? {
            MessageResponse::Pong => Ok(()),
            MessageResponse::ServerError(e) => Err(anyhow!(e)),
            _ => Err(anyhow!("Unexpected response")),
        }
    }

    /// Gets all UTXOs from a maker's wallet
    pub async fn get_utxos(&self, id: &MakerId) -> Result<MessageResponse> {
        self.request(id, MessageRequest::Utxo).await
    }

    /// Gets swap UTXOs from a maker's wallet
    pub async fn get_swap_utxos(&self, id: &MakerId) -> Result<MessageResponse> {
        self.request(id, MessageRequest::SwapUtxo).await
    }

    /// Gets contract UTXOs from a maker's wallet
    pub async fn get_contract_utxos(&self, id: &MakerId) -> Result<MessageResponse> {
        self.request(id, MessageRequest::ContractUtxo).await
    }

    /// Gets fidelity UTXOs from a maker's wallet
    pub async fn get_fidelity_utxos(&self, id: &MakerId) -> Result<MessageResponse> {
        self.request(id, MessageRequest::FidelityUtxo).await
    }

    /// Gets the balances from a maker's wallet
    pub async fn get_balances(&self, id: &MakerId) -> Result<MessageResponse> {
        self.request(id, MessageRequest::Balances).await
    }

    /// Generates a new address from a maker's wallet
    pub async fn get_new_address(&self, id: &MakerId) -> Result<MessageResponse> {
        self.request(id, MessageRequest::NewAddress).await
    }

    /// Sends funds to an address from a maker's wallet
    pub async fn send_to_address(
        &self,
        id: &MakerId,
        address: String,
        amount: u64,
        feerate: f64,
    ) -> Result<MessageResponse> {
        self.pool
            .request(
                id,
                MessageRequest::SendToAddress {
                    address,
                    amount,
                    feerate,
                },
            )
            .await
    }

    /// Gets the Tor address of a maker
    pub async fn get_tor_address(&self, id: &MakerId) -> Result<MessageResponse> {
        self.request(id, MessageRequest::GetTorAddress).await
    }

    /// Gets the data directory of a maker
    pub async fn get_data_dir(&self, id: &MakerId) -> Result<MessageResponse> {
        self.request(id, MessageRequest::GetDataDir).await
    }

    /// Lists fidelity bonds of a maker
    pub async fn list_fidelity(&self, id: &MakerId) -> Result<MessageResponse> {
        self.request(id, MessageRequest::ListFidelity).await
    }

    /// Syncs a maker's wallet with the blockchain
    pub async fn sync_wallet(&self, id: &MakerId) -> Result<MessageResponse> {
        self.request(id, MessageRequest::SyncWallet).await
    }

    /// Sends a raw request to a maker
    pub async fn request(&self, id: &MakerId, req: MessageRequest) -> Result<MessageResponse> {
        self.pool.request(id, req).await
    }

    /// Updates a maker's configuration.
    /// If the server is running, stops it first, removes the maker, re-creates it, and optionally restarts.
    pub fn update_config(&mut self, id: &MakerId, config: MakerConfig) -> Result<()> {
        let previous = self
            .configs
            .get(id)
            .cloned()
            .ok_or_else(|| anyhow!("Maker with id '{}' not found", id))?;
        let was_running = self.pool.is_server_running(id);

        // If only stopped, we can just update the config without re-init
        // But since config changes may affect wallet/RPC, we re-init
        // Stop server if running
        if was_running {
            let _ = self.pool.stop_server(id);
        }

        // Remove from pool entirely (need to re-init with new config)
        self.pool.remove_maker(id);
        self.configs.remove(id);

        // Re-create with new config
        match self.create_maker_internal(id.clone(), config, true) {
            Ok(()) => {
                // Restart server if it was running before
                if was_running {
                    if let Err(e) = self.pool.start_server(id) {
                        tracing::warn!(
                            "Maker '{}' re-created but failed to restart server: {}",
                            id,
                            e
                        );
                    }
                }
                Ok(())
            }
            Err(e) => {
                // Rollback: restore previous config
                tracing::error!(
                    "Failed to re-create maker '{}' with new config: {}. Rolling back.",
                    id,
                    e
                );
                if let Err(restore_err) = self.create_maker_internal(id.clone(), previous, true) {
                    return Err(anyhow!(
                        "Failed to update maker '{}': {}; rollback also failed: {}",
                        id,
                        e,
                        restore_err
                    ));
                }
                if was_running {
                    let _ = self.pool.start_server(id);
                }
                Err(e)
            }
        }
    }

    /// Checks if a maker exists (registered, regardless of server state)
    pub fn has_maker(&self, id: &MakerId) -> bool {
        self.configs.contains_key(id)
    }

    /// Returns the number of registered makers (running + stopped)
    pub fn maker_count(&self) -> usize {
        self.configs.len()
    }

    /// Returns a list of all registered maker IDs (running + stopped)
    pub fn list_makers(&self) -> Vec<&MakerId> {
        self.configs.keys().collect()
    }

    /// Removes a maker entirely (stops server, removes from pool, deletes config)
    pub fn remove_maker(&mut self, id: &MakerId) -> bool {
        self.pool.remove_maker(id);
        let removed = self.configs.remove(id).is_some();
        if removed {
            self.persist();
        }
        removed
    }

    /// Restarts a maker (stop server + start server)
    pub fn restart_maker(&mut self, id: &MakerId) -> Result<(), MakerManagerError> {
        if !self.configs.contains_key(id) {
            return Err(MakerManagerError::NotFound(id.clone()));
        }
        if self.pool.is_server_running(id) {
            self.pool
                .stop_server(id)
                .map_err(MakerManagerError::Other)?;
        }
        self.pool.start_server(id).map_err(MakerManagerError::Other)
    }

    pub fn is_server_running(&mut self, id: &MakerId) -> bool {
        self.pool.is_server_running(id)
    }

    /// Returns the log file path for a given maker ID.
    pub fn log_file_path(&self, maker_id: &str) -> std::path::PathBuf {
        self.persistence
            .config_dir
            .join("logs")
            .join(format!("maker-{}.log", maker_id))
    }
}

/// Typed errors for MakerManager operations
#[derive(Debug, thiserror::Error)]
pub enum MakerManagerError {
    #[error("Maker '{0}' not found")]
    NotFound(String),
    #[error("Maker '{0}' is already running")]
    AlreadyRunning(String),
    #[error("Maker '{0}' is already stopped")]
    AlreadyStopped(String),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}
