use axum::{extract::State, http::StatusCode, routing::get, routing::post, Json, Router};

use crate::maker_manager::MakerConfig;

use super::{
    dto::{ApiResponse, BitcoindStatusInfo, StartBitcoindRequest},
    AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/bitcoind/status", get(get_status))
        .route("/bitcoind/start", post(start))
        .route("/bitcoind/stop", post(stop))
}

/// Try to connect to a bitcoind RPC endpoint using a maker config.
/// Returns the chain name (e.g. "regtest") on success.
fn probe_rpc(config: &MakerConfig) -> Option<String> {
    use coinswap::bitcoind::bitcoincore_rpc::{Auth, Client, RpcApi};

    let auth = match &config.auth {
        Some((u, p)) => Auth::UserPass(u.clone(), p.clone()),
        None => Auth::None,
    };
    let url = format!("http://{}", config.rpc);
    let client = Client::new(&url, auth).ok()?;
    let info = client.get_blockchain_info().ok()?;
    Some(info.chain.to_string())
}

/// Get bitcoind status by probing RPC connectivity via any registered maker's config.
/// Falls back to the dashboard-managed process state if no makers are configured.
#[utoipa::path(
    get,
    path = "/api/bitcoind/status",
    tag = "bitcoind",
    responses(
        (status = 200, description = "Bitcoind connectivity status", body = ApiResponse<BitcoindStatusInfo>),
    )
)]
async fn get_status(State(state): State<AppState>) -> Json<ApiResponse<BitcoindStatusInfo>> {
    // Collect maker configs (drop lock before blocking work)
    let configs: Vec<MakerConfig> = {
        let mgr = state.lock().await;
        mgr.list_makers()
            .into_iter()
            .filter_map(|id| mgr.get_config(id))
            .collect()
    };

    // Try each maker's RPC config in a blocking thread
    let result = tokio::task::spawn_blocking(move || {
        for config in &configs {
            if let Some(network) = probe_rpc(config) {
                return Some(network);
            }
        }
        None
    })
    .await
    .unwrap_or(None);

    // Capture managed process state once to avoid TOCTOU between branches
    let (managed, managed_network) = state.lock().await.bitcoind_status();

    if let Some(network) = result {
        // Reachable via maker RPC config — may be an external process, not dashboard-managed
        return Json(ApiResponse::ok(BitcoindStatusInfo {
            running: true,
            network: Some(network),
            managed,
        }));
    }

    // No maker configs or none reachable — fall back to process tracking
    Json(ApiResponse::ok(BitcoindStatusInfo {
        running: managed,
        managed,
        network: managed_network,
    }))
}

/// Start bitcoind in the specified network mode
#[utoipa::path(
    post,
    path = "/api/bitcoind/start",
    tag = "bitcoind",
    request_body = StartBitcoindRequest,
    responses(
        (status = 200, description = "Bitcoind started", body = ApiResponse<BitcoindStatusInfo>),
        (status = 400, description = "Invalid request or already running", body = ApiResponse<BitcoindStatusInfo>),
    )
)]
async fn start(
    State(state): State<AppState>,
    Json(body): Json<StartBitcoindRequest>,
) -> (StatusCode, Json<ApiResponse<BitcoindStatusInfo>>) {
    let network = body.network.clone();
    match state.lock().await.start_bitcoind(body.network) {
        Ok(()) => (
            StatusCode::OK,
            Json(ApiResponse::ok(BitcoindStatusInfo {
                running: true,
                network: Some(network),
                managed: true,
            })),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::err(e.to_string())),
        ),
    }
}

/// Stop the dashboard-managed bitcoind process
#[utoipa::path(
    post,
    path = "/api/bitcoind/stop",
    tag = "bitcoind",
    responses(
        (status = 200, description = "Bitcoind stopped", body = ApiResponse<BitcoindStatusInfo>),
        (status = 400, description = "Bitcoind is not running", body = ApiResponse<BitcoindStatusInfo>),
    )
)]
async fn stop(
    State(state): State<AppState>,
) -> (StatusCode, Json<ApiResponse<BitcoindStatusInfo>>) {
    // Take the child handle while holding the lock, then release it before blocking.
    let child = state.lock().await.take_bitcoind();
    let Some(mut child) = child else {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::err("bitcoind is not running")),
        );
    };
    // Kill and wait off the async executor so the mutex isn't held during blocking I/O.
    let result = tokio::task::spawn_blocking(move || {
        child
            .kill()
            .map_err(|e| anyhow::anyhow!("Failed to kill bitcoind: {e}"))?;
        child
            .wait()
            .map_err(|e| anyhow::anyhow!("Failed to wait for bitcoind exit: {e}"))
    })
    .await
    .unwrap_or_else(|e| Err(anyhow::anyhow!("spawn_blocking panicked: {e}")));

    match result {
        Ok(_) => (
            StatusCode::OK,
            Json(ApiResponse::ok(BitcoindStatusInfo {
                running: false,
                network: None,
                managed: false,
            })),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::err(e.to_string())),
        ),
    }
}
