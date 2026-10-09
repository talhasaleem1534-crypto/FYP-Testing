#!/bin/bash
# Customer portal vs admin site: who may see what. Uses the fake docker/git in shim/.
HERE="$(cd "$(dirname "$0")" && pwd)"; BACKEND="$(dirname "$HERE")"
pkill -f "^node dist/main" 2>/dev/null
rm -rf /tmp/shimstate /tmp/apps-test /tmp/paas-data-roles; mkdir -p /tmp/shimstate
cd "$BACKEND"
export SOCKET_IO_CLIENT="${SOCKET_IO_CLIENT:-$BACKEND/../frontend/node_modules/socket.io-client}"
start() { PATH="$HERE/shim:$PATH" PORT=3111 PAAS_APPS_DIR=/tmp/apps-test PAAS_DATA_DIR=/tmp/paas-data-roles "$@" node dist/main > /tmp/backend.log 2>&1 & SRV=$!
  for i in $(seq 1 30); do curl -s -m 1 localhost:3111/health >/dev/null && break; sleep 0.3; done; }
start env

B=http://localhost:3111
H='Content-Type: application/json'
code() { curl -s -m 10 -o /dev/null -w '%{http_code}' -H "$H" "$@"; }
jget() { python3 -c "import sys,json
try:
  d=json.load(sys.stdin); print(d$1)
except Exception as e: print('ERR',e)"; }
wait_dep() { st=?; for i in $(seq 1 60); do st=$(curl -s -m 5 $B/deployments/$1 | jget "['status']"); [[ "$st" == success || "$st" == failed ]] && break; sleep 0.5; done; echo $st; }

echo "== admin account (created once, on the admin laptop)"
echo "status before:           $(curl -s $B/auth/status)"
ADMIN=$(curl -s -H "$H" -X POST $B/auth/setup-admin -d '{"name":"Salman","email":"admin@deploystack.local","password":"admin-pass-1"}' | jget "['access_token']")
echo "admin token length (64): ${#ADMIN}"
echo "second admin (409):      $(code -X POST $B/auth/setup-admin -d '{"name":"X","email":"x@x.com","password":"12345678"}')"
echo "status after:            $(curl -s $B/auth/status)"
echo "admin role:              $(curl -s -H "Authorization: Bearer $ADMIN" $B/auth/me | jget "['role']")"

echo "== two customers"
A=$(curl -s -H "$H" -X POST $B/auth/register -d '{"name":"Ayesha","email":"ayesha@example.com","password":"customer-a1"}' | jget "['access_token']")
C=$(curl -s -H "$H" -X POST $B/auth/register -d '{"name":"Bilal","email":"bilal@example.com","password":"customer-b1"}' | jget "['access_token']")
echo "customer role:           $(curl -s -H "Authorization: Bearer $A" $B/auth/me | jget "['role']")"
AA=(-H "Authorization: Bearer $A"); BB=(-H "Authorization: Bearer $C"); AD=(-H "Authorization: Bearer $ADMIN")

echo "== servers as seen by a customer"
curl -s "${AA[@]}" $B/servers | python3 -c "import sys,json;s=json.load(sys.stdin);print('count',len(s),'| name:',s[0]['name'],'| apps_dir hidden:',s[0]['apps_dir']=='')"
echo "admin sees real name:    $(curl -s "${AD[@]}" $B/servers | jget "[0]['name']")"
echo "customer register server (403): $(code "${AA[@]}" -X POST $B/servers -d '{"name":"s","host":"10.0.0.9","ssh_user":"u","ssh_private_key":"k"}')"

echo "== Ayesha creates and deploys an app"
mkdir -p /tmp/shimstate/repo; printf 'flask\n' > /tmp/shimstate/repo/requirements.txt
APP=$(curl -s "${AA[@]}" -H "$H" -X POST $B/applications -d '{"name":"ayesha-shop","repo_url":"https://github.com/a/shop","domain":"shop.local","app_type":"flask"}')
APPID=$(echo "$APP" | jget "['id']"); echo "owner is Ayesha: $(echo "$APP" | jget "['owner_id'] is not None")"

# Listen to live logs as Ayesha, Bilal, the admin, and an anonymous remote-style client while she deploys
SOCK="node $HERE/socket-listen.cjs $B"
$SOCK "$A" 6 > /tmp/sockA & P1=$!; $SOCK "$C" 6 > /tmp/sockB & P2=$!; $SOCK "$ADMIN" 6 > /tmp/sockAdmin & P3=$!; sleep 1
D=$(curl -s "${AA[@]}" -H "$H" -X POST $B/applications/$APPID/deploy | jget "['deployment_id']")
echo "deploy status:           $(wait_dep $D)"; wait $P1 $P2 $P3   # not a bare `wait`: that would wait for the backend too
echo "live logs Ayesha (>0):   $(cat /tmp/sockA)"
echo "live logs Bilal (0):     $(cat /tmp/sockB)"
echo "live logs admin (>0):    $(cat /tmp/sockAdmin)"

echo "== Bilal must not see or touch Ayesha's app (404 each)"
echo "list apps (0):           $(curl -s "${BB[@]}" $B/applications | jget ".__len__()")"
echo "get app:                 $(code "${BB[@]}" $B/applications/$APPID)"
echo "get app by name:         $(code "${BB[@]}" $B/applications/by-name/ayesha-shop/status)"
echo "deploy:                  $(code "${BB[@]}" -X POST $B/applications/$APPID/deploy)"
echo "scale:                   $(code "${BB[@]}" -X POST $B/applications/$APPID/scale -d '{"replicas":2}')"
echo "delete:                  $(code "${BB[@]}" -X DELETE $B/applications/$APPID)"
echo "deployment by id:        $(code "${BB[@]}" $B/deployments/$D)"
echo "deployments list (0):    $(curl -s "${BB[@]}" $B/deployments | jget ".__len__()")"
echo "same app name (409):     $(code "${BB[@]}" -X POST $B/applications -d '{"name":"ayesha-shop","repo_url":"https://github.com/b/x","domain":"b.local"}')"
echo "Ayesha sees her app (1): $(curl -s "${AA[@]}" $B/applications | jget ".__len__()")  deployments (1): $(curl -s "${AA[@]}" $B/deployments | jget ".__len__()")"
echo "admin sees all apps (1): $(curl -s "${AD[@]}" $B/applications | jget ".__len__()")"

echo "== admin pages"
echo "customer -> /admin/customers (403): $(code "${AA[@]}" $B/admin/customers)"
echo "customer -> /admin/storage   (403): $(code "${AA[@]}" $B/admin/storage)"
curl -s "${AD[@]}" $B/admin/customers | python3 -c "
import sys,json
for u in json.load(sys.stdin): print(f\"  {u['role']:8} {u['email']:26} apps={len(u['apps'])} deploys={u['deployments']} sessions={u['active_sessions']} hash={u['password_storage']['hash_preview']} full-hash-leaked={'password_hash' in u}\")"
curl -s "${AD[@]}" $B/admin/storage | python3 -c "
import sys,json; s=json.load(sys.stdin)
print('  data_dir:', s['data_dir']); print('  apps_dir:', s['apps_dir'])
for f in s['data_files']: print(f\"  {f['name']:18} exists={f['exists']} records={f['records']} size={f['size_bytes']}\")
for c in s['app_checkouts']: print(f\"  checkout {c['name']} owner={c['owner']} files={c['files']}\")
print('  portal urls:', s['machine']['customer_portal_urls'])"

echo "== bad tokens never fall back to admin, even from this laptop"
echo "garbage token (401):     $(code -H 'Authorization: Bearer nope' $B/applications)"
curl -s -o /dev/null -X POST "${AA[@]}" $B/auth/logout
echo "logged-out token (401):  $(code "${AA[@]}" $B/applications)"

echo "== PAAS_TRUST_LOCALHOST=off: no token means no access (like a request from another device)"
kill $SRV; wait $SRV 2>/dev/null; start env PAAS_TRUST_LOCALHOST=off
echo "apps, no token (401):    $(code $B/applications)"
echo "admin page, no token (401): $(code $B/admin/storage)"
echo "health (200):            $(code $B/health)   app-types (200): $(code $B/app-types)   auth/status (200): $(code $B/auth/status)"
echo "webhook not blocked by login (not 401): $(code -X POST -H 'X-GitHub-Event: ping' $B/webhooks/github -d '{}')"
echo "admin token still works (200): $(code "${AD[@]}" $B/applications)"
echo "anonymous socket refused: $($SOCK - 2)"
echo "setup-admin from here still 409 (exists): $(code -X POST $B/auth/setup-admin -d '{"name":"X","email":"y@y.com","password":"12345678"}')"
echo "internal token (200):    $(kill $SRV; wait $SRV 2>/dev/null; start env PAAS_TRUST_LOCALHOST=off INTERNAL_API_TOKEN=s3cret-internal; code -H 'X-Internal-Token: s3cret-internal' $B/applications)   wrong internal token (401): $(code -H 'X-Internal-Token: wrong' $B/applications)"
kill $SRV 2>/dev/null; wait $SRV 2>/dev/null
exit 0
