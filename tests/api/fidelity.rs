//! Unit tests for fidelity bond endpoints.

use axum::http::StatusCode;

use super::{get, test_app};

#[tokio::test]
async fn list_fidelity_unknown_maker_is_404() {
    let (status, body) = get(test_app(), "/makers/unknown/fidelity").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!body["success"].as_bool().unwrap_or(true));
}
