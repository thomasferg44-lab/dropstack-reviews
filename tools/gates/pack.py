# Builds review-pack/index.html from review-pack/shots (Gate 4). Not part of the app.
import os, re, html

D = "review-pack"
files = sorted(os.listdir(f"{D}/shots"))
groups = {}
for f in files:
    m = re.match(r"(before|after)-(.+)-(390|desktop)\.png", f)
    if m:
        groups.setdefault((m.group(1), m.group(2)), {})[m.group(3)] = f

BEFORE = ["login", "today-empty", "customers-empty", "jobs", "ask-now", "landing"]
AFTER = [
    ("login", "Sign-in"), ("login-error", "Sign-in, wrong password (inline error)"),
    ("today-empty", "Today, first run: empty, review link missing, checklist 0 of 3"),
    ("setup-unset", "Setup: review link not set"), ("composer-demo", "Request composer (demo customer)"),
    ("composer-success", "Request sent: designed success state"), ("today-populated", "Today, populated (demo)"),
    ("landing-unavailable", "Customer landing: designed unavailable state (no review link)"),
    ("composer-blocked", "Composer: a real send held back while the review link is missing"),
    ("import-preview", "CSV import: messy file, mapping + reasons"), ("import-result", "CSV import result"),
    ("b-job-form", "Config B: log a finished job"), ("b-composer", "Config B: job done -> composer, WhatsApp first"),
    ("b-landing", "Config B: customer landing"),
    ("b-landing-unhappy", "Config B: lowest rating. Google button unchanged; WhatsApp line ADDED"),
    ("b-landing-offline", "Config B: connection dropped mid-feedback, words kept"),
    ("b-activity", "Config B: Activity"), ("b-feedback", "Config B: Feedback with reply draft"),
    ("b-composer-email", "Config B: email channel"), ("b-composer-followup", "Config B: the one follow-up"),
    ("b-followup-success", "Config B: follow-up sent"), ("b-setup", "Config B: Setup (demo, showcase, status)"),
    ("b-widget-embed", "Config B: showcase strip embedded on a plain client page"),
    ("b-customers", "Config B: Customers"), ("b-jobs", "Config B: Jobs"),
    ("b-customer-detail", "Config B: customer record via ?phone= lookup"),
]


def row(kind, name):
    g = groups.get((kind, name), {})
    return "".join(
        f'<figure><img loading="lazy" src="shots/{g[v]}" alt="{html.escape(name)} at {v}"><figcaption>{v}</figcaption></figure>'
        for v in ("390", "desktop") if v in g)


out = ["""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Review Engine review pack</title><style>
body{margin:0;background:#f5f5f7;color:#1d1d1f;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif}
main{max-width:1400px;margin:0 auto;padding:24px 16px}h1{font-size:28px}h2{font-size:21px;margin:40px 0 8px}h3{font-size:15px;margin:24px 0 8px}
.row{display:flex;gap:16px;align-items:flex-start;overflow-x:auto}figure{margin:0;background:#fff;border-radius:14px;padding:10px;box-shadow:0 8px 24px -12px rgb(0 0 0/.15)}
figure img{display:block;max-height:720px;width:auto;max-width:100%}figcaption{font-size:12px;color:#6e6e73;margin-top:6px}p{color:#48484a;max-width:80ch}
</style></head><body><main><h1>Review Engine: compete pass review pack</h1>
<p>Branch compete/reviews-upgrades. Local mock-backend builds, test data only, every non-local request blocked.
Before = the v1 UI at 238cdc7 with only the local test backend copied in. After, config A = the repo config as shipped
(review link empty). Config B = configs/demo-config-2.js, a second invented business with a test review URL (Gate 3).
Full-page phone shots show the fixed bottom tab bar mid-page; that is a screenshot artifact, not the layout.</p>"""]
out.append("<h2>Before (v1)</h2>")
for n in BEFORE:
    if ("before", n) in groups:
        out.append(f"<h3>{n}</h3><div class=row>{row('before', n)}</div>")
out.append("<h2>After</h2>")
for n, t in AFTER:
    if ("after", n) in groups:
        out.append(f"<h3>{html.escape(t)}</h3><div class=row>{row('after', n)}</div>")
out.append("</main></body></html>")
open(f"{D}/index.html", "w").write("\n".join(out))
print(len(files), "screenshots in the pack")
