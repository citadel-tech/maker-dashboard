//! Tests for monitoring endpoints (`/health`, `/status`, `/logs`, `/swaps`, etc.).

use axum::http::StatusCode;
use serde_json::json;

use super::{get, test_app};

// 200 / success-path

#[tokio::test]
async fn health_with_no_makers_returns_ok_status() {
    let (status, body) = get(test_app(), "/health").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({ "success": true, "data": { "status": "ok", "makers": [] } })
    );
}

// 404 for unknown maker

#[tokio::test]
async fn status_unknown_maker_is_404() {
    let (status, body) = get(test_app(), "/makers/unknown/status").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!body["success"].as_bool().unwrap_or(true));
}

#[tokio::test]
async fn swaps_unknown_maker_is_404() {
    let (status, body) = get(test_app(), "/makers/unknown/swaps").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!body["success"].as_bool().unwrap_or(true));
}

#[tokio::test]
async fn logs_unknown_maker_is_404() {
    let (status, body) = get(test_app(), "/makers/unknown/logs").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!body["success"].as_bool().unwrap_or(true));
}

#[tokio::test]
async fn tor_address_unknown_maker_is_404() {
    let (status, body) = get(test_app(), "/makers/unknown/tor-address").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!body["success"].as_bool().unwrap_or(true));
}

#[tokio::test]
async fn data_dir_unknown_maker_is_404() {
    let (status, body) = get(test_app(), "/makers/unknown/data-dir").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!body["success"].as_bool().unwrap_or(true));
}
