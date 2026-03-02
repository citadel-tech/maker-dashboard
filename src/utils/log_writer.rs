use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tracing_subscriber::fmt::MakeWriter;

/// A writer that either writes to a per-maker log file + stdout, or just stdout.
pub enum LogWriter {
    Tee(File, io::Stdout),
    Stdout(io::Stdout),
}

impl Write for LogWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        match self {
            LogWriter::Tee(f, s) => {
                f.write_all(buf)?;
                s.write_all(buf)?;
                Ok(buf.len())
            }
            LogWriter::Stdout(s) => s.write(buf),
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        match self {
            LogWriter::Tee(f, s) => {
                f.flush()?;
                s.flush()
            }
            LogWriter::Stdout(s) => s.flush(),
        }
    }
}

/// A `MakeWriter` implementation that routes logs to per-maker files
/// based on the current thread name. Threads named `legacy-{id}` or
/// `taproot-{id}` get their own log file under `{log_dir}/maker-{id}.log`.
/// All other threads write to stdout.
#[derive(Clone)]
pub struct MakerLogWriter {
    log_dir: PathBuf,
}

/// Global cache of open file handles, keyed by maker id.
static FILE_CACHE: OnceLock<Mutex<HashMap<String, PathBuf>>> = OnceLock::new();

fn file_cache() -> &'static Mutex<HashMap<String, PathBuf>> {
    FILE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

impl MakerLogWriter {
    pub fn new(log_dir: impl Into<PathBuf>) -> Self {
        let log_dir = log_dir.into();
        fs::create_dir_all(&log_dir).expect("Failed to create log directory");
        Self { log_dir }
    }

    /// Extracts the maker id from thread names like `legacy-mymaker` or `taproot-mymaker`.
    fn extract_maker_id() -> Option<String> {
        std::thread::current()
            .name()
            .and_then(|name| {
                name.strip_prefix("legacy-")
                    .or_else(|| name.strip_prefix("taproot-"))
            })
            .map(|id| id.to_string())
    }

    fn open_log_file(&self, maker_id: &str) -> io::Result<File> {
        let mut cache = file_cache().lock().unwrap();
        let path = cache
            .entry(maker_id.to_string())
            .or_insert_with(|| self.log_dir.join(format!("maker-{}.log", maker_id)));

        OpenOptions::new().create(true).append(true).open(path)
    }
}

impl<'a> MakeWriter<'a> for MakerLogWriter {
    type Writer = LogWriter;

    fn make_writer(&'a self) -> Self::Writer {
        match Self::extract_maker_id() {
            Some(id) => match self.open_log_file(&id) {
                Ok(file) => LogWriter::Tee(file, io::stdout()),
                Err(_) => LogWriter::Stdout(io::stdout()),
            },
            None => LogWriter::Stdout(io::stdout()),
        }
    }
}
