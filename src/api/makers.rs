use std::path::PathBuf;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post, put},
    Json, Router,
};

use super::{
    dto::{
        ApiResponse, CreateMakerRequest, MakerInfo, MakerInfoDetailed, UpdateMakerConfigRequest,
    },
    AppState,
};
use crate::maker_manager::{MakerConfig, MakerManagerError};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/makers", get(list_makers))
        .route("/makers", post(create_maker))
        .route("/makers/count", get(get_maker_count))
        .route("/makers/{id}", get(get_maker))
        .route("/makers/{id}", delete(delete_maker))
        .route("/makers/{id}/config", put(update_config))
        .route("/makers/{id}/info", get(get_maker_info))
        .route("/makers/{id}/start", post(start_maker))
        .route("/makers/{id}/stop", post(stop_maker))
        .route("/makers/{id}/restart", post(restart_maker))
}

/// List all makers
#[utoipa::path(
    get, path = "/api/makers", tag = "makers",
    responses((status = 200, description = "List of all makers", body = ApiResponse<Vec<MakerInfo>>))
)]
async fn list_makers(State(state): State<AppState>) -> Json<ApiResponse<Vec<MakerInfo>>> {
    let mgr = state.lock().await;
    let makers: Vec<MakerInfo> = mgr
        .list_makers()
        .into_iter()
        .map(|id| MakerInfo { id: id.clone() })
        .collect();
    Json(ApiResponse::ok(makers))
}

/// Create a new maker
#[utoipa::path(
    post, path = "/api/makers", tag = "makers",
    request_body = CreateMakerRequest,
    responses(
        (status = 201, description = "Maker created",    body = ApiResponse<MakerInfo>),
        (status = 400, description = "Bad request",      body = ApiResponse<MakerInfo>),
        (status = 409, description = "Already exists",   body = ApiResponse<MakerInfo>),
        (status = 500, description = "Internal error",   body = ApiResponse<MakerInfo>)
    )
)]
async fn create_maker(
    State(state): State<AppState>,
    Json(body): Json<CreateMakerRequest>,
) -> (StatusCode, Json<ApiResponse<MakerInfo>>) {
    let mut mgr = state.lock().await;
    if mgr.has_maker(&body.id) {
        return (
            StatusCode::CONFLICT,
            Json(ApiResponse::err(format!(
                "Maker '{}' already exists",
                body.id
            ))),
        );
    }

    let auth = match (body.rpc_user, body.rpc_password) {
        (Some(u), Some(p)) => Some((u, p)),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ApiResponse::err(
                    "Both rpc_user and rpc_password must be provided together",
                )),
            );
        }
    };

    let config = MakerConfig {
        auth,
        data_directory: body.data_directory.map(PathBuf::from),
        rpc: body.rpc.unwrap_or_else(|| "127.0.0.1:38332".to_string()),
        zmq: body
            .zmq
            .unwrap_or_else(|| "tcp://127.0.0.1:28332".to_string()),
        tor_auth: body.tor_auth,
        wallet_name: body.wallet_name,
        taproot: body.taproot.unwrap_or(false),
        password: body.password,
        network_port: body.network_port,
        rpc_port: body.rpc_port,
    };

    match mgr.create_maker(body.id.clone(), config) {
        Ok(()) => (
            StatusCode::CREATED,
            Json(ApiResponse::ok(MakerInfo { id: body.id })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e.to_string())),
        ),
    }
}

/// Get a specific maker by ID
#[utoipa::path(
    get, path = "/api/makers/{id}", tag = "makers",
    params(("id" = String, Path, description = "Maker ID")),
    responses(
        (status = 200, description = "Maker found",     body = ApiResponse<MakerInfoDetailed>),
        (status = 404, description = "Maker not found", body = ApiResponse<MakerInfoDetailed>)
    )
)]
async fn get_maker(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<MakerInfoDetailed>>) {
    let mgr = state.lock().await;
    if let Some(info) = mgr.get_maker_info(&id) {
        (
            StatusCode::OK,
            Json(ApiResponse::ok(MakerInfoDetailed::from(info))),
        )
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{}' not found", id))),
        )
    }
}

/// Delete a maker by ID
#[utoipa::path(
    delete, path = "/api/makers/{id}", tag = "makers",
    params(("id" = String, Path, description = "Maker ID")),
    responses(
        (status = 200, description = "Maker removed",   body = ApiResponse<String>),
        (status = 404, description = "Maker not found", body = ApiResponse<String>)
    )
)]
async fn delete_maker(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<String>>) {
    let mut mgr = state.lock().await;
    if mgr.remove_maker(&id) {
        (
            StatusCode::OK,
            Json(ApiResponse::ok(format!("Maker '{}' removed", id))),
        )
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{}' not found", id))),
        )
    }
}

/// Update a maker's configuration
#[utoipa::path(
    put, path = "/api/makers/{id}/config", tag = "makers",
    params(("id" = String, Path, description = "Maker ID")),
    request_body = UpdateMakerConfigRequest,
    responses(
        (status = 200, description = "Config updated",  body = ApiResponse<String>),
        (status = 404, description = "Maker not found", body = ApiResponse<String>),
        (status = 500, description = "Internal error",  body = ApiResponse<String>)
    )
)]
async fn update_config(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateMakerConfigRequest>,
) -> (StatusCode, Json<ApiResponse<String>>) {
    let mut mgr = state.lock().await;
    let current_config = match mgr.get_maker_info(&id) {
        Some(info) => info.config,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(ApiResponse::err(format!("Maker '{}' not found", id))),
            );
        }
    };

    let config = body.apply_to(current_config);

    match mgr.update_config(&id, config) {
        Ok(()) => (
            StatusCode::OK,
            Json(ApiResponse::ok(format!(
                "Maker '{}' restarted with updated config",
                id
            ))),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!(
                "Failed to update maker '{}': {}",
                id, e
            ))),
        ),
    }
}

/// Get detailed information about a specific maker
#[utoipa::path(
    get, path = "/api/makers/{id}/info", tag = "makers",
    params(("id" = String, Path, description = "Maker ID")),
    responses(
        (status = 200, description = "Maker details",   body = ApiResponse<MakerInfoDetailed>),
        (status = 404, description = "Maker not found", body = ApiResponse<MakerInfoDetailed>)
    )
)]
async fn get_maker_info(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<MakerInfoDetailed>>) {
    let mgr = state.lock().await;
    match mgr.get_maker_info(&id) {
        Some(info) => (StatusCode::OK, Json(ApiResponse::ok(info.into()))),
        None => (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{}' not found", id))),
        ),
    }
}

/// Get total number of registered makers
#[utoipa::path(
    get, path = "/api/makers/count", tag = "makers",
    responses((status = 200, description = "Total maker count", body = ApiResponse<usize>))
)]
async fn get_maker_count(State(state): State<AppState>) -> Json<ApiResponse<usize>> {
    let mgr = state.lock().await;
    Json(ApiResponse::ok(mgr.maker_count()))
}

/// Start a stopped maker
#[utoipa::path(
    post, path = "/api/makers/{id}/start", tag = "makers",
    params(("id" = String, Path, description = "Maker ID")),
    responses(
        (status = 200, description = "Maker started",          body = ApiResponse<String>),
        (status = 404, description = "Maker not found",        body = ApiResponse<String>),
        (status = 409, description = "Maker already running",  body = ApiResponse<String>),
        (status = 500, description = "Internal error",         body = ApiResponse<String>)
    )
)]
async fn start_maker(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<String>>) {
    let mut mgr = state.lock().await;
    match mgr.start_maker(&id) {
        Ok(()) => (
            StatusCode::OK,
            Json(ApiResponse::ok(format!("Maker '{}' started", id))),
        ),
        Err(MakerManagerError::NotFound(_)) => (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{}' not found", id))),
        ),
        Err(MakerManagerError::AlreadyRunning(_)) => (
            StatusCode::CONFLICT,
            Json(ApiResponse::err(format!(
                "Maker '{}' is already running",
                id
            ))),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e.to_string())),
        ),
    }
}

/// Stop a running maker (retains config for restart)
#[utoipa::path(
    post, path = "/api/makers/{id}/stop", tag = "makers",
    params(("id" = String, Path, description = "Maker ID")),
    responses(
        (status = 200, description = "Maker stopped",          body = ApiResponse<String>),
        (status = 404, description = "Maker not found",        body = ApiResponse<String>),
        (status = 409, description = "Maker already stopped",  body = ApiResponse<String>),
        (status = 500, description = "Internal error",         body = ApiResponse<String>)
    )
)]
async fn stop_maker(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<String>>) {
    let mut mgr = state.lock().await;
    match mgr.stop_maker(&id) {
        Ok(()) => (
            StatusCode::OK,
            Json(ApiResponse::ok(format!("Maker '{}' stopped", id))),
        ),
        Err(MakerManagerError::NotFound(_)) => (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{}' not found", id))),
        ),
        Err(MakerManagerError::AlreadyStopped(_)) => (
            StatusCode::CONFLICT,
            Json(ApiResponse::err(format!(
                "Maker '{}' is already stopped",
                id
            ))),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e.to_string())),
        ),
    }
}

/// Restart a maker (stop + start)
#[utoipa::path(
    post, path = "/api/makers/{id}/restart", tag = "makers",
    params(("id" = String, Path, description = "Maker ID")),
    responses(
        (status = 200, description = "Maker restarted",  body = ApiResponse<String>),
        (status = 404, description = "Maker not found",  body = ApiResponse<String>),
        (status = 500, description = "Internal error",   body = ApiResponse<String>)
    )
)]
async fn restart_maker(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<String>>) {
    let mut mgr = state.lock().await;
    match mgr.restart_maker(&id) {
        Ok(()) => (
            StatusCode::OK,
            Json(ApiResponse::ok(format!("Maker '{}' restarted", id))),
        ),
        Err(MakerManagerError::NotFound(_)) => (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{}' not found", id))),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e.to_string())),
        ),
    }
}
