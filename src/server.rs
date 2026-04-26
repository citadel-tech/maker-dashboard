use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;

use axum::{middleware::from_fn, middleware::from_fn_with_state, Router};
use tokio::sync::Mutex;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_axum::router::OpenApiRouter;
use utoipa_swagger_ui::SwaggerUi;

use crate::api::{api_router, ApiDoc, AppState};
use crate::middlewares;
use crate::utils::default_config_dir;

/// Configuration for the HTTP server
pub struct ServerConfig {
    /// IP address to bind to. Defaults to 127.0.0.1
    pub host: IpAddr,
    /// Port to listen on. Defaults to 3000
    pub port: u16,
    /// Path to the frontend static files directory
    pub frontend_path: PathBuf,
    /// Path for the fallback SPA index file
    pub spa_index: PathBuf,
    /// Whether to restrict access to localhost only
    pub localhost_only: bool,
    /// Application config/data directory (e.g. ~/.config/maker-dashboard)
    pub config_dir: PathBuf,
    /// Password for dashboard authentication and data encryption
    pub password: String,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: IpAddr::V4(Ipv4Addr::LOCALHOST),
            port: 3000,
            frontend_path: PathBuf::from("frontend/build/client"),
            spa_index: PathBuf::from("frontend/build/client/index.html"),
            localhost_only: true,
            config_dir: default_config_dir(),
            password: String::new(),
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
    /// Loads any previously persisted maker registrations.
    pub fn new(config: ServerConfig) -> anyhow::Result<Self> {
        use crate::auth::{AuthConfig, SessionStore};

        std::fs::create_dir_all(&config.config_dir).map_err(|e| {
            anyhow::anyhow!(
                "Failed to create config directory {}: {e}",
                config.config_dir.display()
            )
        })?;

        // Load or create auth config
        let auth_config = match AuthConfig::load(&config.config_dir)? {
            Some(cfg) => {
                if !cfg.verify(&config.password)? {
                    anyhow::bail!(
                        "Incorrect password — does not match the stored hash in auth.json"
                    );
                }
                cfg
            }
            None => {
                let cfg = AuthConfig::new(&config.password)?;
                cfg.save(&config.config_dir)?;
                tracing::info!(
                    "Initialized new auth config at {}",
                    config.config_dir.display()
                );
                cfg
            }
        };

        let enc_key = auth_config.derive_key(&config.password)?;

        let manager =
            crate::maker_manager::MakerManager::new(config.config_dir.clone(), Some(enc_key))?;

        let state = AppState {
            makers: Arc::new(Mutex::new(manager)),
            sessions: Arc::new(Mutex::new(SessionStore::new())),
            auth: Arc::new(auth_config),
        };

        Ok(Self { config, state })
    }

    /// Returns the socket address the server will bind to
    pub fn addr(&self) -> SocketAddr {
        SocketAddr::new(self.config.host, self.config.port)
    }

    /// Builds the Axum application router
    pub fn build_router(&self) -> Router {
        let serve_dir = ServeDir::new(&self.config.frontend_path)
            .not_found_service(ServeFile::new(&self.config.spa_index));

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

        app.fallback_service(serve_dir)
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
        tracing::info!("API docs available at http://{}/swagger-ui/", addr);

        let listener = tokio::net::TcpListener::bind(addr).await.map_err(|e| {
            anyhow::anyhow!("Failed to bind to {addr}. Is the port already in use? {e}")
        })?;

        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await?;

        Ok(())
    }
}
