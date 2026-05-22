use axum::{
    extract::{ConnectInfo, Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::net::SocketAddr;

use crate::api::auth::extract_session_token;
use crate::api::AppState;

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

/// Middleware that enforces session authentication for /api/* routes
pub async fn auth_middleware(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path();

    // Let auth endpoints through without a session check.
    if path.starts_with("/api/auth/") {
        return next.run(request).await;
    }

    // Only apply auth check to /api/* routes
    if !path.starts_with("/api/") {
        return next.run(request).await;
    }

    let token = extract_session_token(request.headers());
    let valid = match token {
        Some(t) => state.sessions.lock().await.validate(&t),
        None => false,
    };

    if valid {
        next.run(request).await
    } else {
        let body = Json(json!({
            "success": false,
            "error": "Unauthorized"
        }));
        (StatusCode::UNAUTHORIZED, body).into_response()
    }
}
