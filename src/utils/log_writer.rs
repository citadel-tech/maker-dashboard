use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
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
                let stripped = strip_ansi(buf);
                f.write_all(&stripped)?;
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

/// Efficiently reads the last `n` lines from a file by seeking from the end.
/// Returns the lines in order (oldest to newest).
pub fn read_last_n_lines(path: &PathBuf, n: usize) -> io::Result<Vec<String>> {
    let mut file = File::open(path)?;
    let file_len = file.metadata()?.len();

    if file_len == 0 {
        return Ok(Vec::new());
    }

    const CHUNK_SIZE: u64 = 8192;
    let mut newline_positions = Vec::new();
    let mut pos = file_len;
    let mut buf = Vec::new();

    while pos > 0 && newline_positions.len() <= n {
        let read_size = CHUNK_SIZE.min(pos);
        pos -= read_size;
        file.seek(SeekFrom::Start(pos))?;

        let mut chunk = vec![0u8; read_size as usize];
        file.read_exact(&mut chunk)?;

        chunk.append(&mut buf);
        buf = chunk;

        newline_positions.clear();
        newline_positions.push(0);
        for (i, &b) in buf.iter().enumerate() {
            if b == b'\n' && i + 1 < buf.len() {
                newline_positions.push(i + 1);
            }
        }
    }

    let text = String::from_utf8_lossy(&buf);
    let all_lines: Vec<&str> = text.lines().collect();
    let start = all_lines.len().saturating_sub(n);
    Ok(all_lines[start..].iter().map(|s| s.to_string()).collect())
}

/// Strips ANSI escape codes from a byte slice.
fn strip_ansi(buf: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(buf.len());
    let mut i = 0;
    while i < buf.len() {
        // ESC [ ... m  — CSI sequences
        if buf[i] == 0x1b && buf.get(i + 1) == Some(&b'[') {
            i += 2;
            while i < buf.len() && !buf[i].is_ascii_alphabetic() {
                i += 1;
            }
            i += 1;
        } else {
            out.push(buf[i]);
            i += 1;
        }
    }
    out
}
