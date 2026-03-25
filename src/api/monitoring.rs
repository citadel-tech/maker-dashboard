use std::convert::Infallible;
use std::fs;
use std::time::Duration;

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderValue, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::get,
    Json, Router,
};
use futures::{stream, StreamExt};
use serde::Deserialize;
use tracing::warn;

use crate::maker_manager::message::MessageResponse;
use crate::utils::log_writer::read_last_n_lines;

use super::{
    dto::{ApiResponse, MakerStatus, RpcStatusInfo, SwapHistoryDto, SwapReportDto, UtxoInfo},
    AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/makers/{id}/status", get(get_status))
        .route("/makers/{id}/swaps", get(get_swaps))
        .route("/makers/{id}/swap-reports", get(get_swap_reports))
        .route("/makers/{id}/logs", get(get_logs))
        .route("/makers/{id}/logs/stream", get(get_logs_stream))
        .route("/makers/{id}/logs/download", get(get_logs_download))
        .route("/makers/{id}/tor-address", get(get_tor_address))
        .route("/makers/{id}/data-dir", get(get_data_dir))
        .route("/makers/{id}/rpc-status", get(get_rpc_status))
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
            Json(ApiResponse::err(format!("Maker '{id}' not found"))),
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

/// List active and completed swaps for a maker.
///
/// - `active`: in-progress incoming swap coins (2-of-2 multisig not yet swept)
/// - `completed`: coins swept from completed incoming swaps
#[utoipa::path(
    get,
    path = "/api/makers/{id}/swaps",
    tag = "monitoring",
    params(("id" = String, Path, description = "Maker ID")),
    responses(
        (status = 200, description = "Swap history", body = ApiResponse<SwapHistoryDto>),
        (status = 404, description = "Maker not found", body = ApiResponse<SwapHistoryDto>)
    )
)]
async fn get_swaps(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<SwapHistoryDto>>) {
    if !state.lock().await.has_maker(&id) {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{id}' not found"))),
        );
    }

    let active = match state.lock().await.get_swap_utxos(&id).await {
        Ok(MessageResponse::SwapUtxoResp { utxos }) => convert_utxos(&id, "active", utxos),
        Ok(other) => {
            warn!(
                "Unexpected active swap UTXO response for maker '{id}': {:?}",
                other
            );
            vec![]
        }
        Err(e) => {
            warn!("Failed to fetch active swap UTXOs for maker '{id}': {e}");
            vec![]
        }
    };

    let completed = match state.lock().await.get_swept_swap_utxos(&id).await {
        Ok(MessageResponse::SweptSwapUtxoResp { utxos }) => convert_utxos(&id, "completed", utxos),
        Ok(other) => {
            warn!(
                "Unexpected completed swap UTXO response for maker '{id}': {:?}",
                other
            );
            vec![]
        }
        Err(e) => {
            warn!("Failed to fetch completed swap UTXOs for maker '{id}': {e}");
            vec![]
        }
    };

    (
        StatusCode::OK,
        Json(ApiResponse::ok(SwapHistoryDto { active, completed })),
    )
}

#[utoipa::path(
    get,
    path = "/api/makers/{id}/swap-reports",
    tag = "monitoring",
    params(("id" = String, Path, description = "Maker ID")),
    responses(
        (status = 200, description = "Swap reports", body = ApiResponse<Vec<SwapReportDto>>),
        (status = 404, description = "Maker not found", body = ApiResponse<Vec<SwapReportDto>>),
        (status = 500, description = "Internal error", body = ApiResponse<Vec<SwapReportDto>>)
    )
)]
async fn get_swap_reports(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<Vec<SwapReportDto>>>) {
    let manager = state.lock().await;
    let Some(config) = manager.get_maker_config(&id).cloned() else {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{id}' not found"))),
        );
    };
    drop(manager);

    let Some(data_dir) = config.data_directory else {
        return (
            StatusCode::OK,
            Json(ApiResponse::ok(Vec::<SwapReportDto>::new())),
        );
    };

    let reports_dir = data_dir.join("swap_reports");

    let result = tokio::task::spawn_blocking(move || load_swap_reports(reports_dir, id)).await;

    match result {
        Ok(Ok(reports)) => (StatusCode::OK, Json(ApiResponse::ok(reports))),
        Ok(Err((status, msg))) => (status, Json(ApiResponse::err(msg))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e.to_string())),
        ),
    }
}

fn load_swap_reports(
    reports_dir: std::path::PathBuf,
    id: String,
) -> Result<Vec<SwapReportDto>, (StatusCode, String)> {
    let entries = match fs::read_dir(&reports_dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to read swap reports: {e}"),
            ))
        }
    };

    let mut reports = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        match fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<SwapReportDto>(&raw).ok())
        {
            Some(report) => reports.push(report),
            None => warn!(
                "Failed to parse swap report for maker '{}' at {}",
                id,
                path.display()
            ),
        }
    }

    reports.sort_by(|a, b| b.end_timestamp.cmp(&a.end_timestamp));
    Ok(reports)
}

fn convert_utxos<T>(id: &str, label: &str, utxos: Vec<T>) -> Vec<UtxoInfo>
where
    T: serde::Serialize,
{
    utxos
        .into_iter()
        .filter_map(|u| match serde_json::to_value(&u) {
            Ok(value) => match serde_json::from_value::<UtxoInfo>(value) {
                Ok(info) => Some(info),
                Err(e) => {
                    warn!("Failed to decode {label} swap UTXO for maker '{id}': {e}");
                    None
                }
            },
            Err(e) => {
                warn!("Failed to serialize {label} swap UTXO for maker '{id}': {e}");
                None
            }
        })
        .collect()
}

/// Get recent log entries for a maker.
#[utoipa::path(
    get,
    path = "/api/makers/{id}/logs",
    tag = "monitoring",
    params(
        ("id" = String, Path, description = "Maker ID"),
        ("lines" = Option<usize>, Query, description = "Number of tail lines (default 100)")
    ),
    responses(
        (status = 200, description = "Log lines", body = ApiResponse<Vec<String>>),
        (status = 404, description = "Maker not found", body = ApiResponse<Vec<String>>),
        (status = 500, description = "Internal error", body = ApiResponse<Vec<String>>)
    )
)]
async fn get_logs(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<LogsQuery>,
) -> (StatusCode, Json<ApiResponse<Vec<String>>>) {
    let manager = state.lock().await;
    if !manager.has_maker(&id) {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{id}' not found"))),
        );
    }

    let log_path = manager.log_file_path(&id);
    drop(manager);

    let n = query.lines.unwrap_or(100);

    match read_last_n_lines(&log_path, n) {
        Ok(lines) => (StatusCode::OK, Json(ApiResponse::ok(lines))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            (StatusCode::OK, Json(ApiResponse::ok(Vec::<String>::new())))
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Failed to read logs: {e}"))),
        ),
    }
}

/// Download the full log file for a maker.
async fn get_logs_download(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let manager = state.lock().await;
    if !manager.has_maker(&id) {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::<()>::err(format!("Maker '{id}' not found"))),
        )
            .into_response();
    }
    let log_path = manager.log_file_path(&id);
    drop(manager);

    // Guard against very large files consuming excessive memory.
    if let Ok(meta) = tokio::fs::metadata(&log_path).await {
        if meta.len() > 100_000_000 {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                Json(ApiResponse::<()>::err(
                    "Log file exceeds 100 MB; access it directly at the path shown in the UI",
                )),
            )
                .into_response();
        }
    }

    match tokio::fs::read(&log_path).await {
        Ok(bytes) => {
            // Sanitize the maker ID so it can't inject characters into the header value.
            let safe_id: String = id
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
                .collect();
            let disposition = format!("attachment; filename=\"maker-{safe_id}.log\"");
            let headers = [
                (
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("text/plain; charset=utf-8"),
                ),
                (
                    header::CONTENT_DISPOSITION,
                    HeaderValue::from_str(&disposition)
                        .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
                ),
            ];
            (StatusCode::OK, headers, bytes).into_response()
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::<()>::err("Log file not found")),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::<()>::err(format!("Failed to read log: {e}"))),
        )
            .into_response(),
    }
}

/// Stream log entries in real-time via Server-Sent Events (like `tail -f`)
#[utoipa::path(
    get,
    path = "/api/makers/{id}/logs/stream",
    tag = "monitoring",
    params(("id" = String, Path, description = "Maker ID")),
    responses(
        (status = 200, description = "SSE stream of log lines",  content_type = "text/event-stream"),
        (status = 404, description = "Maker not found", body = ApiResponse<String>)
    )
)]
async fn get_logs_stream(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<
    Sse<impl futures::Stream<Item = Result<Event, Infallible>>>,
    (StatusCode, Json<ApiResponse<String>>),
> {
    let manager = state.lock().await;
    if !manager.has_maker(&id) {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{id}' not found"))),
        ));
    }
    let log_path = manager.log_file_path(&id);
    drop(manager);

    let initial_len = tokio::fs::metadata(&log_path)
        .await
        .map(|m| m.len())
        .unwrap_or(0);

    let stream = stream::unfold((initial_len, log_path), |(last_pos, path)| async move {
        tokio::time::sleep(Duration::from_millis(500)).await;

        let contents = tokio::fs::read(&path).await.unwrap_or_default();
        let current_len = contents.len() as u64;

        let (events, new_pos): (Vec<Result<Event, Infallible>>, u64) = if current_len < last_pos {
            // File was truncated or rotated — restart from the beginning.
            let events = String::from_utf8_lossy(&contents)
                .lines()
                .map(|line| Ok(Event::default().data(line)))
                .collect();
            (events, current_len)
        } else if current_len > last_pos {
            let new_data = &contents[last_pos as usize..];
            let events = String::from_utf8_lossy(new_data)
                .lines()
                .map(|line| Ok(Event::default().data(line)))
                .collect();
            (events, current_len)
        } else {
            (Vec::new(), last_pos)
        };

        Some((stream::iter(events), (new_pos, path)))
    })
    .flatten();

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

/// Test connectivity to the Bitcoin Core RPC endpoint configured for a maker.
/// Returns node info on success, or `connected: false` if the RPC is unreachable.
/// Works whether the maker is running or stopped.
#[utoipa::path(
    get,
    path = "/api/makers/{id}/rpc-status",
    tag = "monitoring",
    params(("id" = String, Path, description = "Maker ID")),
    responses(
        (status = 200, description = "RPC connection status", body = ApiResponse<RpcStatusInfo>),
        (status = 404, description = "Maker not found", body = ApiResponse<RpcStatusInfo>)
    )
)]
async fn get_rpc_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<RpcStatusInfo>>) {
    let manager = state.lock().await;
    if !manager.has_maker(&id) {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{id}' not found"))),
        );
    }
    let config = match manager.get_config(&id) {
        Some(c) => c,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(ApiResponse::err(format!(
                    "Config for maker '{id}' not found"
                ))),
            )
        }
    };
    drop(manager);

    let result = tokio::task::spawn_blocking(move || {
        use coinswap::bitcoind::bitcoincore_rpc::{Auth, Client, RpcApi};

        let auth = match config.auth {
            Some((user, pass)) => Auth::UserPass(user, pass),
            None => Auth::None,
        };
        let url = format!("http://{}", config.rpc);
        let client = Client::new(&url, auth).map_err(|e| e.to_string())?;
        let chain_info = client.get_blockchain_info().map_err(|e| e.to_string())?;
        let net_info = client.get_network_info().map_err(|e| e.to_string())?;
        Ok::<RpcStatusInfo, String>(RpcStatusInfo {
            connected: true,
            version: Some(net_info.version as u32),
            network: Some(chain_info.chain.to_string()),
            block_height: Some(chain_info.blocks),
            sync_progress: Some(chain_info.verification_progress),
        })
    })
    .await;

    match result {
        Ok(Ok(info)) => (StatusCode::OK, Json(ApiResponse::ok(info))),
        Ok(Err(_)) => (
            StatusCode::OK,
            Json(ApiResponse::ok(RpcStatusInfo {
                connected: false,
                version: None,
                network: None,
                block_height: None,
                sync_progress: None,
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e.to_string())),
        ),
    }
}

#[derive(Deserialize)]
struct LogsQuery {
    lines: Option<usize>,
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
        (status = 500, description = "Internal error", body = ApiResponse<String>)
    )
)]
async fn get_tor_address(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<String>>) {
    if !state.lock().await.has_maker(&id) {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{id}' not found"))),
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
            Json(ApiResponse::err(format!("Unexpected response: {other}"))),
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
            Json(ApiResponse::err(format!("Maker '{id}' not found"))),
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
            Json(ApiResponse::err(format!("Unexpected response: {other}"))),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e.to_string())),
        ),
    }
}
