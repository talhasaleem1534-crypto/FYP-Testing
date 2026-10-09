#!/bin/bash
HERE="$(cd "$(dirname "$0")" && pwd)"; BACKEND="$(dirname "$HERE")"
pkill -f "^node dist/main" 2>/dev/null
rm -rf /tmp/shimstate/* /tmp/apps-test /tmp/paas-data-rollback
cd "$BACKEND"
PATH="$HERE/shim:$PATH" PORT=3111 PAAS_APPS_DIR=/tmp/apps-test PAAS_DATA_DIR=/tmp/paas-data-rollback node dist/main > /tmp/backend.log 2>&1 &
SRV=$!
for i in $(seq 1 30); do curl -s -m 1 localhost:3111/health >/dev/null && break; sleep 0.3; done
curl -s -m 2 localhost:3111/health >/dev/null || { echo "BACKEND NOT UP"; tail -20 /tmp/backend.log; kill $SRV; exit 1; }

B=http://localhost:3111
S=/tmp/shimstate
H='Content-Type: application/json'
code() { curl -s -m 10 -o /dev/null -w '%{http_code}' -H "$H" "$@"; }
jget() { python3 -c "import sys,json
try:
  d=json.load(sys.stdin); print(d$1)
except Exception as e: print('ERR',e)"; }
wait_dep() { st=?; for i in $(seq 1 60); do st=$(curl -s -m 5 $B/deployments/$1 | jget "['status']"); [[ "$st" == success || "$st" == failed ]] && break; sleep 0.5; done; echo $st; }

echo "== validation (expect 400 each)"
echo "option-injection repo: $(code -X POST $B/applications -d '{"name":"evil","repo_url":"--upload-pack=touch /tmp/pwned","domain":"a.local"}')"
echo "backtick domain:       $(code -X POST $B/applications -d '{"name":"evil","repo_url":"https://github.com/x/y","domain":"a`id`.local"}')"
echo "bad env name:          $(code -X POST $B/applications -d '{"name":"evil","repo_url":"https://github.com/x/y","domain":"a.local","env_vars":{"A B":"1"}}')"
echo "unknown server (404):  $(code -X POST $B/applications -d '{"name":"evil","repo_url":"https://github.com/x/y","domain":"a.local","server_id":"nope"}')"

echo "== create"
APP=$(curl -s -m 10 -H "$H" -X POST $B/applications -d '{"name":"My Store!","repo_url":"https://github.com/x/y.git","branch":"develop","domain":"my-store.local","port":3000,"env_vars":{"API_KEY":"a b\"c$(id)"}}')
echo "$APP" | jget "['name'],d['host_port'],d['status']"
ID=$(echo "$APP" | jget "['id']")
echo "duplicate name (409):  $(code -X POST $B/applications -d '{"name":"my-store","repo_url":"https://github.com/x/y","domain":"b.local"}')"

echo "== deploy #1 (fresh)"
D1=$(curl -s -m 10 -H "$H" -X POST $B/applications/$ID/deploy | jget "['deployment_id']")
echo "concurrent deploy (409): $(code -X POST $B/applications/$ID/deploy)"
echo "status: $(wait_dep $D1)"; echo "containers: $(ls $S | grep '^c_' | tr '\n' ' ')"

echo "== deploy #2 (swap over existing)"
D2=$(curl -s -m 10 -H "$H" -X POST $B/applications/by-name/my-store/deploy | jget "['deployment_id']")
echo "status: $(wait_dep $D2)"; echo "containers: $(ls $S | grep '^c_' | tr '\n' ' ')"

echo "== deploy #3: new container crashes -> must roll back"
touch $S/crash_new
D3=$(curl -s -m 10 -H "$H" -X POST $B/applications/$ID/deploy | jget "['deployment_id']")
echo "status: $(wait_dep $D3)"; rm -f $S/crash_new
echo "primary container state: $(cat $S/c_paas-my-store 2>&1)"; echo "containers: $(ls $S | grep '^c_' | tr '\n' ' ')"
curl -s $B/applications/$ID | jget "['status'],d.get('current_image')"
curl -s $B/deployments/$D3 | python3 -c "import sys,json;print('\n'.join(l for l in json.load(sys.stdin)['logs'] if any(k in l for k in ('crash','Rolled','Error','│','not healthy','exited'))))"

echo "== deploy #4: build failure -> old container must survive"
touch $S/fail_build
D4=$(curl -s -m 10 -H "$H" -X POST $B/applications/$ID/deploy | jget "['deployment_id']")
echo "status: $(wait_dep $D4)"; rm -f $S/fail_build
echo "old container: $(cat $S/c_paas-my-store 2>&1)"; curl -s $B/applications/$ID | jget "['status']"

echo "== scale"
curl -s -m 20 -H "$H" -X POST $B/applications/$ID/scale -d '{"replicas":3}'; echo; echo "containers: $(ls $S | grep '^c_' | tr '\n' ' ')"
curl -s -m 20 -H "$H" -X POST $B/applications/by-name/my-store/scale -d '{"replicas":1}'; echo; echo "containers: $(ls $S | grep '^c_' | tr '\n' ' ')"
echo "scale 0   (400): $(code -X POST $B/applications/$ID/scale -d '{"replicas":0}')"
echo "scale 2.5 (400): $(code -X POST $B/applications/$ID/scale -d '{"replicas":2.5}')"

echo "== servers"
curl -s -m 30 -H "$H" -X POST $B/servers -d '{"name":"r","host":"127.0.0.2","ssh_user":"deploy","ssh_private_key":"-----BEGIN KEY-----\nabc"}' | python3 -c "import sys,json;s=json.load(sys.stdin);print({k:s.get(k) for k in ('status','ssh_private_key','last_error','apps_dir')})"
echo "remote w/o key (400):  $(code -X POST $B/servers -d '{"name":"r2","host":"10.1.1.1","ssh_user":"deploy"}')"
echo "local w/o key  (201):  $(code -X POST $B/servers -d '{"name":"l2","host":"127.0.0.1","ssh_user":"me"}')"

echo "== docker run args actually used for primary (labels must keep backticks, env must be one arg)"
grep "docker run" /tmp/shimstate/calls.log | head -1 | cut -c1-400
grep -c "2>nul" /tmp/shimstate/calls.log | sed 's/^/windows-only "2>nul" occurrences: /'
echo "== git calls"; grep "^git" /tmp/shimstate/calls.log | head -8
kill $SRV 2>/dev/null; wait $SRV 2>/dev/null

exit 0
