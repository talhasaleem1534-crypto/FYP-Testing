#!/bin/bash
# Customer accounts + "What type of app is this?" (Flask, Static, ...). Uses the fake docker/git in shim/.
HERE="$(cd "$(dirname "$0")" && pwd)"; BACKEND="$(dirname "$HERE")"
pkill -f "^node dist/main" 2>/dev/null
rm -rf /tmp/shimstate /tmp/apps-test /tmp/paas-data-test; mkdir -p /tmp/shimstate
cd "$BACKEND"
start() { PATH="$HERE/shim:$PATH" PORT=3111 PAAS_APPS_DIR=/tmp/apps-test PAAS_DATA_DIR=/tmp/paas-data-test node dist/main > /tmp/backend.log 2>&1 & SRV=$!
  for i in $(seq 1 30); do curl -s -m 1 localhost:3111/health >/dev/null && break; sleep 0.3; done; }
start

B=http://localhost:3111
S=/tmp/shimstate
H='Content-Type: application/json'
code() { curl -s -m 10 -o /dev/null -w '%{http_code}' -H "$H" "$@"; }
jget() { python3 -c "import sys,json
try:
  d=json.load(sys.stdin); print(d$1)
except Exception as e: print('ERR',e)"; }
wait_dep() { st=?; for i in $(seq 1 60); do st=$(curl -s -m 5 $B/deployments/$1 | jget "['status']"); [[ "$st" == success || "$st" == failed ]] && break; sleep 0.5; done; echo $st; }
logs() { curl -s $B/deployments/$1 | python3 -c "import sys,json;print('\n'.join(l for l in json.load(sys.stdin)['logs'] if any(k in l for k in ($2))))"; }

echo "== accounts"
echo "register (201):          $(code -X POST $B/auth/register -d '{"name":"Ali","email":"Ali@Example.com","password":"secret123"}')"
echo "same email again (409):  $(code -X POST $B/auth/register -d '{"name":"Ali","email":"ali@example.com","password":"secret123"}')"
echo "short password (400):    $(code -X POST $B/auth/register -d '{"name":"B","email":"b@example.com","password":"123"}')"
echo "bad email (400):         $(code -X POST $B/auth/register -d '{"name":"B","email":"nope","password":"secret123"}')"
echo "wrong password (401):    $(code -X POST $B/auth/login -d '{"email":"ali@example.com","password":"wrong-pass"}')"
TOKEN=$(curl -s -H "$H" -X POST $B/auth/login -d '{"email":"ALI@example.com","password":"secret123"}' | jget "['access_token']")
echo "login token length (64): ${#TOKEN}"
echo "me:                      $(curl -s -H "Authorization: Bearer $TOKEN" $B/auth/me | jget "['email'],'password_hash' in d")"
echo "me without token (401):  $(code $B/auth/me)"
echo "users file has no plain password (0): $(sleep 1; grep -c secret123 /tmp/paas-data-test/users.json)"
kill $SRV; wait $SRV 2>/dev/null; start
echo "token survives restart (200): $(code -H "Authorization: Bearer $TOKEN" $B/auth/me)"
echo "logout (200):            $(code -X POST -H "Authorization: Bearer $TOKEN" $B/auth/logout)"
echo "me after logout (401):   $(code -H "Authorization: Bearer $TOKEN" $B/auth/me)"

echo "== app types"
curl -s $B/app-types | python3 -c "import sys,json;t=json.load(sys.stdin);print(len(t),'types:',' '.join(x['id'] for x in t));print('flask:',[(x['default_port'],x['default_start_command']) for x in t if x['id']=='flask'][0]);print('has build functions (False):', any('dockerfile' in x for x in t))"
echo "unknown app_type (400):  $(code -X POST $B/applications -d '{"name":"x","repo_url":"https://github.com/x/y","domain":"x.local","app_type":"cobol"}')"
echo "2-line start cmd (400):  $(code -X POST $B/applications -d '{"name":"x","repo_url":"https://github.com/x/y","domain":"x.local","app_type":"flask","start_command":"a\nRUN evil"}')"

echo "== Flask app: port comes from the type, Dockerfile is generated"
mkdir -p $S/repo; printf 'Flask==3.0.0\n' > $S/repo/requirements.txt; echo 'app=1' > $S/repo/app.py
APP=$(curl -s -H "$H" -X POST $B/applications -d '{"name":"hello-flask","repo_url":"https://github.com/x/flask","domain":"flask.local","app_type":"flask"}')
echo "created: $(echo "$APP" | jget "['app_type'],d['port']")   (flask 5000)"
D=$(curl -s -H "$H" -X POST $B/applications/hello-flask/deploy | jget "['deployment_id']")
echo "status: $(wait_dep $D)"
logs $D "'App type','STEP 2','Found','Generated','SUCCESS'"
echo "--- generated Dockerfile:"; cat /tmp/apps-test/hello-flask/Dockerfile.deploystack
echo "--- docker build call: $(grep 'docker build' $S/calls.log | tail -1)"

echo "== Flask app with custom start command"
curl -s -o /dev/null -H "$H" -X POST $B/applications -d '{"name":"flask-main","repo_url":"https://github.com/x/flask2","domain":"f2.local","app_type":"flask","start_command":"gunicorn -b 0.0.0.0:$PORT main:app"}'
D=$(curl -s -H "$H" -X POST $B/applications/flask-main/deploy | jget "['deployment_id']")
echo "status: $(wait_dep $D)"; tail -1 /tmp/apps-test/flask-main/Dockerfile.deploystack

echo "== Static site chosen but repo has no index.html -> clear error, nothing built"
rm -rf $S/repo; mkdir -p $S/repo; echo hi > $S/repo/readme.md
curl -s -o /dev/null -H "$H" -X POST $B/applications -d '{"name":"site","repo_url":"https://github.com/x/site","domain":"site.local","app_type":"static"}'
BUILDS=$(grep -c 'docker build' $S/calls.log)
D=$(curl -s -H "$H" -X POST $B/applications/site/deploy | jget "['deployment_id']")
echo "status (failed): $(wait_dep $D)"; logs $D "'Error',"
echo "docker build not called: $([ "$(grep -c 'docker build' $S/calls.log)" = "$BUILDS" ] && echo yes || echo NO)"

echo "== Django: project folder found automatically"
rm -rf $S/repo; mkdir -p $S/repo/mysite; printf 'Django\n' > $S/repo/requirements.txt; touch $S/repo/manage.py $S/repo/mysite/wsgi.py
curl -s -o /dev/null -H "$H" -X POST $B/applications -d '{"name":"dj","repo_url":"https://github.com/x/dj","domain":"dj.local","app_type":"django"}'
D=$(curl -s -H "$H" -X POST $B/applications/dj/deploy | jget "['deployment_id']")
echo "status: $(wait_dep $D)"; tail -1 /tmp/apps-test/dj/Dockerfile.deploystack

echo "== old apps without app_type still use auto-detection"
rm -rf $S/repo
curl -s -o /dev/null -H "$H" -X POST $B/applications -d '{"name":"legacy","repo_url":"https://github.com/x/legacy","domain":"legacy.local"}'
D=$(curl -s -H "$H" -X POST $B/applications/legacy/deploy | jget "['deployment_id']")
echo "status: $(wait_dep $D)"; logs $D "'Detecting','Auto-generated'"

kill $SRV 2>/dev/null; wait $SRV 2>/dev/null
exit 0
