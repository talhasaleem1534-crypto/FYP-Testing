import re

# Deterministic first layer - runs BEFORE the LLM call and catches the common
# errors instantly and for free. The LLM is only invoked for novel errors this
# layer doesn't recognise.

PATTERNS = [
    {
        "match": re.compile(r"bind.*address already in use|EADDRINUSE|port is already allocated", re.I),
        "diagnosis": "Port conflict: another process is already using the port this container tried to bind to.",
        "fix": "Check for a stale container on the same port (`docker ps`) or change the exposed port in your app config.",
    },
    {
        "match": re.compile(r"dockerfile.*no such file or directory|no such file or directory.*dockerfile", re.I),
        "diagnosis": "Build failed because no Dockerfile was found at the expected path.",
        "fix": "Confirm the Dockerfile is committed and the build context path in your deploy config is correct.",
    },
    {
        "match": re.compile(r"502 bad gateway", re.I),
        "diagnosis": "The reverse proxy (Traefik/Nginx) can't reach your container.",
        "fix": "Check the container is actually listening on the port declared in its deploy config, and that it's still running.",
    },
    {
        "match": re.compile(r"ENOTFOUND|getaddrinfo", re.I),
        "diagnosis": "A DNS lookup failed - the app is trying to reach a hostname that can't be resolved.",
        "fix": "Check environment variables for a database/service hostname typo, or that the dependent service is on the same Docker network.",
    },
    {
        "match": re.compile(r"cannot connect to the docker daemon|error during connect.*docker", re.I),
        "diagnosis": "The Docker daemon is not running or not reachable from this process.",
        "fix": "Start Docker (Docker Desktop on Windows/macOS, `systemctl start docker` on Linux). In a container, mount /var/run/docker.sock.",
    },
    {
        "match": re.compile(r"ECONNREFUSED", re.I),
        "diagnosis": "A connection was refused - nothing is listening on the host/port the app tried to reach.",
        "fix": "Make sure the dependent service is running, the port is correct, and that it is reachable on the same Docker network (use the service name, not localhost).",
    },
    {
        "match": re.compile(r"OOMKilled|out of memory|exit code 137", re.I),
        "diagnosis": "The container was killed because it ran out of memory.",
        "fix": "Raise the container memory limit or reduce the app's memory use; check `docker stats` for the culprit.",
    },
    {
        "match": re.compile(r"permission denied|EACCES", re.I),
        "diagnosis": "A file or socket permission error - commonly Docker socket access or a mounted volume's ownership.",
        "fix": "Check the container user has access to the mounted volume, or that /var/run/docker.sock is correctly mounted if this is a build-time error.",
    },
]


def explain_log(log_text: str):
    if not log_text:
        return {"source": "needs_llm", "handled_locally": False}
    for p in PATTERNS:
        if p["match"].search(log_text):
            return {
                "source": "pattern_engine",
                "diagnosis": p["diagnosis"],
                "fix": p["fix"],
                "handled_locally": True,
            }
    return {"source": "needs_llm", "handled_locally": False}


if __name__ == "__main__":
    tests = [
        "Error: listen EADDRINUSE: address already in use :::3000",
        "failed to solve: failed to read dockerfile: open Dockerfile: no such file or directory",
        "nginx: 502 Bad Gateway while connecting to upstream",
        "Error: getaddrinfo ENOTFOUND postgres-db",
        "EACCES: permission denied, open '/var/run/docker.sock'",
        "TypeError: Cannot read properties of undefined (reading 'map') at buildOrders.js:42",
    ]
    for t in tests:
        result = explain_log(t)
        print(f"LOG: {t[:60]}...")
        print(f"  -> {result}\n")
