use axum::{
    extract::{ConnectInfo, Request},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::net::SocketAddr;

/// Middleware that checks if the client IP is a loopback address
pub async fn restrict_to_localhost(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Response {
    // Return a Response type
    let ip = addr.ip();

    if ip.is_loopback() {
        next.run(request).await
    } else {
        let body = Json(json!({
            "error": "Forbidden",
            "message": format!("Access from {} is not allowed. Only localhost is permitted.", ip)
        }));

        (StatusCode::FORBIDDEN, body).into_response()
    }
}
