# Backend end-to-end tests (no Docker needed)

`shim/docker` and `shim/git` are fake programs that imitate the parts of Docker/git the platform uses
(build, run, rename, stop, inspect, stats, images, rmi ...) and can be told to fail (`fail_build`,
`crash_new`, `docker_down` marker files in /tmp/shimstate).

    npm run build
    npm run test:e2e        # runs both scripts

* `deploy-rollback.sh`: input validation (command-injection attempts), deploy, swap, **rollback on crash**,
  build failure keeps the old container, scaling, server API (keys masked, remote servers really checked).
* `delete-persistence.sh`: delete removes containers/images/checkout and frees the port, delete while building (409),
  Docker down (409 / force), and apps/servers/history surviving a backend restart.

These are scenario scripts: they print what happened, with the expected value in each label (e.g. `(409)`,
`rolled back`), so read the output - they do not exit non-zero on a mismatch. They need `bash`, `curl`, `python3` and a built backend (`dist/`). Linux/macOS/WSL.
