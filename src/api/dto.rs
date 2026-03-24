use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use utoipa::ToSchema;

use crate::maker_manager::{MakerConfig, MakerInfo as ManagerMakerInfo, MakerState};

/// Request body for `POST /api/makers`
#[derive(Deserialize, ToSchema)]
pub struct CreateMakerRequest {
    #[schema(example = "maker1")]
    pub id: String,
    #[schema(example = "127.0.0.1:38332")]
    pub rpc: Option<String>,
    #[schema(example = "tcp://127.0.0.1:28332")]
    pub zmq: Option<String>,
    #[schema(example = "user")]
    pub rpc_user: Option<String>,
    #[schema(example = "password")]
    pub rpc_password: Option<String>,
    pub tor_auth: Option<String>,
    #[schema(example = "maker1")]
    pub wallet_name: Option<String>,
    #[schema(example = false)]
    pub taproot: Option<bool>,
    pub password: Option<String>,
    pub data_directory: Option<String>,
    #[schema(example = 6102)]
    pub network_port: Option<u16>,
    #[schema(example = 6103)]
    pub rpc_port: Option<u16>,
    #[schema(example = 9050)]
    pub socks_port: Option<u16>,
    #[schema(example = 9051)]
    pub control_port: Option<u16>,
    #[schema(example = 10000)]
    pub min_swap_amount: Option<u64>,
    #[schema(example = 50000)]
    pub fidelity_amount: Option<u64>,
    #[schema(example = 13104)]
    pub fidelity_timelock: Option<u32>,
    #[schema(example = 100)]
    pub base_fee: Option<u64>,
    #[schema(example = 0.1)]
    pub amount_relative_fee_pct: Option<f64>,
}

/// Request body for `PUT /api/makers/{id}/config`
#[derive(Deserialize, ToSchema)]
pub struct UpdateMakerConfigRequest {
    #[schema(example = "127.0.0.1:38332")]
    pub rpc: Option<String>,
    #[schema(example = "tcp://127.0.0.1:28332")]
    pub zmq: Option<String>,
    #[schema(example = "user")]
    pub rpc_user: Option<String>,
    #[schema(example = "password")]
    pub rpc_password: Option<String>,
    pub tor_auth: Option<String>,
    #[schema(example = "maker1")]
    pub wallet_name: Option<String>,
    #[schema(example = false)]
    pub taproot: Option<bool>,
    pub password: Option<String>,
    pub data_directory: Option<String>,
    #[schema(example = 6102)]
    pub network_port: Option<u16>,
    #[schema(example = 6103)]
    pub rpc_port: Option<u16>,
    #[schema(example = 9050)]
    pub socks_port: Option<u16>,
    #[schema(example = 9051)]
    pub control_port: Option<u16>,
    #[schema(example = 10000)]
    pub min_swap_amount: Option<u64>,
    #[schema(example = 50000)]
    pub fidelity_amount: Option<u64>,
    #[schema(example = 13104)]
    pub fidelity_timelock: Option<u32>,
    #[schema(example = 100)]
    pub base_fee: Option<u64>,
    #[schema(example = 0.1)]
    pub amount_relative_fee_pct: Option<f64>,
}

impl UpdateMakerConfigRequest {
    /// Merges the update request on top of a base `MakerConfig`, overriding only provided fields.
    pub fn apply_to(self, base: MakerConfig) -> MakerConfig {
        MakerConfig {
            data_directory: self
                .data_directory
                .map(PathBuf::from)
                .or(base.data_directory),
            rpc: self.rpc.unwrap_or(base.rpc),
            zmq: self.zmq.unwrap_or(base.zmq),
            auth: match (self.rpc_user, self.rpc_password) {
                (Some(u), Some(p)) => Some((u, p)),
                _ => base.auth,
            },
            tor_auth: self.tor_auth.or(base.tor_auth),
            wallet_name: self.wallet_name.or(base.wallet_name),
            taproot: self.taproot.unwrap_or(base.taproot),
            password: self.password.or(base.password),
            network_port: self.network_port.unwrap_or(base.network_port),
            rpc_port: self.rpc_port.unwrap_or(base.rpc_port),
            socks_port: self.socks_port.unwrap_or(base.socks_port),
            control_port: self.control_port.unwrap_or(base.control_port),
            min_swap_amount: self.min_swap_amount.unwrap_or(base.min_swap_amount),
            fidelity_amount: self.fidelity_amount.unwrap_or(base.fidelity_amount),
            fidelity_timelock: self.fidelity_timelock.unwrap_or(base.fidelity_timelock),
            base_fee: self.base_fee.unwrap_or(base.base_fee),
            amount_relative_fee_pct: self
                .amount_relative_fee_pct
                .unwrap_or(base.amount_relative_fee_pct),
        }
    }
}

/// Request body for `POST /api/makers/{id}/send`
#[derive(Deserialize, ToSchema)]
pub struct SendToAddressRequest {
    #[schema(example = "bcrt1qxyzw0k8a3gp6n9lqz7th0gkc4e5mvetlkgkay")]
    pub address: String,
    #[schema(example = 50000)]
    pub amount: u64,
    #[schema(example = 1.0)]
    pub feerate: f64,
}

/// Generic success / error JSON envelope
#[derive(Debug, Serialize, ToSchema)]
pub struct ApiResponse<T: Serialize> {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl<T: Serialize> ApiResponse<T> {
    pub fn ok(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn err(msg: impl Into<String>) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(msg.into()),
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MakerInfo {
    pub id: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum MakerStateDto {
    Running,
    Stopped,
}

impl From<MakerState> for MakerStateDto {
    fn from(s: MakerState) -> Self {
        match s {
            MakerState::Running => Self::Running,
            MakerState::Stopped => Self::Stopped,
        }
    }
}

/// Detailed maker information including config and state
#[derive(Debug, Serialize, ToSchema)]
pub struct MakerInfoDetailed {
    pub id: String,
    pub state: MakerStateDto,
    pub rpc: String,
    pub zmq: String,
    pub wallet_name: Option<String>,
    pub taproot: bool,
    pub data_directory: Option<String>,
    pub network_port: u16,
    pub rpc_port: u16,
    pub socks_port: u16,
    pub control_port: u16,
    pub min_swap_amount: u64,
    pub fidelity_amount: u64,
    pub fidelity_timelock: u32,
    pub base_fee: u64,
    pub amount_relative_fee_pct: f64,
}

impl From<ManagerMakerInfo> for MakerInfoDetailed {
    fn from(info: ManagerMakerInfo) -> Self {
        Self {
            id: info.id,
            state: info.state.into(),
            rpc: info.config.rpc,
            zmq: info.config.zmq,
            wallet_name: info.config.wallet_name,
            taproot: info.config.taproot,
            data_directory: info.config.data_directory.and_then(|d| {
                if let Ok(path) = d.canonicalize() {
                    return path.to_str().map(str::to_string);
                }
                d.to_str().map(str::to_string)
            }),
            network_port: info.config.network_port,
            rpc_port: info.config.rpc_port,
            socks_port: info.config.socks_port,
            control_port: info.config.control_port,
            min_swap_amount: info.config.min_swap_amount,
            fidelity_amount: info.config.fidelity_amount,
            fidelity_timelock: info.config.fidelity_timelock,
            base_fee: info.config.base_fee,
            amount_relative_fee_pct: info.config.amount_relative_fee_pct,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BalanceInfo {
    pub regular: u64,
    pub swap: u64,
    pub contract: u64,
    pub fidelity: u64,
    pub spendable: u64,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct UtxoInfo {
    pub addr: String,
    pub amount: u64,
    pub confirmations: u32,
    pub utxo_type: String,
}

/// Swap history for a maker: active (in-flight) and completed (swept) swaps
#[derive(Debug, Serialize, ToSchema)]
pub struct SwapHistoryDto {
    /// In-progress incoming swap coins (2-of-2 multisig not yet swept)
    pub active: Vec<UtxoInfo>,
    /// Completed swaps whose coins have been swept to the regular wallet
    pub completed: Vec<UtxoInfo>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MakerStatus {
    pub id: String,
    pub alive: bool,
    pub is_server_running: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HealthResponse {
    pub status: &'static str,
    pub makers: Vec<MakerStatus>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RpcStatusInfo {
    pub connected: bool,
    pub version: Option<u32>,
    pub network: Option<String>,
    pub block_height: Option<u64>,
    pub sync_progress: Option<f64>,
}

/// Request body for `POST /api/bitcoind/start`
#[derive(Debug, Deserialize, ToSchema)]
pub struct StartBitcoindRequest {
    /// Network to run bitcoind on: "regtest" or "signet"
    #[schema(example = "regtest")]
    pub network: String,
}

/// Status of the dashboard-managed bitcoind process
#[derive(Debug, Serialize, ToSchema)]
pub struct BitcoindStatusInfo {
    pub running: bool,
    pub network: Option<String>,
    /// True only when bitcoind was started by the dashboard (and can be stopped via /stop)
    pub managed: bool,
}
