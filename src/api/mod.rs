pub mod dto;
pub mod fidelity;
pub mod makers;
pub mod monitoring;
pub mod wallet;

use std::sync::Arc;

use axum::{extract::State, routing::get, Json, Router};
use tokio::sync::Mutex;
use utoipa::OpenApi;

use crate::{api::dto::MakerStatus, maker_manager::MakerManager};
use dto::{ApiResponse, HealthResponse};

/// Shared application state accessible by all handlers
pub type AppState = Arc<Mutex<MakerManager>>;

#[derive(OpenApi)]
#[openapi(
    info(title = "Maker Dashboard API", version = "0.1.0"),
    paths(
        makers::list_makers,
        makers::create_maker,
        makers::get_maker_count,
        makers::get_maker,
        makers::delete_maker,
        makers::update_config,
        makers::get_maker_info,
        makers::start_maker,
        makers::stop_maker,
        makers::restart_maker,
        wallet::get_balance,
        wallet::get_utxos,
        wallet::get_swap_utxos,
        wallet::get_contract_utxos,
        wallet::get_fidelity_utxos,
        wallet::send_to_address,
        wallet::get_new_address,
        wallet::sync_wallet,
        fidelity::list_fidelity,
        monitoring::get_status,
        monitoring::get_swaps,
        monitoring::get_logs,
        monitoring::get_logs_stream,
        monitoring::get_tor_address,
        monitoring::get_data_dir,
        health_check,
    ),
    components(schemas(
        dto::CreateMakerRequest,
        dto::UpdateMakerConfigRequest,
        dto::SendToAddressRequest,
        dto::MakerInfo,
        dto::MakerInfoDetailed,
        dto::MakerStateDto,
        dto::BalanceInfo,
        dto::UtxoInfo,
        dto::MakerStatus,
        dto::HealthResponse,
    )),
    tags(
        (name = "makers", description = "Maker management"),
        (name = "wallet", description = "Wallet operations"),
        (name = "fidelity", description = "Fidelity bonds"),
        (name = "monitoring", description = "Status and monitoring"),
    )
)]
pub struct ApiDoc;

/// Builds the full `/api` router with all sub-routes
pub fn api_router() -> Router<AppState> {
    Router::new()
        .merge(makers::routes())
        .merge(wallet::routes())
        .merge(fidelity::routes())
        .merge(monitoring::routes())
        .route("/health", get(health_check))
}

/// Check overall API health and liveness of all registered makers
#[utoipa::path(
    get,
    path = "/api/health",
    responses(
        (status = 200, description = "API and maker health status", body = ApiResponse<HealthResponse>),
    )
)]
async fn health_check(State(state): State<AppState>) -> Json<ApiResponse<HealthResponse>> {
    let ids: Vec<String> = state
        .lock()
        .await
        .list_makers()
        .into_iter()
        .cloned()
        .collect();

    let futures: Vec<_> = ids
        .iter()
        .map(|id| {
            let state = state.clone();
            let id = id.clone();
            async move {
                let alive = state.lock().await.ping(&id).await.is_ok();
                let is_server_running = state.lock().await.is_server_running(&id);
                MakerStatus {
                    id,
                    alive,
                    is_server_running,
                }
            }
        })
        .collect();

    let makers = futures::future::join_all(futures).await;

    Json(ApiResponse::ok(HealthResponse {
        status: "ok",
        makers,
    }))
}
