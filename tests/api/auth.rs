//! Tests for dashboard authentication and first-run setup.

use std::sync::Arc;

use axum::http::StatusCode;
use axum::Router;
use serde_json::json;
use tokio::sync::Mutex;

use maker_dashboard::{
    api::{api_router, AppState},
    auth::SessionStore,
    maker_manager::MakerManager,
};

use super::{get, post, temp_config_dir};

fn setup_app(config_dir: std::path::PathBuf) -> Router {
    setup_app_with_secure_cookies(config_dir, true)
}

fn setup_app_with_secure_cookies(config_dir: std::path::PathBuf, secure_cookies: bool) -> Router {
    let manager =
        MakerManager::new_for_testing(config_dir.clone(), None).expect("MakerManager::new");
    let state = AppState {
        makers: Arc::new(Mutex::new(manager)),
        sessions: Arc::new(Mutex::new(SessionStore::new())),
        auth: Arc::new(std::sync::RwLock::new(None)),
        setup_lock: Arc::new(Mutex::new(())),
        config_dir: Arc::new(config_dir),
        secure_cookies,
    };
    api_router().with_state(state)
}

#[tokio::test]
async fn setup_initializes_fresh_dashboard_and_persists_encrypted_state() {
    let config_dir = temp_config_dir();
    std::fs::create_dir_all(&config_dir).unwrap();
    let app = setup_app(config_dir.clone());

    let (status, body) = post(
        app.clone(),
        "/auth/setup",
        json!({ "password": "test-password" }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "success": true, "data": null }));

    let (status, body) = get(app, "/auth/status").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["password_exists"], true);

    let makers = std::fs::read_to_string(config_dir.join("makers.json")).unwrap();
    let makers: serde_json::Value = serde_json::from_str(&makers).unwrap();
    assert_eq!(makers["v"], 1);
    assert!(makers["data"].is_string());
}

#[tokio::test]
async fn setup_migrates_loaded_legacy_plaintext_maker_state() {
    let config_dir = temp_config_dir();
    std::fs::create_dir_all(&config_dir).unwrap();
    std::fs::write(config_dir.join("makers.json"), r#"{"makers":{}}"#).unwrap();
    let app = setup_app(config_dir.clone());

    let (status, body) = post(app, "/auth/setup", json!({ "password": "test-password" })).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "success": true, "data": null }));

    let makers = std::fs::read_to_string(config_dir.join("makers.json")).unwrap();
    let makers: serde_json::Value = serde_json::from_str(&makers).unwrap();
    assert_eq!(makers["v"], 1);
    assert!(makers["data"].is_string());
}

#[tokio::test]
async fn setup_refuses_locked_maker_state_without_auth_config() {
    let config_dir = temp_config_dir();
    std::fs::create_dir_all(&config_dir).unwrap();
    std::fs::write(config_dir.join("makers.json"), r#"{"v":1,"data":"AA=="}"#).unwrap();
    let app = setup_app(config_dir);

    let (status, body) = post(app, "/auth/setup", json!({ "password": "test-password" })).await;

    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["success"], false);
    assert!(body["error"]
        .as_str()
        .unwrap()
        .contains("makers.json already exists"));
}

#[tokio::test]
async fn setup_session_cookie_can_disable_secure_attribute() {
    let config_dir = temp_config_dir();
    std::fs::create_dir_all(&config_dir).unwrap();
    let app = setup_app_with_secure_cookies(config_dir, false);

    let (status, body) = post(app, "/auth/setup", json!({ "password": "test-password" })).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "success": true, "data": null }));
}
