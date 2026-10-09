#!/bin/bash
HERE="$(cd "$(dirname "$0")" && pwd)"; BACKEND="$(dirname "$HERE")"
pkill -f "^node dist/main" 2>/dev/null; rm -rf /tmp/shimstate/* /tmp/apps-test /tmp/pd
cd "$BACKEND"
start() { PATH="$HERE/shim:$PATH" PORT=3111 PAAS_APPS_DIR=/tmp/apps-test PAAS_DATA_DIR=/tmp/pd node dist/main >> /tmp/backend.log 2>&1 & SRV=$!; for i in $(seq 1 40); do curl -s -m 1 localhost:3111/health >/dev/null && return; sleep 0.3; done; echo "BACKEND NOT UP"; tail -20 /tmp/backend.log; exit 1; }
stop() { kill -TERM $SRV; wait $SRV 2>/dev/null; }
: > /tmp/backend.log; start
B=http://localhost:3111; H='Content-Type: application/json'; S=/tmp/shimstate
code() { curl -s -m 20 -o /dev/null -w '%{http_code}' -H "$H" "$@"; }
jget() { python3 -c "import sys,json
try:
  d=json.load(sys.stdin); print(d$1)
except Exception as e: print('ERR',e)"; }
wait_dep() { st=?; for i in $(seq 1 60); do st=$(curl -s -m 5 $B/deployments/$1 | jget "['status']"); [[ "$st" == success || "$st" == failed ]] && break; sleep 0.4; done; echo $st; }
mk() { curl -s -m 10 -H "$H" -X POST $B/applications -d "{\"name\":\"$1\",\"repo_url\":\"https://github.com/x/y\",\"domain\":\"$1.local\"}"; }

echo "== create + deploy + scale app 'blog'"
A=$(mk blog); ID=$(echo "$A" | jget "['id']"); echo "port: $(echo "$A" | jget "['host_port']")"
D=$(curl -s -H "$H" -X POST $B/applications/$ID/deploy | jget "['deployment_id']"); echo "deploy: $(wait_dep $D)"
curl -s -H "$H" -X POST $B/applications/$ID/scale -d '{"replicas":3}' >/dev/null
echo "deployment has URLs: $(curl -s $B/deployments/$D | jget "['app_url'],d['domain_url'],d['host_port']")"
echo "before delete -> containers: $(ls $S | grep '^c_' | tr '\n' ' ') images: $(ls $S | grep '^img_' | tr '\n' ' ')"
echo "== delete"
curl -s -m 30 -X DELETE $B/applications/$ID; echo
echo "after delete  -> containers: [$(ls $S | grep '^c_' | tr '\n' ' ')] images: [$(ls $S | grep '^img_' | tr '\n' ' ')] checkout exists: $([ -d /tmp/apps-test/blog ] && echo yes || echo no)"
echo "GET deleted app (404): $(code $B/applications/$ID)   delete again (404): $(code -X DELETE $B/applications/$ID)"
echo "port reused by next app: $(mk next | jget "['host_port']")  (expect 4000 again)"
echo "history kept: $(curl -s $B/deployments | jget "[0]['app_name'],d[0]['status']")"

echo "== delete while building -> 409"
A=$(mk slow); SID=$(echo "$A" | jget "['id']")
curl -s -H "$H" -X POST $B/applications/$SID/deploy >/dev/null
echo "status code: $(code -X DELETE $B/applications/$SID)"; sleep 4

echo "== docker down -> 409 unless force"
touch $S/docker_down
echo "no force: $(code -X DELETE $B/applications/$SID)"
echo "force:    $(curl -s -X DELETE "$B/applications/$SID?force=true" | jget "['deleted'],d['warnings']")"
rm -f $S/docker_down

echo "== persistence across restart"
A=$(mk keep); KID=$(echo "$A" | jget "['id']"); KP=$(echo "$A" | jget "['host_port']")
D=$(curl -s -H "$H" -X POST $B/applications/$KID/deploy | jget "['deployment_id']"); wait_dep $D >/dev/null
curl -s -H "$H" -X POST $B/servers -d '{"name":"r","host":"127.0.0.2","ssh_user":"deploy","ssh_private_key":"-----BEGIN KEY-----\nabc"}' >/dev/null
sleep 1; stop; echo "files: $(ls /tmp/pd | tr '\n' ' ') mode: $(stat -c %a /tmp/pd/applications.json)"
start
echo "apps after restart: $(curl -s $B/applications | jget " and [ (a['name'],a['status'],a['host_port']) for a in d ]")"
echo "servers after restart: $(curl -s $B/servers | jget " and [ (s['name'],s['status']) for s in d ]")"
echo "deployments after restart: $(curl -s $B/deployments | jget " and len(d)")"
echo "new app must not reuse port $KP: $(mk fresh | jget "['host_port']")"
stop

exit 0
