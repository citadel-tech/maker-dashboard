//! Unit tests for wallet endpoints (`/makers/{id}/balance`, `/utxos`, etc.).

use axum::http::StatusCode;
use serde_json::json;

use super::{get, post, test_app};

#[tokio::test]
async fn balance_unknown_maker_is_404() {
    let (status, body) = get(test_app(), "/makers/unknown/balance").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!body["success"].as_bool().unwrap_or(true));
}

#[tokio::test]
async fn utxos_unknown_maker_is_404() {
    let (status, body) = get(test_app(), "/makers/unknown/utxos").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!body["success"].as_bool().unwrap_or(true));
}

#[tokio::test]
async fn swap_utxos_unknown_maker_is_404() {
    let (status, body) = get(test_app(), "/makers/unknown/utxos/swap").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!body["success"].as_bool().unwrap_or(true));
}

#[tokio::test]
async fn contract_utxos_unknown_maker_is_404() {
    let (status, body) = get(test_app(), "/makers/unknown/utxos/contract").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!body["success"].as_bool().unwrap_or(true));
}

#[tokio::test]
async fn fidelity_utxos_unknown_maker_is_404() {
    let (status, body) = get(test_app(), "/makers/unknown/utxos/fidelity").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!body["success"].as_bool().unwrap_or(true));
}

#[tokio::test]
async fn new_address_unknown_maker_is_404() {
    let (status, body) = get(test_app(), "/makers/unknown/address").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!body["success"].as_bool().unwrap_or(true));
}

#[tokio::test]
async fn sync_unknown_maker_is_404() {
    let (status, body) = post(test_app(), "/makers/unknown/sync", json!({})).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!body["success"].as_bool().unwrap_or(true));
}

#[tokio::test]
async fn send_to_address_unknown_maker_is_404() {
    let (status, body) = post(
        test_app(),
        "/makers/unknown/send",
        json!({ "address": "bcrt1qtest", "amount": 1000, "feerate": 1.0 }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!body["success"].as_bool().unwrap_or(true));
}
