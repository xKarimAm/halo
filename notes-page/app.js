/* Halo Notes page: static shell served by the Notes Service.
 * Vanilla JS, no build step. All HTTP goes through the injected seams
 * (fetchJson/postTag) so the render test drives it with fixtures.
 * Shapes match the merged service (contracts/meeting-page.schema.json):
 * meeting.degraded, top-level actions[] with point_id, and per-person
 * relevant_points/own_points id lists. Recording playback goes through the
 * service audio endpoint for recordings/{meeting_id}.webm (multi-file
 * covering sets resolve server-side via recordings/{meeting_id}.index.json).
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
      dis: "Disagreements", disSettled: "Settled", disParked: "Parked", disOpen: "Still open",
      urgent: "Urgent", medium: "Medium", later: "Later / to discuss",
      filter: "Filter by type", all: "All",
      byHalo: "by Halo", byYou: "by you", menuCat: "Change type", menuUrg: "Change urgency",
      tipCat: "Type picked by Halo's low-cost classifier. Click to change it.",
      tipUrg: "Urgency picked by Halo's low-cost classifier. Click to change it.",
      prov: "Sorted by Halo's lightweight classifier. Wrong call? Click \u201Cby Halo\u201D on any item to re-tag it.",
      retagged: "Changed.",
      cMin: "{n} min", cDec: "{n} decision", cDecs: "{n} decisions", cQ: "{n} open question",
      cQs: "{n} open questions", cPush: "{n} pushback", cPushes: "{n} pushbacks",
      cUrg: "{n} urgent action", cUrgs: "{n} urgent actions",
      spTitle: "Your speaking", spPrivate: "Only you see this. Facts from the transcript, not a grade.",
      spShare: "Talk share", spFair: "an even share is {n}%", spLongest: "Longest stretch", spAt: "at {t}",
      spQs: "Questions asked", spFollow: "{n} follow-ups", spCut: "Cut in", spCutWho: "first: {name} at {t}",
      spPace: "Pace", spWpm: "words a minute", spHedged: "Hedged commitments", spTry: "Next call:",
      spTry_cut_ins: "when you want in, wait for the end of their sentence, then say their name.",
      spTry_longest: "after your main point, stop and ask one question before going on.",
      spTry_share: "ask one open question per topic and let the room answer first.",
      spTry_hedged: "say commitments plainly: who, what, by when, without “I think” or “maybe”.",
      spTry_questions: "ask one follow-up on what someone just said.",
      spTry_keep: "keep the same balance; it worked.",
      spTry_solo: "this was a solo run; the talk-share facts appear once others join.",
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
      translated: "Translated", video: "Video",
      allMeetings: "All meetings", preview: "Hover a meeting to preview it",
      noSummary: "No AI summary yet. Meetings get one when they end.",
      newFolder: "New folder name", createFolder: "Create folder", moveTo: "Folder",
      noFolder: "No folder", email: "Email", decsShort: "Decisions", openNotes: "Open notes",
      mailSubject: "Action item from \u201C{m}\u201D: {a}",
      mailBody: "Hi {o},\n\nFrom the meeting \u201C{m}\u201D ({d}):\n\n{a}\nUrgency: {u}\n\nSent from Halo notes"
    },
    ar: {
      notes: "الملاحظات", meetings: "الاجتماعات", people: "الأشخاص", everyone: "الاجتماع كاملاً",
      search: "ابحث في كل الاجتماعات: النقاط والمهام والنصوص",
      results: "نتائج البحث", noHits: "لا توجد نتائج.", inPoints: "نقطة", inTx: "النص",
      decision: "قرار", question: "سؤال مفتوح", pushback: "اعتراض", point: "نقطة",
      decs: "القرارات الرئيسية", qs: "أسئلة مفتوحة", pushes: "اعتراضات", pts: "نقاط",
      dis: "الخلافات", disSettled: "تم الحسم", disParked: "مؤجل", disOpen: "ما زال مفتوحا",
      urgent: "عاجل", medium: "متوسط", later: "لاحقاً / للنقاش",
      filter: "تصفية حسب النوع", all: "الكل",
      byHalo: "بواسطة Halo", byYou: "بواسطتك", menuCat: "تغيير النوع", menuUrg: "تغيير الأولوية",
      tipCat: "صنّف Halo هذا النوع بنموذج منخفض التكلفة. اضغط لتغييره.",
      tipUrg: "حدّد Halo الأولوية بنموذج منخفض التكلفة. اضغط لتغييرها.",
      prov: "رتّبها مصنّف Halo الخفيف. التصنيف غير دقيق؟ اضغط \u00ABبواسطة Halo\u00BB على أي عنصر لتعديله.",
      retagged: "تم التغيير.",
      cMin: "{n} دقيقة", cDec: "قرارات: {n}", cDecs: "قرارات: {n}", cQ: "أسئلة مفتوحة: {n}",
      cQs: "أسئلة مفتوحة: {n}", cPush: "اعتراضات: {n}", cPushes: "اعتراضات: {n}",
      cUrg: "مهام عاجلة: {n}", cUrgs: "مهام عاجلة: {n}",
      spTitle: "طريقة حديثك", spPrivate: "يراها أنت فقط. حقائق من النص، وليست تقييماً.",
      spShare: "نصيبك من الحديث", spFair: "النصيب المتساوي {n}%", spLongest: "أطول مقطع متواصل", spAt: "عند {t}",
      spQs: "أسئلة طرحتها", spFollow: "متابعة: {n}", spCut: "مقاطعات", spCutWho: "الأولى: {name} عند {t}",
      spPace: "السرعة", spWpm: "كلمة في الدقيقة", spHedged: "التزامات مترددة", spTry: "في الاجتماع القادم:",
      spTry_cut_ins: "انتظر نهاية جملة المتحدث، ثم ادخل باسمه.",
      spTry_longest: "بعد فكرتك الرئيسية توقف واطرح سؤالاً واحداً.",
      spTry_share: "اطرح سؤالاً مفتوحاً لكل موضوع ودع الآخرين يجيبون أولاً.",
      spTry_hedged: "قل التزاماتك بوضوح: من، ماذا، ومتى، دون «أعتقد» أو «ربما».",
      spTry_questions: "اطرح سؤال متابعة على ما قاله أحدهم للتو.",
      spTry_keep: "حافظ على هذا التوازن؛ لقد نجح.",
      spTry_solo: "كانت هذه جلسة منفردة؛ تظهر حقائق نصيب الحديث عندما ينضم آخرون.",
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
      translated: "مترجم", video: "الفيديو",
      allMeetings: "كل الاجتماعات", preview: "مرّر على اجتماع لمعاينته",
      noSummary: "لا يوجد ملخص آلي بعد. يُكتب عند انتهاء الاجتماع.",
      newFolder: "اسم مجلد جديد", createFolder: "إنشاء مجلد", moveTo: "المجلد",
      noFolder: "بلا مجلد", email: "بريد", decsShort: "القرارات", openNotes: "افتح الملاحظات",
      mailSubject: "مهمة من \u00AB{m}\u00BB: {a}",
      mailBody: "مرحباً {o}،\n\nمن اجتماع \u00AB{m}\u00BB ({d}):\n\n{a}\nالأولوية: {u}\n\nأُرسلت من ملاحظات Halo"
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

  // Time into the meeting. ts_start_ms is the browser clock (epoch ms);
  // live 2026-11-01 the chips read "29892683:17" until this.
  function at(line) {
    return line.recording_offset_ms != null ? line.recording_offset_ms : line.ts_start_ms;
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

  // Karim 2026-11-02: neat punctuation. Model text comes with or without a
  // capital and an end mark; shown text gets both. Titles get no end mark.
  // Quotes stay verbatim (evidence); transcript lines only get the capital.
  function tidy(text, isTitle) {
    var s = String(text || "").replace(/\s+/g, " ").trim();
    if (!s) return s;
    s = s.charAt(0).toUpperCase() + s.slice(1);
    if (isTitle) return s.replace(/[.。]+$/, "");
    return /[\p{L}\p{N})"'”]$/u.test(s) ? s + "." : s;
  }

  function tidyPage(page) {
    var m = page.meeting || {};
    if (m.title) m.title = tidy(m.title, true);
    if (m.subject) m.subject = tidy(m.subject, true);
    if (m.summary) m.summary = tidy(m.summary);
    (m.disagreements || []).forEach(function (d) {
      d.topic = tidy(d.topic, true);
      if (d.resolution) d.resolution = tidy(d.resolution);
      d.sides.forEach(function (x) { x.view = tidy(x.view); });
    });
    (page.points || []).forEach(function (p) {
      p.text = tidy(p.text);
      // A question point the model ended with a period gets its question mark.
      if (p.kind === "question" && /^(what|who|when|where|why|how|which|is|are|can|could|do|does|did|should|will|would)\b/i.test(p.text)) {
        p.text = p.text.replace(/\.$/, "?");
      }
    });
    (page.actions || []).forEach(function (a) { a.text = tidy(a.text); });
    (page.people || []).forEach(function (p) { if (p.why) p.why = tidy(p.why); });
    (page.transcript_lines || []).forEach(function (l) {
      l.text = String(l.text || "").charAt(0).toUpperCase() + String(l.text || "").slice(1);
    });
    return page;
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

  function byUrg(actions) {
    return URG_ORDER.map(function (u) {
      return [u, actions.filter(function (a) { return urgOf(a) === u; })];
    });
  }

  function pointById(page, id) {
    for (var i = 0; i < page.points.length; i++) {
      if (page.points[i].point_id === id) return page.points[i];
    }
    return null;
  }

  // Per-person lists are id references into page.points (#14 shape).
  function pointsByIds(page, ids) {
    var out = [];
    (ids || []).forEach(function (id) {
      var p = pointById(page, id);
      if (p) out.push(p);
    });
    return out;
  }

  function actionById(page, id) {
    for (var i = 0; i < page.actions.length; i++) {
      if (page.actions[i].action_id === id) return page.actions[i];
    }
    return null;
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
  function retagControl(item, id, isAction, lang, userTags) {
    var cur = isAction ? urgOf(item) : kindKey(item.kind);
    var options = isAction ? URG_ORDER : KIND_KEYS;
    var mine = !!userTags[id];
    var details = el("details", "retag" + (mine ? " mine" : ""));
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
    var time = el("span", null, fmtMs(at(line)));
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
    meta.appendChild(retagControl(point, point.point_id, false, lang, app.userTags));
    li.appendChild(meta);
    if (app.openQuote[point.point_id]) {
      var quote = el("blockquote", null, "\u201C" + point.quote + "\u201D");
      li.appendChild(quote);
    }
    return li;
  }

  // Top-level actions[] carry owner/status/urgency plus the linked point_id.
  function actionItem(app, action, lang, showWho) {
    var linked = pointById(app.page, action.point_id);
    var line = linked ? lineByTurn(app.page, linked.turn_ids[0]) : null;
    var assigned = action.status === "assigned";
    var li = el("li", "act" + (assigned ? " asg" : " sug") + " u-" + urgOf(action));
    var badge = el("span", "badge " + (assigned ? "as" : "sg"),
      t(lang, assigned ? "assigned" : "suggested"));
    badge.title = t(lang, assigned ? "asNote" : "sgNote");
    var body = el("div", "body", action.text);
    // The Assigned pill already says it was said aloud; only a suggestion explains itself.
    if (!assigned) body.appendChild(el("small", null, t(lang, "sgNote")));
    var ameta = el("div", "ameta");
    ameta.appendChild(badge);  // a quiet label in the meta line, not a pill over the text
    if (showWho !== false) ameta.appendChild(personChip(action.owner, lang));
    if (line) ameta.appendChild(lineChip(app, line, lang));
    ameta.appendChild(retagControl(action, action.action_id, true, lang, app.userTags));
    if (assigned) {
      var mail = el("a", "mail chip", t(lang, "email"));
      mail.href = mailHref(app, action, lang);
      ameta.appendChild(mail);
    }
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

  function titleOf(meeting) {
    return meeting.title || meeting.subject;
  }

  function fmtDate(ms) {
    return ms ? new Date(ms).toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" }) : "";
  }

  function mailHref(app, action, lang) {
    var m = app.page.meeting;
    var vars = { m: titleOf(m), a: action.text, o: action.owner || "", d: fmtDate(m.t0_ms), u: t(lang, urgOf(action)) };
    // ponytail: no addresses are stored, so the To field is left for the user
    return "mailto:?subject=" + encodeURIComponent(t(lang, "mailSubject", vars)) +
      "&body=" + encodeURIComponent(t(lang, "mailBody", vars));
  }

  function meetingCard(app, meeting, lang) {
    var btn = el("button", "mtg-card glass");
    btn.dataset.open = meeting.meeting_id;
    var stack = el("span", "stack");
    var people = meeting.people || [];
    people.slice(0, 4).forEach(function (name) {
      stack.appendChild(avatar(name));
    });
    if (people.length > 4) stack.appendChild(el("span", "av more", "+" + (people.length - 4)));
    if (!people.length) stack.appendChild(el("span", "av none"));  // keeps titles on one edge
    btn.appendChild(stack);
    var info = el("span");
    info.style.flex = "1";
    var title = el("b", null, titleOf(meeting));
    info.appendChild(title);
    info.appendChild(el("br"));
    // Locked design: date · length · what came out of it (zero counts are left out)
    var bits = [fmtDate(meeting.t0_ms) || meeting.date || ""]; // local day, not the server's UTC one
    if (meeting.minutes) bits.push(t(lang, "cMin", { n: meeting.minutes }));
    var c = meeting.counts || {};
    [["decision", "cDec", "cDecs"], ["question", "cQ", "cQs"], ["pushback", "cPush", "cPushes"],
      ["urgent", "cUrg", "cUrgs"]].forEach(function (k) {
      if (c[k[0]]) bits.push(t(lang, c[k[0]] > 1 ? k[2] : k[1], { n: c[k[0]] }));
    });
    info.appendChild(el("span", "sub", bits.join(" · ")));
    if (meeting.title && meeting.title !== meeting.subject) info.appendChild(el("span", "sub2", meeting.subject));
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

  // Your speaking (Karim 2026-11-03): countable facts about the viewer only,
  // each with its moment, and one thing to try next call. No score, no mood.
  function speakingPanel(s, lang) {
    var section = el("section", "speaking glass");
    var head = el("div", "bhead");
    head.appendChild(el("h2", null, t(lang, "spTitle")));
    head.appendChild(el("p", "prov", t(lang, "spPrivate")));
    section.appendChild(head);
    var dl = el("dl", "spfacts");
    function fact(label, value, note) {
      var d = el("div");
      d.appendChild(el("dt", null, label));
      var dd = el("dd", null, value);
      if (note) dd.appendChild(el("small", null, note));
      d.appendChild(dd);
      dl.appendChild(d);
    }
    if (s.speakers > 1) fact(t(lang, "spShare"), s.talk_share + "%", t(lang, "spFair", { n: s.fair_share }));
    fact(t(lang, "spLongest"), fmtMs(s.longest_ms), t(lang, "spAt", { t: fmtMs(s.longest_at_ms) }));
    fact(t(lang, "spQs"), String(s.questions), s.follow_ups ? t(lang, "spFollow", { n: s.follow_ups }) : "");
    if (s.speakers > 1) {
      fact(t(lang, "spCut"), String(s.cut_ins.length), s.cut_ins.length
        ? t(lang, "spCutWho", { name: s.cut_ins[0].name, t: fmtMs(s.cut_ins[0].at_ms) }) : "");
    }
    if (s.pace_wpm) fact(t(lang, "spPace"), String(s.pace_wpm), t(lang, "spWpm"));
    section.appendChild(dl);
    if (s.hedged && s.hedged.length) {
      var hq = el("div", "sphedge");
      hq.appendChild(el("h3", null, t(lang, "spHedged")));
      s.hedged.forEach(function (h) {
        var q = el("blockquote", null, "“" + h.quote + "” ");
        q.appendChild(el("small", null, fmtMs(h.at_ms)));
        hq.appendChild(q);
      });
      section.appendChild(hq);
    }
    var tip = el("p", "sptry");
    tip.appendChild(el("b", null, t(lang, "spTry") + " "));
    tip.appendChild(document.createTextNode(t(lang, "spTry_" + s.try_next.key)));
    section.appendChild(tip);
    return section;
  }

  function summaryBoard(app, lang) {
    var actions = app.page.actions;
    var section = el("section", "board glass");
    var head = el("div", "bhead");
    head.appendChild(el("h2", null, t(lang, "actions")));
    head.appendChild(el("p", "prov", t(lang, "prov")));
    section.appendChild(head);
    var grid = el("div", "ugrid");
    byUrg(actions).forEach(function (pair) {
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

  /** Who disagreed on what, each side's view, and how it ended (AI, at meeting end). */
  function disagreementsBoard(app, lang) {
    var list = app.page.meeting.disagreements || [];
    if (!list.length || (app.cat !== "all" && app.cat !== "pushback")) return null;
    var section = el("section", "board glass dis");
    var h2 = el("h2");
    h2.appendChild(svgIcon("pushback"));
    h2.appendChild(document.createTextNode(t(lang, "dis")));
    section.appendChild(h2);
    var outcomes = { settled: "disSettled", parked: "disParked", open: "disOpen" };
    list.forEach(function (d) {
      var item = el("div", "dis-item o-" + d.outcome);
      var head = el("div", "dis-head");
      head.appendChild(el("h3", null, d.topic));
      head.appendChild(el("span", "chip dis-out", t(lang, outcomes[d.outcome])));
      item.appendChild(head);
      var ul = el("ul", "dis-sides");
      d.sides.forEach(function (x) {
        var li = el("li");
        li.appendChild(el("b", null, x.name));
        li.appendChild(document.createTextNode(" " + x.view));
        ul.appendChild(li);
      });
      item.appendChild(ul);
      if (d.resolution) item.appendChild(el("p", "dis-res", d.resolution));
      section.appendChild(item);
    });
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
    var own = pointsByIds(app.page, person.own_points);
    var rel = pointsByIds(app.page, person.relevant_points);
    var acts = byUrg(app.page.actions.filter(function (a) { return a.owner === person.name; }))
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
    var time = el("span", "time", cur ? fmtMs(at(cur)) : "--:--");
    time.setAttribute("dir", "ltr");
    row.appendChild(time);
    player.appendChild(row);
    // Recording file served by the Notes Service audio endpoint, using the
    // recorder's recordings/{meeting_id}.webm convention from the page JSON.
    var audio = app.doc.createElement("audio");
    audio.id = "rec";
    audio.className = "rec";
    audio.controls = true;
    audio.preload = "none";
    audio.src = "/api/audio?meeting_id=" + encodeURIComponent(page.meeting.meeting_id);
    player.appendChild(audio);
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
      // Chat-style: a run of lines by one speaker shows the name and face once.
      var cont = index > 0 && page.transcript_lines[index - 1].speaker_name === ln.speaker_name;
      if (cont) btn.classList.add("cont");
      btn.appendChild(avatar(ln.speaker_name));
      var body = el("span", "body");
      var who = el("span", "who");
      if (!cont) {
        who.appendChild(el("b", null, ln.speaker_name));
        who.appendChild(document.createTextNode(" \u00B7 "));
      }
      var when = el("span", null, fmtMs(at(ln)));
      when.setAttribute("dir", "ltr");
      who.appendChild(when);
      body.appendChild(who);
      body.appendChild(el("span", "o", ln.text));
      btn.appendChild(body);
      lines.appendChild(btn);
    });
    aside.appendChild(lines);
    var active = lines.querySelector(".ln.on");
    if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
  }

  function renderMeeting(app, view, lang) {
    var page = app.page;
    if (page.meeting.degraded) {
      view.appendChild(el("div", "degraded", t(lang, "degraded")));
    }
    var wrap = el("div", "mtg");
    var left = el("div");
    var head = el("section", "head glass");
    head.appendChild(el("h1", null, titleOf(page.meeting)));
    // Date · length · people, so the page says when and with whom.
    var lines = page.transcript_lines || [];
    var mins = lines.length ? Math.round((lines[lines.length - 1].ts_end_ms - page.meeting.t0_ms) / 60000) : 0;
    var facts = [fmtDate(page.meeting.t0_ms)];
    if (mins > 0) facts.push(t(lang, "cMin", { n: mins }));
    facts.push((page.people || []).map(function (p) { return p.name; }).join(", "));
    if (page.meeting.title && page.meeting.title !== page.meeting.subject) facts.push(page.meeting.subject);
    head.appendChild(el("p", "facts", facts.filter(Boolean).join(" · ")));
    if (page.meeting.summary) head.appendChild(el("p", "mtg-summary", page.meeting.summary));
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
      if (app.speaking) stage.appendChild(speakingPanel(app.speaking, lang));
      stage.appendChild(filtersBar(app, page.points, lang));
      var dis = disagreementsBoard(app, lang);
      if (dis) stage.appendChild(dis);
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
    view.appendChild(foldersBar(app, lang));
    var grid = el("div", "listgrid");
    var listSection = el("section");
    listSection.setAttribute("aria-label", t(lang, "meetings"));
    var shown = app.meetings.filter(function (m) { return !app.folder || m.folder_id === app.folder; });
    shown.forEach(function (m) { listSection.appendChild(meetingCard(app, m, lang)); });
    // The preview starts on the newest meeting instead of an empty "hover" panel.
    if (!app.previewId && shown.length && app.setPreview) {
      Promise.resolve().then(function () { app.setPreview(shown[0].meeting_id); });
    }
    grid.appendChild(listSection);
    if (app.q.trim()) {
      var hitsSection = el("section", "hits glass");
      hitsSection.setAttribute("aria-live", "polite");
      hitsSection.appendChild(el("h2", null, t(lang, "results")));
      var hits = el("div");
      hits.id = "hits";
      app.hits.forEach(function (h) { hits.appendChild(hitRow(app, h, lang)); });
      if (app.hits.length === 0) hits.appendChild(el("p", "empty", t(lang, "noHits")));
      hitsSection.appendChild(hits);
      grid.appendChild(hitsSection);
    } else {
      grid.appendChild(previewPanel(app, lang));
    }
    view.appendChild(grid);
  }

  function foldersBar(app, lang) {
    var bar = el("nav", "folders");
    bar.setAttribute("aria-label", t(lang, "moveTo"));
    var all = el("button", "fchip", t(lang, "allMeetings"));
    all.dataset.folder = "";
    all.setAttribute("aria-pressed", app.folder ? "false" : "true");
    bar.appendChild(all);
    app.folders.forEach(function (f) {
      var b = el("button", "fchip", f.name + " ");
      b.dataset.folder = f.folder_id;
      b.setAttribute("aria-pressed", app.folder === f.folder_id ? "true" : "false");
      b.appendChild(el("em", null, String(f.count || 0)));
      bar.appendChild(b);
    });
    return bar;
  }

  // Wispr-Flow-style preview of the hovered meeting (Karim 2026-11-02).
  function previewPanel(app, lang) {
    var panel = el("section", "preview glass");
    panel.id = "preview";
    panel.setAttribute("aria-live", "polite");
    var page = app.previewId ? app.previews[app.previewId] : null;
    if (!page) {
      panel.appendChild(el("p", "empty", t(lang, "preview")));
      return panel;
    }
    var m = page.meeting;
    panel.appendChild(el("h2", null, titleOf(m)));
    panel.appendChild(el("p", "sub", fmtDate(m.t0_ms) + (m.title && m.title !== m.subject ? " \u00B7 " + m.subject : "")));
    panel.appendChild(el("p", "pv-summary", m.summary || t(lang, "noSummary")));
    var counts = URG_ORDER.map(function (u) {
      var n = page.actions.filter(function (a) { return urgOf(a) === u; }).length;
      return t(lang, u).split(" /")[0] + " " + n;
    });
    panel.appendChild(el("p", "pv-counts", counts.join(" \u00B7 ")));
    var top = byUrg(page.actions).reduce(function (all, pair) { return all.concat(pair[1]); }, []).slice(0, 3);
    if (top.length) {
      panel.appendChild(el("h3", null, t(lang, "actions")));
      var ul = el("ul", "pv-list");
      top.forEach(function (a) {
        var li = el("li", "u-" + urgOf(a), a.text);
        if (a.owner) li.appendChild(el("small", null, " \u00B7 " + a.owner));
        ul.appendChild(li);
      });
      panel.appendChild(ul);
    }
    var decs = page.points.filter(function (p) { return p.kind === "decision"; }).slice(0, 3);
    if (decs.length) {
      panel.appendChild(el("h3", null, t(lang, "decsShort")));
      var dl = el("ul", "pv-list");
      decs.forEach(function (p) { dl.appendChild(el("li", null, p.text)); });
      panel.appendChild(dl);
    }
    var fold = el("div", "pv-folder");
    var sel = el("select", "move-folder");
    sel.setAttribute("aria-label", t(lang, "moveTo"));
    sel.dataset.meeting = m.meeting_id;
    var listed = app.meetings.filter(function (x) { return x.meeting_id === m.meeting_id; })[0];
    [{ folder_id: "", name: t(lang, "noFolder") }].concat(app.folders).forEach(function (f) {
      var o = el("option", null, f.name);
      o.value = f.folder_id;
      o.selected = ((listed && listed.folder_id) || "") === f.folder_id;
      sel.appendChild(o);
    });
    fold.appendChild(sel);
    var input = el("input", "new-folder in");
    input.placeholder = t(lang, "newFolder");
    input.setAttribute("aria-label", t(lang, "newFolder"));
    fold.appendChild(input);
    var create = el("button", "create-folder btn glass", t(lang, "createFolder"));
    create.dataset.meeting = m.meeting_id;
    fold.appendChild(create);
    panel.appendChild(fold);
    var open = el("button", "btn glass pv-open", t(lang, "openNotes"));
    open.dataset.open = m.meeting_id;
    panel.appendChild(open);
    return panel;
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
      crumb.appendChild(document.createTextNode(" / " + titleOf(app.page.meeting)));
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
      var acts = page.actions.filter(function (a) { return a.owner === person.name; });
      byUrg(acts).forEach(function (pair) {
        if (pair[1].length === 0) return;
        lines.push("### " + t(lang, pair[0]));
        pair[1].forEach(function (a) {
          var linked = pointById(page, a.point_id);
          var ln = linked ? lineByTurn(page, linked.turn_ids[0]) : null;
          lines.push("- [ ] **" + a.text + "** (" +
            t(lang, a.status === "assigned" ? "assigned" : "suggested") +
            (ln ? ", [" + fmtMs(at(ln)) + "](#t=" + Math.floor(at(ln) / 1000) + ")" : "") + ")");
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
          (ln ? ", [" + fmtMs(at(ln)) + "](#t=" + Math.floor(at(ln) / 1000) + ")" : "") + ")");
        lines.push("  > " + p.quote);
      });
      lines.push("");
    });
    return lines.join("\n");
  }

  function findPoint(app, id) {
    if (!app.page) return null;
    return pointById(app.page, id);
  }

  function findAction(app, id) {
    if (!app.page) return null;
    return actionById(app.page, id);
  }

  // Jump the service-served recording to a transcript line's recording moment
  // (offset = line ts minus the covering file's start ts, per the page JSON).
  function seekAudio(app, turnId) {
    var line = app.page ? lineByTurn(app.page, turnId) : null;
    if (!line) return;
    var node = app.doc.getElementById("rec");
    if (!node) return;
    try {
      node.currentTime = line.recording_offset_ms / 1000;
    } catch (e) { /* no media loaded yet */ }
    if (node.play) {
      try {
        var started = node.play();
        if (started && started.catch) started.catch(function () {});
      } catch (e2) { /* autoplay blocked: the moment is still cued */ }
    }
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
      toastTimer: null,
      folders: [],
      folder: "",
      previewId: null,
      previews: {}
    };
    var postJson = opts.postJson || function () { return Promise.reject(new Error("no postJson")); };
    var win = opts.win || { history: { pushState: function () {} } };

    app.showList = function (meetings) {
      app.view = "list";
      app.meetings = (meetings || []).map(function (m) { return tidyPage({ meeting: m }).meeting; });
      render(app);
    };

    app.showMeeting = function (page) {
      app.view = "meeting";
      app.page = tidyPage(page);
      app.person = null;
      app.lineIndex = 0;
      app.speaking = null;
      render(app);
      var id = page.meeting.meeting_id;
      app.fetchJson("/api/meetings/" + encodeURIComponent(id) + "/speaking").then(function (s) {
        if (s && app.page && app.page.meeting.meeting_id === id) { app.speaking = s; render(app); }
      }).catch(function () {});
    };

    app.setLang = function (lang) {
      app.lang = lang === "ar" ? "ar" : "en";
      render(app);
    };

    // Each view has its own address so browser Back/Forward work (#102).
    app.loadMeetings = function (push) {
      return Promise.all([
        app.fetchJson("/api/meetings"),
        app.fetchJson("/api/folders").catch(function () { return []; })
      ]).then(function (res) {
        app.folders = res[1] || [];
        if (push) win.history.pushState({ view: "list" }, "", "/notes/");
        app.showList(res[0]);
      });
    };

    app.openMeeting = function (id, push) {
      return app.fetchJson("/api/meetings/" + encodeURIComponent(id)).then(function (page) {
        if (push) win.history.pushState({ meeting: id }, "", "/notes/" + id);
        app.showMeeting(page);
      });
    };

    app.setPreview = function (id) {
      if (!id || id === app.previewId || app.view !== "list") return;
      app.previewId = id;
      if (app.previews[id]) { render(app); return; }
      app.fetchJson("/api/meetings/" + encodeURIComponent(id)).then(function (page) {
        app.previews[id] = tidyPage(page);
        if (app.previewId === id && app.view === "list") render(app);
      }).catch(function () {});
    };

    function saveFolder(url, body) {
      return postJson(url, body).then(function () { return app.loadMeetings(false); });
    }

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
      var target = isAction ? findAction(app, id) : findPoint(app, id);
      if (!target) return Promise.resolve();
      var body = isAction
        ? { target: "action", target_id: id, urgency: val }
        : { target: "point", target_id: id, kind: val };
      return app.postTag(body).then(function () {
        if (isAction) target.urgency = val;
        else target.kind = val;
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
      if ((b = g("[data-folder]"))) {
        app.folder = b.dataset.folder;
        render(app);
        return;
      }
      if ((b = g(".create-folder"))) {
        var name = (app.doc.querySelector("#preview .new-folder") || {}).value || "";
        if (name.trim()) saveFolder("/api/folders", { name: name.trim(), meeting_id: b.dataset.meeting });
        return;
      }
      if ((b = g("[data-cat]"))) {
        app.cat = b.dataset.cat;
        render(app);
        return;
      }
      if ((b = g("[data-nav]"))) {
        app.loadMeetings(true);
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
        app.openMeeting(b.dataset.open, true).then(function () {
          var turn = b.dataset.line;
          if (turn && app.page) {
            var others = app.page.transcript_lines;
            for (var i = 0; i < others.length; i++) {
              if (others[i].turn_id === turn) {
                app.lineIndex = i;
                break;
              }
            }
            render(app);
            if (turn) seekAudio(app, turn);
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
              break;
            }
          }
          render(app);
          seekAudio(app, turnId);
        }
        return;
      }
    }

    function onHover(event) {
      var card = closest(event.target, app.doc, ".mtg-card[data-open]");
      if (card) app.setPreview(card.dataset.open);
    }

    function onChange(event) {
      var sel = event.target;
      if (sel && sel.classList && sel.classList.contains("move-folder")) {
        saveFolder("/api/folders/move", { meeting_id: sel.dataset.meeting, folder_id: sel.value || null });
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
    app.doc.addEventListener("mouseover", onHover);
    app.doc.addEventListener("focusin", onHover);
    app.doc.addEventListener("change", onChange);
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
    var postJson = function (url, body) {
      return window.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body)
      }).then(function (res) {
        if (!res.ok) throw new Error("Halo notes request failed: " + url);
        return res.json().catch(function () { return {}; });
      });
    };
    var app = createApp({ doc: doc, fetchJson: fetchJson, postTag: postTag, postJson: postJson, win: window });
    var idFromPath = function () {
      var m = /^\/notes\/([0-9a-f-]{36})/i.exec(window.location.pathname);
      return m ? m[1] : null;
    };
    window.addEventListener("popstate", function () {
      var id = idFromPath();
      if (id) app.openMeeting(id, false);
      else app.loadMeetings(false);
    });
    var first = meetingId || idFromPath();
    if (first) app.openMeeting(first, false);
    else app.loadMeetings(false);
    return app;
  }

  window.HaloNotes = {
    createApp: createApp,
    boot: boot,
    exportMarkdown: exportMarkdown,
    tidy: tidy
  };
})();
