use std::{
    io::{Read, Write},
    net::{IpAddr, SocketAddr, TcpStream, ToSocketAddrs},
    time::Duration,
};

use axum::{http::StatusCode, routing::post, Json, Router};
use serde_json::json;

use super::{
    dto::{ApiResponse, StartupCheckKind, StartupCheckRequest, StartupCheckResponse},
    AppState,
};

const DEFAULT_RPC_ADDR: &str = "127.0.0.1:38332";
const DEFAULT_RPC_USER: &str = "user";
const DEFAULT_RPC_PASSWORD: &str = "password";
const DEFAULT_ZMQ_ADDR: &str = "tcp://127.0.0.1:28332";
const DEFAULT_TOR_HOST: &str = "127.0.0.1";
const DEFAULT_SOCKS_PORT: u16 = 9050;
const DEFAULT_CONTROL_PORT: u16 = 9051;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);

pub fn routes() -> Router<AppState> {
    Router::new().route("/onboarding/startup-check", post(run_startup_check))
}

#[utoipa::path(
    post,
    path = "/api/onboarding/startup-check",
    tag = "onboarding",
    request_body = StartupCheckRequest,
    responses(
        (status = 200, description = "Startup check result", body = ApiResponse<StartupCheckResponse>),
    )
)]
pub async fn run_startup_check(
    Json(body): Json<StartupCheckRequest>,
) -> (StatusCode, Json<ApiResponse<StartupCheckResponse>>) {
    let check = body.check;
    let result = tokio::task::spawn_blocking(move || run_check(body))
        .await
        .unwrap_or_else(|e| StartupCheckResponse {
            check,
            success: false,
            message: "Startup check crashed".to_string(),
            detail: Some(e.to_string()),
        });

    (StatusCode::OK, Json(ApiResponse::ok(result)))
}

fn run_check(body: StartupCheckRequest) -> StartupCheckResponse {
    let check = body.check;
    match check {
        StartupCheckKind::Bitcoin => check_bitcoin(&body),
        StartupCheckKind::Rpc => check_rpc(&body),
        StartupCheckKind::Rest => check_rest(&body),
        StartupCheckKind::Zmq => check_zmq(&body),
        StartupCheckKind::Tor => check_tor(&body),
    }
}

fn check_bitcoin(body: &StartupCheckRequest) -> StartupCheckResponse {
    use coinswap::bitcoind::bitcoincore_rpc::RpcApi;

    let check = StartupCheckKind::Bitcoin;
    let rpc = body.rpc.as_deref().unwrap_or(DEFAULT_RPC_ADDR);
    let client = match build_rpc_client(body) {
        Ok(client) => client,
        Err(detail) => return fail(check, "Could not connect to Bitcoin Core RPC", detail),
    };

    let chain_info = match client.get_blockchain_info() {
        Ok(info) => info,
        Err(e) => {
            return fail(
                check,
                "Bitcoin Core RPC is reachable but not responding correctly",
                e.to_string(),
            )
        }
    };

    let sync_pct = chain_info.verification_progress * 100.0;
    let synced = chain_info.verification_progress >= 0.999;
    if synced {
        success(
            check,
            format!(
                "Bitcoin Core is running on {} and synced on {}",
                rpc, chain_info.chain
            ),
            Some(format!(
                "Block height: {}, sync: {:.2}%",
                chain_info.blocks, sync_pct
            )),
        )
    } else {
        fail(
            check,
            "Bitcoin Core is running but still syncing",
            format!(
                "Connected to {} on {} at block {} ({:.2}% synced)",
                rpc, chain_info.chain, chain_info.blocks, sync_pct
            ),
        )
    }
}

fn check_rpc(body: &StartupCheckRequest) -> StartupCheckResponse {
    use coinswap::bitcoind::bitcoincore_rpc::RpcApi;

    let check = StartupCheckKind::Rpc;
    let rpc = body.rpc.as_deref().unwrap_or(DEFAULT_RPC_ADDR);
    let client = match build_rpc_client(body) {
        Ok(client) => client,
        Err(detail) => return fail(check, "Could not connect to Bitcoin Core RPC", detail),
    };

    match client.get_network_info() {
        Ok(info) => success(
            check,
            format!("Bitcoin Core RPC is enabled at {}", rpc),
            Some(format!("Version: {}", info.version)),
        ),
        Err(e) => fail(
            check,
            "Bitcoin Core RPC credentials or server settings look incorrect",
            e.to_string(),
        ),
    }
}

fn check_rest(body: &StartupCheckRequest) -> StartupCheckResponse {
    let check = StartupCheckKind::Rest;
    let rpc = body.rpc.as_deref().unwrap_or(DEFAULT_RPC_ADDR);
    let addr = match first_socket_addr(rpc) {
        Ok(addr) => addr,
        Err(detail) => return fail(check, "Could not parse the Bitcoin RPC address", detail),
    };

    let mut stream = match TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT) {
        Ok(stream) => stream,
        Err(e) => {
            return fail(
                check,
                "Could not connect to the Bitcoin Core REST port",
                e.to_string(),
            )
        }
    };

    let _ = stream.set_read_timeout(Some(CONNECT_TIMEOUT));
    let _ = stream.set_write_timeout(Some(CONNECT_TIMEOUT));

    let request = format!(
        "GET /rest/chaininfo.json HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
        addr
    );
    if let Err(e) = stream.write_all(request.as_bytes()) {
        return fail(
            check,
            "Failed to query the Bitcoin Core REST endpoint",
            e.to_string(),
        );
    }

    let mut response = String::new();
    if let Err(e) = stream.read_to_string(&mut response) {
        return fail(
            check,
            "Failed to read the Bitcoin Core REST response",
            e.to_string(),
        );
    }

    let status_line = response.lines().next().unwrap_or_default();
    if status_line.contains(" 200 ")
        || status_line.contains(" 401 ")
        || status_line.contains(" 403 ")
    {
        return success(
            check,
            format!("Bitcoin Core REST responded at {}", rpc),
            Some(format!("HTTP status: {}", status_line)),
        );
    }

    fail(
        check,
        "Bitcoin Core REST is not enabled on the configured port",
        if status_line.is_empty() {
            "Empty HTTP response from /rest/chaininfo.json".to_string()
        } else {
            format!("HTTP status: {}", status_line)
        },
    )
}

fn check_zmq(body: &StartupCheckRequest) -> StartupCheckResponse {
    let check = StartupCheckKind::Zmq;
    let endpoint = body.zmq.as_deref().unwrap_or(DEFAULT_ZMQ_ADDR);
    let addr = match parse_tcp_endpoint(endpoint) {
        Ok(addr) => addr,
        Err(detail) => return fail(check, "Could not parse the ZMQ endpoint", detail),
    };

    match TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT) {
        Ok(_) => success(
            check,
            format!("ZMQ endpoint is reachable at {}", endpoint),
            Some("TCP connection to the configured publisher port succeeded".to_string()),
        ),
        Err(e) => fail(
            check,
            "Could not reach the configured ZMQ publisher",
            e.to_string(),
        ),
    }
}

fn check_tor(body: &StartupCheckRequest) -> StartupCheckResponse {
    let check = StartupCheckKind::Tor;
    let tor_host = DEFAULT_TOR_HOST
        .parse::<IpAddr>()
        .expect("default Tor host should be a valid IP");
    let socks_addr = SocketAddr::from((tor_host, body.socks_port.unwrap_or(DEFAULT_SOCKS_PORT)));
    let control_addr =
        SocketAddr::from((tor_host, body.control_port.unwrap_or(DEFAULT_CONTROL_PORT)));

    let socks = TcpStream::connect_timeout(&socks_addr, CONNECT_TIMEOUT);
    let control = TcpStream::connect_timeout(&control_addr, CONNECT_TIMEOUT);

    match (socks, control) {
        (Ok(_), Ok(_)) => success(
            check,
            "Tor SOCKS and control ports are reachable".to_string(),
            Some(format!("SOCKS: {}, control: {}", socks_addr, control_addr)),
        ),
        (socks_result, control_result) => {
            let detail = json!({
                "socks": socks_result.err().map(|e| e.to_string()).unwrap_or_else(|| "ok".to_string()),
                "control": control_result.err().map(|e| e.to_string()).unwrap_or_else(|| "ok".to_string()),
            })
            .to_string();
            fail(
                check,
                "Tor is not fully reachable on the expected local ports",
                detail,
            )
        }
    }
}

fn build_rpc_client(
    body: &StartupCheckRequest,
) -> Result<coinswap::bitcoind::bitcoincore_rpc::Client, String> {
    use coinswap::bitcoind::bitcoincore_rpc::{Auth, Client};

    let rpc = body.rpc.as_deref().unwrap_or(DEFAULT_RPC_ADDR);
    let user = body.rpc_user.as_deref().unwrap_or(DEFAULT_RPC_USER);
    let password = body.rpc_password.as_deref().unwrap_or(DEFAULT_RPC_PASSWORD);

    Client::new(
        &format!("http://{}", rpc),
        Auth::UserPass(user.to_string(), password.to_string()),
    )
    .map_err(|e| e.to_string())
}

fn parse_tcp_endpoint(endpoint: &str) -> Result<SocketAddr, String> {
    let host_port = endpoint
        .strip_prefix("tcp://")
        .ok_or_else(|| "Only tcp:// ZMQ endpoints are supported".to_string())?;
    first_socket_addr(host_port)
}

fn first_socket_addr(value: &str) -> Result<SocketAddr, String> {
    value
        .to_socket_addrs()
        .map_err(|e| e.to_string())?
        .next()
        .ok_or_else(|| format!("Could not resolve {}", value))
}

fn success(
    check: StartupCheckKind,
    message: String,
    detail: Option<String>,
) -> StartupCheckResponse {
    StartupCheckResponse {
        check,
        success: true,
        message,
        detail,
    }
}

fn fail(check: StartupCheckKind, message: &str, detail: String) -> StartupCheckResponse {
    StartupCheckResponse {
        check,
        success: false,
        message: message.to_string(),
        detail: Some(detail),
    }
}
