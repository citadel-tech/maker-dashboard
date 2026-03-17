//! Shared test infrastructure for API unit tests.
//!
//! Each sub-module tests one category of API endpoints.
//! All tests use `test_app()` which builds a fresh router backed by an empty
//! `MakerManager` — no Bitcoin RPC or real coinswap infrastructure required.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use http_body_util::BodyExt;
use serde_json::Value;
use tokio::sync::Mutex;
use tower::ServiceExt;

use maker_dashboard::{api::api_router, maker_manager::MakerManager};

mod fidelity;
mod makers;
mod monitoring;
mod wallet;

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// Builds a fresh Router backed by an empty MakerManager in an isolated temp dir.
pub fn test_app() -> Router {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let config_dir =
        std::env::temp_dir().join(format!("maker-api-test-{}-{}", std::process::id(), n));
    if config_dir.exists() {
        std::fs::remove_dir_all(&config_dir).unwrap();
    }
    std::fs::create_dir_all(&config_dir).unwrap();
    let manager = MakerManager::new(config_dir).expect("MakerManager::new");
    let state = Arc::new(Mutex::new(manager));
    api_router().with_state(state)
}

/// GET request → (status, response JSON).
pub async fn get(app: Router, uri: &str) -> (StatusCode, Value) {
    send(app, Request::get(uri).body(Body::empty()).unwrap()).await
}

/// POST request with a JSON body → (status, response JSON).
pub async fn post(app: Router, uri: &str, body: Value) -> (StatusCode, Value) {
    send(
        app,
        Request::post(uri)
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
    )
    .await
}

/// PUT request with a JSON body → (status, response JSON).
pub async fn put(app: Router, uri: &str, body: Value) -> (StatusCode, Value) {
    send(
        app,
        Request::put(uri)
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
    )
    .await
}

/// DELETE request → (status, response JSON).
pub async fn delete(app: Router, uri: &str) -> (StatusCode, Value) {
    send(app, Request::delete(uri).body(Body::empty()).unwrap()).await
}

async fn send(app: Router, req: Request<Body>) -> (StatusCode, Value) {
    let resp = app.oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}
