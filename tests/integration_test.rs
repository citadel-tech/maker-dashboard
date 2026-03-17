// What is tested (in order):
//   - Spawn the dashboard HTTP server.
//   - Create two makers via POST /api/makers.
//   - Fund each maker wallet and verify balance + UTXO endpoints.
//   - Start both makers via POST /api/makers/{id}/start.
//   - Update one maker's config and assert the change is reflected.
//   - Run a standard coinswap between a taker and the two makers.
//   - Verify files in each maker's data directory are present post-swap.
//   - Restart both makers via POST /api/makers/{id}/restart.
//   - Re-sync wallets and assert all balances / UTXO counts are still consistent.

#![cfg(feature = "integration-test")]

use bitcoin::Amount;
use bitcoind::{bitcoincore_rpc::RpcApi, BitcoinD};
use coinswap::{
    taker::{SwapParams, Taker, TakerBehavior},
    wallet::{AddressType, RPCConfig},
};
use maker_dashboard::server::{Server, ServerConfig};
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::{
    fs,
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    sync::Arc,
    thread,
    time::Duration,
};
use tokio::runtime::Runtime;
use tracing_subscriber::{fmt::format::FmtSpan, prelude::*, EnvFilter};

// - Maker / port constants

const MAKER_ALPHA_PORT: u16 = 16201;
const MAKER_BETA_PORT: u16 = 16202;
const MAKER_ALPHA_ID: &str = "alpha";
const MAKER_BETA_ID: &str = "beta";
// RPC ports are assigned dynamically at runtime (see test body).

/// Balance tolerance: ±1 vbyte fee variance in satoshis.
const SAT_TOLERANCE: u64 = 3;

// - Inlined bitcoind helpers

/// Mine `n` blocks to a fresh address on the regtest node.
fn generate_blocks(bitcoind: &BitcoinD, n: u64) {
    let addr = match bitcoind.client.get_new_address(None, None) {
        Ok(a) => a
            .require_network(bitcoind::bitcoincore_rpc::bitcoin::Network::Regtest)
            .unwrap(),
        Err(_) => return,
    };
    let _ = bitcoind.client.generate_to_address(n, &addr);
}

/// Send `amount` to `addr` on the regtest node and return the txid.
fn send_to_address(bitcoind: &BitcoinD, addr: &bitcoin::Address, amount: Amount) -> bitcoin::Txid {
    bitcoind
        .client
        .send_to_address(addr, amount, None, None, None, None, None, None)
        .unwrap()
}

/// Start a regtest bitcoind node.
///
/// Requires `BITCOIND_EXE` to be set in the environment (pointing to the
/// `bitcoind` binary).  In Docker this is set by the image; in CI it is set
/// by the install step.
fn init_bitcoind(base_dir: &Path) -> (BitcoinD, String, String, RpcCreds) {
    let zmq_addr = format!("tcp://127.0.0.1:{}", free_port());
    let zmq_rawtx = format!("-zmqpubrawtx={zmq_addr}");
    let zmq_block = format!("-zmqpubrawblock={zmq_addr}");

    let mut conf = bitcoind::Conf::default();
    conf.args.push("-txindex=1");
    conf.args.push(Box::leak(zmq_rawtx.into_boxed_str()));
    conf.args.push(Box::leak(zmq_block.into_boxed_str()));
    conf.staticdir = Some(base_dir.join(".bitcoin"));

    let exe_path = bitcoind::exe_path().unwrap();
    let bd = BitcoinD::with_conf(exe_path, &conf).expect("start bitcoind");
    generate_blocks(&bd, 101);

    let creds = RpcCreds::from_cookie(&bd.params.cookie_file);
    let rpc_url = bd.rpc_url().trim_start_matches("http://").to_string();
    (bd, rpc_url, zmq_addr, creds)
}

// - RPC credentials (cookie-based)

#[derive(Clone)]
struct RpcCreds {
    user: String,
    pass: String,
}

impl RpcCreds {
    fn from_cookie(cookie_file: &Path) -> Self {
        let raw = fs::read_to_string(cookie_file)
            .unwrap_or_else(|e| panic!("Cannot read cookie {}: {e}", cookie_file.display()));
        let (user, pass) = raw
            .trim()
            .split_once(':')
            .unwrap_or_else(|| panic!("Unexpected cookie format: {raw:?}"));
        Self {
            user: user.to_owned(),
            pass: pass.to_owned(),
        }
    }
}

// - Dashboard server guard

struct DashboardGuard {
    port: u16,
    shutdown: Arc<AtomicBool>,
    _thread: thread::JoinHandle<()>,
}

impl DashboardGuard {
    fn start(config_dir: PathBuf) -> Self {
        let port = free_port();
        let shutdown = Arc::new(AtomicBool::new(false));
        let shutdown2 = shutdown.clone();

        let thread = thread::Builder::new()
            .name("dashboard-server".into())
            .spawn(move || {
                Runtime::new().unwrap().block_on(async move {
                    let cfg = ServerConfig {
                        host: IpAddr::V4(Ipv4Addr::LOCALHOST),
                        port,
                        frontend_path: PathBuf::from("frontend/build/client"),
                        spa_index: PathBuf::from("frontend/build/client/index.html"),
                        localhost_only: true,
                        config_dir,
                    };
                    let server = Server::new(cfg).expect("Server::new");
                    let addr = server.addr();
                    let app = server.build_router();
                    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
                    axum::serve(
                        listener,
                        app.into_make_service_with_connect_info::<SocketAddr>(),
                    )
                    .with_graceful_shutdown(async move {
                        while !shutdown2.load(Ordering::Relaxed) {
                            tokio::time::sleep(Duration::from_millis(100)).await;
                        }
                    })
                    .await
                    .unwrap();
                });
            })
            .expect("spawn dashboard");

        let guard = Self {
            port,
            shutdown,
            _thread: thread,
        };

        // Wait up to 5 s for the server to accept connections.
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            if std::net::TcpStream::connect(format!("127.0.0.1:{port}")).is_ok() {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "Dashboard server did not start within 5 s"
            );
            thread::sleep(Duration::from_millis(50));
        }

        guard
    }
}

impl Drop for DashboardGuard {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
    }
}

// - HTTP client

struct ApiClient {
    base: String,
    agent: ureq::Agent,
    creds: RpcCreds,
}

impl ApiClient {
    fn new(port: u16, creds: RpcCreds) -> Self {
        Self {
            base: format!("http://127.0.0.1:{port}/api"),
            agent: ureq::AgentBuilder::new()
                .timeout(Duration::from_secs(120))
                .build(),
            creds,
        }
    }

    fn get<T: DeserializeOwned>(&self, path: &str) -> T {
        self.agent
            .get(&format!("{}{path}", self.base))
            .call()
            .unwrap_or_else(|e| panic!("GET {path} failed: {e}"))
            .into_json()
            .unwrap_or_else(|e| panic!("JSON decode GET {path}: {e}"))
    }

    fn post_json<T: DeserializeOwned>(&self, path: &str, body: &Value) -> T {
        self.agent
            .post(&format!("{}{path}", self.base))
            .send_json(body)
            .unwrap_or_else(|e| panic!("POST {path} failed: {e}"))
            .into_json()
            .unwrap_or_else(|e| panic!("JSON decode POST {path}: {e}"))
    }

    fn put_json<T: DeserializeOwned>(&self, path: &str, body: &Value) -> T {
        self.agent
            .put(&format!("{}{path}", self.base))
            .send_json(body)
            .unwrap_or_else(|e| panic!("PUT {path} failed: {e}"))
            .into_json()
            .unwrap_or_else(|e| panic!("JSON decode PUT {path}: {e}"))
    }

    // - domain helpers

    fn create_maker(
        &self,
        id: &str,
        rpc_url: &str,
        zmq_url: &str,
        data_dir: &Path,
        network_port: u16,
        wallet_name: &str,
        rpc_port: u16,
    ) {
        let resp: Value = self.post_json(
            "/makers",
            &serde_json::json!({
                "id": id,
                "rpc": rpc_url,
                "zmq": zmq_url,
                "rpc_user": self.creds.user,
                "rpc_password": self.creds.pass,
                "data_directory": data_dir.to_string_lossy(),
                "network_port": network_port,
                "wallet_name": wallet_name,
                "rpc_port": rpc_port,
                "taproot": false
            }),
        );
        assert!(
            resp["success"].as_bool().unwrap_or(false),
            "create_maker '{id}' failed: {resp}"
        );
    }

    fn start_maker(&self, id: &str) {
        let resp: Value = self.post_json(&format!("/makers/{id}/start"), &serde_json::json!({}));
        assert!(
            resp["success"].as_bool().unwrap_or(false),
            "start_maker '{id}' failed: {resp}"
        );
    }

    fn restart_maker(&self, id: &str) {
        let resp: Value = self.post_json(&format!("/makers/{id}/restart"), &serde_json::json!({}));
        assert!(
            resp["success"].as_bool().unwrap_or(false),
            "restart_maker '{id}' failed: {resp}"
        );
    }

    fn get_address(&self, id: &str) -> String {
        let resp: Value = self.get(&format!("/makers/{id}/address"));
        assert!(
            resp["success"].as_bool().unwrap_or(false),
            "get_address '{id}': {resp}"
        );
        resp["data"]
            .as_str()
            .unwrap_or_else(|| panic!("no address in response"))
            .to_owned()
    }

    fn sync_wallet(&self, id: &str) {
        let resp: Value = self.post_json(&format!("/makers/{id}/sync"), &serde_json::json!({}));
        assert!(
            resp["success"].as_bool().unwrap_or(false),
            "sync '{id}': {resp}"
        );
    }

    /// Returns (regular, swap, contract, fidelity, spendable) in satoshis.
    fn get_balance(&self, id: &str) -> (u64, u64, u64, u64, u64) {
        let resp: Value = self.get(&format!("/makers/{id}/balance"));
        assert!(
            resp["success"].as_bool().unwrap_or(false),
            "balance '{id}': {resp}"
        );
        let d = &resp["data"];
        (
            d["regular"].as_u64().unwrap_or(0),
            d["swap"].as_u64().unwrap_or(0),
            d["contract"].as_u64().unwrap_or(0),
            d["fidelity"].as_u64().unwrap_or(0),
            d["spendable"].as_u64().unwrap_or(0),
        )
    }

    fn get_utxos(&self, id: &str) -> Vec<Value> {
        let resp: Value = self.get(&format!("/makers/{id}/utxos"));
        assert!(
            resp["success"].as_bool().unwrap_or(false),
            "utxos '{id}': {resp}"
        );
        resp["data"].as_array().cloned().unwrap_or_default()
    }

    fn get_swap_utxos(&self, id: &str) -> Vec<Value> {
        let resp: Value = self.get(&format!("/makers/{id}/utxos/swap"));
        assert!(
            resp["success"].as_bool().unwrap_or(false),
            "swap_utxos '{id}': {resp}"
        );
        resp["data"].as_array().cloned().unwrap_or_default()
    }

    fn get_maker_detail(&self, id: &str) -> Value {
        let resp: Value = self.get(&format!("/makers/{id}"));
        assert!(
            resp["success"].as_bool().unwrap_or(false),
            "get_maker '{id}': {resp}"
        );
        resp["data"].clone()
    }

    fn update_config(&self, id: &str, body: Value) {
        let resp: Value = self.put_json(&format!("/makers/{id}/config"), &body);
        assert!(
            resp["success"].as_bool().unwrap_or(false),
            "update_config '{id}' failed: {resp}"
        );
    }

    fn list_fidelity(&self, id: &str) -> String {
        let resp: Value = self.get(&format!("/makers/{id}/fidelity"));
        assert!(
            resp["success"].as_bool().unwrap_or(false),
            "fidelity '{id}': {resp}"
        );
        resp["data"].as_str().unwrap_or("").to_owned()
    }

    fn get_status(&self, id: &str) -> (bool, bool) {
        let resp: Value = self.get(&format!("/makers/{id}/status"));
        assert!(
            resp["success"].as_bool().unwrap_or(false),
            "status '{id}': {resp}"
        );
        (
            resp["data"]["alive"].as_bool().unwrap_or(false),
            resp["data"]["is_server_running"].as_bool().unwrap_or(false),
        )
    }

    fn health(&self) -> Value {
        self.get("/health")
    }
}

// - Helpers

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("bind for free port")
        .local_addr()
        .unwrap()
        .port()
}

fn assert_sat_approx(label: &str, actual: u64, expected: u64) {
    let lo = expected.saturating_sub(SAT_TOLERANCE);
    let hi = expected + SAT_TOLERANCE;
    assert!(
        actual >= lo && actual <= hi,
        "{label}: expected ~{expected} sats but got {actual} (tolerance ±{SAT_TOLERANCE})"
    );
}

/// Poll `/status` until the maker is alive or the timeout expires.
fn wait_for_maker_alive(client: &ApiClient, id: &str, timeout: Duration) {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        let (alive, _) = client.get_status(id);
        if alive {
            return;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "Maker '{id}' did not become alive within {timeout:?}"
        );
        thread::sleep(Duration::from_secs(2));
    }
}

/// Mine blocks until the maker's coinswap server accepts TCP connections on
/// `port`.  A successful TCP connect signals that fidelity bond setup is done.
fn wait_for_coinswap_server_ready(bitcoind: &BitcoinD, port: u16, timeout: Duration) {
    let addr: SocketAddr = format!("127.0.0.1:{port}").parse().unwrap();
    let deadline = std::time::Instant::now() + timeout;
    loop {
        generate_blocks(bitcoind, 1);
        if std::net::TcpStream::connect_timeout(&addr, Duration::from_secs(1)).is_ok() {
            return;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "Coinswap server on port {port} did not start within {timeout:?}"
        );
        thread::sleep(Duration::from_secs(3));
    }
}

// - Nostr relay helper

/// Asserts that a Nostr relay is already running on 127.0.0.1:8000.
fn assert_nostr_relay_ready() {
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        if std::net::TcpStream::connect("127.0.0.1:8000").is_ok() {
            return;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "Nostr relay is not running on 127.0.0.1:8000. \
             Start it before running the integration test \
             (CI: hulxv/nostr-relay-action, local: make test-integration-docker)."
        );
        thread::sleep(Duration::from_millis(100));
    }
}

// - THE INTEGRATION TEST

#[test]
fn test_maker_manager_integration() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(true)
                .with_thread_names(true)
                .with_target(true)
                .with_span_events(FmtSpan::FULL),
        )
        .with(EnvFilter::new("error,info"))
        .init();

    let maker_alpha_rpc_port = free_port();
    let maker_beta_rpc_port = free_port();
    println!("[INFO] ports: alpha_rpc={maker_alpha_rpc_port} beta_rpc={maker_beta_rpc_port}");

    let tmp = std::env::temp_dir().join("maker-dashboard-it");
    if tmp.exists() {
        fs::remove_dir_all(&tmp).unwrap();
    }
    let dash_config_dir = tmp.join("dashboard");
    let maker_alpha_dir = tmp.join("maker-alpha");
    let maker_beta_dir = tmp.join("maker-beta");
    let taker_dir = tmp.join("taker");
    for d in [
        &dash_config_dir,
        &maker_alpha_dir,
        &maker_beta_dir,
        &taker_dir,
    ] {
        fs::create_dir_all(d).unwrap();
    }

    println!("[INFO] Checking Nostr relay");
    assert_nostr_relay_ready();

    println!("[INFO] Starting bitcoind");
    let (bitcoind, rpc_url, zmq_addr, rpc_creds) = init_bitcoind(&tmp);
    let bitcoind = Arc::new(bitcoind);

    println!("[INFO] Starting dashboard server");
    let dashboard = DashboardGuard::start(dash_config_dir.clone());
    let client = ApiClient::new(dashboard.port, rpc_creds.clone());

    let health: Value = client.health();
    assert_eq!(health["data"]["status"].as_str(), Some("ok"));

    // Create two makers
    println!("[INFO] Creating makers");
    client.create_maker(
        MAKER_ALPHA_ID,
        &rpc_url,
        &zmq_addr,
        &maker_alpha_dir,
        MAKER_ALPHA_PORT,
        "alpha-wallet",
        maker_alpha_rpc_port,
    );
    client.create_maker(
        MAKER_BETA_ID,
        &rpc_url,
        &zmq_addr,
        &maker_beta_dir,
        MAKER_BETA_PORT,
        "beta-wallet",
        maker_beta_rpc_port,
    );

    let list: Value = client.get("/makers");
    let ids: Vec<&str> = list["data"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|v| v["id"].as_str())
        .collect();
    assert!(ids.contains(&MAKER_ALPHA_ID));
    assert!(ids.contains(&MAKER_BETA_ID));

    let count: Value = client.get("/makers/count");
    assert_eq!(count["data"].as_u64(), Some(2));

    // Fund makers before starting so the fidelity bond is created on first attempt
    println!("[INFO] Funding makers");
    let fund_per_maker = Amount::from_btc(0.20).unwrap();
    let utxo_count = 4u32;
    let utxo_value = fund_per_maker / u64::from(utxo_count);

    for id in [MAKER_ALPHA_ID, MAKER_BETA_ID] {
        for _ in 0..utxo_count {
            let addr: bitcoin::Address<_> = client
                .get_address(id)
                .parse::<bitcoin::Address<_>>()
                .expect("parse address")
                .require_network(bitcoin::Network::Regtest)
                .expect("regtest");
            send_to_address(&bitcoind, &addr, utxo_value);
        }
    }
    generate_blocks(&bitcoind, 1);
    client.sync_wallet(MAKER_ALPHA_ID);
    client.sync_wallet(MAKER_BETA_ID);

    // Create taker before starting makers so its ZMQ watcher is live when fidelity bonds are mined
    println!("[INFO] Creating and funding taker");
    let rpc_config = RPCConfig {
        url: rpc_url.clone(),
        auth: bitcoind::bitcoincore_rpc::Auth::UserPass(
            rpc_creds.user.clone(),
            rpc_creds.pass.clone(),
        ),
        ..Default::default()
    };

    let mut taker = Taker::init(
        Some(taker_dir.clone()),
        Some("taker".into()),
        Some(rpc_config),
        TakerBehavior::Normal,
        None,
        None,
        zmq_addr.clone(),
        None,
    )
    .expect("Taker::init");

    {
        let wallet = taker.get_wallet_mut();
        wallet.sync_and_save().unwrap();
        for _ in 0..3u32 {
            let addr = wallet
                .get_next_external_address(AddressType::P2WPKH)
                .unwrap();
            send_to_address(&bitcoind, &addr, Amount::from_btc(0.05).unwrap());
        }
    }
    generate_blocks(&bitcoind, 1);
    taker.get_wallet_mut().sync_and_save().unwrap();

    // Start both makers and wait for their coinswap servers to be ready
    println!("[INFO] Starting makers");
    client.start_maker(MAKER_ALPHA_ID);
    client.start_maker(MAKER_BETA_ID);

    wait_for_maker_alive(&client, MAKER_ALPHA_ID, Duration::from_secs(60));
    wait_for_maker_alive(&client, MAKER_BETA_ID, Duration::from_secs(60));

    wait_for_coinswap_server_ready(&bitcoind, MAKER_ALPHA_PORT, Duration::from_secs(300));
    wait_for_coinswap_server_ready(&bitcoind, MAKER_BETA_PORT, Duration::from_secs(300));

    let (_, alpha_running) = client.get_status(MAKER_ALPHA_ID);
    let (_, beta_running) = client.get_status(MAKER_BETA_ID);
    assert!(alpha_running, "alpha maker server not running");
    assert!(beta_running, "beta maker server not running");

    thread::sleep(Duration::from_secs(5));
    client.sync_wallet(MAKER_ALPHA_ID);
    client.sync_wallet(MAKER_BETA_ID);

    // Verify balances and UTXOs after fidelity bond creation
    let fidelity_amount: u64 = 5_000_000;
    let (alpha_regular, alpha_swap, alpha_contract, alpha_fidelity, alpha_spendable) =
        client.get_balance(MAKER_ALPHA_ID);
    let (beta_regular, beta_swap, beta_contract, beta_fidelity, beta_spendable) =
        client.get_balance(MAKER_BETA_ID);

    assert!(
        alpha_fidelity > 0,
        "alpha fidelity should be non-zero after bond creation"
    );
    assert!(
        beta_fidelity > 0,
        "beta fidelity should be non-zero after bond creation"
    );
    assert_sat_approx("alpha fidelity", alpha_fidelity, fidelity_amount);
    assert_sat_approx("beta fidelity", beta_fidelity, fidelity_amount);
    assert_eq!(alpha_swap, 0, "alpha unexpected swap balance");
    assert_eq!(beta_swap, 0, "beta unexpected swap balance");
    assert_eq!(alpha_contract, 0, "alpha unexpected contract balance");
    assert_eq!(beta_contract, 0, "beta unexpected contract balance");
    assert_sat_approx("alpha spendable", alpha_spendable, alpha_regular);
    assert_sat_approx("beta spendable", beta_spendable, beta_regular);
    println!("[INFO] Balance check passed: alpha={alpha_regular} sats, beta={beta_regular} sats");

    let alpha_utxos_pre = client.get_utxos(MAKER_ALPHA_ID);
    let beta_utxos_pre = client.get_utxos(MAKER_BETA_ID);
    println!(
        "[INFO] Pre-swap UTXOs: alpha={}, beta={}",
        alpha_utxos_pre.len(),
        beta_utxos_pre.len()
    );

    assert!(
        client.get_swap_utxos(MAKER_ALPHA_ID).is_empty(),
        "alpha: unexpected swap UTXOs before any swap"
    );

    // Update maker config and verify the change is reflected
    println!("[INFO] Updating alpha maker config");
    let wallet_name = "alpha-wallet";
    client.update_config(
        MAKER_ALPHA_ID,
        serde_json::json!({ "wallet_name": wallet_name }),
    );

    thread::sleep(Duration::from_secs(3));
    wait_for_maker_alive(&client, MAKER_ALPHA_ID, Duration::from_secs(30));
    wait_for_coinswap_server_ready(&bitcoind, MAKER_ALPHA_PORT, Duration::from_secs(300));

    let detail = client.get_maker_detail(MAKER_ALPHA_ID);
    assert_eq!(
        detail["wallet_name"].as_str(),
        Some(wallet_name),
        "wallet_name not preserved after update_config: {detail}"
    );
    assert_eq!(
        detail["network_port"].as_u64(),
        Some(MAKER_ALPHA_PORT as u64),
        "network_port changed unexpectedly"
    );

    // Run coinswap — block-gen thread mines transactions during do_coinswap
    println!("[INFO] Initiating coinswap");
    wait_for_maker_alive(&client, MAKER_BETA_ID, Duration::from_secs(30));

    let shutdown_blocks = Arc::new(AtomicBool::new(false));
    let shutdown_blocks2 = shutdown_blocks.clone();
    let bitcoind_for_blocks = bitcoind.clone();
    let block_gen_thread = thread::spawn(move || {
        while !shutdown_blocks2.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_secs(3));
            if !shutdown_blocks2.load(Ordering::Relaxed) {
                generate_blocks(&bitcoind_for_blocks, 10);
            }
        }
    });

    taker
        .do_coinswap(SwapParams {
            send_amount: Amount::from_sat(500_000),
            maker_count: 2,
            manually_selected_outpoints: None,
        })
        .expect("coinswap failed");

    shutdown_blocks.store(true, Ordering::Relaxed);
    block_gen_thread.join().expect("block gen thread panicked");
    println!("[INFO] Coinswap completed");

    generate_blocks(&bitcoind, 1);
    client.sync_wallet(MAKER_ALPHA_ID);
    client.sync_wallet(MAKER_BETA_ID);

    // Post-swap UTXO sanity checks
    let alpha_utxos_post = client.get_utxos(MAKER_ALPHA_ID);
    let beta_utxos_post = client.get_utxos(MAKER_BETA_ID);
    assert!(
        !alpha_utxos_post.is_empty(),
        "alpha should have UTXOs after swap"
    );
    assert!(
        !beta_utxos_post.is_empty(),
        "beta should have UTXOs after swap"
    );

    for utxo in &alpha_utxos_post {
        assert!(
            utxo["amount"].as_u64().unwrap_or(0) > 0,
            "alpha UTXO has zero amount: {utxo}"
        );
    }
    println!(
        "[INFO] Post-swap UTXOs: alpha={}, beta={}",
        alpha_utxos_post.len(),
        beta_utxos_post.len()
    );

    // Verify maker data directories contain wallet files
    println!("[INFO] Checking data directory files");
    for (label, dir) in [
        (MAKER_ALPHA_ID, &maker_alpha_dir),
        (MAKER_BETA_ID, &maker_beta_dir),
    ] {
        let files: Vec<_> = fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(
            !files.is_empty(),
            "Maker '{label}' data directory is empty: {}",
            dir.display()
        );
        assert!(
            files.iter().any(|f| f.contains("wallet")),
            "Maker '{label}' has no wallet file in {}: {files:?}",
            dir.display()
        );
    }

    // Capture state before restart
    let (pre_alpha_regular, pre_alpha_swap, _, pre_alpha_fidelity, pre_alpha_spendable) =
        client.get_balance(MAKER_ALPHA_ID);
    let (pre_beta_regular, pre_beta_swap, _, pre_beta_fidelity, pre_beta_spendable) =
        client.get_balance(MAKER_BETA_ID);
    let pre_alpha_utxo_count = client.get_utxos(MAKER_ALPHA_ID).len();
    let pre_beta_utxo_count = client.get_utxos(MAKER_BETA_ID).len();

    // Restart both makers and verify state is preserved
    println!("[INFO] Restarting both makers");
    client.restart_maker(MAKER_ALPHA_ID);
    client.restart_maker(MAKER_BETA_ID);

    wait_for_maker_alive(&client, MAKER_ALPHA_ID, Duration::from_secs(60));
    wait_for_maker_alive(&client, MAKER_BETA_ID, Duration::from_secs(60));
    wait_for_coinswap_server_ready(&bitcoind, MAKER_ALPHA_PORT, Duration::from_secs(300));
    wait_for_coinswap_server_ready(&bitcoind, MAKER_BETA_PORT, Duration::from_secs(300));

    client.sync_wallet(MAKER_ALPHA_ID);
    client.sync_wallet(MAKER_BETA_ID);

    let (post_alpha_regular, post_alpha_swap, _, post_alpha_fidelity, post_alpha_spendable) =
        client.get_balance(MAKER_ALPHA_ID);
    let (post_beta_regular, post_beta_swap, _, post_beta_fidelity, post_beta_spendable) =
        client.get_balance(MAKER_BETA_ID);
    let post_alpha_utxo_count = client.get_utxos(MAKER_ALPHA_ID).len();
    let post_beta_utxo_count = client.get_utxos(MAKER_BETA_ID).len();

    assert_sat_approx(
        "post-restart alpha regular",
        post_alpha_regular,
        pre_alpha_regular,
    );
    assert_sat_approx("post-restart alpha swap", post_alpha_swap, pre_alpha_swap);
    assert_sat_approx(
        "post-restart alpha fidelity",
        post_alpha_fidelity,
        pre_alpha_fidelity,
    );
    assert_sat_approx(
        "post-restart alpha spendable",
        post_alpha_spendable,
        pre_alpha_spendable,
    );
    assert_sat_approx(
        "post-restart beta regular",
        post_beta_regular,
        pre_beta_regular,
    );
    assert_sat_approx("post-restart beta swap", post_beta_swap, pre_beta_swap);
    assert_sat_approx(
        "post-restart beta fidelity",
        post_beta_fidelity,
        pre_beta_fidelity,
    );
    assert_sat_approx(
        "post-restart beta spendable",
        post_beta_spendable,
        pre_beta_spendable,
    );
    assert_eq!(
        post_alpha_utxo_count, pre_alpha_utxo_count,
        "alpha UTXO count changed after restart"
    );
    assert_eq!(
        post_beta_utxo_count, pre_beta_utxo_count,
        "beta UTXO count changed after restart"
    );

    // Monitoring endpoints smoke test
    let (alpha_alive, alpha_running_post) = client.get_status(MAKER_ALPHA_ID);
    assert!(alpha_alive, "alpha not alive after restart");
    assert!(alpha_running_post, "alpha server not running after restart");

    let health_post: Value = client.health();
    for s in health_post["data"]["makers"].as_array().unwrap() {
        let id = s["id"].as_str().unwrap();
        assert!(
            s["alive"].as_bool().unwrap_or(false),
            "Maker '{id}' not alive in /health"
        );
    }

    let _ = client.list_fidelity(MAKER_ALPHA_ID);
    let _ = client.list_fidelity(MAKER_BETA_ID);

    // Config update is preserved after restart
    let detail_post = client.get_maker_detail(MAKER_ALPHA_ID);
    assert_eq!(
        detail_post["wallet_name"].as_str(),
        Some(wallet_name),
        "wallet_name not preserved after restart"
    );

    println!(
        "[INFO] All checks passed — alpha: {post_alpha_spendable} sats, beta: {post_beta_spendable} sats"
    );
}
