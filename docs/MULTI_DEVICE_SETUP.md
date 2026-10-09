# Running DeployStack on Three Devices (Version 7)

| Device | Role | What runs on it |
|---|---|---|
| **1. Platform laptop** (admin) | DeployStack itself | Backend `:3000`, websites `:5173` (customer portal `/` + admin site `/admin`), all saved data |
| **2. Linux laptop** (server) | Where customers' apps run | SSH server, Docker, git. The apps themselves on ports `4000-5000` |
| **3. Customer device** (any laptop or phone) | The customer | Only a web browser |

```
 3. Customer device              1. Platform laptop (admin)                    2. Linux laptop (server)
 ┌────────────────────┐  HTTP   ┌──────────────────────────────┐   SSH       ┌──────────────────────────┐
 │ Browser            │ ──────► │ Frontend :5173  Backend :3000 │ ──────────► │ git clone, docker build,  │
 │ http://<platform>  │         │ accounts, apps, logs (JSON)   │ (platform   │ docker run                │
 │        :5173/      │         │ platform SSH key              │  key)       │ ~/paas-apps/<app>/        │
 │                    │ ◄───────┼───────── "Open App" ──────────┼──────────── │ app on :4000              │
 └────────────────────┘         └──────────────────────────────┘             └──────────────────────────┘
          └──────────────────────── opens http://<linux-laptop-IP>:4000 ───────────────────────┘
```

All three must be on the **same Wi-Fi / network**.

## 1. Linux laptop (the server) - once

Run in a terminal (Ubuntu/Debian):
```
sudo apt update && sudo apt install -y openssh-server git curl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # then log out and log in again
ip -4 addr                         # note the IP, e.g. 192.168.1.30
```
If the firewall is on (`sudo ufw status`): `sudo ufw allow OpenSSH && sudo ufw allow 4000:5000/tcp`.

## 2. Platform laptop (admin)

1. Start Docker Desktop (only needed if you also deploy to the platform laptop itself).
2. `cd core-platform/backend && npm run start:dev` (`.env` has `HOST=0.0.0.0`). The console prints the
   customer link, e.g. `http://192.168.1.20:5173/` (the front page; **Create account** leads to `/login?signup`).
3. `cd core-platform/frontend && npm run dev`
4. Open **http://localhost:5173/admin**, create the admin account (first time only).
5. **Private Servers → Add a server**:
   - Step 1 shows the commands from section 1 above.
   - Step 2 shows **one command** - run it **on the Linux laptop**. It adds the platform's *public* key to
     `~/.ssh/authorized_keys`, so DeployStack can log in without a password.
   - Step 3: name `linux-laptop`, the Linux laptop's IP, its user name (e.g. `ubuntu`), port 22 →
     **Connect & check**. All five checks must be green: SSH, Docker, git, apps folder, Docker network.
     A red check shows the exact command that fixes it.
   - Keep **"Customers can deploy their apps to this server"** ticked.
6. Recommended: on the **localhost (this machine)** card, untick "Customers can deploy here", so customers'
   apps only go to the Linux laptop.

Windows firewall on the platform laptop: allow Node.js on **Private networks** (or allow inbound TCP 3000 and 5173).

## 3. Customer device

1. Open the link from step 2, e.g. **http://192.168.1.20:5173/**, and click **Create account** (or go straight to `/login`).
2. Create account → **New application** → choose the type (e.g. Flask) → paste the GitHub link.
   "Deploy to server" already shows **linux-laptop** → **Create & deploy**.
3. The live log says `Target: linux-laptop (ubuntu@192.168.1.30 over SSH)`. When it finishes,
   **Open App** goes to `http://192.168.1.30:4000` - the app is running on the Linux laptop.
4. Optional - "bring your own server": **Add my server** (bottom of the portal) uses the same three steps.
   That server belongs to this customer: other customers cannot see or use it (the admin can see it).

## 4. Where everything is saved

| What | Where |
|---|---|
| Accounts, logins, app records, deploy history | Platform laptop: `C:\Users\<you>\.paas-data\*.json` |
| The platform SSH key (private + public) | Platform laptop: `C:\Users\<you>\.paas-data\platform_ssh_key.json` - **never share it** |
| The customer's code (cloned from GitHub) | Linux laptop: `/home/<user>/paas-apps/<app-name>/` |
| Built images and running apps | Linux laptop: Docker (`docker images`, `docker ps`) |

The admin site's **Data & Storage** page shows all of this with exact paths, including which app's code is on which server.

## 5. How it works (for the viva)

1. The platform has one SSH key pair (ed25519), created on first start. The server trusts its public key.
2. For every deploy the backend opens an SSH session to the server and runs, one by one:
   `git clone` → write `Dockerfile.deploystack` → `docker build` → `docker run -p 4000:5000 …` →
   `docker inspect` until the container stays up → on failure, put the previous container back (rollback).
3. Every argument is single-quoted before it is sent, and every command runs under `timeout`, so a repo
   URL or branch name can never become a shell command, and nothing can hang forever.
4. Output is streamed back line by line into the live log the customer sees.

This is the same model as Coolify: the control panel only orchestrates over SSH; the server does the work.

## 6. Not done yet

- HTTPS and domain names (Traefik) on the Linux server - apps are opened by IP and port.
- The AI Health Monitor only watches containers on the platform laptop, not on the Linux server.
- No password reset / login rate limit; the admin cannot disable a customer yet.
