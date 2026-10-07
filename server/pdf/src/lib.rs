//! PDF reports rendered with Typst, entirely in memory.
//!
//! The template (`report.typ`) is compiled into the binary and reads its data from a
//! virtual `data.json`, so names and notes are only ever data, never Typst markup.
//! Fonts come from `typst-assets` (Libertinus Serif, New Computer Modern, DejaVu Sans Mono).

use std::sync::OnceLock;

use typst::diag::{FileError, FileResult};
use typst::foundations::Duration;
use typst::foundations::{Bytes, Datetime};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};
use typst_layout::PagedDocument;

const REPORT: &str = include_str!("report.typ");

struct Fonts {
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
}

/// Parsed once; parsing the bundled fonts takes a moment.
fn fonts() -> &'static Fonts {
    static FONTS: OnceLock<Fonts> = OnceLock::new();
    FONTS.get_or_init(|| {
        let fonts: Vec<Font> = typst_assets::fonts()
            .flat_map(|data| {
                let bytes = Bytes::new(data);
                (0..).map_while(move |i| Font::new(bytes.clone(), i))
            })
            .collect();
        Fonts {
            book: LazyHash::new(FontBook::from_fonts(&fonts)),
            fonts,
        }
    })
}

fn library() -> &'static LazyHash<Library> {
    static LIBRARY: OnceLock<LazyHash<Library>> = OnceLock::new();
    LIBRARY.get_or_init(|| LazyHash::new(Library::default()))
}

fn file_id(path: &str) -> FileId {
    RootedPath::new(
        VirtualRoot::Project,
        VirtualPath::new(path).expect("valid path"),
    )
    .intern()
}

/// One template plus its data file.
struct ReportWorld {
    main: Source,
    data_id: FileId,
    data: Bytes,
}

impl World for ReportWorld {
    fn library(&self) -> &LazyHash<Library> {
        library()
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &fonts().book
    }

    fn main(&self) -> FileId {
        self.main.id()
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.main.id() {
            Ok(self.main.clone())
        } else {
            Err(FileError::AccessDenied)
        }
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        if id == self.data_id {
            Ok(self.data.clone())
        } else if id == self.main.id() {
            Ok(Bytes::from_string(self.main.text().to_string()))
        } else {
            Err(FileError::AccessDenied)
        }
    }

    fn font(&self, index: usize) -> Option<Font> {
        fonts().fonts.get(index).cloned()
    }

    fn today(&self, _offset: Option<Duration>) -> Option<Datetime> {
        // Reports carry their own dates; the template never asks.
        None
    }
}

/// Renders `template` with `data` available as `data.json`.
pub fn render(template: &str, data: &[u8]) -> Result<Vec<u8>, String> {
    let world = ReportWorld {
        main: Source::new(file_id("/main.typ"), template.to_string()),
        data_id: file_id("/data.json"),
        data: Bytes::new(data.to_vec()),
    };
    let document: PagedDocument = typst::compile(&world).output.map_err(|errors| {
        errors
            .iter()
            .map(|e| e.message.to_string())
            .collect::<Vec<_>>()
            .join("; ")
    })?;
    typst_pdf::pdf(&document, &typst_pdf::PdfOptions::default()).map_err(|errors| {
        errors
            .iter()
            .map(|e| e.message.to_string())
            .collect::<Vec<_>>()
            .join("; ")
    })
}

/// A progress report (see `report.typ` for the data it expects).
pub fn report_pdf(data: &serde_json::Value) -> Result<Vec<u8>, String> {
    render(REPORT, &serde_json::to_vec(data).expect("serializable"))
}
