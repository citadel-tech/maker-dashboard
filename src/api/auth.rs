use std::sync::Arc;

use axum::{
    extract::State,
    http::{header, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use super::dto::ApiResponse;
use crate::auth::{AuthConfig, SessionStore};

pub fn routes() -> axum::Router<super::AppState> {
    use axum::routing::{get, post};
    axum::Router::new()
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/auth/status", get(status))
}

#[derive(Deserialize)]
struct LoginRequest {
    password: String,
}

#[derive(Serialize)]
struct AuthStatus {
    authenticated: bool,
}

async fn login(
    State(auth): State<Arc<AuthConfig>>,
    State(sessions): State<Arc<Mutex<SessionStore>>>,
    Json(body): Json<LoginRequest>,
) -> impl IntoResponse {
    match auth.verify(&body.password) {
        Ok(true) => {
            let token = sessions.lock().await.create();
            let cookie = format!(
                "session={token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400"
            );
            (
                StatusCode::OK,
                [(header::SET_COOKIE, cookie)],
                Json(ApiResponse::<()>::ok(())),
            )
                .into_response()
        }
        Ok(false) => (
            StatusCode::UNAUTHORIZED,
            Json(ApiResponse::<()>::err("Invalid password")),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::<()>::err(e.to_string())),
        )
            .into_response(),
    }
}

async fn logout(
    State(sessions): State<Arc<Mutex<SessionStore>>>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    if let Some(token) = extract_session_token(&headers) {
        sessions.lock().await.remove(&token);
    }
    let clear_cookie = "session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0";
    (
        StatusCode::OK,
        [(header::SET_COOKIE, clear_cookie)],
        Json(ApiResponse::<()>::ok(())),
    )
        .into_response()
}

async fn status(
    State(sessions): State<Arc<Mutex<SessionStore>>>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let authenticated = match extract_session_token(&headers) {
        Some(token) => sessions.lock().await.validate(&token),
        None => false,
    };
    Json(ApiResponse::ok(AuthStatus { authenticated }))
}

pub fn extract_session_token(headers: &axum::http::HeaderMap) -> Option<String> {
    let cookie_header = headers.get(header::COOKIE)?.to_str().ok()?;
    cookie_header.split(';').find_map(|part| {
        let part = part.trim();
        part.strip_prefix("session=").map(|v| v.to_string())
    })
}
