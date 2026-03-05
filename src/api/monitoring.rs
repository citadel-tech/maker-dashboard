use std::convert::Infallible;
use std::time::Duration;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
    routing::get,
    Json, Router,
};
use futures::{stream, StreamExt};
use serde::Deserialize;

use crate::maker_manager::message::MessageResponse;
use crate::utils::log_writer::read_last_n_lines;

use super::{
    dto::{ApiResponse, MakerStatus},
    AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/makers/{id}/status", get(get_status))
        .route("/makers/{id}/swaps", get(get_swaps))
        .route("/makers/{id}/logs", get(get_logs))
        .route("/makers/{id}/logs/stream", get(get_logs_stream))
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
            Json(ApiResponse::err(format!("Maker '{}' not found", id))),
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
            Json(ApiResponse::err(format!("Failed to read logs: {}", e))),
        ),
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
            Json(ApiResponse::err(format!("Maker '{}' not found", id))),
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

        let events: Vec<Result<Event, Infallible>> = if current_len > last_pos {
            let new_data = &contents[last_pos as usize..];
            String::from_utf8_lossy(new_data)
                .lines()
                .map(|line| Ok(Event::default().data(line)))
                .collect()
        } else {
            Vec::new()
        };

        let new_pos = current_len.max(last_pos);
        Some((stream::iter(events), (new_pos, path)))
    })
    .flatten();

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
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
