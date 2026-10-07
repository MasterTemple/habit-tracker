//! Email over SMTP (any provider: set SMTP_URL and EMAIL_FROM). Off when not configured:
//! nothing is queued for email then. Tests use an in-memory mailbox.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use lettre::message::{Attachment, Mailbox, MultiPart, SinglePart, header::ContentType};
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::error::ApiResult;
use crate::outbox;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EmailAttachment {
    pub filename: String,
    pub content_type: String,
    /// Base64 contents.
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EmailJob {
    pub to: String,
    pub subject: String,
    pub text: String,
    #[serde(default)]
    pub html: Option<String>,
    #[serde(default)]
    pub attachments: Vec<EmailAttachment>,
}

type SendFuture<'a> = Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>>;

pub trait Mailer: Send + Sync {
    fn send<'a>(&'a self, job: &'a EmailJob) -> SendFuture<'a>;
}

pub struct SmtpMailer {
    transport: AsyncSmtpTransport<Tokio1Executor>,
    from: Mailbox,
}

impl SmtpMailer {
    /// `url` like `smtps://user:pass@smtp.example.com:465` or `smtp://localhost:1025`.
    pub fn new(url: &str, from: &str) -> Result<Self, String> {
        let transport = AsyncSmtpTransport::<Tokio1Executor>::from_url(url)
            .map_err(|e| format!("SMTP_URL: {e}"))?
            .build();
        let from = from.parse().map_err(|e| format!("EMAIL_FROM: {e}"))?;
        Ok(Self { transport, from })
    }
}

impl Mailer for SmtpMailer {
    fn send<'a>(&'a self, job: &'a EmailJob) -> SendFuture<'a> {
        Box::pin(async move {
            let to: Mailbox = job.to.parse().map_err(|e| format!("to {}: {e}", job.to))?;
            let body = match &job.html {
                Some(html) => MultiPart::alternative_plain_html(job.text.clone(), html.clone()),
                None => MultiPart::mixed().singlepart(SinglePart::plain(job.text.clone())),
            };
            let mut multipart = MultiPart::mixed().multipart(body);
            for a in &job.attachments {
                let data = B64.decode(&a.data).map_err(|e| e.to_string())?;
                let content_type =
                    ContentType::parse(&a.content_type).map_err(|e| e.to_string())?;
                multipart = multipart
                    .singlepart(Attachment::new(a.filename.clone()).body(data, content_type));
            }
            let message = Message::builder()
                .from(self.from.clone())
                .to(to)
                .subject(&job.subject)
                .multipart(multipart)
                .map_err(|e| e.to_string())?;
            self.transport
                .send(message)
                .await
                .map(drop)
                .map_err(|e| e.to_string())
        })
    }
}

/// Collects sent mail, for tests.
#[derive(Default, Clone)]
pub struct MemoryMailer(pub Arc<Mutex<Vec<EmailJob>>>);

impl Mailer for MemoryMailer {
    fn send<'a>(&'a self, job: &'a EmailJob) -> SendFuture<'a> {
        self.0.lock().unwrap().push(job.clone());
        Box::pin(async { Ok(()) })
    }
}

/// Loose sanity check (the provider has the final say).
pub fn looks_like_email(s: &str) -> bool {
    let s = s.trim();
    s.len() <= 254
        && s.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty() && domain.contains('.') && !s.contains(' ')
        })
}

/// Queues an email if this server has email set up. Returns whether it was queued.
pub async fn queue(
    state: &AppState,
    user_id: &str,
    job: EmailJob,
    dedupe: &str,
) -> ApiResult<bool> {
    if state.mailer.is_none() || !looks_like_email(&job.to) {
        return Ok(false);
    }
    let to = job.to.clone();
    outbox::enqueue(state, user_id, "email", &to, &job, dedupe).await?;
    Ok(true)
}

/// A user's email address, if they set one.
pub async fn user_email(state: &AppState, user_id: &str) -> ApiResult<Option<String>> {
    let email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = ?")
        .bind(user_id)
        .fetch_one(&state.db)
        .await?;
    Ok(Some(email).filter(|e| looks_like_email(e)))
}

/// Minimal HTML version of a plain-text message (escaped, line breaks kept).
pub fn html_from_text(text: &str) -> String {
    let escaped = text
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    format!(
        "<div style=\"font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5\">{}</div>",
        escaped.replace('\n', "<br>")
    )
}
