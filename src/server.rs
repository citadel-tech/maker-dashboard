use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;

use axum::{middleware::from_fn, middleware::from_fn_with_state, Router};
use tokio::sync::Mutex;
#[cfg(not(feature = "embed-frontend"))]
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_axum::router::OpenApiRouter;
use utoipa_swagger_ui::SwaggerUi;

use crate::api::{api_router, ApiDoc, AppState};
use crate::middlewares;
use crate::utils::default_config_dir;

/// Frontend assets embedded into the binary at compile time (release builds).
/// The directory must exist when compiling with this feature — the release
/// workflow builds the frontend before `cargo build --features embed-frontend`.
#[cfg(feature = "embed-frontend")]
#[derive(rust_embed::RustEmbed)]
#[folder = "frontend/build/client"]
struct FrontendAssets;

/// Serves an embedded frontend asset, falling back to `index.html` for unknown
/// paths so client-side routing (SPA) works.
#[cfg(feature = "embed-frontend")]
async fn serve_embedded_frontend(uri: axum::http::Uri) -> axum::response::Response {
    use axum::http::{header, StatusCode};
    use axum::response::IntoResponse;

    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    match FrontendAssets::get(path).or_else(|| FrontendAssets::get("index.html")) {
        Some(file) => {
            let mime = file.metadata.mimetype().to_string();
            ([(header::CONTENT_TYPE, mime)], file.data.into_owned()).into_response()
        }
        None => (StatusCode::NOT_FOUND, "Not Found").into_response(),
    }
}

/// Configuration for the HTTP server
pub struct ServerConfig {
    /// IP address to bind to. Defaults to 127.0.0.1
    pub host: IpAddr,
    /// Port to listen on. Defaults to 3000
    pub port: u16,
    /// Path to the frontend static files directory.
    /// Unused when built with `embed-frontend` (assets are baked into the binary).
    #[cfg_attr(feature = "embed-frontend", allow(dead_code))]
    pub frontend_path: PathBuf,
    /// Path for the fallback SPA index file.
    /// Unused when built with `embed-frontend` (assets are baked into the binary).
    #[cfg_attr(feature = "embed-frontend", allow(dead_code))]
    pub spa_index: PathBuf,
    /// Whether to restrict access to localhost only
    pub localhost_only: bool,
    /// Whether to set the Secure attribute on session cookies
    pub secure_cookies: bool,
    /// Application config/data directory (e.g. ~/.config/maker-dashboard)
    pub config_dir: PathBuf,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: IpAddr::V4(Ipv4Addr::LOCALHOST),
            port: 3000,
            frontend_path: PathBuf::from("frontend/build/client"),
            spa_index: PathBuf::from("frontend/build/client/index.html"),
            localhost_only: true,
            secure_cookies: true,
            config_dir: default_config_dir(),
        }
    }
}

/// The application server
pub struct Server {
    config: ServerConfig,
    state: AppState,
}

impl Server {
    /// Creates a new server with the given config and a fresh MakerManager.
    ///
    /// Bootstrap flow:
    /// - If `auth.json` exists, the dashboard is already initialized. The
    ///   maker manager starts in the "locked" state — no AES key is held until
    ///   the user logs in via `POST /api/auth/login`.
    /// - If `auth.json` does NOT exist, the dashboard waits for
    ///   `POST /api/auth/setup` to complete first-run setup.
    pub fn new(config: ServerConfig) -> anyhow::Result<Self> {
        use crate::auth::{AuthConfig, SessionStore};

        std::fs::create_dir_all(&config.config_dir).map_err(|e| {
            anyhow::anyhow!(
                "Failed to create config directory {}: {e}",
                config.config_dir.display()
            )
        })?;

        let auth_config = AuthConfig::load(&config.config_dir)?;

        // The maker manager always starts WITHOUT a key. If makers.json is
        // encrypted, the load is deferred until login. If makers.json is
        // missing or legacy plaintext, the deferred-load path is a no-op.
        let manager = crate::maker_manager::MakerManager::new(config.config_dir.clone(), None)?;

        if auth_config.is_none() {
            tracing::info!(
                "First-run setup required. Visit http://{}:{}/setup to initialize.",
                config.host,
                config.port
            );
        }

        let state = AppState {
            makers: Arc::new(Mutex::new(manager)),
            sessions: Arc::new(Mutex::new(SessionStore::new())),
            auth: Arc::new(std::sync::RwLock::new(auth_config)),
            setup_lock: Arc::new(Mutex::new(())),
            config_dir: Arc::new(config.config_dir.clone()),
            secure_cookies: config.secure_cookies,
        };

        Ok(Self { config, state })
    }

    /// Returns the socket address the server will bind to
    pub fn addr(&self) -> SocketAddr {
        SocketAddr::new(self.config.host, self.config.port)
    }

    /// Builds the Axum application router
    pub fn build_router(&self) -> Router {
        let (router, api) = OpenApiRouter::with_openapi(ApiDoc::openapi())
            .nest("/api", api_router().into())
            .split_for_parts();

        let mut app = router
            .merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", api))
            .with_state(self.state.clone())
            .layer(from_fn_with_state(
                self.state.clone(),
                middlewares::auth_middleware,
            ))
            .layer(TraceLayer::new_for_http());

        if self.config.localhost_only {
            app = app.layer(from_fn(middlewares::restrict_to_localhost));
        }

        // Serve the frontend: embedded in the binary when built with
        // `embed-frontend`, otherwise from disk via `frontend_path`.
        #[cfg(feature = "embed-frontend")]
        {
            app.fallback(serve_embedded_frontend)
        }
        #[cfg(not(feature = "embed-frontend"))]
        {
            let serve_dir = ServeDir::new(&self.config.frontend_path)
                .not_found_service(ServeFile::new(&self.config.spa_index));
            app.fallback_service(serve_dir)
        }
    }

    /// Starts the server and blocks until shutdown
    pub async fn run(self) -> anyhow::Result<()> {
        let addr = self.addr();
        let app = self.build_router();

        tracing::info!("Server running on http://{}", addr);
        if self.config.localhost_only {
            tracing::info!(
                "Localhost requests only are accepted. All requests from outside machine are forbidden for security reasons."
            );
        }
        if !self.config.secure_cookies {
            tracing::warn!(
                "Secure cookies are disabled. Use this only for trusted plain HTTP deployments."
            );
        }
        tracing::info!("API docs available at http://{}/swagger-ui/", addr);

        let listener = tokio::net::TcpListener::bind(addr).await.map_err(|e| {
            anyhow::anyhow!("Failed to bind to {addr}. Is the port already in use? {e}")
        })?;

        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(shutdown_signal())
        .await?;

        tracing::info!("Server stopped");
        Ok(())
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let sigterm = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let sigterm = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => tracing::info!("Received Ctrl+C, shutting down..."),
        _ = sigterm => tracing::info!("Received SIGTERM, shutting down..."),
    }
}
