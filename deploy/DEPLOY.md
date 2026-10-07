# Deploying the sync server

About 20 minutes. You'll end with the server at `https://<your domain>` and the web app using it.

What runs on the server (all in Docker, from `deploy/compose.yml`):

- **api**: the Rust server, with its SQLite database in a Docker volume.
- **caddy**: gets an HTTPS certificate for your domain automatically and forwards requests to `api`.
- **backup**: copies the database once a day, keeping 14 days.

## 1. Create the server (Hetzner)

1. Sign up at <https://console.hetzner.cloud> and create a project.
2. If you don't have an SSH key yet, make one on your computer: `ssh-keygen -t ed25519` (press Enter for the
   defaults). Your public key is in `~/.ssh/id_ed25519.pub`.
3. **Add Server**:
   - Location: **Ashburn, VA** or **Hillsboro, OR**.
   - Image: **Ubuntu 24.04**.
   - Type: the smallest shared-vCPU plan (2 vCPU, 2–4 GB RAM) is plenty.
   - SSH key: paste the contents of `~/.ssh/id_ed25519.pub`.
   - Firewall: create one allowing inbound **TCP 22, 80, 443** and **UDP 443**.
   - Backups: worth turning on (about 20% of the server price). They're off-machine copies, unlike the daily
     database copies the server makes itself.
4. Note the server's **IPv4 address**.

## 2. Point your domain at it

At your domain registrar's DNS settings, add an **A record**: name `habits` (or whatever subdomain you like),
value = the server's IPv4 address. If the server has an IPv6 address, add an **AAAA** record too.

Check it before continuing (it can take a few minutes): `dig +short habits.yourdomain.com` should print the IP.

## 3. Install and start

```sh
ssh root@<server IP>

# Updates install themselves; Docker.
apt update && apt -y upgrade && apt -y install unattended-upgrades git
curl -fsSL https://get.docker.com | sh

# The code.
git clone https://github.com/MasterTemple/habit-tracker.git /opt/habit-tracker
cd /opt/habit-tracker/deploy

# Settings: set DOMAIN and a long SIGNUP_CODE.
cp .env.example .env
nano .env

# Build and start (the first build takes several minutes).
docker compose up -d --build
```

Check it: `curl https://habits.yourdomain.com/health` should print `{"status":"ok",…}`. If it doesn't, see
`docker compose logs caddy` (certificate problems are usually DNS not pointing at the server yet) and
`docker compose logs api`.

## 4. Point the web app at it

On your computer, in the repo:

```sh
gh variable set SERVER_URL --body "https://habits.yourdomain.com"
gh workflow run deploy.yml
```

The next build of the web app uses that server by default. Then in the app: **Settings → Account & sync →
Create account**, with the sign-up code from `.env`. Your existing data on the phone uploads on first sign-in.

## Everyday operations

| What | Command (in `/opt/habit-tracker/deploy`) |
|---|---|
| Update to the latest code | `git pull && docker compose up -d --build` |
| Logs | `docker compose logs -f api` |
| Status | `docker compose ps` |
| Restart | `docker compose restart api` |
| List backups | `docker compose exec api ls -l /data/backups` |
| Copy a backup to your computer | `docker compose cp api:/data/backups/habits-YYYY-MM-DD.db .` then `scp` it |

### Restoring a backup

```sh
docker compose stop api
docker compose cp ./habits-YYYY-MM-DD.db api:/data/habits.db
docker compose start api
```

Devices that synced after that backup was taken get a "reset" on their next sync and send their data again, so
nothing they have is lost.
