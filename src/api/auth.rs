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
        .route("/auth/setup", post(setup))
        .route("/auth/rotate-password", post(rotate_password))
}

#[derive(Deserialize)]
struct LoginRequest {
    password: String,
}

#[derive(Deserialize)]
struct SetupRequest {
    password: String,
}

#[derive(Deserialize)]
struct RotatePasswordRequest {
    old_password: String,
    new_password: String,
}

#[derive(Serialize)]
struct AuthStatus {
    /// `true` if `auth.json` exists at startup OR was created via `/auth/setup`.
    initialized: bool,
    /// `true` if the request carries a valid session cookie.
    authenticated: bool,
}

async fn login(
    State(auth): State<Arc<RwLock<Option<AuthConfig>>>>,
    State(sessions): State<Arc<Mutex<SessionStore>>>,
    State(makers): State<Arc<Mutex<crate::maker_manager::MakerManager>>>,
    Json(body): Json<LoginRequest>,
) -> impl IntoResponse {
    // Verify against the stored hash and derive the AES key under the read
    // lock; release before doing async work below.
    let (verified, key_result) = {
        let guard = auth.read().unwrap();
        let Some(cfg) = guard.as_ref() else {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ApiResponse::<()>::err(
                    "Dashboard is not initialized. Complete first-run setup.",
                )),
            )
                .into_response();
        };
        let verified = match cfg.verify(&body.password) {
            Ok(v) => v,
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ApiResponse::<()>::err(e.to_string())),
                )
                    .into_response();
            }
        };
        if verified {
            (true, Some(cfg.derive_key(&body.password)))
        } else {
            (false, None)
        }
    };

    if !verified {
        return (
            StatusCode::UNAUTHORIZED,
            Json(ApiResponse::<()>::err("Invalid password")),
        )
            .into_response();
    }

    // Derive the AES key and unlock the maker manager (idempotent).
    let key = match key_result.expect("verified == true implies key_result is Some") {
        Ok(k) => k,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::<()>::err(format!(
                    "Failed to derive encryption key: {e}"
                ))),
            )
                .into_response();
        }
    };

    if let Err(e) = makers.lock().await.unlock(key) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::<()>::err(format!(
                "Failed to unlock maker store: {e}"
            ))),
        )
            .into_response();
    }

    let token = sessions.lock().await.create();
    let cookie =
        format!("session={token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400");
    (
        StatusCode::OK,
        [(header::SET_COOKIE, cookie)],
        Json(ApiResponse::<()>::ok(())),
    )
        .into_response()
}

async fn setup(
    State(auth): State<Arc<RwLock<Option<AuthConfig>>>>,
    State(sessions): State<Arc<Mutex<SessionStore>>>,
    State(setup_lock): State<Arc<Mutex<()>>>,
    State(makers): State<Arc<Mutex<crate::maker_manager::MakerManager>>>,
    State(config_dir): State<Arc<std::path::PathBuf>>,
    Json(body): Json<SetupRequest>,
) -> impl IntoResponse {
    // Hold the setup lock for the entire critical section so two concurrent
    // /auth/setup calls cannot race past validation.
    let _guard = setup_lock.lock().await;

    if body.password.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::<()>::err("Password must not be empty")),
        )
            .into_response();
    }

    // Already initialized in memory?
    if auth.read().unwrap().is_some() {
        return (
            StatusCode::CONFLICT,
            Json(ApiResponse::<()>::err("Dashboard is already initialized")),
        )
            .into_response();
    }

    // Refuse to overwrite an existing makers.json (loss-of-data guard).
    if makers.lock().await.persistence_state_file_exists() {
        return (
            StatusCode::CONFLICT,
            Json(ApiResponse::<()>::err(
                "Setup refused: makers.json already exists. Restore auth.json or delete makers.json to start fresh.",
            )),
        )
            .into_response();
    }

    // Build new AuthConfig + derive AES key.
    let new_auth = match AuthConfig::new(&body.password) {
        Ok(a) => a,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::<()>::err(e.to_string())),
            )
                .into_response();
        }
    };

    let key = match new_auth.derive_key(&body.password) {
        Ok(k) => k,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::<()>::err(format!(
                    "Failed to derive encryption key: {e}"
                ))),
            )
                .into_response();
        }
    };

    // Persist auth.json atomically.
    if let Err(e) = new_auth.save(&config_dir) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::<()>::err(format!(
                "Failed to save auth config: {e}"
            ))),
        )
            .into_response();
    }

    // Unlock the maker manager (this also persists an empty makers.json).
    if let Err(e) = makers.lock().await.unlock(key) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::<()>::err(format!(
                "Failed to initialize maker store: {e}"
            ))),
        )
            .into_response();
    }

    // Commit: set auth, issue session.
    *auth.write().unwrap() = Some(new_auth);

    let token = sessions.lock().await.create();
    let cookie =
        format!("session={token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400");
    (
        StatusCode::OK,
        [(header::SET_COOKIE, cookie)],
        Json(ApiResponse::<()>::ok(())),
    )
        .into_response()
}

async fn rotate_password(
    State(auth): State<Arc<RwLock<Option<AuthConfig>>>>,
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
        let Some(cfg) = guard.as_ref() else {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ApiResponse::<()>::err(
                    "Dashboard is not initialized. Complete first-run setup.",
                )),
            )
                .into_response();
        };
        match cfg.verify(&body.old_password) {
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
        let old_key = auth
            .read()
            .unwrap()
            .as_ref()
            .and_then(|cfg| cfg.derive_key(&body.old_password).ok());
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
    *auth.write().unwrap() = Some(new_auth);
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
    State(auth): State<Arc<RwLock<Option<AuthConfig>>>>,
    State(sessions): State<Arc<Mutex<SessionStore>>>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let initialized = auth.read().unwrap().is_some();
    let authenticated = match extract_session_token(&headers) {
        Some(token) => sessions.lock().await.validate(&token),
        None => false,
    };
    Json(ApiResponse::ok(AuthStatus {
        initialized,
        authenticated,
    }))
}

pub fn extract_session_token(headers: &axum::http::HeaderMap) -> Option<String> {
    let cookie_header = headers.get(header::COOKIE)?.to_str().ok()?;
    cookie_header.split(';').find_map(|part| {
        let part = part.trim();
        part.strip_prefix("session=").map(|v| v.to_string())
    })
}
