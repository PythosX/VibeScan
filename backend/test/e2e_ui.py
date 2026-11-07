# Browser end-to-end test with a MOCKED /api/analyze (no AI quota used).
# Needs: pip install playwright && playwright install chromium
# Run:   (cd frontend && python3 -m http.server 8099) & python3 backend/test/e2e_ui.py
import json, sys
from playwright.sync_api import sync_playwright

BIO = "Sample bio (made up): Product designer, weekend climber, terrible at small talk. Looking for something real. No drama, no games, I know my worth and I don't chase. I have traditional values but I'm happy to split the bill and the chores. Tell me about the last book that changed your mind."

def span(t, phrase):
    i = t.lower().find(phrase.lower()); return i, i+len(phrase)

def sig(phrase, expl, why, alt, q):
    s,e = span(BIO, phrase)
    return dict(phrase=BIO[s:e], start=s, end=e, explanation=expl, why_it_matters=why, alternative_interpretation=alt, clarification_question=q, context="")

result = dict(
  summary="A short, friendly bio from someone who wants something genuine and describes a calm, direct communication style.",
  relationship_intentions=["Something real, without games"],
  communication_style="Plain and direct, with a few phrases that could mean different things depending on context.",
  positive_signals=[sig("split the bill and the chores","Expresses a willingness to share costs and household work.","Suggests an expectation of fairness.","Could be a stated preference rather than a practice.","How do you like to share household responsibilities?"),
                    sig("Tell me about the last book that changed your mind","An open invitation to share and be curious.","Invites two-way conversation.","May simply be an icebreaker.","What book changed your mind most recently?")],
  ambiguous_signals=[sig("No drama","Often a preference for calm communication.","Matters if it extends to avoiding hard conversations.","May signal discomfort with conflict.","What does a good disagreement look like to you?"),
                     sig("I know my worth","Self-respect or high standards.","Could set expectations early.","May be a defence after bad experiences.","What does that look like in a relationship?"),
                     sig("traditional values","A personal or cultural preference whose meaning varies.","Roles and expectations may differ.","Here it sits alongside sharing chores.","What do traditional values mean to you?")],
  concerning_signals=[],
  expectations=[dict(category="values",statement="Traditional values, shared chores"),dict(category="communication",statement="No drama, no games")],
  suggested_questions=["What does a good disagreement look like to you?","What do traditional values mean to you?","How do you like to share household responsibilities?","What does knowing your worth look like in a relationship?","What book changed your mind most recently?"],
  observations=["Clear about wanting something genuine.","Mixes traditional values with fairness.","Several phrases need context."],
  things_to_clarify=["What 'traditional values' covers.","How 'no drama' applies to disagreements."],
  practical_suggestion="Open with the book question, then ask about values.",
  analysed_text=BIO, meta=dict(dropped_signals=1, provider="Cloudflare Workers AI", model="@cf/meta/llama-3.3-70b-instruct-fp8-fast"))

def sse():
    out=""
    for n in (1,2,3,4,5): out+=f"event: stage\ndata: {json.dumps({'stage':n})}\n\n"
    out+=f"event: result\ndata: {json.dumps(result)}\n\n"
    return out

errors=[]
def run(mode="ok"):
    with sync_playwright() as p:
        b=p.chromium.launch()
        ctx=b.new_context(viewport={"width":1440,"height":900}, permissions=["clipboard-read","clipboard-write"])
        page=ctx.new_page()
        page.on("pageerror", lambda e: errors.append(("pageerror",str(e))))
        page.on("console", lambda m: errors.append(("console",m.text)) if m.type=="error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
        calls=[]
        def api(route):
            calls.append(route.request.post_data)
            if mode=="err":
                route.fulfill(status=200, content_type="text/event-stream", body='event: stage\ndata: {"stage":1}\n\nevent: error\ndata: {"code":"quota_exceeded","message":"VibeScan has reached its free daily AI limit. Please try again tomorrow."}\n\n')
            else:
                route.fulfill(status=200, content_type="text/event-stream", body=sse())
        page.route("**/api/analyze", api)
        page.route("**/fonts.googleapis.com/**", lambda r: r.abort()); page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

        # Landing
        page.goto("http://localhost:8099/index.html"); page.wait_for_timeout(900)
        page.screenshot(path="/tmp/shots/landing-1440.png", full_page=True)
        page.click("[data-preview=pv-book]"); assert page.is_visible("#pv-book") and not page.is_visible("#pv-nodrama")
        # Analyzer
        page.goto("http://localhost:8099/analyzer.html")
        assert page.is_visible("#age-gate"), "age gate missing"
        page.screenshot(path="/tmp/shots/agegate.png")
        page.click("#age-no"); assert page.is_visible("#age-denied")
        page.reload(); page.click("#age-yes"); assert not page.is_visible("#age-gate")
        page.reload(); assert not page.is_visible("#age-gate"), "age not remembered"
        page.click("#analyse"); assert "Add some" in page.inner_text("#bio-error"), page.inner_text("#bio-error")
        page.fill("#bio","hi"); page.click("#analyse"); assert "short" in page.inner_text("#bio-error")
        page.fill("#bio","a"*3100); assert "limit" in page.inner_text("#bio-error") and page.get_attribute("#bio","aria-invalid")=="true"
        page.click("#clear"); assert page.input_value("#bio")==""
        # upload validation
        page.click("#tab-upload")
        page.set_input_files("#file", files=[{"name":"x.gif","mimeType":"image/gif","buffer":b"GIF89a"}])
        page.wait_for_function("document.getElementById('file-error').textContent.includes('supported')")
        page.set_input_files("#file", files=[{"name":"fake.png","mimeType":"image/png","buffer":b"notreallyapng!!"}])
        page.wait_for_function("document.getElementById('file-error').textContent.includes('real')")
        page.set_input_files("#file", files=[{"name":"big.png","mimeType":"image/png","buffer":b"\x89PNG"+b"0"*(5*1024*1024+10)}])
        page.wait_for_function("document.getElementById('file-error').textContent.includes('5 MB')")
        import base64
        png=base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
        page.set_input_files("#file", files=[{"name":"ok.png","mimeType":"image/png","buffer":png}])
        page.wait_for_selector("#preview-wrap:not([hidden])", timeout=3000); assert page.is_visible("#extract")
        page.click("#extract"); page.wait_for_selector("#file-error:not([hidden])", timeout=20000)
        print("OCR offline error shown:", page.inner_text("#file-error")[:90])
        page.click("#remove"); assert page.is_visible("#dropzone")
        page.click("#tab-paste")
        page.click("#example"); assert "Sample bio" in page.input_value("#bio")
        page.screenshot(path="/tmp/shots/analyzer-1440.png")
        if mode=="err":
            page.click("#analyse"); page.wait_for_selector("#bio-error:not([hidden])")
            print("error path:", page.inner_text("#bio-error")); assert page.is_visible("#inputView") and page.input_value("#bio")
            b.close(); return
        page.click("#analyse"); page.wait_for_selector("#progressView:not([hidden])")
        page.wait_for_url("**/results.html", timeout=8000)
        assert json.loads(calls[0])["text"].startswith("Sample bio")
        page.wait_for_selector("#report:not([hidden])")
        page.screenshot(path="/tmp/shots/results-1440.png", full_page=True)
        txt=page.inner_text("#report-main")
        for h in ["Overall summary","Language signals","Phrase-by-phrase breakdown","Relationship expectations","Questions to ask","Final observations"]: assert h in txt, h
        assert "An AI analysis is only a starting point" in txt
        assert page.locator(".hl").count()==5, page.locator(".hl").count()
        page.click(".hl[data-kind=ambiguous]"); assert "No drama" in page.inner_text("#detail")
        page.screenshot(path="/tmp/shots/results-detail-1440.png")
        page.click("text=Copy report"); assert "VIBESCAN ANALYSIS" in page.evaluate("navigator.clipboard.readText()")
        page.click("#copy-questions"); assert page.evaluate("navigator.clipboard.readText()").startswith("1. ")
        page.locator(".questions .btn").first.click(); assert "disagreement" in page.evaluate("navigator.clipboard.readText()")
        assert "removed because" in page.inner_text("#dropped-note")
        # keyboard on highlight
        page.focus(".hl[data-kind=positive]"); page.keyboard.press("Enter"); assert "split the bill" in page.inner_text("#detail")
        # mobile
        for w in (360,390,768,1024):
            page.set_viewport_size({"width":w,"height":800}); page.wait_for_timeout(150)
            sw=page.evaluate("document.documentElement.scrollWidth"); assert sw<=w, (w,sw)
        page.set_viewport_size({"width":390,"height":800}); page.reload(); page.wait_for_selector("#report:not([hidden])")
        page.click(".hl[data-kind=ambiguous]"); page.wait_for_timeout(450)
        assert page.get_attribute("#detail","role")=="dialog"
        page.screenshot(path="/tmp/shots/results-sheet-390.png")
        page.keyboard.press("Escape"); page.wait_for_timeout(400)
        assert not page.is_visible("#detail")
        page.screenshot(path="/tmp/shots/results-390.png", full_page=True)
        # mobile nav
        page.click(".nav-toggle"); assert page.is_visible("#site-nav a >> text=New analysis")
        page.screenshot(path="/tmp/shots/nav-390.png")
        # clear
        page.click(".nav-toggle"); page.click("#clear-analysis"); assert page.is_visible("#empty")
        page.reload(); assert page.is_visible("#empty") and not page.is_visible("#report")
        # landing mobile
        for w in (360,390,768,1024,1440):
            page.set_viewport_size({"width":w,"height":800}); page.goto("http://localhost:8099/index.html"); page.wait_for_timeout(200)
            sw=page.evaluate("document.documentElement.scrollWidth"); assert sw<=w, ("landing",w,sw)
            page.goto("http://localhost:8099/analyzer.html"); sw=page.evaluate("document.documentElement.scrollWidth"); assert sw<=w, ("analyzer",w,sw)
        page.set_viewport_size({"width":390,"height":800}); page.goto("http://localhost:8099/index.html"); page.wait_for_timeout(600)
        page.screenshot(path="/tmp/shots/landing-390.png", full_page=True)
        b.close()

try:
    run("ok"); run("err")
except Exception as e:
    import traceback; traceback.print_exc(limit=-2); print("errors so far:", errors); raise SystemExit(1)
print("console/page errors:", errors if errors else "none")
print("ALL PASSED")
