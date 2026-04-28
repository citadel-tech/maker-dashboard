use std::sync::{Arc, RwLock};

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
        .route("/auth/rotate-password", post(rotate_password))
}

#[derive(Deserialize)]
struct LoginRequest {
    password: String,
}

#[derive(Deserialize)]
struct RotatePasswordRequest {
    old_password: String,
    new_password: String,
}

#[derive(Serialize)]
struct AuthStatus {
    authenticated: bool,
}

async fn login(
    State(auth): State<Arc<RwLock<AuthConfig>>>,
    State(sessions): State<Arc<Mutex<SessionStore>>>,
    Json(body): Json<LoginRequest>,
) -> impl IntoResponse {
    let result = auth.read().unwrap().verify(&body.password);
    match result {
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

async fn rotate_password(
    State(auth): State<Arc<RwLock<AuthConfig>>>,
    State(sessions): State<Arc<Mutex<SessionStore>>>,
    State(makers): State<Arc<Mutex<crate::maker_manager::MakerManager>>>,
    State(config_dir): State<Arc<std::path::PathBuf>>,
    Json(body): Json<RotatePasswordRequest>,
) -> impl IntoResponse {
    // Validate inputs up front
    if body.new_password.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::<()>::err("New password must not be empty")),
        )
            .into_response();
    }
    if body.new_password == body.old_password {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::<()>::err(
                "New password must differ from current password",
            )),
        )
            .into_response();
    }

    // Verify old password against the stored hash
    let verified = {
        let guard = auth.read().unwrap();
        match guard.verify(&body.old_password) {
            Ok(v) => v,
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ApiResponse::<()>::err(e.to_string())),
                )
                    .into_response()
            }
        }
    };
    if !verified {
        return (
            StatusCode::UNAUTHORIZED,
            Json(ApiResponse::<()>::err("Incorrect current password")),
        )
            .into_response();
    }

    // Build new AuthConfig (new argon2id hash + new enc_salt)
    let new_auth = match AuthConfig::new(&body.new_password) {
        Ok(a) => a,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::<()>::err(e.to_string())),
            )
                .into_response()
        }
    };

    // Derive the new AES key from the new password + new enc_salt
    let new_key = match new_auth.derive_key(&body.new_password) {
        Ok(k) => k,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::<()>::err(e.to_string())),
            )
                .into_response()
        }
    };

    // Re-encrypt makers.json with the new key
    if let Err(e) = makers.lock().await.rotate_enc_key(Some(new_key)) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::<()>::err(format!(
                "Failed to re-encrypt makers config: {e}"
            ))),
        )
            .into_response();
    }

    // Atomically write the new auth.json; on failure roll back makers.json
    if let Err(e) = new_auth.save(&config_dir) {
        // Best-effort rollback: restore the old enc key so makers.json stays consistent
        let old_key = auth.read().unwrap().derive_key(&body.old_password).ok();
        let _ = makers.lock().await.rotate_enc_key(old_key);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::<()>::err(format!(
                "Failed to save auth config: {e}"
            ))),
        )
            .into_response();
    }

    // Commit: update in-memory auth config and invalidate all existing sessions
    *auth.write().unwrap() = new_auth;
    *sessions.lock().await = SessionStore::new();

    (StatusCode::OK, Json(ApiResponse::<()>::ok(()))).into_response()
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
