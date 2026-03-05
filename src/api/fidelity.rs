use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};

use super::{dto::ApiResponse, AppState};
use crate::maker_manager::message::MessageResponse;

pub fn routes() -> Router<AppState> {
    Router::new().route("/makers/{id}/fidelity", get(list_fidelity))
}

/// List all fidelity bonds for a maker
#[utoipa::path(
    get,
    path = "/api/makers/{id}/fidelity",
    tag = "fidelity",
    params(("id" = String, Path, description = "Maker ID")),
    responses(
        (status = 200, description = "List of fidelity bonds", body = ApiResponse<String>),
        (status = 404, description = "Maker not found", body = ApiResponse<String>),
        (status = 500, description = "Internal error", body = ApiResponse<String>)
    )
)]
async fn list_fidelity(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<String>>) {
    if !state.lock().await.has_maker(&id) {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::err(format!("Maker '{}' not found", id))),
        );
    }
    match state.lock().await.list_fidelity(&id).await {
        Ok(MessageResponse::ListBonds(bonds)) => (StatusCode::OK, Json(ApiResponse::ok(bonds))),
        Ok(MessageResponse::ServerError(e)) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ApiResponse::err(e)))
        }
        Ok(other) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Unexpected response: {}", other))),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e.to_string())),
        ),
    }
}
