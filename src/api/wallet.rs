use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use tokio::sync::Mutex;

use super::{
    dto::{ApiResponse, BalanceInfo, SendToAddressRequest, UtxoInfo},
    AppState,
};
use crate::maker_manager::{message::MessageResponse, MakerManager};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/makers/{id}/balance", get(get_balance))
        .route("/makers/{id}/utxos", get(get_utxos))
        .route("/makers/{id}/utxos/swap", get(get_swap_utxos))
        .route("/makers/{id}/utxos/contract", get(get_contract_utxos))
        .route("/makers/{id}/utxos/fidelity", get(get_fidelity_utxos))
        .route("/makers/{id}/send", post(send_to_address))
        .route("/makers/{id}/address", get(get_new_address))
        .route("/makers/{id}/sync", post(sync_wallet))
}

/// Get wallet balances for a maker
#[utoipa::path(
    get,
    path = "/api/makers/{id}/balance",
    tag = "wallet",
    params(("id" = String, Path, description = "Maker ID")),
    responses(
        (status = 200, description = "Wallet balances", body = ApiResponse<BalanceInfo>),
        (status = 500, description = "Internal error", body = ApiResponse<BalanceInfo>)
    )
)]
async fn get_balance(
    State(state): State<Arc<Mutex<MakerManager>>>,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<BalanceInfo>>) {
    if !state.lock().await.has_maker(&id) {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{id}' not found"))),
        );
    }
    match state.lock().await.get_balances(&id).await {
        Ok(MessageResponse::TotalBalanceResp(b)) => (
            StatusCode::OK,
            Json(ApiResponse::ok(BalanceInfo {
                regular: b.regular.to_sat(),
                swap: b.swap.to_sat(),
                contract: b.contract.to_sat(),
                fidelity: b.fidelity.to_sat(),
                spendable: b.spendable.to_sat(),
            })),
        ),
        Ok(MessageResponse::ServerError(e)) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ApiResponse::err(e)))
        }
        Ok(other) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Unexpected response: {other}"))),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e.to_string())),
        ),
    }
}

/// List all UTXOs for a maker
#[utoipa::path(
    get,
    path = "/api/makers/{id}/utxos",
    tag = "wallet",
    params(("id" = String, Path, description = "Maker ID")),
    responses(
        (status = 200, description = "List of UTXOs", body = ApiResponse<Vec<UtxoInfo>>),
        (status = 500, description = "Internal error", body = ApiResponse<Vec<UtxoInfo>>)
    )
)]
async fn get_utxos(
    State(state): State<Arc<Mutex<MakerManager>>>,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<Vec<UtxoInfo>>>) {
    if !state.lock().await.has_maker(&id) {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{id}' not found"))),
        );
    }
    match state.lock().await.get_utxos(&id).await {
        Ok(MessageResponse::UtxoResp { utxos }) => {
            let infos = utxos
                .into_iter()
                .filter_map(|u| {
                    serde_json::to_value(&u)
                        .ok()
                        .and_then(|v| serde_json::from_value(v).ok())
                })
                .collect();
            (StatusCode::OK, Json(ApiResponse::ok(infos)))
        }
        Ok(MessageResponse::ServerError(e)) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ApiResponse::err(e)))
        }
        Ok(other) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Unexpected response: {other}"))),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e.to_string())),
        ),
    }
}

/// Send funds from a maker's wallet
#[utoipa::path(
    post,
    path = "/api/makers/{id}/send",
    tag = "wallet",
    params(("id" = String, Path, description = "Maker ID")),
    request_body = SendToAddressRequest,
    responses(
        (status = 200, description = "Transaction ID", body = ApiResponse<String>),
        (status = 500, description = "Internal error", body = ApiResponse<String>)
    )
)]
async fn send_to_address(
    State(state): State<Arc<Mutex<MakerManager>>>,
    Path(id): Path<String>,
    Json(body): Json<SendToAddressRequest>,
) -> (StatusCode, Json<ApiResponse<String>>) {
    if !state.lock().await.has_maker(&id) {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{id}' not found"))),
        );
    }
    match state
        .lock()
        .await
        .send_to_address(&id, body.address, body.amount, body.feerate)
        .await
    {
        Ok(MessageResponse::SendToAddressResp(txid)) => {
            (StatusCode::OK, Json(ApiResponse::ok(txid)))
        }
        Ok(MessageResponse::ServerError(e)) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ApiResponse::err(e)))
        }
        Ok(other) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Unexpected response: {other}"))),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e.to_string())),
        ),
    }
}

/// Generate a new address for a maker
#[utoipa::path(
    get,
    path = "/api/makers/{id}/address",
    tag = "wallet",
    params(("id" = String, Path, description = "Maker ID")),
    responses(
        (status = 200, description = "New wallet address", body = ApiResponse<String>),
        (status = 500, description = "Internal error", body = ApiResponse<String>)
    )
)]
async fn get_new_address(
    State(state): State<Arc<Mutex<MakerManager>>>,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<String>>) {
    if !state.lock().await.has_maker(&id) {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{id}' not found"))),
        );
    }
    match state.lock().await.get_new_address(&id).await {
        Ok(MessageResponse::NewAddressResp(addr)) => (StatusCode::OK, Json(ApiResponse::ok(addr))),
        Ok(MessageResponse::ServerError(e)) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ApiResponse::err(e)))
        }
        Ok(other) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Unexpected response: {other}"))),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e.to_string())),
        ),
    }
}

/// Trigger a wallet sync for a maker
#[utoipa::path(
    post,
    path = "/api/makers/{id}/sync",
    tag = "wallet",
    params(("id" = String, Path, description = "Maker ID")),
    responses(
        (status = 200, description = "Wallet synced", body = ApiResponse<String>),
        (status = 500, description = "Internal error", body = ApiResponse<String>)
    )
)]
async fn sync_wallet(
    State(state): State<Arc<Mutex<MakerManager>>>,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<String>>) {
    if !state.lock().await.has_maker(&id) {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{id}' not found"))),
        );
    }
    match state.lock().await.sync_wallet(&id).await {
        Ok(MessageResponse::Pong) => (
            StatusCode::OK,
            Json(ApiResponse::ok("Wallet synced".to_string())),
        ),
        Ok(MessageResponse::ServerError(e)) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ApiResponse::err(e)))
        }
        Ok(other) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Unexpected response: {other}"))),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e.to_string())),
        ),
    }
}

/// List swap UTXOs for a maker
#[utoipa::path(
    get,
    path = "/api/makers/{id}/utxos/swap",
    tag = "wallet",
    params(("id" = String, Path, description = "Maker ID")),
    responses(
        (status = 200, description = "Swap UTXOs", body = ApiResponse<Vec<UtxoInfo>>),
        (status = 500, description = "Internal error", body = ApiResponse<Vec<UtxoInfo>>)
    )
)]
async fn get_swap_utxos(
    State(state): State<Arc<Mutex<MakerManager>>>,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<Vec<UtxoInfo>>>) {
    if !state.lock().await.has_maker(&id) {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{id}' not found"))),
        );
    }
    match state.lock().await.get_swap_utxos(&id).await {
        Ok(MessageResponse::SwapUtxoResp { utxos }) => {
            let infos = utxos
                .into_iter()
                .filter_map(|u| {
                    serde_json::to_value(&u)
                        .ok()
                        .and_then(|v| serde_json::from_value(v).ok())
                })
                .collect();
            (StatusCode::OK, Json(ApiResponse::ok(infos)))
        }
        Ok(MessageResponse::ServerError(e)) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ApiResponse::err(e)))
        }
        Ok(other) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Unexpected response: {other}"))),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e.to_string())),
        ),
    }
}

/// List contract UTXOs for a maker
#[utoipa::path(
    get,
    path = "/api/makers/{id}/utxos/contract",
    tag = "wallet",
    params(("id" = String, Path, description = "Maker ID")),
    responses(
        (status = 200, description = "Contract UTXOs", body = ApiResponse<Vec<UtxoInfo>>),
        (status = 500, description = "Internal error", body = ApiResponse<Vec<UtxoInfo>>)
    )
)]
async fn get_contract_utxos(
    State(state): State<Arc<Mutex<MakerManager>>>,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<Vec<UtxoInfo>>>) {
    if !state.lock().await.has_maker(&id) {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{id}' not found"))),
        );
    }
    match state.lock().await.get_contract_utxos(&id).await {
        Ok(MessageResponse::ContractUtxoResp { utxos }) => {
            let infos = utxos
                .into_iter()
                .filter_map(|u| {
                    serde_json::to_value(&u)
                        .ok()
                        .and_then(|v| serde_json::from_value(v).ok())
                })
                .collect();
            (StatusCode::OK, Json(ApiResponse::ok(infos)))
        }
        Ok(MessageResponse::ServerError(e)) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ApiResponse::err(e)))
        }
        Ok(other) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Unexpected response: {other}"))),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e.to_string())),
        ),
    }
}

/// List fidelity UTXOs for a maker
#[utoipa::path(
    get,
    path = "/api/makers/{id}/utxos/fidelity",
    tag = "wallet",
    params(("id" = String, Path, description = "Maker ID")),
    responses(
        (status = 200, description = "Fidelity UTXOs", body = ApiResponse<Vec<UtxoInfo>>),
        (status = 500, description = "Internal error", body = ApiResponse<Vec<UtxoInfo>>)
    )
)]
async fn get_fidelity_utxos(
    State(state): State<Arc<Mutex<MakerManager>>>,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<Vec<UtxoInfo>>>) {
    if !state.lock().await.has_maker(&id) {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{id}' not found"))),
        );
    }
    match state.lock().await.get_fidelity_utxos(&id).await {
        Ok(MessageResponse::FidelityUtxoResp { utxos }) => {
            let infos = utxos
                .into_iter()
                .filter_map(|u| {
                    serde_json::to_value(&u)
                        .ok()
                        .and_then(|v| serde_json::from_value(v).ok())
                })
                .collect();
            (StatusCode::OK, Json(ApiResponse::ok(infos)))
        }
        Ok(MessageResponse::ServerError(e)) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ApiResponse::err(e)))
        }
        Ok(other) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Unexpected response: {other}"))),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e.to_string())),
        ),
    }
}
