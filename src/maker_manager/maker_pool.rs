use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::str::FromStr;
use std::sync::atomic::Ordering::Relaxed;
use std::sync::{Arc, RwLock};
use std::thread::{self, JoinHandle};

use anyhow::{anyhow, Result};
use coinswap::bitcoin::{Address, Amount};
use coinswap::maker::{start_maker_server, start_maker_server_taproot};
use coinswap::maker::{Maker, TaprootMaker};
use coinswap::utill::UTXO;
use coinswap::wallet::{AddressType, Destination, Wallet};
use tokio::{runtime::Runtime, sync::Mutex};

use super::message::{MessageRequest, MessageResponse};
use crate::utils::bidirectional_channel::{channel, Requester, Responder};

/// Unique identifier for each maker in the pool
pub type MakerId = String;

/// Trait abstracting wallet access across maker types
pub trait MakerWalletAccess: Send + Sync + 'static {
    fn wallet(&self) -> &RwLock<Wallet>;
    fn default_address_type(&self) -> AddressType;
    fn data_dir(&self) -> &std::path::Path;
}

impl MakerWalletAccess for Maker {
    fn wallet(&self) -> &RwLock<Wallet> {
        self.get_wallet()
    }

    fn default_address_type(&self) -> AddressType {
        AddressType::P2WPKH
    }

    fn data_dir(&self) -> &std::path::Path {
        self.get_data_dir()
    }
}

impl MakerWalletAccess for TaprootMaker {
    fn wallet(&self) -> &RwLock<Wallet> {
        self.wallet()
    }

    fn default_address_type(&self) -> AddressType {
        AddressType::P2TR
    }

    fn data_dir(&self) -> &std::path::Path {
        self.data_dir()
    }
}

fn read_tor_address(data_dir: &Path, network_port: u16) -> Result<String> {
    let tor_metadata_path = data_dir.join("tor/hostname");
    let tor_metadata = fs::read(&tor_metadata_path)
        .map_err(|e| anyhow!("Failed to read {}: {e}", tor_metadata_path.display()))?;
    let [_, hostname]: [String; 2] = serde_cbor::from_slice(&tor_metadata)
        .map_err(|e| anyhow!("Failed to decode {}: {e}", tor_metadata_path.display()))?;

    Ok(format!("{hostname}:{network_port}"))
}

/// Unified request handler for any maker implementing `MakerWalletAccess`
fn handle_request(
    maker: &dyn MakerWalletAccess,
    network_port: u16,
    request: MessageRequest,
) -> Result<MessageResponse> {
    let addr_type = maker.default_address_type();

    Ok(match request {
        MessageRequest::Ping => MessageResponse::Pong,
        MessageRequest::Utxo => match maker.wallet().read() {
            Ok(wallet) => MessageResponse::UtxoResp {
                utxos: wallet
                    .list_all_utxo_spend_info()
                    .into_iter()
                    .map(UTXO::from_utxo_data)
                    .collect(),
            },
            Err(e) => MessageResponse::ServerError(e.to_string()),
        },
        MessageRequest::SwapUtxo => match maker.wallet().read() {
            Ok(wallet) => MessageResponse::SwapUtxoResp {
                utxos: wallet
                    .list_incoming_swap_coin_utxo_spend_info()
                    .into_iter()
                    .map(UTXO::from_utxo_data)
                    .collect(),
            },
            Err(e) => MessageResponse::ServerError(e.to_string()),
        },
        MessageRequest::ContractUtxo => match maker.wallet().read() {
            Ok(wallet) => MessageResponse::ContractUtxoResp {
                utxos: wallet
                    .list_live_timelock_contract_spend_info()
                    .into_iter()
                    .map(UTXO::from_utxo_data)
                    .collect(),
            },
            Err(e) => MessageResponse::ServerError(e.to_string()),
        },
        MessageRequest::FidelityUtxo => match maker.wallet().read() {
            Ok(wallet) => MessageResponse::FidelityUtxoResp {
                utxos: wallet
                    .list_fidelity_spend_info()
                    .into_iter()
                    .map(UTXO::from_utxo_data)
                    .collect(),
            },
            Err(e) => MessageResponse::ServerError(e.to_string()),
        },
        MessageRequest::Balances => match maker.wallet().read() {
            Ok(wallet) => match wallet.get_balances() {
                Ok(balances) => MessageResponse::TotalBalanceResp(balances),
                Err(e) => MessageResponse::ServerError(format!("{e:?}")),
            },
            Err(e) => MessageResponse::ServerError(e.to_string()),
        },
        MessageRequest::NewAddress => match maker.wallet().write() {
            Ok(mut wallet) => match wallet.get_next_external_address(addr_type) {
                Ok(addr) => MessageResponse::NewAddressResp(addr.to_string()),
                Err(e) => MessageResponse::ServerError(format!("{e:?}")),
            },
            Err(e) => MessageResponse::ServerError(e.to_string()),
        },
        MessageRequest::SendToAddress {
            address,
            amount,
            feerate,
        } => {
            let amount = Amount::from_sat(amount);
            let addr = match Address::from_str(&address) {
                Ok(a) => a.assume_checked(),
                Err(e) => {
                    return Ok(MessageResponse::ServerError(format!(
                        "Invalid address: {e}"
                    )))
                }
            };
            let destination = Destination::Multi {
                outputs: vec![(addr, amount)],
                op_return_data: None,
                change_address_type: addr_type,
            };
            let coins_to_send = match maker.wallet().read() {
                Ok(wallet) => match wallet.coin_select(amount, feerate, None) {
                    Ok(coins) => coins,
                    Err(e) => {
                        return Ok(MessageResponse::ServerError(format!(
                            "Coin selection failed: {e:?}"
                        )))
                    }
                },
                Err(e) => {
                    return Ok(MessageResponse::ServerError(format!(
                        "Wallet lock failed: {e}"
                    )))
                }
            };
            let tx = match maker.wallet().write() {
                Ok(mut wallet) => {
                    match wallet.spend_from_wallet(feerate, destination, &coins_to_send) {
                        Ok(tx) => tx,
                        Err(e) => {
                            return Ok(MessageResponse::ServerError(format!(
                                "Transaction building failed: {e:?}"
                            )))
                        }
                    }
                }
                Err(e) => {
                    return Ok(MessageResponse::ServerError(format!(
                        "Wallet lock failed: {e}"
                    )))
                }
            };
            let txid = match maker.wallet().read() {
                Ok(wallet) => match wallet.send_tx(&tx) {
                    Ok(txid) => txid,
                    Err(e) => {
                        return Ok(MessageResponse::ServerError(format!(
                            "Broadcast failed: {e:?}"
                        )))
                    }
                },
                Err(e) => {
                    return Ok(MessageResponse::ServerError(format!(
                        "Wallet lock failed: {e}"
                    )))
                }
            };
            match maker.wallet().write() {
                Ok(mut wallet) => {
                    if let Err(e) = wallet.sync_and_save() {
                        return Ok(MessageResponse::ServerError(format!("Sync failed: {e:?}")));
                    }
                }
                Err(e) => {
                    return Ok(MessageResponse::ServerError(format!(
                        "Wallet lock failed: {e}"
                    )));
                }
            }
            MessageResponse::SendToAddressResp(txid.to_string())
        }
        MessageRequest::GetTorAddress => match read_tor_address(maker.data_dir(), network_port) {
            Ok(address) => MessageResponse::GetTorAddressResp(address),
            Err(e) => MessageResponse::ServerError(e.to_string()),
        },
        MessageRequest::GetDataDir => {
            MessageResponse::GetDataDirResp(maker.data_dir().to_path_buf())
        }
        MessageRequest::ListFidelity => match maker.wallet().read() {
            Ok(wallet) => match wallet.display_fidelity_bonds() {
                Ok(bonds) => MessageResponse::ListBonds(bonds),
                Err(e) => MessageResponse::ServerError(e.to_string()),
            },
            Err(e) => MessageResponse::ServerError(e.to_string()),
        },
        MessageRequest::SyncWallet => match maker.wallet().write() {
            Ok(mut wallet) => match wallet.sync_and_save() {
                Ok(_) => MessageResponse::Pong,
                Err(e) => MessageResponse::ServerError(e.to_string()),
            },
            Err(e) => MessageResponse::ServerError(e.to_string()),
        },
        MessageRequest::SweptSwapUtxo => match maker.wallet().read() {
            Ok(wallet) => MessageResponse::SweptSwapUtxoResp {
                utxos: wallet
                    .list_swept_incoming_swap_utxos()
                    .into_iter()
                    .map(UTXO::from_utxo_data)
                    .collect(),
            },
            Err(e) => MessageResponse::ServerError(e.to_string()),
        },
    })
}

/// Wrapper enum to hold either a legacy or taproot maker
pub enum MakerHandle {
    Legacy(Arc<Maker>),
    Taproot(Arc<TaprootMaker>),
}

impl MakerHandle {
    fn as_wallet_access(&self) -> &dyn MakerWalletAccess {
        match self {
            MakerHandle::Legacy(m) => m.as_ref(),
            MakerHandle::Taproot(m) => m.as_ref(),
        }
    }

    /// Sets the shutdown flag to false, allowing the server to run
    fn reset_shutdown(&self) {
        match self {
            MakerHandle::Legacy(m) => m.shutdown.store(false, Relaxed),
            MakerHandle::Taproot(m) => m.shutdown.store(false, Relaxed),
        }
    }

    /// Sets the shutdown flag to true, signaling the server to stop
    fn signal_shutdown(&self) {
        match self {
            MakerHandle::Legacy(m) => m.shutdown.store(true, Relaxed),
            MakerHandle::Taproot(m) => m.shutdown.store(true, Relaxed),
        }
    }

    /// Clones the inner Arc for spawning the server thread
    fn clone_inner(&self) -> MakerHandle {
        match self {
            MakerHandle::Legacy(m) => MakerHandle::Legacy(m.clone()),
            MakerHandle::Taproot(m) => MakerHandle::Taproot(m.clone()),
        }
    }
}

/// Entry representing a single maker running in its own thread
struct MakerEntry {
    inner: MakerHandle,
    network_port: u16,
    responder: Responder<MessageRequest, MessageResponse>,
}

impl MakerEntry {
    /// Creates a new MakerEntry and returns the requester handle for communication
    fn new(
        inner: MakerHandle,
        network_port: u16,
    ) -> (Self, Requester<MessageRequest, MessageResponse>) {
        let (requester, responder) = channel::<MessageRequest, MessageResponse>(100);
        (
            Self {
                inner,
                network_port,
                responder,
            },
            requester,
        )
    }

    /// Starts handling incoming requests in a loop
    async fn run(mut self) {
        while let Some(req) = self.responder.recv().await {
            let resp = handle_request(self.inner.as_wallet_access(), self.network_port, req)
                .unwrap_or_else(|e| MessageResponse::ServerError(e.to_string()));
            if self.responder.send(resp).await.is_err() {
                break;
            }
        }
    }
}

/// Internal handle for a registered maker
struct MakerPoolEntry {
    /// The maker handle (Arc<Maker> or Arc<TaprootMaker>) — persists across start/stop
    maker_handle: MakerHandle,
    /// Requester for sending wallet queries via the message loop
    requester: Mutex<Requester<MessageRequest, MessageResponse>>,
    /// Thread running the message loop (always alive while maker is registered)
    message_thread: Option<JoinHandle<()>>,
    /// Thread running start_maker_server (only when "started")
    server_thread: Option<JoinHandle<()>>,
}

/// Pool managing multiple makers, each running in its own thread
pub struct MakerPool {
    makers: HashMap<MakerId, MakerPoolEntry>,
}

impl MakerPool {
    /// Creates a new empty maker pool
    pub fn new() -> Self {
        Self {
            makers: HashMap::new(),
        }
    }

    /// Registers a new maker in the pool and spawns its message loop thread.
    /// The maker is NOT started (no coinswap server). Call `start_server` separately.
    pub fn spawn_maker(
        &mut self,
        id: MakerId,
        maker: MakerHandle,
        network_port: u16,
    ) -> Result<()> {
        if self.makers.contains_key(&id) {
            return Err(anyhow!("Maker with id '{id}' already exists"));
        }

        let message_maker = maker.clone_inner();
        let (entry, requester) = MakerEntry::new(message_maker, network_port);

        let message_thread = thread::spawn(move || {
            let rt = Runtime::new().expect("Failed to create tokio runtime");
            rt.block_on(entry.run());
        });

        self.makers.insert(
            id,
            MakerPoolEntry {
                maker_handle: maker,
                requester: Mutex::new(requester),
                message_thread: Some(message_thread),
                server_thread: None,
            },
        );

        Ok(())
    }

    /// Starts the coinswap server for a registered maker.
    /// Spawns `start_maker_server` / `start_maker_server_taproot` in a new thread.
    pub fn start_server(&mut self, id: &MakerId) -> Result<()> {
        let entry = self
            .makers
            .get_mut(id)
            .ok_or_else(|| anyhow!("Maker with id '{id}' not found"))?;

        if entry.server_thread.is_some() {
            return Err(anyhow!("Maker '{id}' server is already running"));
        }

        entry.maker_handle.reset_shutdown();

        let server_handle = match &entry.maker_handle {
            MakerHandle::Legacy(maker) => {
                let maker = maker.clone();
                thread::Builder::new()
                    .name(format!("legacy-{id}"))
                    .spawn(move || {
                        if let Err(e) = start_maker_server(maker) {
                            tracing::error!("Maker server error: {:?}", e);
                        }
                    })?
            }
            MakerHandle::Taproot(maker) => {
                let maker = maker.clone();
                thread::Builder::new()
                    .name(format!("taproot-{id}"))
                    .spawn(move || {
                        if let Err(e) = start_maker_server_taproot(maker) {
                            tracing::error!("Taproot maker server error: {:?}", e);
                        }
                    })?
            }
        };

        entry.server_thread = Some(server_handle);
        Ok(())
    }

    /// Stops the coinswap server for a registered maker.
    /// Sets the shutdown flag and joins the server thread.
    /// The maker remains registered — wallet queries still work.
    pub fn stop_server(&mut self, id: &MakerId) -> Result<()> {
        let entry = self
            .makers
            .get_mut(id)
            .ok_or_else(|| anyhow!("Maker with id '{id}' not found"))?;

        let server_thread = entry
            .server_thread
            .take()
            .ok_or_else(|| anyhow!("Maker '{id}' server is not running"))?;

        entry.maker_handle.signal_shutdown();

        server_thread
            .join()
            .map_err(|_| anyhow!("Failed to join server thread for maker '{id}'"))?;

        Ok(())
    }

    /// Returns true if the maker's coinswap server is currently running
    pub fn is_server_running(&self, id: &MakerId) -> bool {
        self.makers
            .get(id)
            .map(|e| e.server_thread.is_some())
            .unwrap_or(false)
    }

    /// Sends a request to a specific maker and returns the response
    pub async fn request(&self, id: &MakerId, req: MessageRequest) -> Result<MessageResponse> {
        let handle = self
            .makers
            .get(id)
            .ok_or_else(|| anyhow!("Maker with id '{id}' not found"))?;

        handle.requester.lock().await.request(req).await
    }

    /// Checks if a maker with the given ID exists in the pool (registered, regardless of server state)
    pub fn contains(&self, id: &MakerId) -> bool {
        self.makers.contains_key(id)
    }

    #[allow(dead_code)]
    /// Returns the number of makers in the pool
    pub fn len(&self) -> usize {
        self.makers.len()
    }

    #[allow(dead_code)]
    /// Returns true if the pool is empty
    pub fn is_empty(&self) -> bool {
        self.makers.is_empty()
    }

    #[allow(dead_code)]
    /// Returns a list of all maker IDs in the pool
    pub fn list_makers(&self) -> Vec<&MakerId> {
        self.makers.keys().collect()
    }

    /// Removes a maker entirely from the pool.
    /// Stops the server first if running, then drops the message channel (stopping the message loop).
    pub fn remove_maker(&mut self, id: &MakerId) {
        if let Some(mut entry) = self.makers.remove(id) {
            if entry.server_thread.is_some() {
                entry.maker_handle.signal_shutdown();
                if let Some(handle) = entry.server_thread.take() {
                    let _ = handle.join();
                }
            }
            // Dropping the entry closes the channel, which will cause the message loop to exit.
            // We can optionally join the message thread.
            if let Some(handle) = entry.message_thread.take() {
                // Drop the requester first to close the channel
                drop(entry.requester);
                let _ = handle.join();
            }
        }
    }
}

impl Default for MakerPool {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::read_tor_address;

    #[test]
    fn reads_tor_hostname_from_maker_data_dir() {
        let temp_dir =
            std::env::temp_dir().join(format!("maker-pool-tor-address-{}", std::process::id()));
        let tor_dir = temp_dir.join("tor");
        std::fs::create_dir_all(&tor_dir).unwrap();
        std::fs::write(
            tor_dir.join("hostname"),
            serde_cbor::to_vec(&[
                "ED25519-V3:private-key".to_string(),
                "maker-example.onion".to_string(),
            ])
            .unwrap(),
        )
        .unwrap();

        let address = read_tor_address(&temp_dir, 6102).unwrap();
        assert_eq!(address, "maker-example.onion:6102");

        std::fs::remove_dir_all(temp_dir).unwrap();
    }
}
