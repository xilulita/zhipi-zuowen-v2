/* ============================================================
   智批作文 · AI 接口层
   - 大模型直连（OpenAI 兼容协议）
   - 本地 OCR（PaddleOCR HTTP 服务）
   - 图片压缩（Canvas）
   ============================================================ */
window.ZP = window.ZP || {};

(function (ZP) {
  "use strict";

  var LS_KEY = "zhipi.config.v1";

  /* ---------------- 配置存取 ---------------- */
  ZP.config = {
    provider: "deepseek",
    base: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    key: "",
    ocr: "http://127.0.0.1:8866",
    /* imageMode: "vision" 用视觉模型直读图片；"local" 用本地 OCR 先转文字 */
    imageMode: "vision",
    /* 留空 = 与主 AI 接口地址相同；避免用户配了别的服务商却把图片发到别人服务器 */
    visionBase: "",
    visionModel: "",
    visionKey: "",         /* 留空则复用主接口的 Key */
    /* 生成温度：影响批注措辞的稳定性，0.2–0.35 最稳 */
    temperature: 0.3,
    /* noThink: true = 关闭深度思考，直接产出内容（快）；false = 让模型先推理（慢但更稳） */
    noThink: true
  };

  ZP.loadConfig = function () {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        Object.keys(ZP.config).forEach(function (k) {
          if (o[k] !== undefined && o[k] !== null) ZP.config[k] = o[k];
        });
      }
    } catch (e) { /* 忽略损坏配置 */ }
    return ZP.config;
  };

  ZP.saveConfig = function (patch) {
    Object.assign(ZP.config, patch || {});
    try { localStorage.setItem(LS_KEY, JSON.stringify(ZP.config)); } catch (e) {}
    return ZP.config;
  };

  ZP.hasKey = function () {
    return !!(ZP.config.key && ZP.config.key.trim().length > 8);
  };

  /* ---------------- 请求封装 ---------------- */
  function endpointOf(base) {
    var b = (base || "").trim().replace(/\/+$/, "");
    if (!b) throw new Error("接口地址为空，请先在「批改功能选项」中填写。");
    return /\/chat\/completions$/.test(b) ? b : b + "/chat/completions";
  }

  function endpoint() { return endpointOf(ZP.config.base); }

  function abortable(ms, outer) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, ms);
    var onOuter = null;
    if (outer) {
      if (outer.aborted) ctl.abort();
      else {
        onOuter = function () { ctl.abort(); };
        outer.addEventListener("abort", onOuter);
      }
    }
    return {
      signal: ctl.signal,
      done: function () {
        clearTimeout(timer);
        if (outer && onOuter) outer.removeEventListener("abort", onOuter);
      }
    };
  }

  /**
   * 调用 chat/completions
   * @param {Array} messages
   * @param {Object} opt { temperature, maxTokens, timeout, json }
   */
  ZP.chat = async function (messages, opt) {
    opt = opt || {};
    var t0 = Date.now();
    var vision = !!opt.vision;
    var key = vision && ZP.config.visionKey ? ZP.config.visionKey.trim() : (ZP.config.key || "").trim();
    if (!key) {
      throw new Error(vision
        ? "尚未配置视觉模型 Key，请先在「图片识别方式」中填写。"
        : "尚未配置 API Key，请先在左侧「批改功能选项」中填写。");
    }

    var url = vision ? endpointOf(ZP.config.visionBase || ZP.config.base) : endpoint();
    var baseBody = {
      model: vision
        ? (ZP.config.visionModel || ZP.config.model || "qwen-vl-max")
        : (ZP.config.model || "deepseek-chat"),
      messages: messages,
      temperature: opt.temperature === undefined
        ? (typeof ZP.config.temperature === "number" ? ZP.config.temperature : 0.4)
        : opt.temperature,
      stream: false
    };
    if (opt.maxTokens) baseBody.max_tokens = opt.maxTokens;

    /* 关闭深度思考：豆包 Seed 2.x 默认会先思考再回答，
       思考 token 会吃掉输出额度并显著拖慢速度。
       thinking: disabled 让模型直接产出内容（火山方舟官方参数）。 */
    var wantNoThink = (opt.noThink !== undefined)
      ? !!opt.noThink
      : (ZP.config.noThink !== false);
    if (wantNoThink) {
      baseBody.thinking = { type: "disabled" };
      /* 官方推荐用 max_completion_tokens 控制输出上限，兼容保留 max_tokens */
      if (opt.maxTokens) baseBody.max_completion_tokens = opt.maxTokens;
      delete baseBody.max_tokens;
    }

    /* 是否带 response_format：部分视觉模型不支持，失败后会自动去掉重试 */
    var useJson = !!opt.json && !(vision && opt.noJsonForVision);

    async function send(withJson) {
      var body = Object.assign({}, baseBody);
      if (withJson) body.response_format = { type: "json_object" };
      var t = abortable(opt.timeout || 120000, opt.signal);
      t0 = Date.now();
      var res;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + key
          },
          body: JSON.stringify(body),
          signal: t.signal
        });
      } catch (e) {
        t.done();
        if (e && e.name === "AbortError" && opt.signal && opt.signal.aborted) {
          var stopped = new Error("已停止批改");
          stopped.code = "ABORTED";
          throw stopped;
        }
        if (e && e.name === "AbortError") {
          var terr2 = new Error(
            "请求超时：模型在 " + Math.round((opt.timeout || 120000) / 1000) + " 秒内没有返回完整结果。" +
            "这类批改一次要输出近万字，长作文或高峰期容易超时。建议：① 稍后重试；" +
            "② 换用响应更快的视觉模型；③ 若原稿有多页，可分次批改。"
          );
          terr2.code = "TIMEOUT";
          throw terr2;
        }
        var host = "";
        try { host = new URL(url).host; } catch (e2) { host = url; }
        var terr = new Error(
          "无法连接到 " + host + "（" + (e && e.message ? e.message : "网络错误") + "）。" +
          "这只说明请求没发出去，不是模型不支持。常见原因：" +
          "① 接口地址拼写有误，或少了 /v1、/api/v3；" +
          "② 该域名不允许浏览器跨域访问（CORS）；" +
          "③ 视觉模型用了别的平台的地址，而不是你这家服务商的。"
        );
        terr.code = "NETWORK";
        terr.host = host;
        throw terr;
      }
      t.done();
      return res;
    }

    function readError(res) {
      return res.text().then(function (raw) {
        var detail = "";
        try {
          var j = JSON.parse(raw);
          detail = (j.error && (j.error.message || j.error.code)) || j.message || "";
        } catch (e) { detail = raw || ""; }
        return String(detail).slice(0, 200);
      }).catch(function () { return ""; });
    }

    var res = await send(useJson);
    var detail = "";

    if (!res.ok) {
      detail = await readError(res);

      /* 自动兼容：模型不认 response_format 时，去掉该参数重发一次 */
      var jsonUnsupported = useJson &&
        /(response_format|json_object|json mode)/i.test(detail) &&
        res.status >= 400 && res.status < 500;

      if (jsonUnsupported) {
        useJson = false;
        res = await send(false);
        if (!res.ok) detail = await readError(res);
      }

      /* 自动兼容：不认 thinking / max_completion_tokens 的服务商，去掉后重发 */
      var paramUnsupported = /(thinking|max_completion_tokens|unknown|unrecognized|unsupported)/i.test(detail) &&
        res.status >= 400 && res.status < 500;
      if (paramUnsupported) {
        delete baseBody.thinking;
        if (baseBody.max_completion_tokens) {
          baseBody.max_tokens = baseBody.max_completion_tokens;
          delete baseBody.max_completion_tokens;
        }
        res = await send(useJson);
        if (!res.ok) detail = await readError(res);
      }

      /* 自动兼容：图片过大被拒时给出明确指引 */
      if (!res.ok && /(image).*(too large|exceeds|size)/i.test(detail)) {
        throw new Error("图片过大被服务商拒绝：" + detail + " 请换一张更小的照片。");
      }
    }

    if (!res.ok) {
      var msg = "接口返回 " + res.status;
      if (res.status === 401 || res.status === 403) msg += "：Key 无效、无权限或已过期。";
      else if (res.status === 404) msg += "：接口地址或模型名不存在。";
      else if (res.status === 413) msg += "：请求体过大，请压缩图片后重试。";
      else if (res.status === 429) msg += "：请求过于频繁或额度不足。";
      if (detail) msg += " " + detail;
      throw new Error(msg);
    }

    var data = await res.json();
    var choice = data && data.choices && data.choices[0];
    var rawContent = choice && choice.message && choice.message.content;
    var txt = "";
    if (typeof rawContent === "string") txt = rawContent;
    else if (Array.isArray(rawContent)) {
      txt = rawContent.map(function (p) { return p && p.text ? p.text : ""; }).join("");
    }

    if (!txt) {
      var why = (choice && choice.finish_reason) || "";
      if (why === "content_filter") throw new Error("内容被服务商安全策略拦截，请换用其他模型。");
      throw new Error("模型返回内容为空" + (why ? "（finish_reason: " + why + "）" : "") + "，请检查该模型是否支持对话补全。");
    }

    ZP.__lastFinish = choice.finish_reason || "";
    ZP.__lastUsage = data.usage || null;

    /* 统计：每次请求的耗时与 token 用量 */
    if (opt.trace) {
      var u = data.usage || {};
      var durMs = Date.now() - (t0 || Date.now());
      var pTok = u.prompt_tokens || u.input_tokens || 0;
      var cTok = u.completion_tokens || u.output_tokens || 0;
      var tTok = u.total_tokens || (pTok + cTok);
      var estimated = false;
      /* 有的服务商（或代理网关）不返回 usage：按字符数粗估，并标记 estimated，
         界面上会加「≈」号，绝不把估算值当真实计费。 */
      if (!tTok) {
        var inChars = 0;
        (messages || []).forEach(function (m) {
          inChars += String((m && m.content) || "").length;
        });
        var outChars = String(txt || "").length;
        pTok = Math.round(inChars / 1.6);
        cTok = Math.round(outChars / 1.6);
        tTok = pTok + cTok;
        estimated = true;
      }
      opt.trace.push({
        step: opt.traceLabel || "request",
        ms: durMs,
        prompt: pTok,
        completion: cTok,
        total: tTok,
        estimated: estimated,
        model: opt.model || ZP.config.model,
        ok: true
      });
    }

    if (typeof opt.onMeta === "function") opt.onMeta(choice.finish_reason || "", data.usage || null);
    return txt;
  };

  /* ---------------- JSON 容错解析 ---------------- */
  ZP.parseJSON = function (raw) {
    if (!raw) throw new Error("模型返回为空。");
    var s = String(raw).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

    function tryParse(t) { try { return JSON.parse(t); } catch (e) { return null; } }

    var v = tryParse(s);
    if (v) return v;

    var a = s.indexOf("{"),
        b = s.lastIndexOf("}");
    if (a >= 0 && b > a) {
      v = tryParse(s.slice(a, b + 1));
      if (v) return v;
      v = tryParse(s.slice(a, b + 1).replace(/,\s*([}\]])/g, "$1"));
      if (v) return v;
    }

    /* 被截断：补齐未闭合的字符串与括号后再试 */
    if (a >= 0) {
      var fixed = ZP.balanceJSON(s);
      v = tryParse(fixed) || tryParse(fixed.replace(/,\s*([}\]])/g, "$1"));
      if (v) return v;
    }

    /* 仍然失败：把真实开头带出来，便于定位（不静默吞错） */
    var head = s.slice(0, 80).replace(/\s+/g, " ");
    throw new Error("模型返回的结果不是完整 JSON，无法解析。开头为：「" + head +
      "…」。建议换用更强的视觉模型，或减少一次批改的作文长度。");
  };

  /* ---------------- 提示词 ---------------- */
  ZP.buildPrompt = function (ctx) {
    var g = ZP.getGrade(ctx.grade);
    var w = ctx.weights;
    var dimLines = ZP.DIMS.map(function (d) {
      return "- " + d.key + "（" + d.name + "，权重 " + w[d.key] + " 分）：" + d.desc +
        "；本年级要求：" + (g.dimReq[d.key] || d.desc);
    }).join("\n");

    var sys = [
      "你是一位有 20 年经验的小学语文教研员，长期负责" + g.name + "作文阅卷与讲评。",
      "你的批改必须具体、可操作：每一条意见都要指向原文里的某个词或某句话，禁止空泛套话。",
      "你只输出 JSON，不输出任何解释性文字、不使用 Markdown 代码块。"
    ].join("\n");

    var user = [
      "【任务】批改下面这篇" + g.name + ctx.genre + "，并按指定 JSON 结构输出。",
      "",
      "【年级写作要求】",
      g.reqs.map(function (r, i) { return (i + 1) + ". " + r; }).join("\n"),
      "字数要求：" + g.words[0] + "–" + g.words[1] + " 字（润色稿必须严格落在该区间）。",
      "评分口径：" + g.rule,
      "",
      "【四维评分】总分 100，四维权重固定如下，各维度得分按该维度满分折算为百分制（0–100 的整数）：",
      dimLines,
      "加权总分 = Σ(维度得分 × 权重 ÷ 100)，四舍五入取整。等级：≥" + g.level.first + " 为一类文，" +
        g.level.second + "–" + (g.level.first - 1) + " 为二类文，<" + g.level.second + " 为三类文。",
      "",
      "【批注要求】",
      "1) 逐句定位：annotations 中 para 为段落序号（从 0 开始），sentence 为该段中要批注的句子原文（需与正文完全一致，便于前端定位）。",
      "   若输入包含多页原稿图片，还必须给出 page 字段：该句所在的页序号（第 1 页 = 0，第 2 页 = 1，以此类推）。",
      "2) type 只能是 red（错别字/病句）、amber（润色后语句）、green（优秀好句）、violet（修改建议）之一。",
      "3) 每类至少 1 条，总数 8–14 条；red 必须指出错在哪里、正确写法；green 要说明好在哪里（手法+效果）。",
      "",
      "4) ★amber（润色语句）与 violet（修改建议）必须写足、写具体，禁止空泛提示：",
      "   · note（说明）：40–90 字，要说清「原句问题在哪 + 为什么这样改更好」，可指出手法（比喻/动作/感官/节奏）。",
      "   · fix（改写示例）：必须给出一句完整的、可直接替换进原文的改写句，25–80 字；",
      "     改写要贴合学生原有情境，不得空泛，也不得只写「可更生动」「补充细节」这类废话。",
      "   · 示例格式：note=\"原句只有视觉描写，缺少声音；补上听觉能让画面立体\" ，fix=\"风一吹，树叶沙沙地响，像有人在远处轻轻翻书。\"",
      "   · 每条 amber/violet 都要做到「照着 fix 就能直接替换原文」。",
      "",
      "5) ★red（错别字/病句）的 fix 只给「正确写法」，不要写整句范文：",
      "   · 错别字：只写正确的那个字或词 + 可选拼音，如 fix=\"应运题 → 应用题（yìng yòng tí）\"，不超过 20 字；",
      "   · 病句：给出修正后的原句本身（可保留原句结构，只改错处），不超过 40 字；",
      "   · 不要出现「改写例句」「可以改成」之类的前缀，直接给结果。",
      "   · green（优秀好句）的 fix 为空串。",
      "",
      "【小练笔】3 道题，每题精简，必须针对本文真实存在的短板，分别在描写手法、表达手法、修辞手法、感官描写、环境描写中选择不同角度切入；",
      "problem 指出文中具体缺陷；think 给可执行的写作路径；material 给 2–3 条可直接借用的素材或句式；task 给字数与硬性限制。",
      "",
      "【写作思路】outline 面向「重新构思一篇同类作文」，是客观提纲，不复述本文原句：",
      "   · begin / middle / end 各写「可以怎么写」，给出可直接照做的写法路径，而不是评价本文优缺点；",
      "   · 用「可以……」「比如……」的句式，允许给出具体的画面、句子建议；",
      "   · middle 若有多层推进，用「1. 2. 3.」分条，每条一句话，不写空泛的「注意细节」「多描写」；",
      "   · 必须贴合本文的题目、题材与学生生活经验，不得写成通用套话。",
      "",
      "【具体问题与修改思路】issues 列出本文最关键的 3 个问题，每个问题独立成条，指向具体位置：",
      "   · problem：一句话点明问题（30–60 字），必须说清「哪一部分 / 哪一类表述」出了问题，",
      "     要能对应到原文的具体句子或段落，禁止「内容不够生动」这类没有落点的说法；",
      "   · advice：一句话给出总的修改方向（20–50 字），说明「换掉什么、改成什么」；",
      "   · steps：3 条可执行步骤（每条 15–40 字），按先后顺序写，第一步必须是「先做什么」（如先删掉某类句子），",
      "     最后一步落到「最后怎么收束」，让学生照着能直接动笔。",
      "   · 三条问题不要重复，尽量覆盖内容、结构、语言三个层面。",
      "   · 本节与 annotations 是不同层级：annotations 是逐句批注，issues 是整篇层面的问题归纳，不要简单复制批注内容。",
      "",
      "【润色稿】本次不输出润色稿（polished 留空对象 {}），润色稿会单独生成，以保证批注写足。",
      "",
      "【正文】",
      ctx.text,
      "",
      "【输出 JSON 结构】严格按此结构，不要增删顶层字段：",
      JSON.stringify({
        score: 0,
        level: "一类文|二类文|三类文",
        dims: [{ key: "content", score: 0, comment: "80字以内，指出具体问题", tagline: "8字内概括" }],
        overall: "总评 180–260 字，分 2–3 段，用 \\n\\n 分段；先肯定具体优点，再指出 2 个核心问题，最后给一条可执行的改进路径",
        annotations: [{ para: 0, page: 0, sentence: "原文句子", box: { y: 0, x1: 0, x2: 0 }, type: "red|amber|green|violet", tag: "错别字|病句|润色语句|优秀好句|修改建议", note: "40-90字：问题在哪+为何这样改", fix: "amber/violet 给25-80字可直接替换的改写句；red 只给正确写法（≤20字）" }],
        outline: {
          begin: { title: "开头", text: "可以直接照做的开篇写法，120字以内；用「可以……比如……」句式" },
          middle: { title: "中间", text: "分层推进的写法路径，150字以内；多层用 1. 2. 3. 分条" },
          end: { title: "结尾", text: "收束写法，120字以内；强调与开头的照应或情感落点" }
        },
        issues: [
          {
            problem: "具体问题：哪一部分出了什么问题（30-60字，须有落点）",
            advice: "总修改方向：换掉什么、改成什么（20-50字）",
            steps: ["第一步：先做什么", "第二步：再做什么", "第三步：最后怎么收束"]
          }
        ],
        drills: [{ no: 1, title: "题目", problem: "对应问题", think: "思路引导", material: "素材示例", task: "任务要求" }],
        polished: {}
      }, null, 2)
    ].join("\n");

    return [{ role: "system", content: sys }, { role: "user", content: user }];
  };

  /* ---------------- 批改主流程 ---------------- */
  ZP.gradeEssay = async function (ctx, onStage) {
    var msgs = ZP.buildPrompt(ctx);
    onStage && onStage("正在读取作文内容", 18);
    var raw = await ZP.chat(msgs, {
      json: true, timeout: 360000, maxTokens: 6500,
      signal: ctx.signal, trace: ctx.trace, traceLabel: "全文批改"
    });
    onStage && onStage("正在生成四维评分与批注", 72);
    var data = ZP.parseJSON(raw);
    var norm = normalize(data, ctx);

    /* 第二阶段：单独生成升格范文，失败不影响主批改 */
    try {
      if (ctx.signal && ctx.signal.aborted) throw Object.assign(new Error("已停止"), { code: "ABORTED" });
      var pol = await ZP.polishEssay({
        text: ctx.text, grade: ctx.grade, genre: ctx.genre, isVision: false, trace: ctx.trace
      }, norm, onStage, ctx.signal);
      if (pol) {
        norm.polished = pol;
        var gw = ZP.getGrade(ctx.grade).words;
        norm.inRange = pol.words >= gw[0] && pol.words <= gw[1];
      } else {
        norm.polishFailed = "no_source";
      }
    } catch (e) {
      if (e && e.code === "ABORTED") throw e;
      norm.polishFailed = (e && e.message) ? String(e.message).slice(0, 200) : "unknown";
    }

    onStage && onStage("正在排版批注与升格范文", 94);
    return norm;
  };

  /* 让润色稿严格落到本年级字数区间 */
  var NL = String.fromCharCode(10);

  /**
   * 让润色稿严格落到本年级字数区间（最多校准 rounds 轮）。
   * @param norm      normalize 产出的结果对象（读 norm.polished）
   * @param ctx       { text, grade, genre, trace }
   * @param useVision 视觉链路没有独立文本 Key 时沿用视觉模型
   * @param signal    AbortSignal，用户停止时能立刻中断
   * @param rounds    最多尝试几轮，默认 2
   * @returns norm（有改进才替换 polished，否则原样返回）
   */
  async function enforceRange(norm, ctx, useVision, signal, rounds) {
    if (!norm || !norm.polished || !Array.isArray(norm.polished.paras) || !norm.polished.paras.length) return norm;

    var g = ZP.getGrade(ctx.grade);
    var minW = g.words[0], maxW = g.words[1];
    var midW = Math.round((minW + maxW) / 2);
    var maxRounds = rounds === undefined ? 2 : rounds;

    /* 距离目标区间还差多少（在区间内为 0） */
    function dist(n) {
      if (n < minW) return minW - n;
      if (n > maxW) return n - maxW;
      return 0;
    }

    for (var r = 0; r < maxRounds; r++) {
      if (signal && signal.aborted) {
        var ab = new Error("已停止");
        ab.code = "ABORTED";
        throw ab;
      }

      var curParas = norm.polished.paras;
      var curText = curParas.join(NL);
      var now = ZP.countChars(ZP.stripTechMarks(curText));
      if (dist(now) === 0) break;                 /* 已在区间内，不必再校准 */

      var target = midW;                          /* 统一收向区间中点 */
      var delta = Math.round(target - now);
      var dirTxt = delta > 0
        ? "请增补约 " + delta + " 字的具体细节（动作、对话、场景或心理），不要加议论。"
        : "请精简约 " + Math.abs(delta) + " 字，优先删去重复表述与空泛议论，保留细节。";

      var ask = "下面这篇升格范文当前 " + now + " 字，" + g.name +
        "要求 " + minW + "–" + maxW + " 字。" + NL +
        dirTxt + NL +
        "请在不改变情节、人物与叙述视角的前提下，使总字数严格落在 " + minW + "–" + maxW + " 字之间。" + NL +
        "★保留原有的 <m1>~<m4> 标记：被标记的片段如果保留，标记必须原样保留；被删掉的片段连同标记一起删。" + NL +
        '输出 JSON：{"title":"标题","paras":["第一段","第二段"]}' + NL +
        "【原文】" + NL + curText;

      var msgs = [
        { role: "system", content: "你是语文教研员，只做字数校准，不改情节与视角。只输出 JSON。" },
        { role: "user", content: ask }
      ];

      /* 视觉直读链路没有独立的文本模型 Key，字数校准沿用视觉模型 */
      var raw = await ZP.chat(msgs, {
        vision: !!useVision, temperature: 0.28, json: true,
        timeout: 120000, maxTokens: 3000,
        signal: signal, trace: ctx.trace, traceLabel: "字数校准"
      });
      /* 被截断时尝试续写，避免整轮白跑 */
      raw = await continueIfTruncated(raw, msgs, 1, false, signal, ctx.trace);

      var paras;
      try {
        var d = ZP.parseJSON(raw) || {};
        paras = (Array.isArray(d.paras) ? d.paras : [])
          .map(function (x) { return String(x).trim(); })
          .filter(Boolean);
        /* 只去掉续写造成的整段重复，保留排比/反复等合法重复 */
        paras = dedupeTailRepeat(paras);
        if (paras.length && !norm.polished.title && d.title) {
          norm.polished.title = String(d.title);
        }
      } catch (e) {
        paras = [];
      }
      if (!paras.length) break;

      var words = ZP.countChars(ZP.stripTechMarks(paras.join("")));

      /* 只有确实更接近目标区间时才采用这一版的改写稿 */
      if (dist(words) >= dist(norm.polished.words)) break;

      norm.polished = {
        title: norm.polished.title,
        words: words,
        paras: paras,
        /* 字数校准只动篇幅，保留首轮产出的润色手法说明 */
        techniques: norm.polished.techniques || []
      };
      norm.inRange = words >= minW && words <= maxW;
      norm.range = g.words;
    }

    return norm;
  }

  /* 换行匹配：用字符码构造，避免源码里出现真实换行 */
  var NEWLINES = new RegExp("[" + String.fromCharCode(10) + String.fromCharCode(13) + "]+");

  /* 校验并规整模型给出的句子位置：0–100 的百分比 */
  function normBox(b) {
    if (!b || typeof b !== "object") return null;
    function num(v) {
      var n = parseFloat(v);
      if (!isFinite(n)) return null;
      return Math.max(0, Math.min(100, n));
    }
    var y = num(b.y), x1 = num(b.x1), x2 = num(b.x2);
    if (y === null) return null;
    if (x1 === null) x1 = 0;
    if (x2 === null) x2 = 100;
    if (x2 < x1) { var t = x1; x1 = x2; x2 = t; }
    if (x2 - x1 < 1) x2 = Math.min(100, x1 + 8);
    return { y: y, x1: x1, x2: x2 };
  }

  /**
   * 图片稿没有正文时，按升格稿体量估算原文字数：
   * 学生原文通常比升格稿略短，取 0.92 并取整到十位。
   */
  function estFromPolished(polParas) {
    var pw = ZP.countChars((polParas || []).join(""));
    return pw > 0 ? Math.round(pw * 0.92 / 10) * 10 : 0;
  }

  /* 结构校验与兜底 */
  function normalize(d, ctx) {
    if (!d || typeof d !== "object") throw new Error("返回结构异常。");
    var g = ZP.getGrade(ctx.grade);
    var pagesTotal = Math.max(1, ctx.pages || 1);

    /* 结构校验：模型没按要求输出时，明确报错而不是生成空报告 */
    var hasDims = Array.isArray(d.dims) && d.dims.length > 0;
    var hasPol = d.polished && Array.isArray(d.polished.paras) && d.polished.paras.length > 0;
    if (!hasDims && !hasPol) {
      var keys = Object.keys(d).slice(0, 8).join("、");
      throw new Error("模型没有按约定的 JSON 结构返回（实际字段：" + (keys || "空") +
        "）。建议换用视觉能力更强的模型，或在「批改功能选项」中降低温度后重试。");
    }

    var dims = ZP.DIMS.map(function (dim) {
      var src = (d.dims || []).find(function (x) { return x && x.key === dim.key; }) || {};
      var sc = Number(src.score);
      if (!isFinite(sc)) sc = 0;
      sc = Math.max(0, Math.min(100, Math.round(sc)));
      return {
        key: dim.key,
        score: sc,
        comment: String(src.comment || "该维度暂无详细说明。").slice(0, 300),
        tagline: String(src.tagline || "").slice(0, 16)
      };
    });

    var weighted = dims.reduce(function (s, x) {
      return s + x.score * (ctx.weights[x.key] || 0);
    }, 0) / 100;
    var score = Math.max(0, Math.min(100, Math.round(weighted)));
    var lv = ZP.levelOf(score, ctx.grade);

    var annList = d.annotations || d.marks || d.comments || [];
    if (!Array.isArray(annList)) annList = [];
    var totalForPage = annList.length;
    var anns = annList.map(function (a, idx) {
      if (!a || typeof a !== "object") return null;
      /* 视觉模型常把 para 输出成 "0"/"第1段"，统一转成整数 */
      var rawPara = a.para !== undefined ? a.para : (a.paragraph !== undefined ? a.paragraph : 0);
      var para = parseInt(String(rawPara).replace(/[^0-9]/g, ""), 10);
      if (!isFinite(para) || para < 0) para = 0;
      var sent = a.sentence || a.text || a.original || a.quote || "";
      sent = String(sent).trim();
      if (!sent) return null;
      return { para: para, sentence: sent, src: a, idx: idx };
    }).filter(Boolean).slice(0, 20).map(function (item) {
      var a = item.src;
      var type = ["red", "amber", "green", "violet"].indexOf(a.type) >= 0 ? a.type : "violet";
      /* 页码：模型给了就用，没给则按段落粗略估算（每 4 段视为一页）。
         图片稿没有正文，段落号全是 0，此时不能再用段落号兜底，
         否则所有批注都会被压到第 1 页；改为按批注序号均分到各页。 */
      var pgRaw = a.page !== undefined ? a.page : (a.pageIndex !== undefined ? a.pageIndex : (a.p ? a.p : ""));
      var pg = parseInt(String(pgRaw).replace(/[^0-9-]/g, ""), 10);
      if (!isFinite(pg) || pg < 0) {
        var totalPages = pagesTotal;
        pg = totalPages > 1 && ZP.countChars(ctx.text || "")
          ? Math.floor(item.para / 4)
          : Math.floor(item.idx * totalPages / Math.max(1, totalForPage));
      }
      if (ctx.pages) pg = Math.min(pg, ctx.pages - 1);

      return {
        para: item.para,
        page: pg,
        sentence: item.sentence.slice(0, 200),
        type: type,
        tag: String(a.tag || { red: "错别字", amber: "润色语句", green: "优秀好句", violet: "修改建议" }[type]),
        note: String(a.note || "").slice(0, 400),
        fix: String(a.fix || "").slice(0, 400),
        /* 模型给出的划线位置（百分比）；缺失或异常时为 null，前端退回按段落估算 */
        box: normBox(a.box)
      };
    });

    var pol = d.polished || {};
    var polParas = (Array.isArray(pol.paras) ? pol.paras : []).map(function (p) { return String(p).trim(); }).filter(Boolean);
    var polText = polParas.join("");
    /* 字数不含 <m1>~<m4> 标记，与界面显示口径一致 */
    var polWords = ZP.countChars(ZP.stripTechMarks(polText));

    var drills = (Array.isArray(d.drills) ? d.drills : []).slice(0, 3).map(function (x, i) {
      return {
        no: i + 1,
        title: String(x.title || "小练笔 " + (i + 1)).slice(0, 40),
        problem: String(x.problem || "").slice(0, 300),
        think: String(x.think || "").slice(0, 300),
        material: String(x.material || "").slice(0, 300),
        task: String(x.task || "").slice(0, 60)
      };
    });

    var ol = d.outline || {};
    function step(key, fallback) {
      var o = ol[key] || {};
      return { title: String(o.title || fallback), text: String(o.text || "") };
    }

    return {
      isDemo: false,
      title: String(pol.title || ctx.title || "作文批改").slice(0, 60),
      student: ctx.student || "未署名",
      meta: g.name + " · " + ctx.genre,
      grade: ctx.grade,
      genre: ctx.genre,
      wordCount: ZP.countChars(ctx.text) || estFromPolished(polParas),
      score: score,
      level: lv.name,
      levelCls: lv.cls,
      dims: dims,
      overall: String(d.overall || "").slice(0, 1200),
      metrics: {
        /* 图片稿没有正文，用升格稿体量估算，避免显示成批注条数 */
        words: ZP.countChars(ctx.text) || estFromPolished(polText ? polText.split("") : polParas),
        paras: ctx.text.trim()
          ? ctx.text.split(NEWLINES).filter(function (s) { return s.trim(); }).length
          : Math.max(3, (polParas || []).length),
        estimated: !ZP.countChars(ctx.text),
        marks: anns.length,
        good: anns.filter(function (a) { return a.type === "green"; }).length
      },
      annotations: anns,
      trace: ctx.trace || [],
      tokens: (function () {
        var t = ctx.trace || [];
        var p = 0, c = 0;
        t.forEach(function (x) { p += x.prompt || 0; c += x.completion || 0; });
        return { prompt: p, completion: c, total: p + c };
      })(),
      paragraphs: ZP.splitParagraphs(ctx.text),
      outline: {
        begin: step("begin", "开头思路"),
        middle: step("middle", "中间思路"),
        end: step("end", "结尾思路")
      },
      /* 具体问题与修改思路：整篇层面的问题归纳，与逐句批注互补 */
      issues: (Array.isArray(d.issues) ? d.issues : []).slice(0, 5).map(function (x, i) {
        x = x || {};
        return {
          no: i + 1,
          problem: String(x.problem || "").slice(0, 200),
          advice: String(x.advice || "").slice(0, 200),
          steps: (Array.isArray(x.steps) ? x.steps : []).slice(0, 5)
            .map(function (t) { return String(t).slice(0, 120); })
            .filter(function (t) { return t.trim(); })
        };
      }).filter(function (x) { return x.problem; }),
      drills: drills,
      polished: {
        title: String(pol.title || ctx.title || ""),
        words: polWords,
        paras: polParas,
        /* 本次改写实际使用的手法，供报告底部展示 */
        techniques: (Array.isArray(pol.techniques) ? pol.techniques : []).slice(0, 8)
      },
      inRange: polWords >= g.words[0] && polWords <= g.words[1],
      range: g.words
    };
  }

  /* 文本切段 */
  ZP.splitParagraphs = function (text) {
    return String(text || "")
      .replace(/\r\n?/g, "\n")
      .split(/\n+/)
      .map(function (s) { return s.trim().replace(/^[\s\u3000]+/, ""); })
      .filter(function (s) { return s.length > 0; });
  };

  /* ---------------- 视觉模型直读 ---------------- */

  /** 构造视觉消息：文本 + 图片（dataURL） */
  function visionMessages(systemText, userText, dataUrl) {
    /* dataUrl 可为单张字符串，或多页数组 */
    var list = Array.isArray(dataUrl) ? dataUrl : [dataUrl];
    var parts = [{ type: "text", text: userText }];
    list.forEach(function (u, i) {
      if (list.length > 1) {
        parts.push({ type: "text", text: "第 " + (i + 1) + " 页：" });
      }
      parts.push({ type: "image_url", image_url: { url: u } });
    });
    return [
      { role: "system", content: systemText },
      { role: "user", content: parts }
    ];
  }

  var FALLBACK_TRANS = "你无法看到图片，只能拿到文字。请先把这篇作文（含标题、段落）完整转录为中文正文，" +
    "保留原文错别字与标点，段落之间用换行分隔。只输出转录正文，不要批改、不要解释、不要加任何前缀。";

  /**
   * 用视觉模型把作文图片转录成文字
   * @returns {{text:string, degraded:boolean}}
   *   degraded=true 表示模型未真正读图（多模态不可用），返回的 text 为空
   */
  ZP.visionTranscribe = async function (dataUrl, onStage) {
    onStage && onStage("视觉模型正在读图", 16);
    var msgs = visionMessages(
      "你是中文 OCR 引擎，只负责逐字转录，不修改、不评价。",
      FALLBACK_TRANS + "\n\n【版面提示】这是学生手写或打印的作文纸，可能有横线格；请按段落还原。",
      dataUrl
    );

    var raw = await ZP.chat(msgs, { vision: true, temperature: 0, timeout: 150000, maxTokens: 2600, noJsonForVision: true });

    var text = String(raw || "")
      .replace(/^```[\s\S]*?\n/, "").replace(/```\s*$/, "")
      .replace(/^(作文转录|转录结果|正文)[:：]\s*/, "")
      .trim();

    /* 近似“我看不到图片”的拒识：没有中文正文或过短视为降级 */
    var han = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    var looksLikeRefusal = /(无法|不能|看不到|未能)(查看|识别|读取|获取).*(图片|图像)/.test(text);
    if (!text || han < 12 || looksLikeRefusal) {
      return { text: "", degraded: true };
    }
    return { text: text, degraded: false };
  };

  /**
   * 输出过长被截断时续写补全。
   * 只补续写、不带图，避免重复消耗；最多 max 次。
   */
  ZP.balanceJSON = function (txt) {
    var s = String(txt || "");
    var i = s.indexOf("{");
    if (i < 0) return s;
    s = s.slice(i).replace(/^```(?:json)?/i, "").replace(/```\s*$/i, "").trim();

    var stack = [], inStr = false, esc = false;
    for (var k = 0; k < s.length; k++) {
      var ch = s[k];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{" || ch === "[") stack.push(ch);
      else if (ch === "}" || ch === "]") stack.pop();
    }
    if (inStr) s += '"';
    s = s.replace(/,\s*$/, "");
    while (stack.length) {
      var open = stack.pop();
      s += (open === "{" ? "}" : "]");
    }
    return s;
  };

  /* JSON 是否已完整闭合：比 finish_reason 更可靠（部分服务商不返回 length） */
  function jsonComplete(txt) {
    var s = String(txt || "");
    var a = s.indexOf("{"); if (a < 0) return false;
    var depth = 0, inStr = false, esc = false;
    for (var i = a; i < s.length; i++) {
      var ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") { depth--; if (depth === 0) return true; }
    }
    return false;
  }

  async function continueIfTruncated(raw, msgs, maxTries, wasTruncated, signal, trace) {
    var text = raw;
    /* 只要 JSON 还没闭合就继续补，不再单看 finish_reason */
    var truncated = !!wasTruncated || !jsonComplete(text);
    for (var i = 0; i < maxTries; i++) {
      if (!truncated) break;
      try {
        var meta = {};
        var more = await ZP.chat(
          msgs.concat([
            { role: "assistant", content: text },
            { role: "user", content: "上一条输出被长度限制截断了。请只输出剩余部分，直接接着上一次的最后一个字符继续，不要重复、不要解释、不要加代码块。" }
          ]),
          {
            vision: true, temperature: 0.18, json: true, timeout: 180000, maxTokens: 6000,
            signal: signal, trace: trace, traceLabel: "续写补全",
            onMeta: function (fin) { meta.finish = fin; }
          }
        );
        var seg = String(more || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
        if (!seg.trim()) break;
        text += seg;
        truncated = !jsonComplete(text);
      } catch (e) { break; }
    }
    return text;
  }

  /**
   * 让视觉模型一次性完成「读图 + 批改」，返回符合日历结构的 JSON
   */
  ZP.gradeWithVision = async function (ctx, onStage) {
    var g = ZP.getGrade(ctx.grade);
    var base = ZP.buildPrompt(ctx);       // 复用同一套规则与 JSON 结构
    var sys = base[0].content;
    var userText = base[1].content
      .replace(/【正文】[\s\S]*?【输出 JSON 结构】/, "【正文】见随附作文图片，请直接从图中读取，不要另行索要文字。\n\n【输出 JSON 结构】");

    userText = "请先在心里逐字读完全图（含标题、分段、修改痕迹），再按下面的规则批改。" +
      "annotations 里的 sentence 必须逐字照抄图片中的原句，这样前端才能准确画线。" +
      "\n\n【最重要：给每条批注标位置】\n" +
      "每条 annotations 都要额外带 box 字段，用百分比描述这句原话在图片上的位置（原点在左上角）：" +
'  \"box\": { \"y\": 数字, \"x1\": 数字, \"x2\": 数字 }' +
      "其中 y = 该行文字的垂直中心占整图高度的百分比（0 顶 / 100 底）；" +
      "x1 = 该句横向开始位置占整图宽度的百分比；x2 = 该句横向结束位置占整图宽度的百分比。" +
      "估法：先数这句话在第几行，用「行序号 ÷ 总行数」估 y；再按句中首字、末字在行内的位置估 x1、x2。" +
      "y 必须落在正确的行上，误差不超过一行。\n\n" +
      "【硬性要求：每条批注必须标 page】\n" +
      "page = 这句话所在的页序号，从 0 开始（第 1 页 = 0，第 2 页 = 1，第 3 页 = 2）。" +
      "必须严格按该句实际出现在哪一页来填，不允许省略、不允许全部填 0。" +
      "若某页没有可批注的句子，该页就不出批注；但每页的批注都必须落在它自己的页码上。\n\n" +
      "【输出前自检】\n" +
      "逐页清点：第 1 页几条、第 2 页几条、第 3 页几条……" +
      "确认每条批注的 page 与它实际所在的页一致，且批注顺序与原文页码顺序一致。" + userText;

    onStage && onStage("视觉模型正在读图并批改", 30);
    var vmsgs = visionMessages(sys, userText, ctx.imageDataUrl);
    var trunc = false;
    /* 视觉批改要一次吐出一万字左右的 JSON，给足时间；
       超时不直接判死，下面会尝试“续写补全”已产出的部分 */
    var raw = await ZP.chat(vmsgs, {
      vision: true, json: true, timeout: 290000, maxTokens: 8000,
      signal: ctx.signal, trace: ctx.trace, traceLabel: "读图批改",
      onMeta: function (fin) { trunc = fin === "length"; }
    });

    /* 输出被截断时自动续写，直到 JSON 闭合（最多续 2 次） */
    raw = await continueIfTruncated(raw, vmsgs, 3, trunc, ctx.signal, ctx.trace);

    onStage && onStage("正在生成四维评分与批注", 74);
    var data = ZP.parseJSON(raw);
    var norm = normalize(data, ctx);

    /* 第二阶段：单独生成升格范文；失败不影响主批改结果 */
    try {
      if (ctx.signal && ctx.signal.aborted) throw Object.assign(new Error("已停止"), { code: "ABORTED" });
      var pol = await ZP.polishEssay({
        text: ctx.text, grade: ctx.grade, genre: ctx.genre, isVision: true, trace: ctx.trace
      }, norm, onStage, ctx.signal);
      if (pol) {
        norm.polished = pol;
        norm.inRange = pol.words >= ZP.getGrade(ctx.grade).words[0] &&
                       pol.words <= ZP.getGrade(ctx.grade).words[1];
      } else {
        /* 拿不到原文（批注也没有句子）时生成不了范文：标记一下，界面上给出可执行提示，
           不再静默留空让老师以为是模型没写 */
        norm.polishFailed = "no_source";
      }
    } catch (e) {
      if (e && e.code === "ABORTED") throw e;
      /* 第二阶段失败不影响主批改，但要记录原因，报告里明确告知 */
      norm.polishFailed = (e && e.message) ? String(e.message).slice(0, 200) : "unknown";
    }

    onStage && onStage("正在整理批注与报告", 92);

    /* 图片稿没有正文文本：按批注的段落号还原段数，按升格稿估算原文字数 */
    if (!ZP.countChars(ctx.text || "")) {
      var maxPara = 0;
      (norm.annotations || []).forEach(function (a) {
        if (typeof a.para === "number" && a.para + 1 > maxPara) maxPara = a.para + 1;
      });
      /* 段落数：批注段落号 + 升格稿段数都要计入，避免出现「1 段」这种明显失真 */
      var polParas = (norm.polished && norm.polished.paras) ? norm.polished.paras.length : 0;
      var estParas = Math.max(maxPara, polParas, 3);

      /* 原文通常略短于升格稿，按 0.92 估算并取整到十位 */
      var polWords = ZP.countChars(ZP.stripTechMarks((norm.polished && norm.polished.paras || []).join("")));
      var estWords = polWords > 0 ? Math.round(polWords * 0.92 / 10) * 10 : 0;

      norm.metrics = norm.metrics || {};
      norm.metrics.words = estWords;
      norm.metrics.paras = estParas;
      norm.metrics.estimated = true;
      norm.wordCount = estWords;
    }
    norm.source = "vision";
    return norm;
  };

  /**
   * 判断报错是否属于「模型不支持图片输入」
   * 覆盖常见中英文表述，便于给出「换 VL 模型」的明确引导
   */
  /* 第二阶段：单独生成升格范文（避免与批注争抢输出额度） */
  ZP.polishEssay = async function (ctx, norm, onStage, signal) {
    var g = ZP.getGrade(ctx.grade);

    var src = (ctx.text || "").trim();
    if (!src) {
      var byPara = {};
      (norm.annotations || []).forEach(function (a) {
        (byPara[a.para] = byPara[a.para] || []).push(a.sentence);
      });
      src = Object.keys(byPara).sort(function (x, y) { return x - y; })
        .map(function (k) { return byPara[k].join(""); }).join(NL);
    }
    if (!src) return null;

    var ask = [
      "【任务】把下面这篇" + g.name + ctx.genre + "改写成一篇升格范文。",
      "要求：",
      "1) 保留学生的原意、人物与事件，不换题材、不生造情节；",
      "2) 补足细节与五感描写，删掉空泛议论，让画面更具体；",
      "3) 字数严格落在 " + g.words[0] + "-" + g.words[1] + " 字之间，分 4-6 段；",
      "4) 语言符合" + g.name + "水准，不生硬、不堆砌辞藻；",
      "5) 同时说明本次改写在哪些地方动了手，每条一条要点，为教师讲评提供依据；",
      "6) ★为了让教师一眼看出重点描写方法，在正文中用行内标记标出改写片段（详见下方标记规则）。",
      "",
      "【重点标记规则】正文 paras 里用以下四个标签包裹「本次改写过的、体现某类手法」的片段：",
      "   <m1>…</m1>  动作 / 细节描写（具体的动作、神态、物件细节）",
      "   <m2>…</m2>  感官描写（听觉、触觉、嗅觉、味觉、视觉色彩）",
      "   <m3>…</m3>  修辞手法（比喻、拟人、排比、反复等）",
      "   <m4>…</m4>  议论改叙述 / 点题（把空泛议论换成具体落点，或首尾照应）",
      "   · 只标真正改写过的片段，每段 0–2 处，全篇 6–10 处，不要通篇满标；",
      "   · 一个片段只用一个标签，不要把同一句同时套两层标签；",
      "   · 标签外侧正常写标点，标签内只包文字本身；",
      "   · 例：<m3>红叉像一排小旗子</m3>、<m2>暖气管咕噜响了一声</m2>、<m1>笔尖把纸压出浅浅的印子</m1>；",
      "   · 除这四个标签外，正文中不得出现任何其他尖括号或 HTML 标签。",
      "",
      "【润色手法 techniques】列出本篇实际用到的润色手法，3–6 条，每条单独一个对象：",
      "   · mark：该手法对应的标记，只能是 m1 / m2 / m3 / m4 之一（与正文标签一一对应）；",
      "   · text：手法 + 具体落点的说明，15–40 字，先点手法名，再说改在哪里、产生了什么效果；",
      "   · 必须指向本篇真实发生过的改动，不能写套话（如「语言更优美」）；",
      "   · 不要写「本文」「学生」之类的评论口吻，只陈述改写了什么；",
      "   · 同一种 mark 最多一条，四个 mark 能覆盖时尽量覆盖。",
      "",
      '7) 只输出 JSON：{"title":"标题","paras":["含标记的段落"],"techniques":[{"mark":"m1","text":"手法说明"}]}',
      "",
      "【学生原文】",
      src
    ].join(NL);

    onStage && onStage("正在生成升格范文", 88);
    var msgs = [
      { role: "system", content: "你是语文教研员，擅长把学生习作改写成同龄优秀范文。只输出 JSON。" },
      { role: "user", content: ask }
    ];
    /* 升格稿本身 450–950 字，加上 <m1>~<m4> 标记与 techniques 说明，
       4200 的额度在长作文上容易被截断，放宽到 6000 */
    var raw = await ZP.chat(msgs, {
      vision: !!ctx.isVision, temperature: 0.5, json: true,
      timeout: 180000, maxTokens: 6000, signal: signal,
      trace: ctx.trace, traceLabel: "生成范文"
    });
    /* 被截断时续写；给到 3 轮，长稿也能补全 */
    raw = await continueIfTruncated(raw, msgs, 3, false, signal, ctx.trace);

    /* 解析：先按严格 JSON；失败时从残缺文本里抢救段落，
       避免「续写未救回」就整篇丢掉，导致报告里范文为空 */
    var d = null;
    try {
      d = ZP.parseJSON(raw);
    } catch (e) {
      d = salvagePolished(raw);
      if (d) console.warn("[升格范文] JSON 不完整，已按残文抢救段落：", (e && e.message || "").slice(0, 80));
    }
    d = d || {};
    var paras = [];
    (Array.isArray(d.paras) ? d.paras : []).forEach(function (x) {
      var t = String(x).trim();
      if (!t) return;
      paras.push(t);            /* 不做全文去重：排比/反复本就允许重复 */
    });
    paras = dedupeTailRepeat(paras);
    if (!paras.length) return null;

    /* 兼容两种返回：对象 {mark,text} 或旧版纯字符串；统一成 {mark,text} */
    var validMark = { m1: 1, m2: 1, m3: 1, m4: 1 };
    var techniques = (Array.isArray(d.techniques) ? d.techniques : [])
      .map(function (t) {
        if (t && typeof t === "object") {
          var mk = String(t.mark || "").toLowerCase().trim();
          return { mark: validMark[mk] ? mk : "", text: String(t.text || "").trim().slice(0, 80) };
        }
        return { mark: "", text: String(t || "").trim().slice(0, 80) };
      })
      .filter(function (t) { return t.text; })
      .slice(0, 8);

    var out = {
      title: String(d.title || norm.title || "升格范文"),
      words: ZP.countChars(ZP.stripTechMarks(paras.join(""))),
      paras: paras,
      techniques: techniques
    };

    /* 字数校准：模型常偏离本年级区间，这里按需增删细节把它收进去（最多 2 轮）。
       失败或没有改进时保持首轮结果，不影响主批改。 */
    try {
      var box = { polished: out, inRange: false, range: g.words };
      await enforceRange(box, ctx, !!ctx.isVision, signal, 2);
      if (box.polished && box.polished.paras && box.polished.paras.length) {
        out = box.polished;
        /* 校准可能改动段落结构与标记，techniques 需与正文标记对齐：只保留正文里还存在的 mark */
        var body = out.paras.join(NL);
        out.techniques = (out.techniques || []).filter(function (t) {
          return !t.mark || body.indexOf("<" + t.mark + ">") >= 0;
        });
      }
    } catch (e) {
      if (e && e.code === "ABORTED") throw e;
      /* 校准失败：保留首轮范文，只记录，不打断流程 */
      if (window.console) console.warn("[字数校准] 未执行成功，保留首轮范文：", (e && e.message || "").slice(0, 100));
    }

    return out;
  };

  /**
   * 去掉「续写造成的整段重复」，但保留合法的重复段落（排比、反复等写作手法）。
   * 只处理两种形态：整体「P + P」，以及尾部重复了开头若干整段。
   * 不做全文 set 去重——那会把刻意重复的段落也删掉。
   */
  function dedupeTailRepeat(list) {
    var a = (list || []).slice();
    if (a.length < 4) return a;

    /* 整体「P + P」：删掉后半 */
    if (a.length % 2 === 0) {
      var half = a.length / 2, same = true;
      for (var i = 0; i < half; i++) {
        if (a[i] !== a[half + i]) { same = false; break; }
      }
      if (same) return a.slice(0, half);
    }
    /* 尾部重复了开头若干整段：只删尾部那段副本 */
    var SEP = String.fromCharCode(1);
    for (var cut = 1; cut < a.length; cut++) {
      var tail = a.slice(cut);
      if (tail.length >= 2 && tail.length < a.length &&
          a.slice(0, tail.length).join(SEP) === tail.join(SEP)) {
        return a.slice(0, cut);
      }
    }
    return a;
  }

  /**
   * 从残缺的 JSON 文本里抢救升格范文。
   * 场景：模型输出被 max_tokens 截断、续写也没补全，严格解析会整体失败。
   * 做法：逐个匹配字符串字面量，跳过 title/techniques 等非正文键，只收正文段落。
   */
  function salvagePolished(raw) {
    var s = String(raw || "");
    var out = { title: "", paras: [], techniques: [] };
    var ti = s.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (ti) out.title = ti[1];

    var pi = s.indexOf('"paras"');
    var seg = pi >= 0 ? s.slice(pi) : s;
    /* 到 techniques 为止，避免把手法说明混进正文 */
    var cut = seg.indexOf('"techniques"');
    if (cut > 0) seg = seg.slice(0, cut);

    var re = /"((?:[^"\\]|\\.)*)"/g, m;
    while ((m = re.exec(seg))) {
      var t = m[1].replace(/\\n/g, "").replace(/\\"/g, '"').trim();
      if (!t) continue;
      if (t === "paras" || t === "title" || t === "techniques") continue;
      /* 段落至少 8 个字才收，过滤零碎键值 */
      if (t.replace(/<\/?(?:m1|m2|m3|m4)>/g, "").length < 8) continue;
      out.paras.push(t);
    }
    out.paras = dedupeTailRepeat(out.paras);
    return out.paras.length ? out : null;
  }

  ZP.isUnsupportedImageError = function (msg) {
    var m = String(msg || "");
    if (!m) return false;
    var EN = [/does not support/i, /doesn't support/i, /not support/i, /unsupported/i, /invalid request/i];
    var TARGET = /(image|images|vision|multimodal|content type)/i;
    var CN = /(不支持|无法处理|不能处理|无法识别).*(图片|图像|多模态|视觉)/;
    var KW = /(image_url|image input|multimodal|vision model|多模态模型|图片输入)/i;
    var hitEn = EN.some(function (re) { return re.test(m); }) && TARGET.test(m);
    return hitEn || CN.test(m) || KW.test(m);
  };

  /** 视觉模型是否可用（有 Key 且有模型名） */
  ZP.hasVision = function () {
    var key = (ZP.config.visionKey || "").trim() || (ZP.config.key || "").trim();
    var base = (ZP.config.visionBase || "").trim() || (ZP.config.base || "").trim();
    var model = (ZP.config.visionModel || "").trim() || (ZP.config.model || "").trim();
    return !!(key && base && model);
  };

  /* 原稿图片压缩：长边 1600px，兼顾识别精度与请求体积 */
  ZP.compressForVision = async function (dataUrl, maxSideOpt) {
    var img = await loadImage(dataUrl);
    /* 多页时单页分辨率下调，控制整体请求体积（3 页 × 1600px 会明显拖慢） */
    var maxSide = maxSideOpt || 1600;
    var scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale >= 0.999) return dataUrl;
    var cv = document.createElement("canvas");
    cv.width = Math.round(img.naturalWidth * scale);
    cv.height = Math.round(img.naturalHeight * scale);
    var c = cv.getContext("2d");
    c.fillStyle = "#fff";
    c.fillRect(0, 0, cv.width, cv.height);
    c.imageSmoothingQuality = "high";
    c.drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/jpeg", 0.9);
  };

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error("原稿图片无法读取。")); };
      im.src = src;
    });
  }

  /* ---------------- 本地 OCR ---------------- */
  ZP.ocrImage = async function (dataUrl, onStage) {
    var base = (ZP.config.ocr || "").trim().replace(/\/+$/, "");
    if (!base) throw new Error("未配置本地 OCR 地址。");

    onStage && onStage("正在连接本地 OCR", 12);
    var b64 = String(dataUrl).split(",")[1] || "";

    // 兼容常见部署：PaddleOCR /ocr、/predict、/api/ocr
    var paths = ["/ocr", "/predict", "/api/ocr", "/v1/ocr"];
    var lastErr = null;
    for (var i = 0; i < paths.length; i++) {
      try {
        var res = await fetch(base + paths[i], {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: b64, img: b64, use_gpu: false })
        });
        if (!res.ok) { lastErr = new Error("OCR 服务返回 " + res.status); continue; }
        var j = await res.json();
        var txt = pickText(j);
        if (txt) {
          onStage && onStage("已识别作文文字", 34);
          return txt;
        }
        lastErr = new Error("OCR 返回中没有文本字段。");
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error((lastErr && lastErr.message ? lastErr.message : "OCR 请求失败") +
      "；请确认本地服务已启动，且地址与路由正确。");
  };

  function pickText(j) {
    if (!j) return "";
    if (typeof j === "string") return j;
    if (Array.isArray(j)) {
      return j.map(function (x) {
        if (typeof x === "string") return x;
        if (Array.isArray(x)) return x[1] && Array.isArray(x[1]) ? x[1][0] : "";
        return x.text || x.transcription || "";
      }).join("\n");
    }
    if (typeof j.text === "string") return j.text;
    if (typeof j.result === "string") return j.result;
    if (Array.isArray(j.result)) {
      return j.result.map(function (r) {
        if (typeof r === "string") return r;
        if (Array.isArray(r) && r[1]) return r[1][0] || "";
        return r.text || "";
      }).join("\n");
    }
    if (j.data) return pickText(j.data);
    if (Array.isArray(j.lines)) {
      return j.lines.map(function (l) { return l.text || l.transcription || ""; }).join("\n");
    }
    return "";
  }

  ZP.testOCR = async function () {
    var base = (ZP.config.ocr || "").trim().replace(/\/+$/, "");
    if (!base) throw new Error("请先填写本地 OCR 服务地址。");
    var res = await fetch(base + "/health", { method: "GET" });
    if (!res.ok) throw new Error("服务未就绪（" + res.status + "）");
    return true;
  };

  /* ---------------- 图片压缩 ---------------- */
  /**
   * 读取文件 → 压缩 → 返回 { dataUrl, width, height, size, name }
   * 长边限制 1800px，质量 0.86，兼顾 OCR 精度与上传速度
   */
  ZP.compressImage = function (file, opt) {
    opt = opt || {};
    var maxSide = opt.maxSide || 1800;
    var quality = opt.quality || 0.86;

    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) {
        reject(new Error("请选择图片文件（JPG / PNG / WEBP）。"));
        return;
      }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, maxSide / Math.max(w, h));
        var tw = Math.round(w * scale), th = Math.round(h * scale);

        var cv = document.createElement("canvas");
        cv.width = tw; cv.height = th;
        var ctx = cv.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, tw, th);
        ctx.drawImage(img, 0, 0, tw, th);

        var dataUrl = cv.toDataURL("image/jpeg", quality);
        var bytes = Math.round((dataUrl.length - "data:image/jpeg;base64,".length) * 0.75);
        URL.revokeObjectURL(url);
        resolve({
          dataUrl: dataUrl,
          width: tw,
          height: th,
          size: bytes,
          originSize: file.size,
          name: file.name || "作文.jpg"
        });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("图片读取失败，请换一张图片。"));
      };
      img.src = url;
    });
  };

  ZP.fmtSize = function (b) {
    if (!b && b !== 0) return "—";
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + " KB";
    return (b / 1024 / 1024).toFixed(1) + " MB";
  };
})(window.ZP);
