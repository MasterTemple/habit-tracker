//! Web Push: message encryption (RFC 8291, aes128gcm), server identification (VAPID,
//! RFC 8292), subscriptions, and sending. Pure Rust crypto, so no OpenSSL.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes128Gcm, Nonce};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header::USER_AGENT};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use chrono::{DateTime, TimeDelta, Utc};
use hkdf::Hkdf;
use p256::ecdh::EphemeralSecret;
use p256::ecdsa::signature::Signer;
use p256::ecdsa::{Signature, SigningKey};
use p256::elliptic_curve::sec1::ToEncodedPoint;
use p256::{PublicKey, SecretKey};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::Sha256;
use sqlx::SqlitePool;

use crate::AppState;
use crate::auth::AuthUser;
use crate::clock::timestamp;
use crate::error::{ApiError, ApiResult};

const RECORD_SIZE: u32 = 4096;

// ---------- encryption (RFC 8291) ----------

/// Encrypts `payload` for one browser subscription (its `p256dh` public key and `auth`
/// secret, both base64url). Returns the request body.
pub fn encrypt(p256dh: &str, auth: &str, payload: &[u8]) -> Result<Vec<u8>, String> {
    let ua_public_bytes = B64.decode(p256dh).map_err(|e| format!("p256dh: {e}"))?;
    let auth_secret = B64.decode(auth).map_err(|e| format!("auth: {e}"))?;
    let ua_public =
        PublicKey::from_sec1_bytes(&ua_public_bytes).map_err(|e| format!("p256dh: {e}"))?;
    if payload.len() + 17 > RECORD_SIZE as usize {
        return Err("payload too large".into());
    }

    let as_secret = EphemeralSecret::random(&mut OsRng);
    let as_public = as_secret.public_key().to_encoded_point(false);
    let shared = as_secret.diffie_hellman(&ua_public);

    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let (cek, nonce) = derive_keys(
        shared.raw_secret_bytes(),
        &auth_secret,
        &ua_public_bytes,
        as_public.as_bytes(),
        &salt,
    );

    // One record: the payload followed by the 0x02 "last record" delimiter.
    let mut plaintext = payload.to_vec();
    plaintext.push(2);
    let ciphertext = Aes128Gcm::new_from_slice(&cek)
        .expect("16-byte key")
        .encrypt(Nonce::from_slice(&nonce), plaintext.as_slice())
        .map_err(|e| e.to_string())?;

    let mut body = Vec::with_capacity(16 + 4 + 1 + 65 + ciphertext.len());
    body.extend_from_slice(&salt);
    body.extend_from_slice(&RECORD_SIZE.to_be_bytes());
    body.push(as_public.as_bytes().len() as u8);
    body.extend_from_slice(as_public.as_bytes());
    body.extend_from_slice(&ciphertext);
    Ok(body)
}

/// The content-encryption key and nonce, from the ECDH secret and the subscription's
/// auth secret (RFC 8291 §3.4 and RFC 8188 §2.2).
pub fn derive_keys(
    ecdh: &[u8],
    auth_secret: &[u8],
    ua_public: &[u8],
    as_public: &[u8],
    salt: &[u8],
) -> ([u8; 16], [u8; 12]) {
    let mut key_info = b"WebPush: info\0".to_vec();
    key_info.extend_from_slice(ua_public);
    key_info.extend_from_slice(as_public);
    let mut ikm = [0u8; 32];
    Hkdf::<Sha256>::new(Some(auth_secret), ecdh)
        .expand(&key_info, &mut ikm)
        .expect("valid length");

    let prk = Hkdf::<Sha256>::new(Some(salt), &ikm);
    let mut cek = [0u8; 16];
    let mut nonce = [0u8; 12];
    prk.expand(b"Content-Encoding: aes128gcm\0", &mut cek)
        .expect("valid length");
    prk.expand(b"Content-Encoding: nonce\0", &mut nonce)
        .expect("valid length");
    (cek, nonce)
}

// ---------- VAPID (RFC 8292) ----------

/// This server's push identity: a P-256 key pair created once and kept in the database.
pub struct Vapid {
    key: SigningKey,
    /// Uncompressed public key, base64url: the app's `applicationServerKey`.
    pub public_key: String,
    subject: String,
}

impl Vapid {
    pub async fn load_or_create(db: &SqlitePool, subject: &str) -> Result<Self, sqlx::Error> {
        let stored: Option<String> =
            sqlx::query_scalar("SELECT value FROM server_keys WHERE name = 'vapid_private'")
                .fetch_optional(db)
                .await?;
        let secret = match stored
            .and_then(|s| B64.decode(s).ok())
            .and_then(|b| SecretKey::from_slice(&b).ok())
        {
            Some(secret) => secret,
            None => {
                let secret = SecretKey::random(&mut OsRng);
                sqlx::query(
                    "INSERT OR REPLACE INTO server_keys (name, value) VALUES ('vapid_private', ?)",
                )
                .bind(B64.encode(secret.to_bytes()))
                .execute(db)
                .await?;
                secret
            }
        };
        let public_key = B64.encode(secret.public_key().to_encoded_point(false).as_bytes());
        Ok(Self {
            key: SigningKey::from(secret),
            public_key,
            subject: subject.to_string(),
        })
    }

    /// The `Authorization` header value for a request to `endpoint`.
    pub fn authorization(&self, endpoint: &str, now: DateTime<Utc>) -> Result<String, String> {
        let url = url::Url::parse(endpoint).map_err(|e| e.to_string())?;
        let audience = url.origin().ascii_serialization();
        let header = B64.encode(br#"{"typ":"JWT","alg":"ES256"}"#);
        let claims = B64.encode(
            json!({ "aud": audience, "exp": (now + TimeDelta::hours(12)).timestamp(), "sub": self.subject }).to_string(),
        );
        let signing_input = format!("{header}.{claims}");
        let signature: Signature = self.key.sign(signing_input.as_bytes());
        Ok(format!(
            "vapid t={signing_input}.{}, k={}",
            B64.encode(signature.to_bytes()),
            self.public_key
        ))
    }
}

// ---------- which endpoints are allowed ----------

/// Push services browsers use. Anything else is refused, so an account can't make the
/// server send requests to arbitrary (e.g. internal) addresses.
const PUSH_HOSTS: &[&str] = &[
    "web.push.apple.com",
    "fcm.googleapis.com",
    "updates.push.services.mozilla.com",
    "notify.windows.com",
    "push.apple.com",
];

pub fn endpoint_allowed(endpoint: &str, allow_any: bool) -> bool {
    let Ok(url) = url::Url::parse(endpoint) else {
        return false;
    };
    if allow_any {
        return matches!(url.scheme(), "http" | "https");
    }
    let host = url.host_str().unwrap_or_default();
    url.scheme() == "https"
        && PUSH_HOSTS
            .iter()
            .any(|h| host == *h || host.ends_with(&format!(".{h}")))
}

// ---------- HTTP ----------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/push/key", get(public_key))
        .route("/push/subscribe", post(subscribe).delete(unsubscribe))
        .route("/push/test", post(send_test))
}

async fn public_key(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({ "publicKey": state.vapid.public_key }))
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SubscriptionKeys {
    pub p256dh: String,
    pub auth: String,
}

#[derive(Deserialize)]
struct Subscription {
    endpoint: String,
    keys: SubscriptionKeys,
}

async fn subscribe(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Json(sub): Json<Subscription>,
) -> ApiResult<StatusCode> {
    if !endpoint_allowed(&sub.endpoint, state.config.allow_private_targets) {
        return Err(ApiError::BadRequest(
            "That isn't a supported push service".into(),
        ));
    }
    let valid_key = B64
        .decode(&sub.keys.p256dh)
        .ok()
        .is_some_and(|k| PublicKey::from_sec1_bytes(&k).is_ok());
    if !valid_key || B64.decode(&sub.keys.auth).map_or(true, |a| a.len() != 16) {
        return Err(ApiError::BadRequest("Invalid subscription keys".into()));
    }
    let agent: String = headers
        .get(USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .chars()
        .take(200)
        .collect();
    // A device re-subscribing (or moving to another account) replaces its old entry.
    sqlx::query(
        "INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
           user_agent = excluded.user_agent",
    )
    .bind(&sub.endpoint)
    .bind(&auth.user_id)
    .bind(&sub.keys.p256dh)
    .bind(&sub.keys.auth)
    .bind(agent)
    .bind(timestamp(state.clock.now()))
    .execute(&state.db)
    .await?;
    Ok(StatusCode::CREATED)
}

#[derive(Deserialize)]
struct Unsubscribe {
    endpoint: String,
}

async fn unsubscribe(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<Unsubscribe>,
) -> ApiResult<StatusCode> {
    sqlx::query("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?")
        .bind(&req.endpoint)
        .bind(&auth.user_id)
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Sends "Notifications are working" to all of the caller's devices.
async fn send_test(
    State(state): State<AppState>,
    auth: AuthUser,
) -> ApiResult<Json<serde_json::Value>> {
    let now = state.clock.now();
    let devices = crate::notifications::notify(
        &state,
        &auth.user_id,
        crate::notifications::Notice {
            kind: "test".into(),
            title: "Notifications are working".into(),
            body: "You'll get reminders and alerts here.".into(),
            url: None,
            dedupe: format!("test:{}", now.timestamp_millis()),
            data: json!({}),
        },
        &[crate::notifications::Channel::Push],
    )
    .await?;
    crate::outbox::process_due(&state).await;
    Ok(Json(json!({ "devices": devices })))
}

/// What the service worker receives (decrypted): shown as a notification.
#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub struct PushPayload {
    pub title: String,
    pub body: String,
    pub url: Option<String>,
    pub tag: Option<String>,
    #[serde(rename = "inboxId")]
    pub inbox_id: Option<String>,
}

pub enum SendResult {
    Sent,
    /// The subscription is gone (unsubscribed / expired): stop using it.
    Gone,
    Retry(String),
}

/// Sends one encrypted push message.
pub async fn send(
    state: &AppState,
    endpoint: &str,
    keys: &SubscriptionKeys,
    payload: &PushPayload,
) -> SendResult {
    if !endpoint_allowed(endpoint, state.config.allow_private_targets) {
        return SendResult::Gone;
    }
    let body = match encrypt(
        &keys.p256dh,
        &keys.auth,
        &serde_json::to_vec(payload).expect("serializable"),
    ) {
        Ok(b) => b,
        Err(e) => return SendResult::Retry(format!("encrypt: {e}")),
    };
    let authorization = match state.vapid.authorization(endpoint, state.clock.now()) {
        Ok(a) => a,
        Err(e) => return SendResult::Retry(format!("vapid: {e}")),
    };
    let res = state
        .http
        .post(endpoint)
        .header("authorization", authorization)
        .header("content-encoding", "aes128gcm")
        .header("content-type", "application/octet-stream")
        .header("ttl", "86400")
        .header("urgency", "normal")
        .body(body)
        .send()
        .await;
    match res {
        Ok(r) if r.status().is_success() => SendResult::Sent,
        Ok(r) if matches!(r.status().as_u16(), 404 | 410) => SendResult::Gone,
        Ok(r) => SendResult::Retry(format!("push service answered {}", r.status())),
        Err(e) => SendResult::Retry(e.to_string()),
    }
}
