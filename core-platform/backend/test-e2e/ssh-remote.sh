#!/bin/bash
# Deploy to a "Linux server" over REAL SSH (fake-sshd.cjs + fake docker/git). Platform = this backend.
HERE="$(cd "$(dirname "$0")" && pwd)"; BACKEND="$(dirname "$HERE")"
pkill -f "^node dist/main" 2>/dev/null; pkill -f "^node $HERE/fake-sshd" 2>/dev/null
D=/tmp/paas-data-ssh; RH=/tmp/fake-remote-home; SLOG=/tmp/fake-sshd.log
rm -rf /tmp/shimstate /tmp/apps-test $D $RH $SLOG /tmp/untrusted-key* /tmp/fake-customer-home; mkdir -p /tmp/shimstate
cd "$BACKEND"
PATH="$HERE/shim:$PATH" PORT=3111 PAAS_APPS_DIR=/tmp/apps-test PAAS_DATA_DIR=$D node dist/main > /tmp/backend.log 2>&1 & SRV=$!
for i in $(seq 1 30); do curl -s -m 1 localhost:3111/health >/dev/null && break; sleep 0.3; done; sleep 0.6

B=http://localhost:3111; H='Content-Type: application/json'
code() { curl -s -m 30 -o /dev/null -w '%{http_code}' -H "$H" "$@"; }
jget() { python3 -c "import sys,json
try:
  d=json.load(sys.stdin); print(d$1)
except Exception as e: print('ERR',e)"; }
wait_dep() { st=?; for i in $(seq 1 80); do st=$(curl -s -m 5 "${AD[@]}" $B/deployments/$1 | jget "['status']"); [[ "$st" == success || "$st" == failed ]] && break; sleep 0.5; done; echo $st; }
checks() { python3 -c "import sys,json;s=json.load(sys.stdin);print(' ', s.get('status'),'|',' · '.join(('OK ' if c['ok'] else 'FAIL ')+c['label']+': '+c['detail'] for c in s.get('checks') or []))"; }

PUB=$(python3 -c "import json;print(json.load(open('$D/platform_ssh_key.json'))['public_key'])")
echo "== platform key generated and saved: ${PUB:0:24}…  (private key file mode $(stat -c %a $D/platform_ssh_key.json))"
node "$HERE/fake-sshd.cjs" 127.0.0.2 2222 "$PUB" $RH $SLOG > /tmp/fake-sshd.out 2>&1 & SSHD=$!; sleep 0.8; cat /tmp/fake-sshd.out

ADMIN=$(curl -s -H "$H" -X POST $B/auth/setup-admin -d '{"name":"Admin","email":"admin@x.com","password":"admin-pass-1"}' | jget "['access_token']")
CUST=$(curl -s -H "$H" -X POST $B/auth/register -d '{"name":"Ayesha","email":"ayesha@x.com","password":"customer-a1"}' | jget "['access_token']")
AD=(-H "Authorization: Bearer $ADMIN"); CU=(-H "Authorization: Bearer $CUST")

echo "== 'Add a server' page data (customer may read it)"
curl -s "${CU[@]}" $B/servers/platform-key | python3 -c "import sys,json;k=json.load(sys.stdin);print('  trust command has the key:', '$PUB' in k['trust_command']);print('  prepare steps:', len(k['prepare_commands']))"

echo "== admin adds the Linux server (platform key, no private key pasted)"
SRV_JSON=$(curl -s -m 60 "${AD[@]}" -H "$H" -X POST $B/servers -d "{\"name\":\"linux-laptop\",\"host\":\"127.0.0.2\",\"port\":2222,\"ssh_user\":\"$(whoami)\"}")
echo "$SRV_JSON" | checks
SID=$(echo "$SRV_JSON" | jget "['id']"); echo "  apps_dir from \$HOME: $(echo "$SRV_JSON" | jget "['apps_dir']")  auth: $(echo "$SRV_JSON" | jget "['auth_method']")  shared: $(echo "$SRV_JSON" | jget "['shared']")"

echo "== failures explain themselves"
curl -s -m 60 "${AD[@]}" -H "$H" -X POST $B/servers -d '{"name":"wrong-port","host":"127.0.0.2","port":2299,"ssh_user":"x"}' | checks
ssh-keygen -q -t ed25519 -N '' -f /tmp/untrusted-key >/dev/null
KEY=$(python3 -c "import json;print(json.dumps(open('/tmp/untrusted-key').read()))")
curl -s -m 60 "${AD[@]}" -H "$H" -X POST $B/servers -d "{\"name\":\"untrusted\",\"host\":\"127.0.0.2\",\"port\":2222,\"ssh_user\":\"bob\",\"ssh_private_key\":$KEY}" | checks
echo "  customer adds 127.0.0.5 (400): $(code "${CU[@]}" -X POST $B/servers -d '{"name":"x","host":"127.0.0.5","ssh_user":"u"}')"

echo "== customer sees the shared Linux server first"
curl -s "${CU[@]}" $B/servers | python3 -c "import sys,json;print('  ',[(s['name'],s['host']) for s in json.load(sys.stdin)])"

echo "== customer deploys a Flask app to the Linux server over SSH"
mkdir -p /tmp/shimstate/repo; printf 'flask\n' > /tmp/shimstate/repo/requirements.txt
APP=$(curl -s "${CU[@]}" -H "$H" -X POST $B/applications -d "{\"name\":\"remote-flask\",\"repo_url\":\"https://github.com/a/f\",\"domain\":\"f.local\",\"app_type\":\"flask\",\"server_id\":\"$SID\"}")
APPID=$(echo "$APP" | jget "['id']"); echo "  app_url: $(echo "$APP" | jget "['app_url']")"
DID=$(curl -s "${CU[@]}" -X POST $B/applications/$APPID/deploy | jget "['deployment_id']")
echo "  status: $(wait_dep $DID)"
curl -s "${AD[@]}" $B/deployments/$DID | python3 -c "import sys,json;d=json.load(sys.stdin);print('\n'.join('   '+l for l in d['logs'] if any(k in l for k in ('Target','Connect','Checking Docker','Found','Generated','SUCCESS','App URL'))))"
echo "  generated Dockerfile is on the SERVER: $(ls $RH/paas-apps/remote-flask/Dockerfile.deploystack 2>&1)"
echo "  commands the server received: $(grep -c . $SLOG) (docker build: $(grep -c "'docker' 'build'" $SLOG), docker run: $(grep -c "'docker' 'run'" $SLOG), git clone: $(grep -c "'git' 'clone'" $SLOG))"
echo "  sample: $(grep "'docker' 'build'" $SLOG | head -1 | cut -c1-160)"

echo "== scale to 2 over SSH"
curl -s -m 60 "${CU[@]}" -H "$H" -X POST $B/applications/$APPID/scale -d '{"replicas":2}'; echo
echo "  replica started on server: $(grep -c "paas-remote-flask-r2" $SLOG)"

echo "== admin stops sharing the server"
curl -s -o /dev/null "${AD[@]}" -H "$H" -X PATCH $B/servers/$SID -d '{"shared":false}'
echo "  customer servers now: $(curl -s "${CU[@]}" $B/servers | python3 -c "import sys,json;print([s['name'] for s in json.load(sys.stdin)])")"
echo "  customer new app on it (404): $(code "${CU[@]}" -X POST $B/applications -d "{\"name\":\"other\",\"repo_url\":\"https://github.com/a/o\",\"domain\":\"o.local\",\"server_id\":\"$SID\"}")"
echo "  delete server still in use (409): $(code "${AD[@]}" -X DELETE $B/servers/$SID)"

echo "== storage page shows the key file and where the code lives on the server"
curl -s "${AD[@]}" $B/admin/storage | python3 -c "import sys,json;s=json.load(sys.stdin);print('  ', [f['name'] for f in s['data_files'] if 'ssh' in f['name']], s['server_checkouts'])"

echo "== server goes offline during a deploy -> clear failure"
kill $SSHD; wait $SSHD 2>/dev/null; sleep 0.3
D2=$(curl -s "${CU[@]}" -X POST $B/applications/$APPID/deploy | jget "['deployment_id']")
echo "  status: $(wait_dep $D2)"; curl -s "${AD[@]}" $B/deployments/$D2 | python3 -c "import sys,json;print('  ',[l for l in json.load(sys.stdin)['logs'] if 'Error' in l][0][-150:])"
echo "  app still marked running (old version kept): $(curl -s "${CU[@]}" $B/applications/$APPID | jget "['status']")"
echo "  delete while server offline (409, offers force): $(code "${CU[@]}" -X DELETE $B/applications/$APPID)"

echo "== server back: delete removes containers + code on the server"
node "$HERE/fake-sshd.cjs" 127.0.0.2 2222 "$PUB" $RH $SLOG > /tmp/fake-sshd.out 2>&1 & SSHD=$!; sleep 0.8
curl -s -m 60 "${CU[@]}" -X DELETE $B/applications/$APPID | python3 -c "import sys,json;d=json.load(sys.stdin);print('  ',d['removed_containers'],'images',d['removed_images'],'files',d['removed_files'],d['warnings'])"
echo "  code folder on server gone: $([ -e $RH/paas-apps/remote-flask ] && echo NO || echo yes)"
echo "  delete server now (200): $(code "${AD[@]}" -X DELETE $B/servers/$SID)"

echo "== a customer brings their OWN server (needs a non-loopback address on this machine)"
LAN=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -n "$LAN" ]; then
  node "$HERE/fake-sshd.cjs" "$LAN" 2223 "$PUB" /tmp/fake-customer-home $SLOG > /dev/null 2>&1 & SSHD2=$!; sleep 0.8
  OWN=$(curl -s -m 60 "${CU[@]}" -H "$H" -X POST $B/servers -d "{\"name\":\"my-server\",\"host\":\"$LAN\",\"port\":2223,\"ssh_user\":\"$(whoami)\",\"shared\":true}")
  echo "$OWN" | checks
  OID=$(echo "$OWN" | jget "['id']"); echo "  owned by customer: $(echo "$OWN" | jget "['owner_id'] is not None")  shared (customer can't share, False): $(echo "$OWN" | jget "['shared']")"
  CUST2=$(curl -s -H "$H" -X POST $B/auth/register -d '{"name":"Bilal","email":"bilal@x.com","password":"customer-b1"}' | jget "['access_token']")
  echo "  other customer cannot see it: $(curl -s -H "Authorization: Bearer $CUST2" $B/servers | python3 -c "import sys,json;print('my-server' not in [s['name'] for s in json.load(sys.stdin)])")   nor verify it (404): $(code -H "Authorization: Bearer $CUST2" -X POST $B/servers/$OID/verify)"
  echo "  admin cannot share a customer's server (400): $(code "${AD[@]}" -X PATCH $B/servers/$OID -d '{"shared":true}')"
  A2=$(curl -s "${CU[@]}" -H "$H" -X POST $B/applications -d "{\"name\":\"own-site\",\"repo_url\":\"https://github.com/a/s\",\"domain\":\"s.local\",\"app_type\":\"flask\",\"server_id\":\"$OID\"}")
  D3=$(curl -s "${CU[@]}" -X POST $B/applications/$(echo "$A2" | jget "['id']")/deploy | jget "['deployment_id']")
  echo "  deploy to own server: $(wait_dep $D3)  url: $(echo "$A2" | jget "['app_url']")  code on that server: $(ls /tmp/fake-customer-home/paas-apps/)"
  kill $SSHD2 2>/dev/null; wait $SSHD2 2>/dev/null
else
  echo "  skipped: no network address"
fi

kill $SSHD $SRV 2>/dev/null; wait $SSHD $SRV 2>/dev/null
exit 0
