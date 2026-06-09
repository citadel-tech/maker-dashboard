//! Tests for maker management endpoints.

use std::net::TcpListener;

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
async fn suggested_ports_return_defaults_when_available() {
    let (status, body) = get(test_app(), "/makers/ports/suggested").await;
    assert_eq!(status, StatusCode::OK);
    let network_port = body["data"]["network_port"].as_u64().unwrap();
    let rpc_port = body["data"]["rpc_port"].as_u64().unwrap();
    assert!(network_port > 0);
    assert!(rpc_port > 0);
    assert_ne!(network_port, rpc_port);
}

#[tokio::test]
async fn suggested_ports_skip_taken_defaults() {
    let app = test_app();

    let (first_status, first_body) = get(app.clone(), "/makers/ports/suggested").await;
    assert_eq!(first_status, StatusCode::OK);

    let first_network_port = first_body["data"]["network_port"].as_u64().unwrap();
    let first_rpc_port = first_body["data"]["rpc_port"].as_u64().unwrap();

    let network_listener = TcpListener::bind(format!("127.0.0.1:{first_network_port}")).unwrap();
    let rpc_listener = TcpListener::bind(format!("127.0.0.1:{first_rpc_port}")).unwrap();

    let (second_status, second_body) = get(app, "/makers/ports/suggested").await;

    drop(network_listener);
    drop(rpc_listener);

    assert_eq!(second_status, StatusCode::OK);
    assert_ne!(
        second_body["data"]["network_port"].as_u64().unwrap(),
        first_network_port
    );
    assert_ne!(
        second_body["data"]["rpc_port"].as_u64().unwrap(),
        first_rpc_port
    );
    assert_ne!(
        second_body["data"]["network_port"].as_u64().unwrap(),
        second_body["data"]["rpc_port"].as_u64().unwrap()
    );
}

#[tokio::test]
async fn auto_start_setting_defaults_to_enabled() {
    let (status, body) = get(test_app(), "/makers/auto-start").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({ "success": true, "data": { "enabled": true } })
    );
}

#[tokio::test]
async fn auto_start_setting_can_be_updated() {
    let app = test_app();

    let (put_status, put_body) = put(
        app.clone(),
        "/makers/auto-start",
        json!({ "enabled": false }),
    )
    .await;
    assert_eq!(put_status, StatusCode::OK);
    assert_eq!(
        put_body,
        json!({ "success": true, "data": { "enabled": false } })
    );

    let (get_status, get_body) = get(app, "/makers/auto-start").await;
    assert_eq!(get_status, StatusCode::OK);
    assert_eq!(
        get_body,
        json!({ "success": true, "data": { "enabled": false } })
    );
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

#[tokio::test]
async fn create_skips_taken_local_network_port() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();

    let (status, body) = post(
        test_app(),
        "/makers",
        json!({
            "id": "test",
            "rpc_user": "alice",
            "rpc_password": "pass",
            "network_port": port,
        }),
    )
    .await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(!body["success"].as_bool().unwrap());
    assert_ne!(
        body["error"],
        format!("network_port {port} is already in use on this machine")
    );
}

#[tokio::test]
async fn create_skips_taken_local_rpc_port() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();

    let (status, body) = post(
        test_app(),
        "/makers",
        json!({
            "id": "test",
            "rpc_user": "alice",
            "rpc_password": "pass",
            "rpc_port": port,
        }),
    )
    .await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(!body["success"].as_bool().unwrap());
    assert_ne!(
        body["error"],
        format!("rpc_port {port} is already in use on this machine")
    );
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
