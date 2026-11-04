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
      ask: "Ask your meetings, e.g. what did we decide about the launch?", askBtn: "Ask",
      askBusy: "Reading your meetings…", askFail: "Halo could not answer. Try again.",
      answer: "Answer", sources: "From your meetings", summary: "AI summary",
      decision: "Decision", question: "Open question", pushback: "Pushback", point: "Point",
      decs: "Key decisions", qs: "Open questions", pushes: "Pushbacks", pts: "Points",
      dis: "Disagreements", kDis: "Disagreement", disSettled: "Settled", disParked: "Parked", disOpen: "Still open",
      urgent: "Urgent", medium: "Medium", later: "Later / to discuss",
      filter: "Filter by type", all: "All",
      byHalo: "by Halo", byYou: "by you", menuCat: "Change type", menuUrg: "Change urgency",
      tipCat: "Type picked by Halo's low-cost classifier. Click to change it.",
      tipUrg: "Urgency picked by Halo's low-cost classifier. Click to change it.",
      prov: "Sorted by Halo. Wrong call? Change the tag on any item.",
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
      keep: "Call audio and your mic, kept on this PC until you delete the data folder.",
      norec: "No recording for this meeting. The notes and transcript are complete.",
      reclive: "The recording is ready when the meeting ends.",
      nokey: "Meta Model API key missing: put it after META_API_KEY= in .env and restart uv run halo. Until then there are no live transcripts, points, notes or answers.",
      none: "Nothing here.", draftOnly: "Draft: only this meeting is filled in.",
      translated: "Translated",
      allMeetings: "All meetings", preview: "Click a meeting to preview it",
      noSummary: "No AI summary yet. Meetings get one when they end.",
      newFolder: "New folder name", createFolder: "Create folder", moveTo: "Folder",
      noFolder: "No folder", email: "Email", decsShort: "Decisions", openNotes: "Open notes",
      // Home (Karim 2026-11-04, AV)
      lenSec: "{n} s", today: "Today", tabAll: "All meetings", tabUrgent: "Urgent", tabAction: "Needs action",
      tabOthers: "With others", tabArchived: "Archived", noCapture: "Nothing captured", archivedTag: "Archived",
      sinceHead: "Since your last visit ({w}):", nothingNew: "Nothing new since your last visit ({w}).",
      nNew1: "1 new meeting", nNew: "{n} new meetings", nMine1: "1 action item for you", nMine: "{n} action items for you",
      nAct1: "1 action item", nAct: "{n} action items", nUrg: "{n} urgent", seen: "Mark as seen", unseen: "Show again",
      newTip: "New since your last visit", sortedBy: "Sorted by Halo", allClear: "All clear. Nothing needs you right now.",
      emptyTab: "No meetings here yet.", renameF: "Rename folder", deleteF: "Delete folder", save: "Save", cancel: "Cancel",
      deleteQ: "Delete “{n}”? Its meetings stay, just unfiled.", del: "Delete",
      folderDeleted: "Folder deleted. Its meetings are still here.", notSaved: "Not saved. Try again.",
      following: "Following {n}", followIn: "in {k} of {t} meetings", followStop: "Stop following",
      sumT: "Summary", noOwner: "No owner", nMore: "+ {n} more", nothing: "Nothing was captured in this meeting.",
      recView: "Recording view", simple: "Simple", detailed: "Detailed", replay: "Replay", stop: "Stop",
      kQ: "Question", kTall: "Tall mark: urgent", recording: "Recording", norecShort: "No recording",
      playRec: "Play recording", pauseRec: "Pause recording", archive: "Archive", unarchive: "Unarchive",
      archivedToast: "Archived. It left Needs action.", undo: "Undo",
      typeLabel: "Meeting type", typeByHalo: "sorted by Halo", typeByYou: "set by you",
      typeHalo: "Halo's pick", typePick: "Set a type",
      t_sprint: "Sprint", t_planning: "Planning", t_discovery: "Product discovery", t_sales: "Sales",
      t_induction: "Induction", t_one_on_one: "1:1", t_interview: "Interview", t_other: "Other",
      mailSubject: "Action item from \u201C{m}\u201D: {a}",
      mailBody: "Hi {o},\n\nFrom the meeting \u201C{m}\u201D ({d}):\n\n{a}\nUrgency: {u}\n\nSent from Halo notes",
      pointMailSubject: "From \u201C{m}\u201D: {p}",
      pointMailBody: "Hi,\n\nIn the meeting \u201C{m}\u201D ({d}), {s} said:\n\n{p}\n\nSent from Halo notes"
    },
    ar: {
      notes: "الملاحظات", meetings: "الاجتماعات", people: "الأشخاص", everyone: "الاجتماع كاملاً",
      search: "ابحث في كل الاجتماعات: النقاط والمهام والنصوص",
      results: "نتائج البحث", noHits: "لا توجد نتائج.", inPoints: "نقطة", inTx: "النص",
      ask: "اسأل اجتماعاتك، مثلاً: ماذا قررنا بشأن الإطلاق؟", askBtn: "اسأل",
      askBusy: "أقرأ اجتماعاتك…", askFail: "لم يتمكن Halo من الإجابة. حاول مرة أخرى.",
      answer: "الإجابة", sources: "من اجتماعاتك", summary: "ملخص",
      decision: "قرار", question: "سؤال مفتوح", pushback: "اعتراض", point: "نقطة",
      decs: "القرارات الرئيسية", qs: "أسئلة مفتوحة", pushes: "اعتراضات", pts: "نقاط",
      dis: "الخلافات", kDis: "خلاف", disSettled: "تم الحسم", disParked: "مؤجل", disOpen: "ما زال مفتوحا",
      urgent: "عاجل", medium: "متوسط", later: "لاحقاً / للنقاش",
      filter: "تصفية حسب النوع", all: "الكل",
      byHalo: "بواسطة Halo", byYou: "بواسطتك", menuCat: "تغيير النوع", menuUrg: "تغيير الأولوية",
      tipCat: "صنّف Halo هذا النوع بنموذج منخفض التكلفة. اضغط لتغييره.",
      tipUrg: "حدّد Halo الأولوية بنموذج منخفض التكلفة. اضغط لتغييرها.",
      prov: "رتّبها Halo. التصنيف غير دقيق؟ غيّره من أي عنصر.",
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
      keep: "تسجيل صوت المكالمة وميكروفونك محفوظ على هذا الجهاز حتى تحذف مجلد البيانات.",
      norec: "لا يوجد تسجيل لهذا الاجتماع، لكن الملاحظات والنص الكامل متاحة.",
      reclive: "يصبح التسجيل جاهزاً عند انتهاء الاجتماع.",
      nokey: "مفتاح Meta Model API غير موجود: ضعه بعد META_API_KEY= في ملف .env وأعد تشغيل uv run halo. حتى ذلك الحين لا يوجد نص مباشر ولا نقاط ولا ملاحظات ولا إجابات.",
      none: "لا شيء هنا.", draftOnly: "مسودة: هذا الاجتماع فقط مكتمل.",
      translated: "مترجم",
      allMeetings: "كل الاجتماعات", preview: "اضغط على اجتماع لمعاينته",
      noSummary: "لا يوجد ملخص آلي بعد. يُكتب عند انتهاء الاجتماع.",
      newFolder: "اسم مجلد جديد", createFolder: "إنشاء مجلد", moveTo: "المجلد",
      noFolder: "بلا مجلد", email: "بريد", decsShort: "القرارات", openNotes: "افتح الملاحظات",
      lenSec: "{n} ث", today: "اليوم", tabAll: "كل الاجتماعات", tabUrgent: "عاجل", tabAction: "يحتاج إجراء",
      tabOthers: "مع آخرين", tabArchived: "مؤرشف", noCapture: "لم يُلتقط شيء", archivedTag: "مؤرشف",
      sinceHead: "منذ زيارتك الأخيرة ({w}):", nothingNew: "لا جديد منذ زيارتك الأخيرة ({w}).",
      nNew1: "اجتماع جديد واحد", nNew: "اجتماعات جديدة: {n}", nMine1: "مهمة واحدة لك", nMine: "مهام لك: {n}",
      nAct1: "مهمة واحدة", nAct: "مهام: {n}", nUrg: "عاجل: {n}", seen: "تمت المشاهدة", unseen: "أظهرها مجدداً",
      newTip: "جديد منذ زيارتك الأخيرة", sortedBy: "رتّبها Halo", allClear: "لا شيء يحتاجك الآن.",
      emptyTab: "لا اجتماعات هنا بعد.", renameF: "إعادة تسمية المجلد", deleteF: "حذف المجلد", save: "حفظ", cancel: "إلغاء",
      deleteQ: "حذف «{n}»؟ تبقى اجتماعاته، بلا مجلد.", del: "حذف",
      folderDeleted: "حُذف المجلد. اجتماعاته ما زالت هنا.", notSaved: "لم يُحفظ. حاول مرة أخرى.",
      following: "تتابع {n}", followIn: "في {k} من {t} اجتماعات", followStop: "إيقاف المتابعة",
      sumT: "الملخص", noOwner: "بلا مسؤول", nMore: "+ {n} أخرى", nothing: "لم يُلتقط شيء في هذا الاجتماع.",
      recView: "عرض التسجيل", simple: "مبسّط", detailed: "مفصّل", replay: "إعادة", stop: "إيقاف",
      kQ: "سؤال", kTall: "العلامة الطويلة: عاجل", recording: "التسجيل", norecShort: "لا تسجيل",
      playRec: "شغّل التسجيل", pauseRec: "أوقف التسجيل مؤقتاً", archive: "أرشفة", unarchive: "إلغاء الأرشفة",
      archivedToast: "تمت الأرشفة. خرج من «يحتاج إجراء».", undo: "تراجع",
      typeLabel: "نوع الاجتماع", typeByHalo: "رتّبه Halo", typeByYou: "حدّدته أنت",
      typeHalo: "اختيار Halo", typePick: "حدّد النوع",
      t_sprint: "سبرنت", t_planning: "تخطيط", t_discovery: "استكشاف المنتج", t_sales: "مبيعات",
      t_induction: "تهيئة موظف", t_one_on_one: "فردي", t_interview: "مقابلة", t_other: "أخرى",
      mailSubject: "مهمة من \u00AB{m}\u00BB: {a}",
      mailBody: "مرحباً {o}،\n\nمن اجتماع \u00AB{m}\u00BB ({d}):\n\n{a}\nالأولوية: {u}\n\nأُرسلت من ملاحظات Halo",
      pointMailSubject: "من \u00AB{m}\u00BB: {p}",
      pointMailBody: "مرحباً،\n\nفي اجتماع \u00AB{m}\u00BB ({d})، قال {s}:\n\n{p}\n\nأُرسلت من ملاحظات Halo"
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
    var mail = el("a", "mail chip", t(lang, "email"));
    mail.href = pointMailHref(app, point, lang);
    meta.appendChild(mail);
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

  // Karim 2026-11-04: send any statement to the person it concerns.
  function pointMailHref(app, point, lang) {
    var m = app.page.meeting;
    var vars = { m: titleOf(m), p: point.text, s: point.speaker_name || "", d: fmtDate(m.t0_ms) };
    return "mailto:?subject=" + encodeURIComponent(t(lang, "pointMailSubject", vars)) +
      "&body=" + encodeURIComponent(t(lang, "pointMailBody", vars));
  }

  function hitRow(app, hit, lang) {
    var btn = el("button", "hit");
    btn.dataset.open = hit.meeting_id;
    if (hit.line) btn.dataset.line = hit.line;
    var kind = el("span", "kind", hit.kindLabel ? t(lang, hit.kindLabel) : "");
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

  // Say each fact once: a plain point that is already an action item lives
  // in Action items only (blind juror round 2).
  function boardPoints(page) {
    var acted = {};
    (page.actions || []).forEach(function (a) { if (a.point_id) acted[a.point_id] = true; });
    return page.points.filter(function (p) { return !(kindKey(p.kind) === "point" && acted[p.point_id]); });
  }

  function kindColumn(app, kind, lang) {
    var names = { decision: "decs", question: "qs", pushback: "pushes", point: "pts" };
    var list = boardPoints(app.page).filter(function (p) {
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
    var id = page.meeting.meeting_id;
    var src = "/api/audio?meeting_id=" + encodeURIComponent(id);
    var note = el("div", "norec");
    var showNote = function (state) {
      row.hidden = true;
      note.textContent = t(lang, state === "live" ? "reclive" : "norec");
      player.appendChild(note);
    };
    app.recState = app.recState || {};
    var state = app.recState[id];
    if (state === "none" || state === "live") {
      showNote(state);
    } else {
      var audio = app.doc.createElement("audio");
      audio.id = "rec";
      audio.className = "rec";
      audio.controls = true;
      audio.preload = "none";
      audio.src = src;
      player.appendChild(audio);
      var keep = el("div", "keep", t(lang, "keep"));
      player.appendChild(keep);
      // One 1-byte probe per meeting (the panel re-renders on every click):
      // 404 = no file, 429 = the meeting is still open.
      var win = app.doc.defaultView;
      if (state === undefined && win && win.fetch) {
        app.recState[id] = "probing";
        win.fetch(src, { headers: { Range: "bytes=0-0" } }).then(function (res) {
          app.recState[id] = res.ok ? "ok" : res.status === 429 ? "live" : "none";
          // Redraw whichever panel is showing now (it may be newer than this one).
          var shown = app.doc.getElementById("rec");
          var host = shown && shown.parentNode && shown.parentNode.parentNode;
          if (!res.ok && host && app.page && app.page.meeting.meeting_id === id) {
            renderTranscript(app, host, app.lang);
          }
        }).catch(function () { delete app.recState[id]; });
      }
    }
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
      stage.appendChild(filtersBar(app, boardPoints(page), lang));
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

  // Ask across meetings (POST /api/ask): Spark answers from stored passages;
  // the cited rows are store text and open the meeting at that line.
  function askForm(app, lang) {
    var form = el("form", "search ask glass");
    form.id = "askform";
    var input = document.createElement("input");
    input.id = "askq";
    input.type = "text";
    input.maxLength = 300;
    input.dir = "auto";
    input.placeholder = t(lang, "ask");
    input.setAttribute("aria-label", t(lang, "ask"));
    input.value = app.askDraft != null ? app.askDraft : (app.ask ? app.ask.q : "");
    form.appendChild(input);
    var btn = el("button", "askbtn", t(lang, "askBtn"));
    btn.type = "submit";
    if (app.ask && app.ask.busy) btn.disabled = true;
    form.appendChild(btn);
    return form;
  }

  function askPanel(app, ask, lang) {
    var section = el("section", "hits answer glass");
    section.setAttribute("aria-live", "polite");
    section.appendChild(el("h2", null, t(lang, "answer")));
    if (ask.busy) {
      section.appendChild(el("p", "empty", t(lang, "askBusy")));
      return section;
    }
    if (ask.fresh) { section.classList.add("arrive"); ask.fresh = false; }
    var text = el("p", "atext", ask.failed ? t(lang, "askFail") : ask.answer);
    text.dir = "auto";
    section.appendChild(text);
    if (ask.citations && ask.citations.length) {
      section.appendChild(el("h3", null, t(lang, "sources")));
      var rows = el("div");
      ask.citations.forEach(function (c) { rows.appendChild(hitRow(app, c, lang)); });
      section.appendChild(rows);
    }
    return section;
  }

  // ---- Home (Karim 2026-11-04, "AV" from docs/ui/drafts/landing/av-home.html) ----
  // Each meeting is a call strip: every point at the second it was said. The
  // preview has a living recording line, Simple and Detailed views, Replay,
  // and coloured plates whose items jump to their mark. Tabs: All, Urgent,
  // Needs action, With others, folders, Archived; Halo's meeting types sort
  // underneath. "Since your last visit" counts what is new until Mark as seen.
  var MTYPES = ["sprint", "planning", "discovery", "sales", "induction", "one_on_one", "interview", "other"];
  var LAST_KEY = "halo-notes-lastvisit";
  var MODE_KEY = "halo-notes-view";

  function stored(key, value) {
    try {
      if (arguments.length === 1) return window.localStorage.getItem(key);
      if (value == null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch (e) { /* private window: this visit only */ }
    return null;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function stillMotion() {
    return !window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function clock(ms) {
    var s = Math.max(0, Math.round((ms || 0) / 1000));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  function lenText(ms, lang) {
    var s = Math.round((ms || 0) / 1000);
    return s < 60 ? t(lang, "lenSec", { n: s }) : t(lang, "cMin", { n: Math.round(s / 60) });
  }

  function avHTML(name, focusable) {
    return '<span class="av" style="--h:' + hueOf(name) + '" title="' + esc(name) + '" data-follow="' + esc(name) + '"' +
      (focusable ? ' role="button" tabindex="0"' : "") + ">" + esc(initials(name)) + "</span>";
  }

  function stackHTML(people, max, focusable) {
    var h = people.slice(0, max).map(function (n) { return avHTML(n, focusable); }).join("");
    if (people.length > max) h += '<span class="av more">+' + (people.length - max) + "</span>";
    return '<span class="stack">' + h + "</span>";
  }

  // The page JSON as the home needs it: times are recording offsets, so a mark,
  // the audio and the transcript agree on the same second.
  function homeModel(page) {
    var lines = page.transcript_lines || [];
    var byTurn = {};
    lines.forEach(function (l) { byTurn[l.turn_id] = l; });
    var base = lines.length ? lines[0].ts_start_ms : (page.meeting.t0_ms || 0);
    var off = function (l) {
      return typeof l.recording_offset_ms === "number" ? l.recording_offset_ms : Math.max(0, l.ts_start_ms - base);
    };
    var dur = 0;
    lines.forEach(function (l) { dur = Math.max(dur, off(l) + Math.max(0, (l.ts_end_ms || 0) - (l.ts_start_ms || 0))); });
    var points = (page.points || []).map(function (p) {
      var l = byTurn[(p.turn_ids || [])[0]];
      return {
        id: p.point_id, kind: KIND_KEYS.indexOf(p.kind) >= 0 ? p.kind : "point", text: p.text,
        who: p.speaker_name || "", urgency: urgOf(p), at: l ? Math.min(off(l), dur) : null
      };
    });
    var atOf = {};
    points.forEach(function (p) { atOf[p.id] = p.at; });
    var actions = (page.actions || []).map(function (a) {
      return {
        id: a.action_id, text: a.text, owner: a.owner || "", status: a.status, urgency: urgOf(a),
        at: atOf[a.point_id] != null ? atOf[a.point_id] : null
      };
    });
    var people = [];
    var add = function (n) { if (n && people.indexOf(n) < 0) people.push(n); };
    (page.people || []).forEach(function (p) { add(p.name); });
    lines.forEach(function (l) { add(l.speaker_name); });
    return {
      id: page.meeting.meeting_id, title: titleOf(page.meeting), summary: page.meeting.summary || "",
      t0: page.meeting.t0_ms, duration: dur, points: points, actions: actions, people: people,
      disagreements: page.meeting.disagreements || []
    };
  }

  function modelOf(app, id) {
    if (!app.previews[id]) return null;
    if (!app.models[id]) app.models[id] = homeModel(app.previews[id]);
    return app.models[id];
  }

  function listed(app, id) {
    return app.meetings.filter(function (x) { return x.meeting_id === id; })[0] || null;
  }

  function hasActions(app, it) {
    var m = modelOf(app, it.meeting_id);
    return m ? m.actions.length > 0 : ((it.counts || {}).urgent || 0) > 0;
  }

  function tabsOf(app, lang) {
    var tabs = [
      { id: "all", label: t(lang, "tabAll"), f: function () { return true; } },
      { id: "urgent", cls: "t-urg", label: t(lang, "tabUrgent"), f: function (m) { return !m.archived && ((m.counts || {}).urgent || 0) > 0; } },
      { id: "action", label: t(lang, "tabAction"), f: function (m) { return !m.archived && hasActions(app, m); } },
      { id: "others", label: t(lang, "tabOthers"), f: function (m) { return (m.people || []).length > 1; } }
    ];
    app.folders.forEach(function (f) {
      tabs.push({ id: "f:" + f.folder_id, folder: f, label: f.name, f: function (m) { return m.folder_id === f.folder_id; } });
    });
    if (app.meetings.some(function (m) { return m.archived; }) || app.tab === "archived") {
      tabs.push({ id: "archived", label: t(lang, "tabArchived"), f: function (m) { return m.archived; } });
    }
    return tabs;
  }

  function currentTab(app, lang) {
    var tabs = tabsOf(app, lang);
    return tabs.filter(function (x) { return x.id === app.tab; })[0] || tabs[0];
  }

  function followed(app, list) {
    return app.follow ? list.filter(function (m) { return (m.people || []).indexOf(app.follow) >= 0; }) : list;
  }

  function visibleMeetings(app, lang) {
    var tab = currentTab(app, lang);
    return followed(app, app.meetings.filter(tab.f)).filter(function (m) { return !app.mtype || m.meeting_type === app.mtype; });
  }

  function sinceStart(app) {
    var last = +stored(LAST_KEY) || 0;
    if (last) return last;
    // First visit: count from the start of the day before the newest meeting.
    var d = new Date((app.meetings[0] || {}).t0_ms || Date.now());
    d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function sinceHTML(app, lang) {
    if (!app.meetings.length) return "";
    var w = new Date(app.since).toLocaleString(lang === "ar" ? "ar" : "en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
    var fresh = app.meetings.filter(function (m) { return (m.t0_ms || 0) > app.since; });
    if (!fresh.length) {
      return esc(t(lang, "nothingNew", { w: w })) + ' <button class="seen" id="unseen" type="button">' + esc(t(lang, "unseen")) + "</button>";
    }
    var me = app.meetings[0].self_name || "";
    var mine = 0;
    var urgent = 0;
    fresh.forEach(function (it) {
      urgent += (it.counts || {}).urgent || 0;
      var m = modelOf(app, it.meeting_id);
      if (m) mine += m.actions.filter(function (a) { return me ? a.owner === me : true; }).length;
    });
    var parts = ["<b>" + esc(t(lang, fresh.length === 1 ? "nNew1" : "nNew", { n: fresh.length })) + "</b>"];
    parts.push(esc(t(lang, me ? (mine === 1 ? "nMine1" : "nMine") : (mine === 1 ? "nAct1" : "nAct"), { n: mine })));
    if (urgent) parts.push('<button class="urg-link" type="button" data-tab="urgent">' + esc(t(lang, "nUrg", { n: urgent })) + "</button>");
    return esc(t(lang, "sinceHead", { w: w })) + " " + parts.join(", ") + '. <button class="seen" id="seen" type="button">' + esc(t(lang, "seen")) + "</button>";
  }

  function stripHTML(m, follow) {
    if (!m) return '<div class="strip wait"></div>';
    if (!m.duration) return '<div class="strip empty"></div>';
    var n = 0;
    return '<div class="strip">' + m.points.map(function (p, i) {
      if (p.at == null) return "";
      var dim = follow && p.who !== follow ? " dim" : "";
      return '<i class="' + p.kind + (p.urgency === "urgent" ? " urgent" : "") + dim + '" style="left:' +
        Math.min(100, (p.at / m.duration) * 100).toFixed(2) + "%;--n:" + (n++) + '" data-i="' + i + '"></i>';
    }).join("") + "</div>";
  }

  function factsHTML(it, lang) {
    var c = it.counts || {};
    var out = [];
    if (c.decision) out.push(esc(t(lang, c.decision > 1 ? "cDecs" : "cDec", { n: c.decision })));
    if (c.question) out.push(esc(t(lang, c.question > 1 ? "cQs" : "cQ", { n: c.question })));
    if (c.pushback) out.push(esc(t(lang, c.pushback > 1 ? "cPushes" : "cPush", { n: c.pushback })));
    if (c.urgent) out.push('<span class="urg-link" data-tab="urgent">' + esc(t(lang, c.urgent > 1 ? "cUrgs" : "cUrg", { n: c.urgent })) + "</span>");
    var h = out.join(" · ") || esc(t(lang, "noCapture"));
    if (it.meeting_type) h += '<span class="tchip" data-mt="' + esc(it.meeting_type) + '">' + esc(t(lang, "t_" + it.meeting_type)) + "</span>";
    if (it.archived) h += '<span class="arch-tag">' + esc(t(lang, "archivedTag")) + "</span>";
    return h;
  }

  function sameDay(a, b) {
    var x = new Date(a);
    var y = new Date(b);
    return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
  }

  function rowsHTML(app, list, lang) {
    var i = 0;
    var last = null;
    var h = "";
    list.forEach(function (it) {
      var day = fmtDate(it.t0_ms) || it.date || "";
      if (day !== last) {
        h += '<h2 class="day" style="--i:' + (i++) + '">' + esc(it.t0_ms && sameDay(it.t0_ms, Date.now()) ? t(lang, "today") : day) + "</h2>";
        last = day;
      }
      var m = modelOf(app, it.meeting_id);
      var len = m && m.duration ? lenText(m.duration, lang) : (it.minutes ? t(lang, "cMin", { n: it.minutes }) : "");
      var isNew = (it.t0_ms || 0) > app.since;
      h += '<button class="row mtg-card" type="button" data-sel="' + esc(it.meeting_id) + '" style="--d:' + (i + 4) + ";--i:" + (i++) +
        '" aria-current="' + (it.meeting_id === app.previewId) + '"><span class="rtop">' + stackHTML(it.people || [], 4, false) +
        '<b dir="auto">' + esc(titleOf(it)) + "</b>" + (isNew ? '<i class="newdot" title="' + esc(t(lang, "newTip")) + '"></i>' : "") +
        "<time>" + esc(len) + '</time></span><span class="rfacts">' + factsHTML(it, lang) + "</span>" + stripHTML(m, app.follow) + "</button>";
    });
    return h;
  }

  function tabsBar(app, lang) {
    var bar = el("div", "tabs");
    bar.setAttribute("role", "tablist");
    var cur = currentTab(app, lang);
    var base = followed(app, app.meetings);
    bar.innerHTML = '<span class="ind" id="ind"></span>' + tabsOf(app, lang).map(function (tb) {
      var n = base.filter(tb.f).length;
      return '<button role="tab" type="button" data-tab="' + esc(tb.id) + '" aria-selected="' + (tb.id === cur.id) + '" class="' +
        (tb.cls || "") + (tb.cls && n ? " has" : "") + '">' + esc(tb.label) + "<em>" + n + "</em></button>";
    }).join("");
    return bar;
  }

  function typesBar(app, lang) {
    var tab = currentTab(app, lang);
    var list = followed(app, app.meetings.filter(tab.f));
    var counts = {};
    list.forEach(function (m) { if (m.meeting_type) counts[m.meeting_type] = (counts[m.meeting_type] || 0) + 1; });
    var present = MTYPES.filter(function (k) { return counts[k]; });
    if (!present.length && !app.mtype) return null;
    var bar = el("div", "types");
    bar.setAttribute("aria-label", t(lang, "sortedBy"));
    bar.innerHTML = "<span>" + esc(t(lang, "sortedBy")) + "</span>" + present.map(function (k) {
      return '<button type="button" class="tchip-f" data-mtype="' + k + '" aria-pressed="' + (app.mtype === k) + '">' +
        esc(t(lang, "t_" + k)) + "<em>" + counts[k] + "</em></button>";
    }).join("");
    return bar;
  }

  function folderTools(app, lang) {
    var tab = currentTab(app, lang);
    if (!tab.folder) return null;
    var box = el("div", "ftools");
    box.dataset.folderId = tab.folder.folder_id;
    if (app.folderEdit === "rename") {
      box.innerHTML = '<input class="in" id="frename" aria-label="' + esc(t(lang, "renameF")) + '" value="' + esc(tab.folder.name) + '">' +
        '<button type="button" class="btn-2" data-fdo="rename-save">' + esc(t(lang, "save")) + '</button><button type="button" class="link" data-fdo="cancel">' + esc(t(lang, "cancel")) + "</button>";
    } else if (app.folderEdit === "delete") {
      box.innerHTML = "<span>" + esc(t(lang, "deleteQ", { n: tab.folder.name })) + '</span><button type="button" class="btn-2 danger" data-fdo="delete-yes">' +
        esc(t(lang, "del")) + '</button><button type="button" class="link" data-fdo="cancel">' + esc(t(lang, "cancel")) + "</button>";
    } else {
      box.innerHTML = '<button type="button" class="link" data-fdo="rename">' + esc(t(lang, "renameF")) + '</button><button type="button" class="link" data-fdo="delete">' + esc(t(lang, "deleteF")) + "</button>";
    }
    return box;
  }

  function followBar(app, lang) {
    var bar = el("div", "follow");
    var n = followed(app, app.meetings).length;
    bar.innerHTML = avHTML(app.follow, false) + "<span>" + esc(t(lang, "following", { n: app.follow })) + " · " +
      esc(t(lang, "followIn", { k: n, t: app.meetings.length })) + '</span><button type="button" class="link" data-follow="">' + esc(t(lang, "followStop")) + "</button>";
    return bar;
  }

  function platesHTML(m, lang) {
    var h = "";
    if (m.summary) h += '<section class="plate p-sum"><h3>' + esc(t(lang, "sumT")) + '</h3><p dir="auto">' + esc(m.summary) + "</p></section>";
    if (m.actions.length) {
      h += '<section class="plate p-act"><h3>' + esc(t(lang, "actions")) + " <em>" + m.actions.length + "</em></h3><ul>";
      m.actions.slice().sort(function (a, b) { return URG_ORDER.indexOf(a.urgency) - URG_ORDER.indexOf(b.urgency); }).forEach(function (a) {
        h += '<li data-act="' + m.actions.indexOf(a) + '" class="u-' + esc(a.urgency) + '"><i class="udot"></i><span dir="auto">' + esc(a.text) +
          "</span><small>" + esc(a.owner || t(lang, "noOwner")) + (a.status === "suggested" ? " · " + esc(t(lang, "suggested")) : "") +
          " · " + esc(t(lang, a.urgency).split(" /")[0]) + (a.at != null ? " · " + clock(a.at) : "") + "</small></li>";
      });
      h += "</ul></section>";
    }
    [["decision", "decsShort"], ["question", "qs"], ["pushback", "pushes"]].forEach(function (k) {
      var ps = m.points.filter(function (p) { return p.kind === k[0]; });
      if (!ps.length) return;
      h += '<section class="plate p-' + k[0] + '"><h3>' + esc(t(lang, k[1])) + " <em>" + ps.length + "</em></h3><ul>";
      ps.slice(0, 3).forEach(function (p) {
        h += '<li data-pt="' + m.points.indexOf(p) + '"><span dir="auto">' + esc(p.text) + "</span><small>" + esc(p.who) +
          (p.at != null ? " · " + clock(p.at) : "") + "</small></li>";
      });
      if (ps.length > 3) h += '<li class="more">' + esc(t(lang, "nMore", { n: ps.length - 3 })) + "</li>";
      h += "</ul></section>";
    });
    return h || '<section class="plate p-sum"><h3>' + esc(t(lang, "sumT")) + "</h3><p>" + esc(t(lang, "nothing")) + "</p></section>";
  }

  function viewSegHTML(mode, lang) {
    return '<div class="vseg" role="group" aria-label="' + esc(t(lang, "recView")) + '"><span class="vknob"></span>' +
      '<button type="button" data-view="simple" aria-pressed="' + (mode === "simple") + '">' + esc(t(lang, "simple")) + "</button>" +
      '<button type="button" data-view="detailed" aria-pressed="' + (mode === "detailed") + '">' + esc(t(lang, "detailed")) + "</button></div>";
  }

  function keyHTML(lang) {
    return '<div class="key"><span style="--c:var(--dec)">' + esc(t(lang, "decision")) + '</span><span style="--c:var(--q)">' + esc(t(lang, "kQ")) +
      '</span><span style="--c:var(--push)">' + esc(t(lang, "pushback")) + '</span><span style="--c:var(--pt)">' + esc(t(lang, "point")) +
      '</span><span class="k-act" style="--c:var(--med)">' + esc(t(lang, "action")) + '</span><span class="k-dis" style="--c:var(--push)">' + esc(t(lang, "kDis")) +
      "</span><span>" + esc(t(lang, "kTall")) + "</span></div>";
  }

  function previewPanel(app, lang) {
    var panel = el("section", "preview pv");
    panel.id = "preview";
    panel.setAttribute("aria-live", "polite");
    var page = app.previewId ? app.previews[app.previewId] : null;
    if (!page) {
      panel.appendChild(el("p", "empty", t(lang, "preview")));
      return panel;
    }
    var m = modelOf(app, app.previewId);
    var it = listed(app, m.id) || {};
    panel.dataset.id = m.id;
    var h = '<div class="phead"><h2 dir="auto">' + esc(m.title) + "</h2>" +
      (m.duration ? '<button class="rp-btn" id="replay" type="button">' + esc(t(lang, "replay")) + "</button>" + viewSegHTML(app.homeMode, lang) : "") + "</div>";
    h += '<div class="pmeta">' + stackHTML(m.people, 5, true) + "<span>" + esc(fmtDate(m.t0)) + (m.duration ? " · " + esc(lenText(m.duration, lang)) : "") +
      " · " + m.people.map(esc).join(", ") + "</span></div>";
    h += '<div class="ptype">' + (it.meeting_type ? '<span class="tchip">' + esc(t(lang, "t_" + it.meeting_type)) + "</span><small>" +
      esc(t(lang, it.type_by === "you" ? "typeByYou" : "typeByHalo")) + "</small>" : "") +
      '<label><span class="sr">' + esc(t(lang, "typeLabel")) + '</span><select class="mtype-set" data-meeting="' + esc(m.id) + '">' +
      '<option value="">' + esc(t(lang, it.meeting_type && it.type_by !== "you" ? "typeHalo" : "typePick")) + "</option>" +
      MTYPES.map(function (k) {
        return '<option value="' + k + '"' + (it.type_by === "you" && it.meeting_type === k ? " selected" : "") + ">" + esc(t(lang, "t_" + k)) + "</option>";
      }).join("") + "</select></label></div>";
    if (m.duration) h += '<div class="timeline ' + app.homeMode + '"></div>' + keyHTML(lang) + '<div class="tip"></div>';
    h += '<div class="plates">' + platesHTML(m, lang) + "</div>";
    panel.innerHTML = h;
    var foot = el("div", "pfoot");
    var sel = el("select", "move-folder");
    sel.setAttribute("aria-label", t(lang, "moveTo"));
    sel.dataset.meeting = m.id;
    [{ folder_id: "", name: t(lang, "noFolder") }].concat(app.folders).forEach(function (f) {
      var o = el("option", null, f.name);
      o.value = f.folder_id;
      o.selected = (it.folder_id || "") === f.folder_id;
      sel.appendChild(o);
    });
    foot.appendChild(sel);
    var input = el("input", "new-folder in");
    input.placeholder = t(lang, "newFolder");
    input.setAttribute("aria-label", t(lang, "newFolder"));
    foot.appendChild(input);
    var create = el("button", "create-folder btn-2", t(lang, "createFolder"));
    create.type = "button";
    create.dataset.meeting = m.id;
    foot.appendChild(create);
    foot.appendChild(el("span", "sp"));
    var arch = el("button", "btn-2", t(lang, it.archived ? "unarchive" : "archive"));
    arch.type = "button";
    arch.dataset.archive = m.id;
    arch.dataset.on = it.archived ? "0" : "1";
    foot.appendChild(arch);
    var open = el("button", "btn pv-open", t(lang, "openNotes"));
    open.type = "button";
    open.dataset.open = m.id;
    foot.appendChild(open);
    panel.appendChild(foot);
    return panel;
  }

  // ---- The preview's recording line: audio, marks, tip, flag, Replay, the living line ----
  var LIVING = { sg: 60, follow: 0.12, k: 0.08, damp: 0.78, phs: 0.045 };
  var lineSeq = 0;

  function stopHome(H) {
    if (H.audio) { try { H.audio.pause(); } catch (e) { /* gone */ } }
    H.audio = null;
    cancelAnimationFrame(H.raf || 0);
    cancelAnimationFrame(H.rpRaf || 0);
    H.raf = H.rpRaf = 0;
  }

  function markInfo(H, mk) {
    var m = H.m;
    var lang = H.app.lang;
    if (mk.dataset.a != null) {
      var a = m.actions[+mk.dataset.a];
      return { at: a.at, tone: a.urgency, head: t(lang, "action") + " · " + (a.owner || t(lang, "noOwner")) + " · " + t(lang, a.urgency).split(" /")[0],
        text: a.text, sel: '.p-act li[data-act="' + mk.dataset.a + '"]', label: t(lang, "action") };
    }
    var p = m.points[+mk.dataset.i];
    return { at: p.at, tone: p.kind, head: p.who + " · " + t(lang, p.kind === "question" ? "kQ" : p.kind) + (p.urgency === "urgent" ? " · " + t(lang, "urgent") : ""),
      text: p.text, sel: '.plate li[data-pt="' + mk.dataset.i + '"]', label: t(lang, p.kind === "question" ? "kQ" : p.kind) };
  }

  function showTip(H, mk) {
    if (!mk) return;
    var x = markInfo(H, mk);
    var tip = H.pv.querySelector(".tip");
    tip.className = "tip t-" + x.tone;
    tip.innerHTML = "<small>" + clock(x.at) + " · " + esc(x.head) + '</small><br><span dir="auto">' + esc(x.text) + "</span>";
  }

  function pin(H, mk, keep, quiet) {
    H.pv.querySelectorAll(".big .on, .plate li.lit").forEach(function (x) { x.classList.remove("on", "lit"); });
    if (H.pinned === mk && !keep) { H.pinned = null; return; }
    H.pinned = mk;
    mk.classList.add("on");
    showTip(H, mk);
    var tip = H.pv.querySelector(".tip");
    tip.classList.remove("pop");
    void tip.offsetWidth;
    tip.classList.add("pop");
    var li = H.pv.querySelector(markInfo(H, mk).sel);
    if (li) {
      li.classList.add("lit");
      if (!quiet && li.scrollIntoView) li.scrollIntoView({ block: "nearest", behavior: stillMotion() ? "auto" : "smooth" });
    }
  }

  function flag(H, big, mk) {
    var f = big.querySelector(".flag");
    if (!f) { f = H.app.doc.createElement("span"); big.appendChild(f); }
    var x = markInfo(H, mk);
    var r = mk.getBoundingClientRect();
    var b = big.getBoundingClientRect();
    f.className = "flag f-" + x.tone;
    f.textContent = clock(x.at) + " · " + x.label;
    f.style.left = (r.left - b.left + r.width / 2) + "px";
    f.style.top = (r.top - b.top) + "px";
    void f.offsetWidth;
    f.classList.add("show");
    clearTimeout(f._t);
    f._t = setTimeout(function () { f.classList.remove("show"); }, 2200);
  }

  function laneHTML(m, who) {
    var n = 0;
    return '<div class="strip">' + m.points.map(function (p, i) {
      if (p.at == null || (who && p.who !== who)) return "";
      return '<i class="' + p.kind + (p.urgency === "urgent" ? " urgent" : "") + '" style="left:' + Math.min(100, (p.at / m.duration) * 100).toFixed(2) +
        "%;--n:" + (n++) + '" data-i="' + i + '"></i>';
    }).join("") + "</div>";
  }

  function railHTML(m) {
    return '<div class="strip arail">' + m.actions.map(function (a, j) {
      if (a.at == null) return "";
      return '<b class="am u-' + a.urgency + '" style="left:calc(6px + (100% - 12px) * ' + Math.min(1, a.at / m.duration).toFixed(4) + ')" data-a="' + j + '"></b>';
    }).join("") + "</div>";
  }

  function renderTimeline(H, unfold) {
    var m = H.m;
    var lang = H.app.lang;
    var mode = H.app.homeMode;
    var r = 0;
    var row = function (lab, strip) {
      return '<div class="lab" style="--r:' + r + '">' + lab + "</div>" + strip.replace('class="strip', 'style="--r:' + (r++) + '" class="strip');
    };
    var play = '<button class="play" type="button" aria-label="' + esc(t(lang, "playRec")) + '" disabled><svg viewBox="0 0 16 16" aria-hidden="true">' +
      '<path class="i-play" d="M5 3.2v9.6l7.6-4.8z"/><g class="i-pause"><rect x="3.5" y="3.2" width="3" height="9.6" rx="1"/><rect x="9.5" y="3.2" width="3" height="9.6" rx="1"/></g></svg></button>';
    var h;
    if (mode === "simple") h = row(play, laneHTML(m)) + row("", railHTML(m));
    else {
      h = row(play + '<span class="rlab">' + esc(t(lang, "recording")) + "</span>", '<div class="strip track"></div>');
      m.people.forEach(function (p) { h += row(avHTML(p, false) + "<span>" + esc(p) + "</span>", laneHTML(m, p)); });
      h += row('<span class="adia"></span><span>' + esc(t(lang, "actions")) + "</span>", railHTML(m));
    }
    var tl = H.pv.querySelector(".timeline");
    tl.className = "timeline " + mode;
    tl.innerHTML = '<div class="big ' + mode + (unfold ? " unfold" : "") + '">' + h + '</div><div class="axisrow"><span></span><div class="axis"><span><span class="tnow">0:00</span></span><span>' +
      clock(m.duration) + "</span></div></div>";
    wireBig(H, tl.querySelector(".big"));
    bindPlay(H);
  }

  function setupAudio(H) {
    var a = new Audio();
    a.preload = "metadata";
    a.src = "/api/audio?meeting_id=" + encodeURIComponent(H.m.id);
    a._ok = false;
    a._last = 0;
    H.audio = a;
    a.addEventListener("loadedmetadata", function () { if (H.audio !== a) return; a._ok = true; bindPlay(H); });
    a.addEventListener("error", function () { if (H.audio !== a) return; a._ok = false; a._none = true; bindPlay(H); });
    a.addEventListener("ended", function () { if (H.audio !== a) return; bindPlay(H); });
  }

  function bindPlay(H) {
    var btn = H.pv.querySelector(".play");
    var a = H.audio;
    if (!btn || !a) return;
    var lang = H.app.lang;
    btn.disabled = !a._ok;
    btn.classList.toggle("playing", !a.paused && !a.ended);
    btn.setAttribute("aria-label", t(lang, a.paused ? "playRec" : "pauseRec"));
    if (a._none) {
      btn.title = t(lang, "norecShort");
      var lab = H.pv.querySelector(".rlab");
      var now = H.pv.querySelector(".tnow");
      if (lab) lab.innerHTML = '<span class="norec-s">' + esc(t(lang, "norecShort")) + "</span>";
      else if (now) { now.textContent = t(lang, "norecShort"); now.className = "tnow norec-s"; }
    }
    btn.onclick = function () {
      if (!a._ok) return;
      if (a.paused) { var p = a.play(); if (p && p.catch) p.catch(function () {}); } else a.pause();
    };
    a.onplay = function () { bindPlay(H); tick(H); };
    a.onpause = function () { bindPlay(H); };
    paint(H);
  }

  function tick(H) {
    cancelAnimationFrame(H.raf || 0);
    var step = function () {
      if (!H.audio || H.audio.paused) return;
      paint(H);
      H.raf = requestAnimationFrame(step);
    };
    H.raf = requestAnimationFrame(step);
  }

  function paint(H) {
    var big = H.pv.querySelector(".big");
    var a = H.audio;
    if (!big || !a) return;
    var m = H.m;
    var f = Math.min(1, (a.currentTime * 1000) / m.duration) || 0;
    var s = big.querySelector(".strip:not(.arail)").getBoundingClientRect();
    var b = big.getBoundingClientRect();
    big._pf = f;
    if (big._kick) big._kick();
    var ph = big.querySelector(".phd");
    ph.style.transform = "translateX(" + (s.left - b.left + f * s.width) + "px)";
    ph.classList.toggle("show", a.currentTime > 0);
    var now = H.pv.querySelector(".tnow");
    if (now && !a._none) now.textContent = clock(f * m.duration);
    var last = a._last;
    a._last = f;
    if (a.paused || f <= last) return;
    big.querySelectorAll(".strip i, .strip b").forEach(function (mk) {
      var at = markInfo(H, mk).at / m.duration;
      if (at > last && at <= f) {
        mk.classList.remove("pass");
        void mk.offsetWidth;
        mk.classList.add("pass");
        if (!H.pinned) showTip(H, mk);
      }
    });
  }

  function seek(H, f) {
    var a = H.audio;
    if (!a || !a._ok) return;
    a.currentTime = (f * H.m.duration) / 1000;
    a._last = f;
    paint(H);
  }

  // The recording line as a living shape (Karim's pick "5 Living"): it swells
  // under the cursor with a soft spring and breathes while the hand is near.
  function setupLines(H, big) {
    var detailed = big.classList.contains("detailed");
    var out = [];
    big.querySelectorAll(".strip:not(.arail)").forEach(function (st) {
      st.classList.add("live");
      var w = st.clientWidth;
      var h = st.clientHeight;
      var id = "ln" + (++lineSeq);
      st.insertAdjacentHTML("afterbegin", '<svg class="line" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" aria-hidden="true"><defs>' +
        '<clipPath id="' + id + 'h"><rect height="' + h + '" width="0"/></clipPath><clipPath id="' + id + 'p"><rect height="' + h + '" width="0"/></clipPath></defs>' +
        '<path class="l-base"/><path class="l-hov" clip-path="url(#' + id + 'h)"/><path class="l-play" clip-path="url(#' + id + 'p)"/></svg>');
      var svg = st.firstChild;
      out.push({ st: st, w: w, mid: detailed ? 13 : 15, base: detailed ? 2 : 4, x: w / 2, tx: w / 2, a: 0, va: 0, ta: 0, hf: 0, thf: 0, ph: 0,
        paths: Array.prototype.slice.call(svg.querySelectorAll("path")), rh: svg.querySelector("#" + id + "h rect"), rp: svg.querySelector("#" + id + "p rect") });
    });
    var raf2 = 0;
    function draw(o) {
      var N = 90;
      var top = [];
      var bot = [];
      var scale = detailed ? 0.7 : 1;
      for (var i = 0; i <= N; i++) {
        var x = (o.w * i) / N;
        var g = Math.exp(-Math.pow((x - o.x) / LIVING.sg, 2)) * scale;
        var th = Math.max(o.base * 0.7, o.base + o.a * (2.1 + 0.4 * Math.sin(o.ph)) * g);
        top.push(x.toFixed(1) + " " + (o.mid - th / 2).toFixed(2));
        bot.unshift(x.toFixed(1) + " " + (o.mid + th / 2).toFixed(2));
      }
      var d = "M" + top.join(" L") + " L" + bot.join(" L") + "Z";
      o.paths.forEach(function (p) { p.setAttribute("d", d); });
      o.rh.setAttribute("width", (o.hf * o.w).toFixed(1));
      o.rp.setAttribute("width", ((big._pf || 0) * o.w).toFixed(1));
    }
    function step() {
      var moving = false;
      var still = stillMotion();
      out.forEach(function (o) {
        if (still) { o.x = o.tx; o.a = o.ta; o.va = 0; o.hf = o.thf; }
        else {
          o.x += (o.tx - o.x) * LIVING.follow;
          o.va = (o.va + (o.ta - o.a) * LIVING.k) * LIVING.damp;
          o.a += o.va;
          o.hf += (o.thf - o.hf) * 0.18;
          o.ph += LIVING.phs;
        }
        draw(o);
        if (Math.abs(o.tx - o.x) > 0.3 || Math.abs(o.ta - o.a) > 0.01 || Math.abs(o.va) > 0.01 || Math.abs(o.thf - o.hf) > 0.001 || (!still && o.a > 0.01)) moving = true;
      });
      raf2 = moving && big.isConnected ? requestAnimationFrame(step) : 0;
    }
    big._kick = function () { if (!raf2) raf2 = requestAnimationFrame(step); };
    out.forEach(draw);
    return out;
  }

  function wireBig(H, big) {
    var doc = H.app.doc;
    var m = H.m;
    var marks = Array.prototype.slice.call(big.querySelectorAll(".strip i, .strip b"));
    var cur = doc.createElement("span");
    cur.className = "cur";
    cur.setAttribute("aria-hidden", "true");
    cur.appendChild(doc.createElement("em"));
    big.appendChild(cur);
    var lines = setupLines(H, big);
    drawArcs(H, big);
    var ph = doc.createElement("span");
    ph.className = "phd";
    ph.setAttribute("aria-hidden", "true");
    big.appendChild(ph);
    marks.forEach(function (mk) {
      var x = markInfo(H, mk);
      mk.tabIndex = 0;
      mk.setAttribute("role", "button");
      mk.setAttribute("aria-label", clock(x.at) + ", " + x.head + ": " + x.text);
      mk.addEventListener("focus", function () { if (!H.pinned) showTip(H, mk); });
      mk.addEventListener("click", function (e) { e.stopPropagation(); pin(H, mk); seek(H, x.at / m.duration); });
      mk.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pin(H, mk); } });
    });
    var near = null;
    var frac = function (e) {
      var s = big.querySelector(".strip:not(.arail)").getBoundingClientRect();
      return { s: s, f: Math.max(0, Math.min(1, (e.clientX - s.left) / s.width)) };
    };
    big.addEventListener("mousemove", function (e) {
      var q = frac(e);
      var b = big.getBoundingClientRect();
      big.classList.add("tracking");
      cur.style.transform = "translateX(" + (q.s.left - b.left + q.f * q.s.width) + "px)";
      cur.firstChild.textContent = clock(q.f * m.duration);
      cur.classList.add("show");
      // Lens: marks within 70px swell up to 1.35x, the nearest most.
      marks.forEach(function (mk) {
        var r = mk.getBoundingClientRect();
        var dx = Math.abs(r.left + r.width / 2 - e.clientX);
        mk.style.setProperty("--mag", (1 + 0.35 * Math.max(0, 1 - dx / 70)).toFixed(3));
      });
      var det = big.classList.contains("detailed");
      var lane = null;
      if (det) {
        big.querySelectorAll(".strip").forEach(function (st) {
          var r = st.getBoundingClientRect();
          if (e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2) lane = st;
        });
        big.querySelectorAll(".lane-on").forEach(function (x) { x.classList.remove("lane-on"); });
        if (lane) {
          lane.classList.add("lane-on");
          if (lane.previousElementSibling) lane.previousElementSibling.classList.add("lane-on");
        }
      }
      lines.forEach(function (o) {
        o.tx = q.f * o.w;
        o.thf = q.f;
        o.ta = !det || o.st === lane ? 1 : 0;
      });
      big._kick();
      var best = null;
      var bd = 14;
      marks.forEach(function (mk) {
        var r = mk.getBoundingClientRect();
        var d = Math.hypot(r.left + r.width / 2 - e.clientX, (r.top + r.height / 2 - e.clientY) * 0.6);
        if (d < bd) { bd = d; best = mk; }
      });
      if (best !== near) {
        if (near) near.classList.remove("near");
        near = best;
        if (near) { near.classList.add("near"); if (!H.pinned) showTip(H, near); }
      }
    });
    big.addEventListener("mouseleave", function () {
      big.classList.remove("tracking");
      marks.forEach(function (mk) { mk.style.removeProperty("--mag"); });
      lines.forEach(function (o) { o.ta = 0; o.thf = 0; });
      big._kick();
      big.querySelectorAll(".lane-on").forEach(function (x) { x.classList.remove("lane-on"); });
      cur.classList.remove("show");
      if (near) near.classList.remove("near");
      near = null;
    });
    // A click on the line (not a mark or the button) jumps the recording there.
    big.addEventListener("click", function (e) {
      if (e.target.closest(".play,.lab") || !e.target.closest(".strip")) return;
      seek(H, frac(e).f);
      if (H.audio && H.audio._ok && H.audio.paused) { var p = H.audio.play(); if (p && p.catch) p.catch(function () {}); }
    });
    // Every plate item knows its mark: hover lights it, click jumps there with a small flag.
    H.pv.querySelectorAll(".plate li[data-pt], .p-act li[data-act]").forEach(function (li) {
      var mk = li.dataset.act != null ? big.querySelector('.am[data-a="' + li.dataset.act + '"]') : big.querySelector('.strip i[data-i="' + li.dataset.pt + '"]');
      if (!mk) return;
      li.classList.add("has-mark");
      li.tabIndex = 0;
      li.onmouseenter = function () { mk.classList.add("near"); };
      li.onmouseleave = function () { mk.classList.remove("near"); };
      var go = function () {
        pin(H, mk, true);
        seek(H, markInfo(H, mk).at / m.duration);
        if (big.scrollIntoView) big.scrollIntoView({ block: "nearest", behavior: stillMotion() ? "auto" : "smooth" });
        flag(H, big, mk);
      };
      li.onclick = go;
      li.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
    });
  }

  // Disagreements on the line (Karim 2026-11-04): a thin arc joins the two
  // sides' moments. Disagreements name people, not points, so each side is
  // the speaker's pushback (else any point) nearest the other side in time.
  // ponytail: nearest-pair heuristic; give disagreements point ids if arcs land wrong.
  function arcPairs(m) {
    var out = [];
    m.disagreements.forEach(function (d) {
      var sides = (d.sides || []).slice(0, 2);
      if (sides.length < 2) return;
      var pick = function (who) {
        var mine = m.points.filter(function (p) { return p.at != null && p.who === who; });
        var push = mine.filter(function (p) { return p.kind === "pushback"; });
        return push.length ? push : mine;
      };
      var a = pick(sides[0].name);
      var b = pick(sides[1].name);
      var best = null;
      a.forEach(function (pa) {
        b.forEach(function (pb) {
          var gap = Math.abs(pa.at - pb.at);
          if (!best || gap < best.gap) best = { gap: gap, a: pa, b: pb };
        });
      });
      if (best) out.push({ d: d, a: best.a, b: best.b });
    });
    return out;
  }

  function drawArcs(H, big) {
    if (!big.classList.contains("simple")) return;
    var st = big.querySelector(".strip:not(.arail)");
    var pairs = arcPairs(H.m);
    if (!st || !pairs.length) return;
    var lang = H.app.lang;
    var outcomes = { settled: "disSettled", parked: "disParked", open: "disOpen" };
    // Karim 2026-11-04: no arcs; the stretch between the two sides is tinted.
    pairs.forEach(function (pr) {
      var a = Math.min(pr.a.at, pr.b.at) / H.m.duration;
      var b = Math.max(pr.a.at, pr.b.at) / H.m.duration;
      var path = H.app.doc.createElement("span");
      path.style.left = (a * 100).toFixed(2) + "%";
      path.style.width = "max(6px, " + ((b - a) * 100).toFixed(2) + "%)";
      path.setAttribute("class", "dis-seg o-" + (pr.d.outcome || "open"));
      path.setAttribute("tabindex", "0");
      path.setAttribute("role", "button");
      var head = t(lang, "dis") + " · " + t(lang, outcomes[pr.d.outcome] || "disOpen");
      var text = pr.d.topic + ": " + pr.d.sides.slice(0, 2).map(function (x) { return x.name + " — " + x.view; }).join(" / ");
      path.setAttribute("aria-label", head + ". " + text);
      var show = function () {
        var tip = H.pv.querySelector(".tip");
        if (!tip || H.pinned) return;
        tip.className = "tip t-pushback";
        tip.innerHTML = "<small>" + clock(Math.min(pr.a.at, pr.b.at)) + " · " + esc(head) + '</small><br><span dir="auto">' + esc(text) + "</span>";
      };
      path.addEventListener("mouseenter", show);
      path.addEventListener("focus", show);
      path.addEventListener("click", function (e) { e.stopPropagation(); show(); seek(H, Math.min(pr.a.at, pr.b.at) / H.m.duration); });
      st.appendChild(path);
    });
  }

  function moveKnob(H) {
    var on = H.pv.querySelector(".vseg [aria-pressed=true]");
    var knob = H.pv.querySelector(".vknob");
    if (on && knob) knob.style.transform = "translateX(" + on.offsetLeft + "px) scaleX(" + on.offsetWidth + ")";
  }

  // Replay: the line fills over 6 s; each mark nods as it is reached, its words
  // take the box and its plate item lights. A second press stops it.
  function replay(H) {
    var big = H.pv.querySelector(".big");
    var btn = H.pv.querySelector("#replay");
    if (!big) return;
    var lang = H.app.lang;
    var ph = big.querySelector(".phd");
    if (H.rpRaf) {
      cancelAnimationFrame(H.rpRaf);
      H.rpRaf = 0;
      btn.textContent = t(lang, "replay");
      big._pf = 0;
      big._kick();
      ph.classList.remove("show");
      return;
    }
    if (H.audio && !H.audio.paused) H.audio.pause();
    var marks = Array.prototype.slice.call(big.querySelectorAll(".strip i, .strip b")).map(function (mk) {
      return { mk: mk, f: markInfo(H, mk).at / H.m.duration };
    }).sort(function (a, b) { return a.f - b.f; });
    var T = stillMotion() ? 0 : 6000;
    var t0 = performance.now();
    var next = 0;
    btn.textContent = t(lang, "stop");
    var frame = function (now) {
      var f = T ? Math.min(1, (now - t0) / T) : 1;
      var s = big.querySelector(".strip:not(.arail)").getBoundingClientRect();
      var b = big.getBoundingClientRect();
      big._pf = f;
      big._kick();
      ph.style.transform = "translateX(" + (s.left - b.left + f * s.width) + "px)";
      ph.classList.add("show");
      var tn = H.pv.querySelector(".tnow");
      if (tn && !(H.audio && H.audio._none)) tn.textContent = clock(f * H.m.duration);
      while (next < marks.length && marks[next].f <= f) {
        var mk = marks[next++].mk;
        mk.classList.remove("pass");
        void mk.offsetWidth;
        mk.classList.add("pass");
        pin(H, mk, true, true);
      }
      if (f < 1 && big.isConnected) H.rpRaf = requestAnimationFrame(frame);
      else {
        H.rpRaf = 0;
        btn.textContent = t(lang, "replay");
        setTimeout(function () { ph.classList.remove("show"); big._pf = 0; big._kick(); }, 900);
      }
    };
    H.rpRaf = requestAnimationFrame(frame);
  }

  // Called after every list render and preview swap: slides the tab underline
  // and wires the preview once per element.
  function wireHome(app) {
    var doc = app.doc;
    var H = app.home;
    var ind = doc.getElementById("ind");
    var on = doc.querySelector(".tabs [aria-selected=true]");
    if (ind && on) {
      var to = "translateX(" + on.offsetLeft + "px) scaleX(" + on.offsetWidth + ")";
      if (H.ind && H.ind !== to && !stillMotion()) {
        ind.style.transition = "none";
        ind.style.transform = H.ind;
        void ind.offsetWidth;
        ind.style.transition = "";
      }
      ind.style.transform = to;
      H.ind = to;
    }
    var pv = doc.getElementById("preview");
    if (!pv || !pv.dataset.id || H.pv === pv) return;
    stopHome(H);
    H.app = app;
    H.pv = pv;
    H.m = modelOf(app, pv.dataset.id);
    H.pinned = null;
    pv.addEventListener("click", function (e) {
      if (e.target.closest("#replay")) { replay(H); return; }
      var v = e.target.closest("[data-view]");
      if (!v || v.dataset.view === app.homeMode) return;
      app.homeMode = v.dataset.view;
      stored(MODE_KEY, app.homeMode);
      pv.querySelectorAll(".vseg [data-view]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === v)); });
      moveKnob(H);
      H.pinned = null;
      renderTimeline(H, true);
    });
    if (!H.m || !H.m.duration) return;
    setupAudio(H);
    renderTimeline(H, false);
    var first = pv.querySelector(".big .strip i, .big .strip b");
    if (first) showTip(H, first);
    moveKnob(H);
  }

  function renderList(app, view, lang) {
    view.classList.add("home");
    var head = el("div", "home-head");
    var left = el("div");
    left.appendChild(el("h1", null, t(lang, "meetings")));
    var finding = el("p", "finding");
    finding.id = "finding";
    finding.innerHTML = sinceHTML(app, lang);
    left.appendChild(finding);
    head.appendChild(left);
    head.appendChild(askForm(app, lang));
    view.appendChild(head);
    var label = el("label", "search");
    var icon = el("span", null, "⌕");
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
    if (app.ask) view.appendChild(askPanel(app, app.ask, lang));
    if (app.follow) view.appendChild(followBar(app, lang));
    view.appendChild(tabsBar(app, lang));
    var tools = el("div", "subbar");
    var types = typesBar(app, lang);
    if (types) tools.appendChild(types);
    var ft = folderTools(app, lang);
    if (ft) tools.appendChild(ft);
    if (tools.firstChild) view.appendChild(tools);
    var grid = el("div", "listgrid");
    var listSection = el("section", "list");
    listSection.id = "list";
    listSection.setAttribute("aria-label", t(lang, "meetings"));
    var shown = visibleMeetings(app, lang);
    listSection.innerHTML = rowsHTML(app, shown, lang);
    if (!shown.length) {
      var calm = app.tab === "urgent" || app.tab === "action";
      listSection.appendChild(el("p", calm ? "allclear" : "finding", t(lang, calm ? "allClear" : "emptyTab")));
    }
    // The preview starts on the first meeting shown instead of an empty panel.
    if (shown.length && app.setPreview && !shown.some(function (m) { return m.meeting_id === app.previewId; })) {
      Promise.resolve().then(function () { app.setPreview(shown[0].meeting_id); });
    }
    grid.appendChild(listSection);
    if (app.q.trim()) {
      var hitsSection = el("section", "hits");
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
    // Arrival: the page draws itself once per visit.
    if (!app.arrived && app.meetings.length && !stillMotion()) {
      app.arrived = true;
      view.classList.add("arrive");
      setTimeout(function () { view.classList.remove("arrive"); }, 2600);
    }
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
    // A rebuild must not steal the caret: typing in search re-renders per key.
    var focused = doc.activeElement && doc.activeElement.id && view.contains(doc.activeElement)
      ? { id: doc.activeElement.id, at: doc.activeElement.selectionStart } : null;
    view.textContent = "";
    view.classList.remove("home");
    // Motion is feedback: the screen eases in only when it really changes (another
    // meeting, person, filter or folder), never on a keystroke re-render.
    var key = app.view === "list" || !app.page ? "list:" + app.tab + ":" + app.mtype + ":" + (app.follow || "")
      : "m:" + app.page.meeting.meeting_id + ":" + (app.person || "") + ":" + (app.cat || "");
    view.classList.toggle("enter", key !== app.viewKey);
    app.viewKey = key;
    if (app.view !== "list") stopHome(app.home);
    app.home.pv = null; // the old preview element is gone
    if (app.view === "list" || !app.page) renderList(app, view, lang);
    else renderMeeting(app, view, lang);
    if (app.view === "list") wireHome(app);
    var again = focused && doc.getElementById(focused.id);
    if (again) {
      again.focus();
      if (typeof focused.at === "number" && again.setSelectionRange) again.setSelectionRange(focused.at, focused.at);
    }
  }

  function toast(app, message, undoLabel, onUndo) {
    var node = app.doc.getElementById("toast");
    node.textContent = message;
    if (undoLabel) {
      var undo = el("button", "toast-undo", undoLabel);
      undo.type = "button";
      undo.onclick = function () { node.classList.remove("show"); onUndo(); };
      node.appendChild(undo);
    }
    node.classList.add("show");
    clearTimeout(app.toastTimer);
    app.toastTimer = setTimeout(function () { node.classList.remove("show"); }, undoLabel ? 5000 : 2200);
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
      ask: null,
      askDraft: null,
      cat: "all",
      openQuote: {},
      userTags: {},
      toastTimer: null,
      folders: [],
      folder: "",
      previewId: null,
      previews: {},
      models: {},
      home: {},
      tab: "all",
      mtype: "",
      follow: null,
      folderEdit: null,
      homeMode: stored(MODE_KEY) === "detailed" ? "detailed" : "simple",
      since: 0
    };
    var postJson = opts.postJson || function () { return Promise.reject(new Error("no postJson")); };
    var win = opts.win || { history: { pushState: function () {} } };

    app.showList = function (meetings) {
      app.view = "list";
      app.meetings = (meetings || []).map(function (m) { return tidyPage({ meeting: m }).meeting; });
      app.since = sinceStart(app);
      render(app);
      // Every row draws its call strip from its page.
      // ponytail: one request per meeting; add the marks to /api/meetings if lists grow past ~50.
      var missing = app.meetings.filter(function (m) { return !app.previews[m.meeting_id]; }).slice(0, 60);
      if (!missing.length) return;
      Promise.all(missing.map(function (m) {
        return app.fetchJson("/api/meetings/" + encodeURIComponent(m.meeting_id)).then(function (page) {
          app.previews[m.meeting_id] = tidyPage(page);
          delete app.models[m.meeting_id];
        }).catch(function () {});
      })).then(function () {
        if (app.view !== "list") return;
        var list = app.doc.getElementById("list");
        if (!list) return;
        // Only the rows and the counts change: keep the preview (and its audio) as it is.
        var fresh = app.doc.createElement("div");
        renderList(app, fresh, app.lang);
        var keep = app.doc.getElementById("preview");
        var tabs = app.doc.querySelector("#view .tabs");
        var fl = fresh.querySelector("#list");
        list.innerHTML = fl.innerHTML;
        if (tabs) tabs.replaceWith(fresh.querySelector(".tabs"));
        var find = app.doc.getElementById("finding");
        if (find) find.innerHTML = fresh.querySelector("#finding").innerHTML;
        if (!keep || !keep.dataset.id) showPreview();
        wireHome(app);
      });
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

    // Swap only the preview panel: a full render on hover/focus dropped
    // keyboard focus and typed text (review 2026-11-03).
    function showPreview() {
      var old = app.doc.getElementById("preview");
      if (!old) { render(app); return; }
      if (old.dataset.id && old.dataset.id === app.previewId) return; // already showing it
      var swap = function () {
        var fresh = previewPanel(app, app.lang);
        old.replaceWith(fresh);
        app.doc.querySelectorAll("#list .row").forEach(function (r) {
          r.setAttribute("aria-current", String(r.dataset.sel === app.previewId));
        });
        wireHome(app);
      };
      if (app.doc.startViewTransition && !stillMotion()) app.doc.startViewTransition(swap);
      else swap();
    }

    function refreshList() {
      return app.loadMeetings(false);
    }

    app.setPreview = function (id) {
      if (!id || id === app.previewId || app.view !== "list") return;
      app.previewId = id;
      if (app.previews[id]) { showPreview(); return; }
      app.fetchJson("/api/meetings/" + encodeURIComponent(id)).then(function (page) {
        app.previews[id] = tidyPage(page);
        delete app.models[id];
        if (app.previewId === id && app.view === "list") showPreview();
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

    app.askQuestion = function (q) {
      q = (q || "").trim();
      if (!q || (app.ask && app.ask.busy)) return Promise.resolve(null);
      app.ask = { q: q, busy: true };
      app.askDraft = null;
      render(app);
      return postJson("/api/ask", { q: q }).then(function (res) {
        app.ask = { q: q, answer: res.answer || "", citations: res.citations || [], fresh: true };
      }).catch(function () {
        app.ask = { q: q, failed: true, citations: [], fresh: true };
      }).then(function () {
        render(app);
        return app.ask;
      });
    };

    function onSubmit(event) {
      if (event.target && event.target.id === "askform") {
        event.preventDefault();
        var input = app.doc.getElementById("askq");
        app.askQuestion(input ? input.value : "");
      }
    }

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
      if ((b = g("[data-follow]"))) {
        app.follow = b.dataset.follow || null;
        render(app);
        return;
      }
      if ((b = g("[data-tab]"))) {
        app.tab = b.dataset.tab;
        app.mtype = "";
        app.folderEdit = null;
        render(app);
        return;
      }
      if ((b = g("[data-mtype]"))) {
        app.mtype = app.mtype === b.dataset.mtype ? "" : b.dataset.mtype;
        render(app);
        return;
      }
      if ((b = g("[data-sel]"))) {
        app.setPreview(b.dataset.sel);
        return;
      }
      if ((b = g("#seen"))) {
        app.since = Date.now();
        stored(LAST_KEY, String(app.since));
        render(app);
        return;
      }
      if ((b = g("#unseen"))) {
        stored(LAST_KEY, null);
        app.since = sinceStart(app);
        render(app);
        return;
      }
      if ((b = g("[data-archive]"))) {
        var mid = b.dataset.archive;
        var on = b.dataset.on === "1";
        var setArch = function (state) {
          return postJson("/api/meetings/archive", { meeting_id: mid, archived: state }).then(refreshList);
        };
        setArch(on).then(function () {
          if (on) toast(app, t(app.lang, "archivedToast"), t(app.lang, "undo"), function () { setArch(false); });
        }).catch(function () { toast(app, t(app.lang, "notSaved")); });
        return;
      }
      if ((b = g("[data-fdo]"))) {
        var fbox = closest(b, app.doc, ".ftools");
        var fid = fbox && fbox.dataset.folderId;
        var act = b.dataset.fdo;
        if (act === "rename" || act === "delete") { app.folderEdit = act; render(app); return; }
        if (act === "cancel") { app.folderEdit = null; render(app); return; }
        if (act === "rename-save") {
          var nm = (app.doc.getElementById("frename") || {}).value || "";
          if (!nm.trim()) return;
          postJson("/api/folders/rename", { folder_id: fid, name: nm.trim() }).then(function () {
            app.folderEdit = null;
            return refreshList();
          }).catch(function () { toast(app, t(app.lang, "notSaved")); });
          return;
        }
        if (act === "delete-yes") {
          postJson("/api/folders/delete", { folder_id: fid }).then(function () {
            app.folderEdit = null;
            app.tab = "all";
            return refreshList();
          }).then(function () { toast(app, t(app.lang, "folderDeleted")); })
            .catch(function () { toast(app, t(app.lang, "notSaved")); });
        }
        return;
      }
      if ((b = g("[data-lang]"))) {
        app.setLang(b.dataset.lang);
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

    function onHover() { /* Karim 2026-11-03 (AV): a click picks the preview, hover only lights the row. */ }

    function onChange(event) {
      var sel = event.target;
      if (sel && sel.classList && sel.classList.contains("mtype-set")) {
        postJson("/api/meetings/type", { meeting_id: sel.dataset.meeting, meeting_type: sel.value || null })
          .then(refreshList).catch(function () { toast(app, t(app.lang, "notSaved")); });
        return;
      }
      if (sel && sel.classList && sel.classList.contains("move-folder")) {
        saveFolder("/api/folders/move", { meeting_id: sel.dataset.meeting, folder_id: sel.value || null });
      }
    }

    function onInput(event) {
      if (event.target && event.target.id === "q") {
        app.search(event.target.value);
      }
      // A re-render (language toggle, folder chip, search) must keep a half-typed question.
      if (event.target && event.target.id === "askq") app.askDraft = event.target.value;
    }

    function onKey(event) {
      if (event.key !== "Escape") return;
      if (app.person) {
        app.person = null;
        render(app);
      } else if (app.follow) {
        app.follow = null;
        render(app);
      }
    }

    app.doc.addEventListener("click", onClick);
    app.doc.addEventListener("mouseover", onHover);
    app.doc.addEventListener("focusin", onHover);
    app.doc.addEventListener("change", onChange);
    app.doc.addEventListener("submit", onSubmit);
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
    // A judge without a key gets told why nothing happens (older backends have no /api/status).
    fetchJson("/api/status").then(function (s) {
      var bar = doc.getElementById("keybar");
      if (bar && s && s.meta_key === false) bar.hidden = false;
    }).catch(function () {});
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
