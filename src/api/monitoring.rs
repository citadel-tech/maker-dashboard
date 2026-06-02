use std::collections::HashMap;
use std::convert::Infallible;
use std::fs;
use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;
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
use tokio::sync::Mutex;
use tracing::warn;

use crate::maker_manager::{message::MessageResponse, MakerManager};
use crate::utils::log_writer::read_last_n_lines;

use super::{
    dto::{
        ApiResponse, CombinedLogLine, MakerStatus, RpcStatusInfo, SwapHistoryDto, SwapReportDto,
        TorStatusInfo, UtxoInfo,
    },
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
        .route("/logs/combined", get(get_combined_logs))
        .route("/tor/status", get(get_tor_status))
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
    State(state): State<Arc<Mutex<MakerManager>>>,
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
    State(state): State<Arc<Mutex<MakerManager>>>,
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
    State(state): State<Arc<Mutex<MakerManager>>>,
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

    let wallet_name = config.wallet_name.unwrap_or_else(|| id.clone());

    let result =
        tokio::task::spawn_blocking(move || load_swap_reports(data_dir, wallet_name, id)).await;

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
    data_dir: PathBuf,
    wallet_name: String,
    id: String,
) -> Result<Vec<SwapReportDto>, (StatusCode, String)> {
    let mut reports = load_wallet_swap_report(&data_dir, &wallet_name, &id)?;
    reports.sort_by_key(|b| std::cmp::Reverse(b.end_timestamp));
    Ok(reports)
}

fn load_wallet_swap_report(
    data_dir: &FsPath,
    wallet_name: &str,
    id: &str,
) -> Result<Vec<SwapReportDto>, (StatusCode, String)> {
    let path = wallet_swap_report_path(data_dir, wallet_name);
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to read swap report: {e}"),
            ))
        }
    };

    let mut report_file = match serde_json::from_str::<WalletSwapReportFile>(&raw) {
        Ok(report_file) => report_file,
        Err(e) => {
            warn!(
                "Failed to parse wallet swap report for maker '{}' at {}: {}",
                id,
                path.display(),
                e
            );
            return Ok(Vec::new());
        }
    };

    Ok(report_file
        .maker
        .remove(id)
        .unwrap_or_default()
        .into_iter()
        .map(SwapReportDto::from)
        .collect())
}

fn wallet_swap_report_path(data_dir: &FsPath, wallet_name: &str) -> PathBuf {
    const REPORT_SUFFIX: &str = "_swap_report.json";

    let wallet_stem = FsPath::new(wallet_name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .unwrap_or(wallet_name);

    data_dir
        .join("wallets")
        .join(format!("{wallet_stem}{REPORT_SUFFIX}"))
}

#[derive(Debug, Deserialize)]
struct WalletSwapReportFile {
    #[serde(default)]
    maker: HashMap<String, Vec<WalletMakerReport>>,
}

#[derive(Debug, Deserialize)]
struct WalletMakerReport {
    swap_id: String,
    status: String,
    network: String,
    swap_duration_seconds: f64,
    start_timestamp: u64,
    end_timestamp: u64,
    incoming_amount: u64,
    outgoing_amount: u64,
    fee_earned: u64,
    incoming_contract_txid: String,
    outgoing_contract_txid: String,
    timelock: u32,
}

impl From<WalletMakerReport> for SwapReportDto {
    fn from(report: WalletMakerReport) -> Self {
        Self {
            swap_id: report.swap_id,
            role: "maker".to_string(),
            status: report.status,
            swap_duration_seconds: report.swap_duration_seconds,
            recovery_duration_seconds: 0.0,
            start_timestamp: report.start_timestamp,
            end_timestamp: report.end_timestamp,
            network: report.network,
            error_message: None,
            incoming_amount: report.incoming_amount,
            outgoing_amount: report.outgoing_amount,
            fee_paid_or_earned: report.fee_earned as i64,
            incoming_contract_txid: Some(report.incoming_contract_txid),
            outgoing_contract_txid: Some(report.outgoing_contract_txid),
            funding_txids: Vec::new(),
            recovery_txids: None,
            timelock: report.timelock.try_into().unwrap_or(u16::MAX),
            makers_count: None,
            maker_addresses: Vec::new(),
            maker_fee_info: Vec::new(),
            total_maker_fees: 0,
            mining_fee: 0,
            fee_percentage: if report.incoming_amount == 0 {
                0.0
            } else {
                (report.fee_earned as f64 / report.incoming_amount as f64) * 100.0
            },
            input_utxos: Vec::new(),
            output_change_amounts: Vec::new(),
            output_swap_amounts: Vec::new(),
            output_change_utxos: Vec::new(),
            output_swap_utxos: Vec::new(),
        }
    }
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
    State(state): State<Arc<Mutex<MakerManager>>>,
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
async fn get_logs_download(
    State(state): State<Arc<Mutex<MakerManager>>>,
    Path(id): Path<String>,
) -> Response {
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
    State(state): State<Arc<Mutex<MakerManager>>>,
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
    State(state): State<Arc<Mutex<MakerManager>>>,
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

/// Get combined log lines from all makers, each tagged with maker_id.
#[utoipa::path(
    get,
    path = "/api/logs/combined",
    tag = "monitoring",
    params(
        ("lines" = Option<usize>, Query, description = "Number of tail lines per maker (default 100)")
    ),
    responses(
        (status = 200, description = "Combined log lines", body = ApiResponse<Vec<CombinedLogLine>>)
    )
)]
async fn get_combined_logs(
    State(state): State<Arc<Mutex<MakerManager>>>,
    Query(query): Query<LogsQuery>,
) -> (StatusCode, Json<ApiResponse<Vec<CombinedLogLine>>>) {
    let n = query.lines.unwrap_or(100);
    let maker_paths: Vec<(String, std::path::PathBuf)> = {
        let manager = state.lock().await;
        manager
            .list_makers()
            .into_iter()
            .map(|id| (id.clone(), manager.log_file_path(id)))
            .collect()
    };
    let mut all_lines: Vec<CombinedLogLine> = Vec::new();
    for (maker_id, path) in maker_paths {
        match read_last_n_lines(&path, n) {
            Ok(lines) => all_lines.extend(lines.into_iter().map(|line| CombinedLogLine {
                maker_id: maker_id.clone(),
                line,
            })),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => warn!("Failed to read logs for maker '{maker_id}': {e}"),
        }
    }
    (StatusCode::OK, Json(ApiResponse::ok(all_lines)))
}

#[derive(Deserialize)]
struct LogsQuery {
    lines: Option<usize>,
}

#[utoipa::path(
    get,
    path = "/api/tor/status",
    tag = "monitoring",
    responses(
        (status = 200, description = "Tor connectivity status", body = ApiResponse<TorStatusInfo>),
    )
)]
pub async fn get_tor_status(State(state): State<AppState>) -> Json<ApiResponse<TorStatusInfo>> {
    let source = state.makers.lock().await.tor_source();
    Json(ApiResponse::ok(TorStatusInfo {
        managed: source != "system",
        source,
    }))
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
    State(state): State<Arc<Mutex<MakerManager>>>,
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
    State(state): State<Arc<Mutex<MakerManager>>>,
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use crate::{
        api::AppState,
        auth::{AuthConfig, SessionStore},
        maker_manager::MakerConfig,
    };

    #[test]
    fn wallet_swap_report_path_uses_wallet_file_stem() {
        let data_dir = PathBuf::from("/tmp/coinswap/maker1");
        assert_eq!(
            wallet_swap_report_path(&data_dir, "maker1.dat"),
            data_dir.join("wallets").join("maker1_swap_report.json")
        );
    }

    #[test]
    fn load_wallet_swap_report_reads_maker_entries() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let data_dir = std::env::temp_dir().join(format!(
            "maker-dashboard-report-test-{}-{nonce}",
            std::process::id()
        ));
        let wallets_dir = data_dir.join("wallets");
        std::fs::create_dir_all(&wallets_dir).unwrap();
        std::fs::write(
            wallets_dir.join("maker1_swap_report.json"),
            r#"{
                "taker": [],
                "maker": {
                    "maker1": [{
                        "swap_id": "swap-1",
                        "status": "Success",
                        "network": "regtest",
                        "swap_duration_seconds": 2.5,
                        "start_timestamp": 10,
                        "end_timestamp": 12,
                        "incoming_amount": 10000,
                        "outgoing_amount": 9800,
                        "fee_earned": 200,
                        "incoming_contract_txid": "in-txid",
                        "outgoing_contract_txid": "out-txid",
                        "timelock": 144
                    }]
                },
                "recovery": [],
                "deniability_proofs": []
            }"#,
        )
        .unwrap();

        let reports = load_wallet_swap_report(&data_dir, "maker1.dat", "maker1").unwrap();
        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0].swap_id, "swap-1");
        assert_eq!(reports[0].role, "maker");
        assert_eq!(reports[0].fee_paid_or_earned, 200);
        assert_eq!(reports[0].timelock, 144);

        std::fs::remove_dir_all(data_dir).unwrap();
    }

    #[tokio::test]
    async fn swap_reports_endpoint_returns_only_requested_maker_reports() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let config_dir = std::env::temp_dir().join(format!(
            "maker-dashboard-api-config-test-{}-{nonce}",
            std::process::id()
        ));
        let data_dir = std::env::temp_dir().join(format!(
            "maker-dashboard-api-report-test-{}-{nonce}",
            std::process::id()
        ));
        let wallets_dir = data_dir.join("wallets");
        std::fs::create_dir_all(&config_dir).unwrap();
        std::fs::create_dir_all(&wallets_dir).unwrap();
        std::fs::write(
            wallets_dir.join("shared-wallet_swap_report.json"),
            r#"{
                "taker": [],
                "maker": {
                    "alpha": [{
                        "swap_id": "alpha-swap",
                        "status": "Success",
                        "network": "regtest",
                        "swap_duration_seconds": 2.5,
                        "start_timestamp": 10,
                        "end_timestamp": 12,
                        "incoming_amount": 10000,
                        "outgoing_amount": 9800,
                        "fee_earned": 200,
                        "incoming_contract_txid": "alpha-in-txid",
                        "outgoing_contract_txid": "alpha-out-txid",
                        "timelock": 144
                    }],
                    "beta": [{
                        "swap_id": "beta-swap",
                        "status": "Success",
                        "network": "regtest",
                        "swap_duration_seconds": 3.5,
                        "start_timestamp": 20,
                        "end_timestamp": 22,
                        "incoming_amount": 20000,
                        "outgoing_amount": 19700,
                        "fee_earned": 300,
                        "incoming_contract_txid": "beta-in-txid",
                        "outgoing_contract_txid": "beta-out-txid",
                        "timelock": 288
                    }]
                },
                "recovery": [],
                "deniability_proofs": []
            }"#,
        )
        .unwrap();

        let mut manager = MakerManager::new_for_testing(config_dir.clone(), None).unwrap();
        for id in ["alpha", "beta"] {
            manager.insert_config_for_testing(
                id.to_string(),
                MakerConfig {
                    data_directory: Some(data_dir.clone()),
                    wallet_name: Some("shared-wallet".to_string()),
                    ..MakerConfig::default()
                },
            );
        }

        let state = AppState {
            makers: Arc::new(Mutex::new(manager)),
            sessions: Arc::new(Mutex::new(SessionStore::new())),
            auth: Arc::new(std::sync::RwLock::new(Some(
                AuthConfig::new("test-password").unwrap(),
            ))),
            setup_lock: Arc::new(Mutex::new(())),
            config_dir: Arc::new(config_dir.clone()),
            secure_cookies: true,
        };
        let app = routes().with_state(state);

        let alpha_body = request_json(app.clone(), "/makers/alpha/swap-reports").await;
        let beta_body = request_json(app, "/makers/beta/swap-reports").await;

        assert_eq!(alpha_body["success"].as_bool(), Some(true));
        assert_eq!(beta_body["success"].as_bool(), Some(true));
        assert_eq!(alpha_body["data"].as_array().unwrap().len(), 1);
        assert_eq!(beta_body["data"].as_array().unwrap().len(), 1);
        assert_eq!(alpha_body["data"][0]["swap_id"], "alpha-swap");
        assert_eq!(beta_body["data"][0]["swap_id"], "beta-swap");

        std::fs::remove_dir_all(data_dir).unwrap();
        std::fs::remove_dir_all(config_dir).unwrap();
    }

    async fn request_json(app: Router, path: &str) -> serde_json::Value {
        let resp = app
            .oneshot(Request::get(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap()
    }
}
