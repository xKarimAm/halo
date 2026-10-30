/* Halo Notes page: static shell served by the Notes Service.
 * Vanilla JS, no build step. All HTTP goes through the injected seams
 * (fetchJson/postTag) so the render test drives it with fixtures.
 * Provisional shapes (pending notes_service/contracts answers) are marked
 * PROVISIONAL and filed as issues; the golden page JSON is the oracle.
 */
"use strict";

(function () {
  var KIND_KEYS = ["point", "question", "decision", "pushback"];
  var URG_ORDER = ["urgent", "medium", "later"];

  var T = {
    en: {
      notes: "Notes", meetings: "Meetings", people: "People", everyone: "Whole meeting",
      search: "Search every meeting: points, actions and transcripts",
      results: "Search results", noHits: "No matches.", inPoints: "Point", inTx: "Transcript",
      decision: "Decision", question: "Open question", pushback: "Pushback", point: "Point",
      decs: "Key decisions", qs: "Open questions", pushes: "Pushbacks", pts: "Points",
      urgent: "Urgent", medium: "Medium", later: "Later / to discuss",
      filter: "Filter by type", all: "All",
      byHalo: "by Halo", byYou: "by you", menuCat: "Change type", menuUrg: "Change urgency",
      tipCat: "Type picked by Halo's low-cost classifier. Click to change it.",
      tipUrg: "Urgency picked by Halo's low-cost classifier. Click to change it.",
      prov: "Sorted by Halo's lightweight classifier. Wrong call? Click \u201Cby Halo\u201D on any item to re-tag it.",
      retagged: "Changed.",
      why: "Why {n} matters here", actions: "Action items", action: "Action item",
      assigned: "Assigned", suggested: "Suggested",
      asNote: "Said aloud", sgNote: "Suggested from their role, not said aloud", due: "Due",
      own: "Said by {n}", rel: "Relevant to {n}, said by others",
      tx: "Transcript", export: "Export Markdown", exported: "Markdown file saved.",
      orig: "Original", hide: "Hide original", jump: "Jump to line", play: "Play recording from here",
      recAt: "Recording: {p} at {t}", close: "Close profile", role: "Role from Setup",
      degraded: "AI summary failed, showing live notes.",
      keep: "Video auto-deletes after 7 days. Notes and transcript stay.",
      none: "Nothing here.", draftOnly: "Draft: only this meeting is filled in.",
      translated: "Translated", video: "Video"
    },
    ar: {
      notes: "الملاحظات", meetings: "الاجتماعات", people: "الأشخاص", everyone: "الاجتماع كاملاً",
      search: "ابحث في كل الاجتماعات: النقاط والمهام والنصوص",
      results: "نتائج البحث", noHits: "لا توجد نتائج.", inPoints: "نقطة", inTx: "النص",
      decision: "قرار", question: "سؤال مفتوح", pushback: "اعتراض", point: "نقطة",
      decs: "القرارات الرئيسية", qs: "أسئلة مفتوحة", pushes: "اعتراضات", pts: "نقاط",
      urgent: "عاجل", medium: "متوسط", later: "لاحقاً / للنقاش",
      filter: "تصفية حسب النوع", all: "الكل",
      byHalo: "بواسطة Halo", byYou: "بواسطتك", menuCat: "تغيير النوع", menuUrg: "تغيير الأولوية",
      tipCat: "صنّف Halo هذا النوع بنموذج منخفض التكلفة. اضغط لتغييره.",
      tipUrg: "حدّد Halo الأولوية بنموذج منخفض التكلفة. اضغط لتغييرها.",
      prov: "رتّبها مصنّف Halo الخفيف. التصنيف غير دقيق؟ اضغط \u00ABبواسطة Halo\u00BB على أي عنصر لتعديله.",
      retagged: "تم التغيير.",
      why: "لماذا يهم {n} هنا", actions: "المهام", action: "مهمة",
      assigned: "مُسندة", suggested: "مقترحة",
      asNote: "قيلت في الاجتماع", sgNote: "مقترحة حسب الدور، لم تُذكر صراحةً", due: "الموعد",
      own: "قالها {n}", rel: "تهمّ {n}، قالها آخرون",
      tx: "النص الكامل", export: "تصدير Markdown", exported: "تم حفظ ملف Markdown.",
      orig: "الأصل", hide: "إخفاء الأصل", jump: "انتقل إلى السطر", play: "شغّل التسجيل من هنا",
      recAt: "التسجيل: {p} عند {t}", close: "إغلاق الملف", role: "الدور من الإعداد",
      degraded: "فشل التلخيص الآلي، تُعرض الملاحظات المباشرة.",
      keep: "يُحذف الفيديو تلقائياً بعد ٧ أيام. الملاحظات والنص باقية.",
      none: "لا شيء هنا.", draftOnly: "مسودة: هذا الاجتماع فقط مكتمل.",
      translated: "مترجم", video: "الفيديو"
    }
  };

  function t(lang, key, vars) {
    var s = T[lang][key] || key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        s = s.replace("{" + k + "}", vars[k]);
      });
    }
    return s;
  }

  function fmt(sec) {
    var s = Math.max(0, Math.floor(sec));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return (m < 10 ? "0" + m : "" + m) + ":" + (r < 10 ? "0" + r : "" + r);
  }

  function fmtMs(ms) {
    return fmt(ms / 1000);
  }

  function hueOf(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) {
      h = (h * 31 + name.charCodeAt(i)) % 360;
    }
    return h;
  }

  function initials(name) {
    var parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 1);
    return parts[0].slice(0, 1) + parts[1].slice(0, 1);
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  /** Safe highlight: splits text nodes around the query, never innerHTML. */
  function markify(text, q) {
    var frag = document.createDocumentFragment();
    if (!q) {
      frag.appendChild(document.createTextNode(text));
      return frag;
    }
    var lower = text.toLowerCase();
    var needle = q.toLowerCase();
    var i = 0;
    for (;;) {
      var at = lower.indexOf(needle, i);
      if (at < 0) break;
      frag.appendChild(document.createTextNode(text.slice(i, at)));
      var mark = document.createElement("mark");
      mark.textContent = text.slice(at, at + q.length);
      frag.appendChild(mark);
      i = at + q.length;
    }
    frag.appendChild(document.createTextNode(text.slice(i)));
    return frag;
  }

  function urgOf(point) {
    return point.urgency || "later";
  }

  function actionsOf(points) {
    return points.filter(function (p) { return p.is_action; });
  }

  function byUrg(actions) {
    return URG_ORDER.map(function (u) {
      return [u, actions.filter(function (a) { return urgOf(a) === u; })];
    });
  }

  function ownOf(points, name) {
    return points.filter(function (p) { return p.speaker_name === name; });
  }

  // PROVISIONAL (contracts issue): page JSON has no per-person relevant list,
  // so relevance = points said by others in the same meeting.
  function relOf(points, name) {
    return points.filter(function (p) { return p.speaker_name !== name; });
  }

  function lineByTurn(page, turnId) {
    if (!turnId) return null;
    for (var i = 0; i < page.transcript_lines.length; i++) {
      if (page.transcript_lines[i].turn_id === turnId) return page.transcript_lines[i];
    }
    return null;
  }

  function avatar(name) {
    var span = el("span", "av", initials(name));
    span.style.setProperty("--h", String(hueOf(name)));
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  var ICON_D = {
    decision: ["M5 12.5l4.5 4.5L19 7.5"],
    question: ["M9 9.2a3 3 0 1 1 4.3 2.7c-.8.4-1.3 1.1-1.3 2V15", "M12 18.6v.1"],
    pushback: ["M9 14L4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"]
  };

  function svgIcon(kind) {
    var svgNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "ic");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    if (kind === "point") {
      var dot = document.createElementNS(svgNS, "circle");
      dot.setAttribute("cx", "12"); dot.setAttribute("cy", "12"); dot.setAttribute("r", "3.2");
      dot.setAttribute("fill", "currentColor"); dot.setAttribute("stroke", "none");
      svg.appendChild(dot);
      return svg;
    }
    (ICON_D[kind] || []).forEach(function (d) {
      var path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    });
    return svg;
  }

  function kindKey(kind) {
    return KIND_KEYS.indexOf(kind) >= 0 ? kind : "point";
  }

  // One-click re-tag: quiet "by Halo / by you" provenance opening a tiny menu.
  function retagControl(item, isAction, lang, userTags) {
    var id = isAction ? item.point_id : item.point_id;
    var cur = isAction ? urgOf(item) : kindKey(item.kind);
    var options = isAction ? URG_ORDER : KIND_KEYS;
    var mine = !!userTags[id];
    var details = el("details", "retag");
    var summary = el("summary", null, mine ? t(lang, "byYou") : t(lang, "byHalo"));
    summary.title = t(lang, isAction ? "tipUrg" : "tipCat");
    var caret = el("span", null, " \u25BE");
    summary.appendChild(caret);
    details.appendChild(summary);
    var menu = el("div", "menu");
    menu.setAttribute("role", "menu");
    var head = el("p", null, t(lang, isAction ? "menuUrg" : "menuCat"));
    menu.appendChild(head);
    options.forEach(function (v) {
      var btn = el("button", (isAction ? "u-" : "c-") + v);
      btn.setAttribute("role", "menuitemradio");
      btn.setAttribute("aria-checked", v === cur ? "true" : "false");
      btn.dataset.retag = id;
      btn.dataset.val = v;
      btn.dataset.action = isAction ? "1" : "";
      if (!isAction) btn.appendChild(svgIcon(v));
      else {
        var dot = el("i", "udot");
        btn.appendChild(dot);
      }
      btn.appendChild(document.createTextNode(t(lang, v)));
      if (v === cur) {
        var check = svgIcon("decision");
        check.setAttribute("class", "ic ck");
        btn.appendChild(check);
      }
      menu.appendChild(btn);
    });
    details.appendChild(menu);
    return details;
  }

  function personChip(name, lang, withAvatar) {
    var btn = el("button", "mini");
    btn.dataset.person = name;
    if (withAvatar !== false) btn.appendChild(avatar(name));
    var label = el("span", null, name);
    btn.appendChild(label);
    return btn;
  }

  function lineChip(app, line, lang) {
    var btn = el("button", "chip", "\u25B6 ");
    btn.dataset.line = line.turn_id;
    btn.title = t(lang, "play");
    var time = el("span", null, fmtMs(line.ts_start_ms));
    time.setAttribute("dir", "ltr");
    btn.appendChild(time);
    return btn;
  }

  function pointItem(app, point, lang, showBy) {
    var page = app.page;
    var line = lineByTurn(page, point.turn_ids[0]);
    var li = el("li", "pt c-" + kindKey(point.kind));
    var main = el("button", "pt-main");
    if (line) main.dataset.line = line.turn_id;
    main.setAttribute("aria-label", t(lang, kindKey(point.kind)) + ": " + point.text);
    var tag = el("span", "tag");
    tag.appendChild(svgIcon(kindKey(point.kind)));
    tag.appendChild(document.createTextNode(t(lang, kindKey(point.kind))));
    var txt = el("span", "txt", point.text);
    var wrap = el("span");
    wrap.appendChild(tag);
    wrap.appendChild(txt);
    main.appendChild(wrap);
    li.appendChild(main);
    var meta = el("div", "meta");
    if (showBy !== false) meta.appendChild(personChip(point.speaker_name, lang));
    if (line) meta.appendChild(lineChip(app, line, lang));
    var origBtn = el("button", "chip", app.openQuote[point.point_id] ? t(lang, "hide") : t(lang, "orig"));
    origBtn.dataset.orig = point.point_id;
    origBtn.setAttribute("aria-expanded", app.openQuote[point.point_id] ? "true" : "false");
    meta.appendChild(origBtn);
    meta.appendChild(retagControl(point, false, lang, app.userTags));
    li.appendChild(meta);
    if (app.openQuote[point.point_id]) {
      var quote = el("blockquote", null, "\u201C" + point.quote + "\u201D");
      li.appendChild(quote);
    }
    return li;
  }

  // PROVISIONAL (contracts issue): page JSON carries no action owner/status,
  // so every is_action point renders as Suggested (the documented live fallback).
  function actionItem(app, point, lang, showWho) {
    var page = app.page;
    var line = lineByTurn(page, point.turn_ids[0]);
    var li = el("li", "act sug u-" + urgOf(point));
    var badge = el("span", "badge sg", t(lang, "suggested"));
    li.appendChild(badge);
    var body = el("div", "body", point.text);
    var small = el("small", null, t(lang, "sgNote"));
    body.appendChild(small);
    var ameta = el("div", "ameta");
    if (showWho !== false) ameta.appendChild(personChip(point.speaker_name, lang));
    if (line) ameta.appendChild(lineChip(app, line, lang));
    ameta.appendChild(retagControl(point, true, lang, app.userTags));
    body.appendChild(ameta);
    li.appendChild(body);
    return li;
  }

  function filtersBar(app, points, lang) {
    var bar = el("div", "filters");
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", t(lang, "filter"));
    var mk = function (value, label, count, cls) {
      var btn = el("button", cls || null);
      btn.dataset.cat = value;
      btn.setAttribute("aria-pressed", app.cat === value ? "true" : "false");
      btn.appendChild(document.createTextNode(label + " "));
      var em = el("em", null, String(count));
      btn.appendChild(em);
      return btn;
    };
    bar.appendChild(mk("all", t(lang, "all"), points.length));
    KIND_KEYS.forEach(function (k) {
      var btn = mk(k, "", points.filter(function (p) { return kindKey(p.kind) === k; }).length, "c-" + k);
      btn.insertBefore(svgIcon(k), btn.firstChild);
      btn.insertBefore(document.createTextNode(t(lang, k) + " "), btn.firstChild.nextSibling);
      bar.appendChild(btn);
    });
    return bar;
  }

  function meetingCard(app, meeting, lang) {
    var btn = el("button", "mtg-card glass");
    btn.dataset.open = meeting.meeting_id;
    var stack = el("span", "stack");
    (meeting.people || []).slice(0, 4).forEach(function (name) {
      stack.appendChild(avatar(name));
    });
    btn.appendChild(stack);
    var info = el("span");
    info.style.flex = "1";
    var title = el("b", null, meeting.subject);
    info.appendChild(title);
    info.appendChild(el("br"));
    info.appendChild(el("span", "sub", meeting.date || ""));
    btn.appendChild(info);
    return btn;
  }

  function hitRow(app, hit, lang) {
    var btn = el("button", "hit");
    btn.dataset.open = hit.meeting_id;
    if (hit.line) btn.dataset.line = hit.line;
    var kind = el("span", "kind", hit.kindLabel || "");
    btn.appendChild(kind);
    var body = el("div");
    body.appendChild(markify(hit.snippet || "", app.q.trim()));
    btn.appendChild(body);
    var sub = el("small", null, (hit.subject || "") + (hit.speaker ? " \u00B7 " + hit.speaker : ""));
    btn.appendChild(sub);
    return btn;
  }

  function summaryBoard(app, lang) {
    var points = app.page.points;
    var section = el("section", "board glass");
    var head = el("div", "bhead");
    head.appendChild(el("h2", null, t(lang, "actions")));
    head.appendChild(el("p", "prov", t(lang, "prov")));
    section.appendChild(head);
    var grid = el("div", "ugrid");
    byUrg(actionsOf(points)).forEach(function (pair) {
      var u = pair[0], list = pair[1];
      var col = el("section", "ucol u-" + u);
      var h3 = el("h3");
      h3.appendChild(el("i", "udot"));
      h3.appendChild(document.createTextNode(t(lang, u) + " "));
      h3.appendChild(el("em", null, String(list.length)));
      col.appendChild(h3);
      var ul = el("ul");
      list.forEach(function (a) { ul.appendChild(actionItem(app, a, lang, true)); });
      if (list.length === 0) ul.appendChild(el("li", "empty", t(lang, "none")));
      col.appendChild(ul);
      grid.appendChild(col);
    });
    section.appendChild(grid);
    return section;
  }

  function kindColumn(app, kind, lang) {
    var names = { decision: "decs", question: "qs", pushback: "pushes", point: "pts" };
    var list = app.page.points.filter(function (p) {
      return kindKey(p.kind) === kind && (app.cat === "all" || kindKey(p.kind) === app.cat);
    });
    var section = el("section", "col glass c-" + kind);
    var h2 = el("h2");
    h2.appendChild(svgIcon(kind));
    h2.appendChild(document.createTextNode(t(lang, names[kind])));
    section.appendChild(h2);
    var ul = el("ul");
    list.forEach(function (p) { ul.appendChild(pointItem(app, p, lang, true)); });
    if (list.length === 0) ul.appendChild(el("li", "empty", t(lang, "none")));
    section.appendChild(ul);
    return section;
  }

  function personPanel(app, person, lang) {
    var points = app.page.points;
    var own = ownOf(points, person.name);
    var rel = relOf(points, person.name);
    var acts = byUrg(actionsOf(points).filter(function (a) { return a.speaker_name === person.name; }))
      .filter(function (pair) { return pair[1].length > 0; });
    var section = el("section", "panel glass");
    section.setAttribute("aria-label", person.name);
    var head = el("div", "p-head");
    head.appendChild(avatar(person.name));
    var title = el("div");
    title.appendChild(el("h2", null, person.name));
    var sub = el("div", "sub", person.role);
    sub.title = t(lang, "role");
    title.appendChild(sub);
    head.appendChild(title);
    var close = el("button", "x", "\u00D7");
    close.dataset.person = "";
    close.setAttribute("aria-label", t(lang, "close"));
    head.appendChild(close);
    section.appendChild(head);
    var why = el("div", "why");
    why.appendChild(el("h2", null, t(lang, "why", { n: person.name })));
    why.appendChild(el("p", null, person.why));
    section.appendChild(why);
    var grid = el("div", "pgrid");
    var actSection = el("section", "span2");
    var ahead = el("div", "bhead");
    ahead.appendChild(el("h2", null, t(lang, "actions")));
    ahead.appendChild(el("p", "prov", t(lang, "prov")));
    actSection.appendChild(ahead);
    acts.forEach(function (pair) {
      var group = el("div", "ugroup u-" + pair[0]);
      var h3 = el("h3");
      h3.appendChild(el("i", "udot"));
      h3.appendChild(document.createTextNode(t(lang, pair[0]) + " "));
      h3.appendChild(el("em", null, String(pair[1].length)));
      group.appendChild(h3);
      var ul = el("ul");
      pair[1].forEach(function (a) { ul.appendChild(actionItem(app, a, lang, false)); });
      group.appendChild(ul);
      actSection.appendChild(group);
    });
    if (acts.length === 0) actSection.appendChild(el("p", "empty", t(lang, "none")));
    grid.appendChild(actSection);
    var filterWrap = el("div", "span2");
    filterWrap.appendChild(filtersBar(app, own.concat(rel), lang));
    grid.appendChild(filterWrap);
    [["own", own], ["rel", rel]].forEach(function (pair) {
      var key = pair[0], list = pair[1];
      var s = el("section");
      s.appendChild(el("h2", null, t(lang, key, { n: person.name })));
      var ul = el("ul");
      list.filter(function (p) { return app.cat === "all" || kindKey(p.kind) === app.cat; })
        .forEach(function (p) { ul.appendChild(pointItem(app, p, lang, key === "rel")); });
      if (ul.children.length === 0) ul.appendChild(el("li", "empty", t(lang, "none")));
      s.appendChild(ul);
      grid.appendChild(s);
    });
    section.appendChild(grid);
    return section;
  }

  function renderTranscript(app, aside, lang) {
    aside.textContent = "";
    var page = app.page;
    var cur = page.transcript_lines[app.lineIndex] || page.transcript_lines[0];
    var player = el("div", "player");
    var row = el("div", "prow");
    var play = el("button", "play", "\u25B6");
    play.setAttribute("aria-label", t(lang, "play"));
    if (cur) play.dataset.line = cur.turn_id;
    row.appendChild(play);
    var time = el("span", "time", cur ? fmtMs(cur.ts_start_ms) : "--:--");
    time.setAttribute("dir", "ltr");
    row.appendChild(time);
    player.appendChild(row);
    player.appendChild(el("div", "keep", t(lang, "keep")));
    if (cur) {
      player.appendChild(el("div", "recoff", t(lang, "recAt", {
        p: page.recording.path, t: fmtMs(cur.recording_offset_ms)
      })));
    }
    aside.appendChild(player);
    var h2 = el("h2", null, t(lang, "tx"));
    h2.style.padding = "12px 20px 0";
    aside.appendChild(h2);
    var lines = el("div", "lines");
    lines.id = "lines";
    page.transcript_lines.forEach(function (ln, index) {
      var btn = el("button", "ln" + (index === app.lineIndex ? " on" : ""));
      btn.dataset.line = ln.turn_id;
      btn.id = "ln-" + index;
      if (index === app.lineIndex) btn.setAttribute("aria-current", "true");
      btn.appendChild(avatar(ln.speaker_name));
      var who = el("span", "who");
      who.appendChild(el("b", null, ln.speaker_name));
      who.appendChild(document.createTextNode(" \u00B7 "));
      var when = el("span", null, fmtMs(ln.ts_start_ms));
      when.setAttribute("dir", "ltr");
      who.appendChild(when);
      btn.appendChild(who);
      btn.appendChild(el("span", "o", ln.text));
      lines.appendChild(btn);
    });
    aside.appendChild(lines);
    var active = lines.querySelector(".ln.on");
    if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
  }

  function renderMeeting(app, view, lang) {
    var page = app.page;
    if (page.degraded) {
      view.appendChild(el("div", "degraded", t(lang, "degraded")));
    }
    var wrap = el("div", "mtg");
    var left = el("div");
    var head = el("section", "head glass");
    head.appendChild(el("h1", null, page.meeting.subject));
    left.appendChild(head);
    left.appendChild(el("h2", "sr", t(lang, "people")));
    var people = el("div", "people");
    people.setAttribute("role", "group");
    people.setAttribute("aria-label", t(lang, "people"));
    var all = el("button", "all", t(lang, "everyone"));
    all.dataset.person = "";
    all.setAttribute("aria-pressed", app.person ? "false" : "true");
    people.appendChild(all);
    page.people.forEach(function (person) {
      var btn = el("button", "person");
      btn.dataset.person = person.name;
      btn.setAttribute("aria-pressed", app.person === person.name ? "true" : "false");
      btn.style.setProperty("--h", String(hueOf(person.name)));
      btn.appendChild(avatar(person.name));
      btn.appendChild(el("span", "nm", person.name));
      var rl = el("span", "rl", person.role);
      rl.title = t(lang, "role");
      btn.appendChild(rl);
      people.appendChild(btn);
    });
    left.appendChild(people);
    var stage = el("div");
    stage.id = "stage";
    var selected = page.people.filter(function (p) { return p.name === app.person; })[0];
    if (selected) {
      stage.appendChild(personPanel(app, selected, lang));
    } else {
      stage.appendChild(summaryBoard(app, lang));
      stage.appendChild(filtersBar(app, page.points, lang));
      var cols = el("div", "cols" + (app.cat === "all" ? "" : " one"));
      (app.cat === "all" ? KIND_KEYS : [app.cat]).forEach(function (k) {
        cols.appendChild(kindColumn(app, k, lang));
      });
      stage.appendChild(cols);
    }
    left.appendChild(stage);
    wrap.appendChild(left);
    var aside = el("aside", "tx glass");
    aside.id = "tx";
    aside.setAttribute("aria-label", t(lang, "tx"));
    renderTranscript(app, aside, lang);
    wrap.appendChild(aside);
    view.appendChild(wrap);
  }

  function renderList(app, view, lang) {
    view.appendChild(el("h1", null, t(lang, "meetings")));
    var label = el("label", "search glass");
    var icon = el("span", null, "\u2315");
    icon.setAttribute("aria-hidden", "true");
    label.appendChild(icon);
    label.appendChild(el("span", "sr", t(lang, "search")));
    var input = document.createElement("input");
    input.id = "q";
    input.type = "search";
    input.value = app.q;
    input.placeholder = t(lang, "search");
    label.appendChild(input);
    view.appendChild(label);
    var grid = el("div", "listgrid");
    var listSection = el("section");
    listSection.setAttribute("aria-label", t(lang, "meetings"));
    app.meetings.forEach(function (m) { listSection.appendChild(meetingCard(app, m, lang)); });
    grid.appendChild(listSection);
    var hitsSection = el("section", "hits glass");
    hitsSection.setAttribute("aria-live", "polite");
    hitsSection.appendChild(el("h2", null, t(lang, "results")));
    var hits = el("div");
    hits.id = "hits";
    app.hits.forEach(function (h) { hits.appendChild(hitRow(app, h, lang)); });
    if (app.q.trim() && app.hits.length === 0) hits.appendChild(el("p", "empty", t(lang, "noHits")));
    hitsSection.appendChild(hits);
    grid.appendChild(hitsSection);
    view.appendChild(grid);
  }

  function render(app) {
    var doc = app.doc;
    var lang = app.lang;
    doc.documentElement.lang = lang;
    doc.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    Array.prototype.forEach.call(doc.querySelectorAll("[data-lang]"), function (b) {
      b.setAttribute("aria-pressed", b.dataset.lang === lang ? "true" : "false");
    });
    Array.prototype.forEach.call(doc.querySelectorAll("[data-t]"), function (node) {
      node.textContent = t(lang, node.dataset.t);
    });
    var exportBtn = doc.getElementById("export");
    exportBtn.hidden = app.view !== "meeting";
    exportBtn.textContent = "\u21E9 " + t(lang, "export");
    var crumb = doc.getElementById("crumb");
    crumb.textContent = "";
    if (app.view === "list") {
      crumb.appendChild(el("span", null, t(lang, "meetings")));
    } else {
      var back = el("button", null, t(lang, "meetings"));
      back.dataset.nav = "list";
      crumb.appendChild(back);
      crumb.appendChild(document.createTextNode(" / " + app.page.meeting.subject));
      if (app.person) crumb.appendChild(document.createTextNode(" / " + app.person));
    }
    var view = doc.getElementById("view");
    view.textContent = "";
    if (app.view === "list" || !app.page) renderList(app, view, lang);
    else renderMeeting(app, view, lang);
  }

  function toast(app, message) {
    var node = app.doc.getElementById("toast");
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(app.toastTimer);
    app.toastTimer = setTimeout(function () { node.classList.remove("show"); }, 2200);
  }

  function exportMarkdown(page, lang) {
    var lines = [];
    lines.push("# " + page.meeting.subject);
    lines.push("");
    page.people.forEach(function (person) {
      lines.push("## " + person.name + ": " + person.role);
      lines.push(person.why);
      lines.push("");
      var acts = actionsOf(page.points).filter(function (a) { return a.speaker_name === person.name; });
      byUrg(acts).forEach(function (pair) {
        if (pair[1].length === 0) return;
        lines.push("### " + t(lang, pair[0]));
        pair[1].forEach(function (a) {
          var ln = lineByTurn(page, a.turn_ids[0]);
          lines.push("- [ ] **" + a.text + "** (" + t(lang, "suggested") +
            (ln ? ", [" + fmtMs(ln.ts_start_ms) + "](#t=" + Math.floor(ln.ts_start_ms / 1000) + ")" : "") + ")");
        });
        lines.push("");
      });
    });
    lines.push("## " + t(lang, "pts"));
    KIND_KEYS.forEach(function (k) {
      var list = page.points.filter(function (p) { return kindKey(p.kind) === k; });
      if (list.length === 0) return;
      lines.push("### " + t(lang, k));
      list.forEach(function (p) {
        var ln = lineByTurn(page, p.turn_ids[0]);
        lines.push("- **" + p.text + "** (" + p.speaker_name +
          (ln ? ", [" + fmtMs(ln.ts_start_ms) + "](#t=" + Math.floor(ln.ts_start_ms / 1000) + ")" : "") + ")");
        lines.push("  > " + p.quote);
      });
      lines.push("");
    });
    return lines.join("\n");
  }

  function findPoint(app, id) {
    if (!app.page) return null;
    for (var i = 0; i < app.page.points.length; i++) {
      if (app.page.points[i].point_id === id) return app.page.points[i];
    }
    return null;
  }

  function closest(node, doc, selector) {
    while (node && node !== doc) {
      if (node.matches && node.matches(selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  function createApp(opts) {
    var app = {
      doc: opts.doc,
      fetchJson: opts.fetchJson,
      postTag: opts.postTag,
      lang: "en",
      view: "list",
      meetings: [],
      page: null,
      person: null,
      lineIndex: 0,
      q: "",
      hits: [],
      cat: "all",
      openQuote: {},
      userTags: {},
      toastTimer: null
    };

    app.showList = function (meetings) {
      app.view = "list";
      app.meetings = meetings;
      render(app);
    };

    app.showMeeting = function (page) {
      app.view = "meeting";
      app.page = page;
      app.person = null;
      app.lineIndex = 0;
      render(app);
    };

    app.setLang = function (lang) {
      app.lang = lang === "ar" ? "ar" : "en";
      render(app);
    };

    app.loadMeetings = function () {
      return app.fetchJson("/api/meetings").then(function (meetings) {
        app.showList(meetings);
      });
    };

    app.openMeeting = function (id) {
      return app.fetchJson("/api/meetings/" + encodeURIComponent(id)).then(function (page) {
        app.showMeeting(page);
      });
    };

    app.search = function (q) {
      app.q = q;
      if (!q.trim()) {
        app.hits = [];
        render(app);
        return Promise.resolve([]);
      }
      return app.fetchJson("/api/search?q=" + encodeURIComponent(q)).then(function (res) {
        app.hits = res.hits || [];
        render(app);
        return app.hits;
      });
    };

    function onRetag(id, val, isAction) {
      var point = findPoint(app, id);
      if (!point) return Promise.resolve();
      var body = isAction
        ? { target: "action", target_id: id, urgency: val }
        : { target: "point", target_id: id, kind: val };
      return app.postTag(body).then(function () {
        if (isAction) point.urgency = val;
        else point.kind = val;
        app.userTags[id] = val;
        render(app);
        toast(app, t(app.lang, "retagged"));
      });
    }

    function onClick(event) {
      var g = function (s) { return closest(event.target, app.doc, s); };
      var b;
      if ((b = g("[data-retag][data-val]"))) {
        event.preventDefault();
        onRetag(b.dataset.retag, b.dataset.val, b.dataset.action === "1");
        return;
      }
      if ((b = g("[data-lang]"))) {
        app.setLang(b.dataset.lang);
        return;
      }
      if ((b = g("[data-cat]"))) {
        app.cat = b.dataset.cat;
        render(app);
        return;
      }
      if ((b = g("[data-nav]"))) {
        app.loadMeetings();
        return;
      }
      if ((b = g("#export"))) {
        var blob = new Blob([exportMarkdown(app.page, app.lang)], { type: "text/markdown" });
        var a = app.doc.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "halo-notes-" + app.page.meeting.meeting_id + ".md";
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        toast(app, t(app.lang, "exported"));
        return;
      }
      if ((b = g("[data-open]"))) {
        app.openMeeting(b.dataset.open).then(function () {
          var turn = b.dataset.line;
          if (turn && app.page) {
            var others = app.page.transcript_lines;
            for (var i = 0; i < others.length; i++) {
              if (others[i].turn_id === turn) {
                app.lineIndex = i;
                render(app);
                break;
              }
            }
          }
        });
        return;
      }
      if ((b = g("[data-orig]"))) {
        var pid = b.dataset.orig;
        app.openQuote[pid] = !app.openQuote[pid];
        render(app);
        return;
      }
      if ((b = g("[data-person]"))) {
        app.person = b.dataset.person || null;
        render(app);
        return;
      }
      if ((b = g("[data-line]"))) {
        var turnId = b.dataset.line;
        if (app.page) {
          var lines = app.page.transcript_lines;
          for (var j = 0; j < lines.length; j++) {
            if (lines[j].turn_id === turnId) {
              app.lineIndex = j;
              render(app);
              break;
            }
          }
        }
        return;
      }
    }

    function onInput(event) {
      if (event.target && event.target.id === "q") {
        app.search(event.target.value);
      }
    }

    function onKey(event) {
      if (event.key !== "Escape") return;
      if (app.person) {
        app.person = null;
        render(app);
      }
    }

    app.doc.addEventListener("click", onClick);
    app.doc.addEventListener("input", onInput);
    app.doc.addEventListener("keydown", onKey);
    return app;
  }

  function boot(doc, meetingId) {
    var fetchJson = function (url) {
      return window.fetch(url, { headers: { Accept: "application/json" } }).then(function (res) {
        if (!res.ok) throw new Error("Halo notes request failed: " + url);
        return res.json();
      });
    };
    var postTag = function (body) {
      return window.fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body)
      }).then(function (res) {
        if (!res.ok) throw new Error("Halo re-tag failed");
        return res.json().catch(function () { return {}; });
      });
    };
    var app = createApp({ doc: doc, fetchJson: fetchJson, postTag: postTag });
    if (meetingId) app.openMeeting(meetingId);
    else app.loadMeetings();
    return app;
  }

  window.HaloNotes = {
    createApp: createApp,
    boot: boot,
    exportMarkdown: exportMarkdown
  };
})();
