//! Tests for maker management endpoints.

use axum::http::StatusCode;
use serde_json::json;

use super::{delete, get, post, put, test_app};

// 200 / success-path

#[tokio::test]
async fn list_makers_returns_empty_array() {
    let (status, body) = get(test_app(), "/makers").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "success": true, "data": [] }));
}

#[tokio::test]
async fn maker_count_is_zero_initially() {
    let (status, body) = get(test_app(), "/makers/count").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "success": true, "data": 0 }));
}

#[tokio::test]
async fn list_and_count_stay_empty_after_failed_create() {
    let app = test_app();
    // This fails because there is no Bitcoin node at 127.0.0.1:19998
    post(
        app.clone(),
        "/makers",
        json!({ "id": "fail", "rpc_user": "u", "rpc_password": "p", "rpc": "127.0.0.1:19998", "zmq": "tcp://127.0.0.1:19997" }),
    )
    .await;

    let (list_status, list_body) = get(app.clone(), "/makers").await;
    assert_eq!(list_status, StatusCode::OK);
    assert!(list_body["data"].as_array().unwrap().is_empty());

    let (count_status, count_body) = get(app.clone(), "/makers/count").await;
    assert_eq!(count_status, StatusCode::OK);
    assert_eq!(count_body["data"], 0);
}

// validation errors (400)

#[tokio::test]
async fn create_without_credentials_is_400() {
    let (status, body) = post(
        test_app(),
        "/makers",
        json!({ "id": "test", "rpc": "127.0.0.1:18332", "zmq": "tcp://127.0.0.1:28332" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(!body["success"].as_bool().unwrap());
    assert_eq!(
        body["error"],
        "Both rpc_user and rpc_password must be provided together"
    );
}

#[tokio::test]
async fn create_with_only_rpc_user_is_400() {
    let (status, body) = post(
        test_app(),
        "/makers",
        json!({ "id": "test", "rpc_user": "alice" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(!body["success"].as_bool().unwrap());
}

// 500 when Bitcoin is unavailable

#[tokio::test]
async fn create_with_credentials_returns_500_without_bitcoin() {
    let (status, body) = post(
        test_app(),
        "/makers",
        json!({ "id": "test", "rpc_user": "alice", "rpc_password": "pass", "rpc": "127.0.0.1:19998", "zmq": "tcp://127.0.0.1:19997" }),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(!body["success"].as_bool().unwrap());
    assert!(body["error"].is_string());
}

// 404 for unknown maker

#[tokio::test]
async fn get_unknown_maker_is_404() {
    let (status, body) = get(test_app(), "/makers/unknown").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!body["success"].as_bool().unwrap());
    assert_eq!(body["error"], "Maker 'unknown' not found");
}

#[tokio::test]
async fn get_maker_info_unknown_is_404() {
    let (status, body) = get(test_app(), "/makers/unknown/info").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!body["success"].as_bool().unwrap());
}

#[tokio::test]
async fn delete_unknown_maker_is_404() {
    let (status, body) = delete(test_app(), "/makers/unknown").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!body["success"].as_bool().unwrap());
    assert_eq!(body["error"], "Maker 'unknown' not found");
}

#[tokio::test]
async fn start_unknown_maker_is_404() {
    let (status, body) = post(test_app(), "/makers/unknown/start", json!({})).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!body["success"].as_bool().unwrap());
    assert_eq!(body["error"], "Maker 'unknown' not found");
}

#[tokio::test]
async fn stop_unknown_maker_is_404() {
    let (status, body) = post(test_app(), "/makers/unknown/stop", json!({})).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!body["success"].as_bool().unwrap());
    assert_eq!(body["error"], "Maker 'unknown' not found");
}

#[tokio::test]
async fn restart_unknown_maker_is_404() {
    let (status, body) = post(test_app(), "/makers/unknown/restart", json!({})).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!body["success"].as_bool().unwrap());
    assert_eq!(body["error"], "Maker 'unknown' not found");
}

#[tokio::test]
async fn update_config_unknown_maker_is_404() {
    let (status, body) = put(test_app(), "/makers/unknown/config", json!({})).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!body["success"].as_bool().unwrap());
    assert_eq!(body["error"], "Maker 'unknown' not found");
}
