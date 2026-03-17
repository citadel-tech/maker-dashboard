use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use utoipa::ToSchema;

use crate::maker_manager::{MakerConfig, MakerInfo as ManagerMakerInfo, MakerState};

/// Request body for `POST /api/makers`
#[derive(Deserialize, ToSchema)]
pub struct CreateMakerRequest {
    pub id: String,
    pub rpc: Option<String>,
    pub zmq: Option<String>,
    pub rpc_user: Option<String>,
    pub rpc_password: Option<String>,
    pub tor_auth: Option<String>,
    pub wallet_name: Option<String>,
    pub taproot: Option<bool>,
    pub password: Option<String>,
    pub data_directory: Option<String>,
    pub network_port: Option<u16>,
    pub rpc_port: Option<u16>,
}

/// Request body for `PUT /api/makers/{id}/config`
#[derive(Deserialize, ToSchema)]
pub struct UpdateMakerConfigRequest {
    pub rpc: Option<String>,
    pub zmq: Option<String>,
    pub rpc_user: Option<String>,
    pub rpc_password: Option<String>,
    pub tor_auth: Option<String>,
    pub wallet_name: Option<String>,
    pub taproot: Option<bool>,
    pub password: Option<String>,
    pub data_directory: Option<String>,
    pub network_port: Option<u16>,
    pub rpc_port: Option<u16>,
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
            network_port: self.network_port.or(base.network_port),
            rpc_port: self.rpc_port.or(base.rpc_port),
        }
    }
}

/// Request body for `POST /api/makers/{id}/send`
#[derive(Deserialize, ToSchema)]
pub struct SendToAddressRequest {
    pub address: String,
    pub amount: u64,
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
    pub network_port: Option<u16>,
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
            network_port: info.config.network_port,
            data_directory: info.config.data_directory.and_then(|d| {
                if let Ok(path) = d.canonicalize() {
                    return path.to_str().map(str::to_string);
                }
                d.to_str().map(str::to_string)
            }),
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
