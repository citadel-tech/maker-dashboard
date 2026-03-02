use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};

use crate::maker_manager::message::MessageResponse;

use super::{
    dto::{ApiResponse, MakerStatus},
    AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/makers/{id}/status", get(get_status))
        .route("/makers/{id}/swaps", get(get_swaps))
        .route("/makers/{id}/logs", get(get_logs))
        .route("/makers/{id}/tor-address", get(get_tor_address))
        .route("/makers/{id}/data-dir", get(get_data_dir))
}

/// Get operational status of a maker
#[utoipa::path(
    get,
    path = "/api/makers/{id}/status",
    tag = "monitoring",
    params(("id" = String, Path, description = "Maker ID")),
    responses(
        (status = 200, description = "Maker status", body = ApiResponse<MakerStatus>),
        (status = 404, description = "Maker not found", body = ApiResponse<MakerStatus>)
    )
)]
async fn get_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<MakerStatus>>) {
    if !state.lock().await.has_maker(&id) {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{}' not found", id))),
        );
    }
    let alive = state.lock().await.ping(&id).await.is_ok();
    let is_server_running = state.lock().await.is_server_running(&id);

    (
        StatusCode::OK,
        Json(ApiResponse::ok(MakerStatus {
            id,
            alive,
            is_server_running,
        })),
    )
}

/// List active and recent swaps for a maker. NOT IMPLEMENTED YET!!!
#[utoipa::path(
    get,
    path = "/api/makers/{id}/swaps",
    tag = "monitoring",
    params(("id" = String, Path, description = "Maker ID")),
    responses(
        (status = 404, description = "Maker not found", body = ApiResponse<Vec<String>>),
        (status = 501, description = "Not implemented", body = ApiResponse<Vec<String>>)
    )
)]
async fn get_swaps(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<Vec<String>>>) {
    if !state.lock().await.has_maker(&id) {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{}' not found", id))),
        );
    }
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(ApiResponse::err(
            "Swap history tracking is not yet implemented",
        )),
    )
}

/// Get recent log entries for a maker. NOT IMPLEMENTED YET!!!
#[utoipa::path(
    get,
    path = "/api/makers/{id}/logs",
    tag = "monitoring",
    params(("id" = String, Path, description = "Maker ID")),
    responses(
        (status = 404, description = "Maker not found", body = ApiResponse<Vec<String>>),
        (status = 501, description = "Not implemented", body = ApiResponse<Vec<String>>)
    )
)]
async fn get_logs(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<Vec<String>>>) {
    if !state.lock().await.has_maker(&id) {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{}' not found", id))),
        );
    }
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(ApiResponse::err("Log retrieval is not yet implemented")),
    )
}

/// Get the Tor address of a maker
#[utoipa::path(
    get,
    path = "/api/makers/{id}/tor-address",
    tag = "monitoring",
    params(("id" = String, Path, description = "Maker ID")),
    responses(
        (status = 200, description = "Tor address", body = ApiResponse<String>),
        (status = 404, description = "Maker not found", body = ApiResponse<String>),
        (status = 500, description = "Internal error or not yet implemented", body = ApiResponse<String>)
    )
)]
async fn get_tor_address(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<String>>) {
    if !state.lock().await.has_maker(&id) {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{}' not found", id))),
        );
    }
    match state.lock().await.get_tor_address(&id).await {
        Ok(MessageResponse::GetTorAddressResp(addr)) => {
            (StatusCode::OK, Json(ApiResponse::ok(addr)))
        }
        Ok(MessageResponse::ServerError(e)) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ApiResponse::err(e)))
        }
        Ok(other) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Unexpected response: {}", other))),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e.to_string())),
        ),
    }
}

/// Get the data directory of a maker
#[utoipa::path(
    get,
    path = "/api/makers/{id}/data-dir",
    tag = "monitoring",
    params(("id" = String, Path, description = "Maker ID")),
    responses(
        (status = 200, description = "Data directory path", body = ApiResponse<String>),
        (status = 500, description = "Internal error", body = ApiResponse<String>)
    )
)]
async fn get_data_dir(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<String>>) {
    if !state.lock().await.has_maker(&id) {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{}' not found", id))),
        );
    }
    match state.lock().await.get_data_dir(&id).await {
        Ok(MessageResponse::GetDataDirResp(path)) => (
            StatusCode::OK,
            Json(ApiResponse::ok(path.display().to_string())),
        ),
        Ok(MessageResponse::ServerError(e)) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ApiResponse::err(e)))
        }
        Ok(other) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Unexpected response: {}", other))),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e.to_string())),
        ),
    }
}
