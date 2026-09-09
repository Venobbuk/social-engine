#!/usr/bin/env python3
# seed_demo.py — populate social.silkvo.com with a Reclub-shaped DEMO: hkpl's real clubs as channels (with their
# logos), demo players, meet announcements, replies and reactions, branding. Everything created is tagged "demo"
# so it can be wiped. Runs on kaka; admin token read from /root/social-engine.admintoken; nothing secret printed.
import json, os, random, secrets, sys, time, urllib.request, urllib.parse, datetime
API = "http://127.0.0.1:3960/api"
TOK = open("/root/social-engine.admintoken").read().strip()
HKPL = "https://hkpl.silkvo.com"
random.seed(42)

def api(ep, body, token=TOK, timeout=60):
    data = json.dumps({**body, "i": token}).encode()
    req = urllib.request.Request(f"{API}/{ep}", data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        return {"_error": e.code, "_body": e.read()[:200].decode(errors="replace")}

def upload(url, name, token=TOK):
    """download on kaka, upload to drive via multipart; returns file id or None"""
    import mimetypes, uuid
    try:
        with urllib.request.urlopen(url, timeout=60) as r: blob = r.read()
    except Exception as e:
        return None
    boundary = uuid.uuid4().hex
    ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
    body = b""
    for k, v in [("i", token), ("force", "true"), ("name", name)]:
        body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: {ctype}\r\n\r\n".encode() + blob + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(f"{API}/drive/files/create", data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return json.loads(r.read()).get("id")
    except Exception:
        return None

CLUBS = [  # (name, district, logo path on hkpl, teams)
    ("212 HK", "Kwun Tong", "/cdn/clubs/1.webp", 17), ("PickOne", "Kowloon Bay", "/cdn/clubs/35.jpeg", 15),
    ("Pickledise", "Tsuen Wan", "/cdn/clubs/16.webp", 13), ("Club de Recreio", "Jordan", "/cdn/clubs/48.png", 13),
    ("Hong Kong Country Club", "Deep Water Bay", "/cdn/clubs/18.png", 11), ("Asia Aces Pickleball Academy", "Wong Chuk Hang", "/cdn/clubs/2.png", 11),
    ("BayPickle", "Kwai Chung", "/cdn/clubs/4.jpg", 11), ("Hong Kong Football Club", "Causeway Bay", "/cdn/clubs/23.png", 9),
    ("Lit Pickle", "Sham Shui Po", "/cdn/clubs/27.jpg", 9), ("The Pickle Grounds HK", "Kowloon Bay", "/cdn/gcs/uploads/hkpl/1787560846675_58cc57b09ea71a7b75c3db6c00b6e701.JPG.jpg", 9),
]
VENUES = [("Kowloon Park", "Tsim Sha Tsui", 6), ("Hong Kong Football Club", "Causeway Bay", 6), ("South China Athletic Association", "Causeway Bay", 6),
          ("United Services Recreation Club", "Jordan", 4), ("Kowloon Cricket Club", "Jordan", 4), ("King George V School Sports Hall", "Ho Man Tin", 4),
          ("Aberdeen Sports Ground", "Aberdeen", 4), ("Kowloon Park Sports Centre", "Tsim Sha Tsui", 4)]
PLAYERS = [("demo_ken", "Ken Lau", "DUPR 3.62 · Kowloon · doubles"), ("demo_wing", "Wing Chan", "DUPR 4.05 · HK Island · plays mornings"),
           ("demo_mandy", "Mandy Ho", "DUPR 3.21 · NT · new to the league"), ("demo_jason", "Jason Ng", "DUPR 3.88 · Kowloon East · captain"),
           ("demo_carol", "Carol Wong", "DUPR 3.45 · Causeway Bay"), ("demo_tommy", "Tommy Leung", "DUPR 4.31 · Jordan · coach"),
           ("demo_ivy", "Ivy Cheung", "DUPR 3.10 · Tsuen Wan"), ("demo_marco", "Marco Yip", "DUPR 3.70 · Kwun Tong"),
           ("demo_sam", "Sam Tsang", "DUPR 3.95 · Sham Shui Po"), ("demo_rita", "Rita Lam", "DUPR 3.33 · Aberdeen"),
           ("demo_leo", "Leo Kwok", "DUPR 4.12 · Kowloon Bay"), ("demo_pui", "Pui Yee", "DUPR 3.55 · Ho Man Tin")]

report = {"users": 0, "channels": 0, "meets": 0, "replies": 0, "reactions": 0, "logos": 0}

# 1) branding: hkpl logo as instance icon, theme colour
icon_id = upload(HKPL + "/cdn/gcs/logo.png", "silkvo-social-icon.png")
if icon_id:
    f = api("drive/files/show", {"fileId": icon_id})
    api("admin/update-meta", {"iconUrl": f.get("url"), "app192IconUrl": f.get("url"), "themeColor": "#008034"})
    report["logos"] += 1

# 2) demo users (passwords random, kept nowhere but /root/social-engine.demo-users for wipe/reuse)
users = {}
saved = {}
if os.path.exists("/root/social-engine.demo-users"):
    saved = json.load(open("/root/social-engine.demo-users"))
for uname, name, bio in PLAYERS:
    if uname in saved:  # exists from a previous run → reuse token, else sign in (paced: signin is rate-limited)
        if saved[uname].get("token"):
            users[uname] = {"id": saved[uname]["id"], "token": saved[uname]["token"], "pw": saved[uname].get("pw", "")}
            continue
        time.sleep(2.0)
        data = json.dumps({"username": uname, "password": saved[uname]["pw"]}).encode()
        req = urllib.request.Request(f"{API}/signin-flow", data=data, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r: s = json.loads(r.read())
        except Exception as e:
            print("signin failed", uname, getattr(e, "code", e), file=sys.stderr); s = {}
        tok = s.get("i") or s.get("token")
        if tok:
            users[uname] = {"id": saved[uname]["id"], "token": tok, "pw": saved[uname].get("pw", "")}
        continue
    pw = secrets.token_urlsafe(14)
    u = api("admin/accounts/create", {"username": uname, "password": pw})
    if "_error" in u:
        continue
    users[uname] = {"id": u["id"], "token": u["token"], "pw": pw}
    api("i/update", {"name": name, "description": bio + "  ·  demo account"}, token=u["token"])
    report["users"] += 1
with open("/root/social-engine.demo-users", "w") as fh:
    json.dump({**saved, **{k: {"id": v["id"], "pw": v["pw"], "token": v["token"]} for k, v in users.items()}}, fh)
os.chmod("/root/social-engine.demo-users", 0o600)
ulist = list(users.items())
print("demo users with tokens:", len(ulist), file=sys.stderr)

def engage(nid, ch_id, host):
    """replies + reactions from demo users on a meet note"""
    for uname, u in random.sample(ulist, k=min(len(ulist), random.randint(2, 5))):
        if host and uname == host[0]: continue
        rp = api("notes/create", {"text": random.choice(["in!", "in 🙋", "in, +1 partner", "count me in", "in — can bring balls"]), "replyId": nid, "channelId": ch_id}, token=u["token"])
        if "_error" not in rp: report["replies"] += 1
        rx = api("notes/reactions/create", {"noteId": nid, "reaction": random.choice(["👍", "🎉", "🏓", "🔥"])}, token=u["token"])
        if "_error" not in rx: report["reactions"] += 1
        time.sleep(0.4)

# 3) clubs as channels (banner = club logo), a host per club
channels = []
existing = {c["name"]: c for c in api("channels/search", {"query": "", "limit": 100}) if isinstance(c, dict)} if isinstance(api("channels/search", {"query": "", "limit": 100}), list) else {}
for i, (cname, district, logo, teams) in enumerate(CLUBS):
    host = ulist[i % len(ulist)] if ulist else None
    if cname in existing:  # idempotent: reuse; empty channel → seed meets; filled channel → add engagement to its meets
        c = existing[cname]
        if c.get("notesCount", 0) == 0:
            channels.append((c["id"], cname, district, host))
        elif ulist:
            tl = api("channels/timeline", {"channelId": c["id"], "limit": 5})
            for n in (tl if isinstance(tl, list) else []):
                if not n.get("replyId") and n.get("repliesCount", 0) == 0:
                    engage(n["id"], c["id"], host)
        continue
    time.sleep(1.5)
    # channel + its banner are created by the HOST user (banner must live in the creator's drive; per-user create limits spread out)
    htok = host[1]["token"] if host else TOK
    banner_id = upload(HKPL + logo, f"club-{i}-logo" + os.path.splitext(logo)[1], token=htok)
    if banner_id: report["logos"] += 1
    ch = api("channels/create", {"name": cname, "description": f"{cname} · {district} · {teams} league teams · open play + socials. (demo)", **({"bannerId": banner_id} if banner_id else {}), "color": random.choice(["#008034", "#f5a623", "#1565c0", "#c62828", "#6a1b9a"])}, token=htok)
    if "_error" in ch:
        print("channel error", cname, ch.get("_error"), ch.get("_body", "")[:120], file=sys.stderr); continue
    channels.append((ch["id"], cname, district, host))
    report["channels"] += 1

# 4) meets as posts in each channel (+ replies "in" + reactions)
today = datetime.date.today()
formats = ["Open play · doubles", "Round robin · mixed", "Social · beginners welcome", "Ladder night · 3.5+"]
for ch_id, cname, district, host in channels:
    for k in range(3):
        v = random.choice(VENUES); d = today + datetime.timedelta(days=random.randint(1, 12))
        hh = random.choice([("10:00", "12:00"), ("14:00", "16:00"), ("19:00", "21:00")])
        spots = random.choice([8, 12, 16]); fee = random.choice(["HK$60", "HK$80", "HK$120", "cost-split ≈ HK$45"])
        dupr = random.choice(["2.5–3.5", "3.0–4.0", "3.5+", "all levels"])
        text = (f"🏓 {random.choice(formats)}\n📅 {d.strftime('%a %d %b')} · {hh[0]}–{hh[1]}\n📍 {v[0]}, {v[1]} · {v[2]} courts\n"
                f"🎯 DUPR {dupr} · {spots} spots · {fee}\n\nReply \"in\" to join · hosted by {cname}  #meet #{district.replace(' ', '')}")
        n = api("notes/create", {"text": text, "channelId": ch_id, "visibility": "public"}, token=host[1]["token"] if host else TOK)
        if "_error" in n: continue
        nid = n["createdNote"]["id"]; report["meets"] += 1
        engage(nid, ch_id, host)
        time.sleep(0.5)

# 5) welcome note from admin (pinned)
w = api("notes/create", {"text": "Welcome to silkvo social — the open-play network behind HKPL.\n\nClubs live under Channels. Meets are posted by clubs; reply \"in\" to join (real RSVP with seat counts and waitlists is coming next).\n\nThis is a demo dataset: clubs are real HKPL clubs, players and meets are dummy. #demo", "visibility": "public"})
if "_error" not in w:
    api("i/pin", {"noteId": w["createdNote"]["id"]})
print(json.dumps(report))
