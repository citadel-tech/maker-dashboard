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

fn validate_maker_config(config: &MakerConfig) -> Result<(), String> {
    for (name, port) in [
        ("network_port", config.network_port),
        ("rpc_port", config.rpc_port),
        ("socks_port", config.socks_port),
        ("control_port", config.control_port),
    ] {
        if port == 0 {
            return Err(format!("{name} must be between 1 and 65535"));
        }
    }

    let ports = [
        ("network_port", config.network_port),
        ("rpc_port", config.rpc_port),
        ("socks_port", config.socks_port),
        ("control_port", config.control_port),
    ];
    for i in 0..ports.len() {
        for j in (i + 1)..ports.len() {
            if ports[i].1 == ports[j].1 {
                return Err(format!(
                    "{} and {} cannot use the same port ({})",
                    ports[i].0, ports[j].0, ports[i].1
                ));
            }
        }
    }

    if !(12960..=25920).contains(&config.fidelity_timelock) {
        return Err(format!(
            "fidelity_timelock must be between 12960 and 25920, got {}",
            config.fidelity_timelock
        ));
    }

    if config.min_swap_amount == 0 {
        return Err("min_swap_amount must be greater than 0".to_string());
    }
    if config.fidelity_amount == 0 {
        return Err("fidelity_amount must be greater than 0".to_string());
    }

    Ok(())
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
        password: body.password,
        network_port: body.network_port.unwrap_or(6102),
        rpc_port: body.rpc_port.unwrap_or(6103),
        socks_port: body.socks_port.unwrap_or(9050),
        control_port: body.control_port.unwrap_or(9051),
        min_swap_amount: body.min_swap_amount.unwrap_or(10000),
        fidelity_amount: body.fidelity_amount.unwrap_or(10000),
        fidelity_timelock: body.fidelity_timelock.unwrap_or(15000),
        required_confirms: body.required_confirms.unwrap_or(1),
        base_fee: body.base_fee.unwrap_or(1000),
        amount_relative_fee_pct: body.amount_relative_fee_pct.unwrap_or(0.025),
        time_relative_fee_pct: body.time_relative_fee_pct.unwrap_or(0.001),
        nostr_relays: body.nostr_relays.unwrap_or_default(),
    };

    if let Err(e) = validate_maker_config(&config) {
        return (StatusCode::BAD_REQUEST, Json(ApiResponse::err(e)));
    }

    for (name, port) in [
        ("network_port", config.network_port),
        ("rpc_port", config.rpc_port),
    ] {
        if mgr.is_port_in_use(port, None) {
            return (
                StatusCode::CONFLICT,
                Json(ApiResponse::err(format!(
                    "{name} {port} is already in use by another maker"
                ))),
            );
        }
    }

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
            Json(ApiResponse::err(format!("Maker '{id}' not found"))),
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
            Json(ApiResponse::ok(format!("Maker '{id}' removed"))),
        )
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{id}' not found"))),
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

    let base = match mgr.get_maker_config(&id).cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(ApiResponse::err(format!("Maker '{id}' not found"))),
            )
        }
    };

    let config = body.apply_to(base);

    if let Err(e) = validate_maker_config(&config) {
        return (StatusCode::BAD_REQUEST, Json(ApiResponse::err(e)));
    }

    for (name, port) in [
        ("network_port", config.network_port),
        ("rpc_port", config.rpc_port),
    ] {
        if mgr.is_port_in_use(port, Some(&id)) {
            return (
                StatusCode::CONFLICT,
                Json(ApiResponse::err(format!(
                    "{name} {port} is already in use by another maker"
                ))),
            );
        }
    }

    match mgr.update_config(&id, config) {
        Ok(()) => (
            StatusCode::OK,
            Json(ApiResponse::ok(format!(
                "Maker '{id}' restarted with updated config"
            ))),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!(
                "Failed to update maker '{id}': {e}"
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
            Json(ApiResponse::err(format!("Maker '{id}' not found"))),
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
            Json(ApiResponse::ok(format!("Maker '{id}' started"))),
        ),
        Err(MakerManagerError::NotFound(_)) => (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{id}' not found"))),
        ),
        Err(MakerManagerError::AlreadyRunning(_)) => (
            StatusCode::CONFLICT,
            Json(ApiResponse::err(format!("Maker '{id}' is already running"))),
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
            Json(ApiResponse::ok(format!("Maker '{id}' stopped"))),
        ),
        Err(MakerManagerError::NotFound(_)) => (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{id}' not found"))),
        ),
        Err(MakerManagerError::AlreadyStopped(_)) => (
            StatusCode::CONFLICT,
            Json(ApiResponse::err(format!("Maker '{id}' is already stopped"))),
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
            Json(ApiResponse::ok(format!("Maker '{id}' restarted"))),
        ),
        Err(MakerManagerError::NotFound(_)) => (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{id}' not found"))),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e.to_string())),
        ),
    }
}
