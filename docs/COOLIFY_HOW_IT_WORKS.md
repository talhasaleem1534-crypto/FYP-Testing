# How Coolify Works, and What We Copy From It

Written in simple steps so every team member can explain it in the viva.
Sources: https://coolify.io/self-hosted, https://coolify.io/docs/choose-your-path,
https://coolify.io/docs/start-with-self-hosted, https://coolify.io/docs/get-started/concepts,
https://coolify.io/docs/applications/build-packs/overview (read October 2026).

---

## 1. What Coolify is

Coolify is an open-source "deploy platform" (like Heroku or Vercel) that runs on **servers you own**.
You give it a Git repository, it builds a Docker container from your code, starts it on your server and
puts a domain + HTTPS in front of it. Under the hood it is an **SSH + Docker orchestrator**: it logs into
your server with an SSH key and runs `git`, `docker build` and `docker run` there.

## 2. The "Self-hosted" page (coolify.io/self-hosted) - what it asks you

It asks you to do **one thing**: run the installer on your server.

```
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
```

The rest of the page is the "why": no surprise cloud bills, more CPU/RAM for your money, your data
stays with you, and every feature is free (no paid tier in the open-source version).

## 3. The "Choose your path" page (coolify.io/docs/choose-your-path)

Coolify has two parts that people often mix up:

| Part | What it is |
|---|---|
| **Control panel** | The Coolify website/dashboard itself (login, projects, deploy button, logs). |
| **Your servers** | The machines where your apps actually run. |

The two paths only differ in **who runs the control panel**:

| Path | Who runs the control panel | Who owns the servers | Cost |
|---|---|---|---|
| **Self-hosted** | You install Coolify yourself and keep it updated/backed up | You | Free |
| **Coolify Cloud** | The Coolify team runs it for you | **You still bring your own servers** | Monthly subscription |

On **both** paths, you are responsible for your servers' security (OS updates, SSH, firewall) and for your apps.

> **Important for us:** DeployStack works like the **Coolify Cloud** path: *we* run the control panel
> (login page, dashboard), and the **customer brings their own server**. We do not sell servers.

## 4. Coolify step by step (the full customer journey)

1. **Install** - run the install script on a server (needs 2 CPU, 2 GB RAM, 10 GB disk, SSH access, a fresh Linux).
2. **Open the dashboard** - `http://<server-ip>:8000`.
3. **Create the admin account** - the first person to register becomes admin, so do it immediately.
4. **Onboarding: "Where do you want to deploy?"**
   - *This machine (localhost)* - apps run on the same server as Coolify, or
   - *A remote server* - Coolify gives you an **SSH key**; you paste its public part into the server's
     `~/.ssh/authorized_keys`, then type the server IP, SSH user and port.
5. **Server validation** - Coolify connects over SSH, checks the OS, **installs Docker if missing**, and
   starts its **reverse proxy** (Traefik by default, Caddy optional) on that server.
6. **Create a Project** - a folder for related things (e.g. "My Shop").
7. **Pick an Environment** - e.g. `production` and `staging` inside the project.
8. **Add a Resource** - one of three kinds:
   - **Application** (your own code),
   - **Database** (PostgreSQL, MySQL, Redis... one click),
   - **Service** (ready-made apps like WordPress, Plausible... one click).
9. **Choose the source** of the application: public Git repo, private GitHub repo (via a GitHub App),
   a deploy key, a Dockerfile, a Docker Compose file, or an existing Docker image.
10. **Choose the Build Pack** - this is *how* Coolify turns code into a container:

    | Build pack | What it does | What you fill in |
    |---|---|---|
    | **Nixpacks** (default) | Looks at your files (`package.json`, `requirements.txt`...) and **guesses** the language, install, build and start commands | Optional overrides: install / build / start command, base directory, port |
    | Railpack (beta) | Newer version of the same "guess it" idea | Same as Nixpacks |
    | **Static** | Serves already-built HTML files with a web server | Folder with the files |
    | **Dockerfile** | Uses *your* Dockerfile exactly | Port, env vars |
    | **Docker Compose** | Several containers together (app + database...) | Your `docker-compose.yml` |
    | Docker Image | Nothing to build, pull an image | Image name |

11. **Configure** - domain (HTTPS certificate from Let's Encrypt is automatic), the port your app listens
    on, environment variables, health check, persistent storage.
12. **Deploy** - Coolify SSHes into the server, clones the code, builds the image, starts the container
    with proxy labels, and **streams the build log** live.
13. **After deploy** - auto-deploy on every `git push` (webhook), rollback to an older version, logs,
    a web terminal into the container, backups for databases, basic monitoring.

### Coolify words vs our words

| Coolify | DeployStack (our code) |
|---|---|
| Server (localhost / remote) | `servers` module - localhost auto-registered, remote via SSH key |
| Project / Environment | *not built (not needed for a student version)* |
| Resource: Application | `applications` module |
| Build pack (Nixpacks, Dockerfile...) | **App type** (Flask, Next.js, Static, Own Dockerfile...) - see section 5 |
| Deployment + live logs | `deployments` module + Socket.IO log stream |
| Proxy (Traefik) | `proxy` module - Traefik labels on every container |
| Webhook auto-deploy | `webhooks` module |
| Admin account | **Customer accounts** (`auth` module) - see section 6 |

## 5. Our choice: ask "What type of app is this?" instead of "Which build pack?"

There are millions of apps and dependency combinations; no platform supports each one by hand.
Coolify solves this with Nixpacks *guessing*. When the guess is wrong, a beginner sees a cryptic error.

We ask the customer one easy question - **"Flask? Django? Next.js? Static site?"** - and each answer
carries its own recipe. When the customer clicks **Flask**, the platform already knows:

| | Flask example |
|---|---|
| Required file | `requirements.txt` (deploy stops early with a clear message if it is missing) |
| Language version | Python 3.12 |
| Install | `pip install -r requirements.txt` + `gunicorn` |
| Port | 5000 |
| Start | `gunicorn --bind 0.0.0.0:$PORT app:app` (the customer can change it) |
| Dockerfile | generated as `Dockerfile.deploystack` (never overwrites the customer's own `Dockerfile`) |

Supported now: Flask, FastAPI, Django, Node.js/Express, Next.js, React/Vue/Vite (static build),
Static HTML, Go, "I have my own Dockerfile" (any language) and "Not sure - detect it for me"
(the older automatic detection). Adding a framework = adding **one entry** to
`core-platform/backend/src/modules/app-types/app-types.ts`.

This is the same idea as the "Framework preset" dropdown on Vercel/Netlify, and it is simpler to
explain and test than writing our own Nixpacks.

## 6. The customer journey in DeployStack (after this change)

1. **Login page** - the customer creates an account or signs in (or clicks "Try the demo").
2. **Private Servers** - the customer registers their own server (IP, SSH user, private key).
3. **New Application → Step 1: "What type of app is this?"** - grid of app types.
4. **Step 2** - repo URL, branch, domain; port and start command are pre-filled from the type;
   a box explains *"What we will do"* and which files the repo must contain.
5. **Create & deploy** - live log shows `Preparing a Flask build... Found requirements.txt...`.
6. **Open App** link when it is running.

## 7. What is still missing (suggested order)

1. ~~Deploy to the customer's remote server over SSH~~ - **done in version 7**: clone, build, run, scale,
   rollback and delete all run on the Linux server over SSH. See `docs/MULTI_DEVICE_SETUP.md`.
2. ~~Separate customers' data~~ - **done in version 6**: separate customer portal and admin site,
   every app/deployment has an owner, every route needs a login. See `docs/MULTI_DEVICE_SETUP.md`.
3. ~~Server onboarding like Coolify~~ - **done in version 7**: the platform generates its own SSH key; "Add a server"
   shows the one command that trusts it, then checks SSH, Docker, git, folder and network with a fix for each failure.
4. **Environment variables** in the New Application form (the API already accepts `env_vars`).
5. Login protection: rate limiting / lockout after many wrong passwords; password reset; admin can disable a customer.
