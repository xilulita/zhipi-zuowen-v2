# 智批作文 · AI 批改逻辑技术文档

> 本文档完整记录「智批作文」的 AI 批改实现，可直接移植到其他 AI 应用。
> 所有提示词均为生产环境实际使用版本，非示意。

---

## 一、设计目标与核心结论

| 目标 | 做法 | 效果 |
|---|---|---|
| 批改要快 | 关闭深度思考 + 两阶段拆分 | 3 页原稿 72–84 秒，文本稿 10–20 秒 |
| 输出要稳 | 强制 JSON + 截断续写 | 长 JSON（上万字符）不断裂 |
| 内容要能用 | 明确 note/fix 字数与写法约束 | 批注可直接照着改 |
| 位置要准 | 视觉模型直接输出百分比坐标 | 无需 OCR，批注能画到原图对应行 |

### 三条最重要的经验

1. **关闭深度思考（thinking）是最大的提速项**。豆包 `thinking:{type:"disabled"}`，批改从 80 秒量级降到 10 秒量级。
2. **千万不要让模型一次写完全部内容**。评分、批注、思路、练笔、升格范文放在同一次请求里，必然被 `max_tokens` 截断，或被模型为省字数而写得很敷衍。拆成两阶段即可解决。
3. **长 JSON 必须有续写兜底**。只判断 `finish_reason === "length"` 不够，要判断 **JSON 是否闭合**（括号配平）。

---

## 二、整体流程

```
用户上传原稿（图片 1~N 页 / 或粘贴正文）
        │
        ▼
┌─────────────────────────────────────┐
│ 阶段一：结构化批改                    │
│  输入：年级 + 体裁 + 四维权重 + 正文   │
│  输出：评分 / 批注 / 思路 / 练笔       │
│  polished 字段留空 {}                 │
└─────────────────────────────────────┘
        │  normalize() 归一化
        ▼
┌─────────────────────────────────────┐
│ 阶段二：升格范文（独立请求）           │
│  输出：{ title, paras[] }             │
│  失败不影响阶段一结果                 │
└─────────────────────────────────────┘
        │
        ▼
   合成为最终报告对象 → 渲染
```

**为什么分两阶段**：模型输出有硬上限。阶段一要吐 8–14 条批注，每条 40–90 字说明加 25–80 字例句，加上总评、思路、三道练笔，轻松超过 6000 tokens；再塞一篇 500 字范文必然被截断。

---

## 三、阶段一：结构化批改

### 3.1 请求参数

```javascript
{
  model: "doubao-seed-2-1-pro-260915",   // 视觉批改用带视觉能力的模型
  messages: [...],
  temperature: 0.25,                      // 视觉 0.25 / 文本 0.35，低温度保证 JSON 稳定
  response_format: { type: "json_object" },
  max_completion_tokens: 8000,            // 视觉 8000 / 文本 6500
  thinking: { type: "disabled" },         // ★ 关键：关闭深度思考
  timeout: 290000                         // 视觉批改给足时间
}
```

**兼容性处理**（不同服务商支持度不同）：

```javascript
// 不支持 response_format 时，自动去掉该参数重发
// 不支持 thinking 时，自动去掉该参数重发
// 视觉模型不认 max_completion_tokens 时，回退成 max_tokens
```

### 3.2 System Prompt

```
你是一位有 20 年经验的小学语文教研员，长期负责{年级}作文阅卷与讲评。
你的批改必须具体、可操作：每一条意见都要指向原文里的某个词或某句话，禁止空泛套话。
你只输出 JSON，不输出任何解释性文字、不使用 Markdown 代码块。
```

作用：定角色、给约束、禁废话。最后一句防止模型在 JSON 前后加"好的，以下是……"。

### 3.3 User Prompt 完整结构

按以下顺序组织，每一段都有明确作用：

```
【任务】批改下面这篇{年级}{体裁}，并按指定 JSON 结构输出。

【年级写作要求】
1. 内容具体，感情真实，有自己的感受
2. 分段表述，层次清楚，详略得当
3. 语句通顺，用词准确，尝试多种修辞
4. 书写规范，标点正确，错别字少
字数要求：450–550 字（润色稿必须严格落在该区间）。
评分口径：五年级按"内容具体 + 感情真实 + 分段清楚"三条硬线评：
         只写概括不写细节的，内容分不超过 70%；
         详略平均用力的，结构分不超过 75%。

【四维评分】总分 100，四维权重固定如下，各维度得分按该维度满分折算为百分制（0–100 的整数）：
- content（内容立意，权重 30 分）：主题是否明确、立意是否深刻、素材是否贴合题意；本年级要求：中心明确，选材具体，有真实感受
- structure（结构逻辑，权重 25 分）：段落安排是否合理、层次是否清晰、详略是否得当；本年级要求：段落清晰，有详有略，首尾呼应
- language（语言表达，权重 25 分）：用词是否准确生动、句式是否有变化；本年级要求：用词准确生动，有细节与修辞意识
- norm（规范书写，权重 20 分）：错别字、标点、书写规范；本年级要求：错别字控制在 2 处以内，标点规范
加权总分 = Σ(维度得分 × 权重 ÷ 100)，四舍五入取整。
等级：≥85 为一类文，72–84 为二类文，<72 为三类文。

【批注要求】
1) 逐句定位：annotations 中 para 为段落序号（从 0 开始），
   sentence 为该段中要批注的句子原文（需与正文完全一致，便于前端定位）。
   若输入包含多页原稿图片，还必须给出 page 字段：
   该句所在的页序号（第 1 页 = 0，第 2 页 = 1，以此类推）。
2) type 只能是 red（错别字/病句）、amber（润色后语句）、green（优秀好句）、violet（修改建议）之一。
3) 每类至少 1 条，总数 8–14 条；red 必须指出错在哪里、正确写法；green 要说明好在哪里（手法+效果）。

4) ★amber（润色语句）与 violet（修改建议）必须写足、写具体，禁止空泛提示：
   · note（说明）：40–90 字，要说清「原句问题在哪 + 为什么这样改更好」，可指出手法（比喻/动作/感官/节奏）。
   · fix（改写示例）：必须给出一句完整的、可直接替换进原文的改写句，25–80 字；
     改写要贴合学生原有情境，不得空泛，也不得只写「可更生动」「补充细节」这类废话。
   · 示例格式：note="原句只有视觉描写，缺少声音；补上听觉能让画面立体"，
     fix="风一吹，树叶沙沙地响，像有人在远处轻轻翻书。"
   · 每条 amber/violet 都要做到「照着 fix 就能直接替换原文」。

5) ★red（错别字/病句）的 fix 只给「正确写法」，不要写整句范文：
   · 错别字：只写正确的那个字或词 + 可选拼音，如 fix="应运题 → 应用题（yìng yòng tí）"，不超过 20 字；
   · 病句：给出修正后的原句本身（可保留原句结构，只改错处），不超过 40 字；
   · 不要出现「改写例句」「可以改成」之类的前缀，直接给结果。
   · green（优秀好句）的 fix 为空串。

【小练笔】3 道题，每题精简，必须针对本文真实存在的短板，
分别在描写手法、表达手法、修辞手法、感官描写、环境描写中选择不同角度切入；
problem 指出文中具体缺陷；think 给可执行的写作路径；
material 给 2–3 条可直接借用的素材或句式；task 给字数与硬性限制。

【润色稿】本次不输出润色稿（polished 留空对象 {}），润色稿会单独生成，以保证批注写足。

【正文】
{学生作文正文，或"见随附作文图片"}

【输出 JSON 结构】严格按此结构，不要增删顶层字段：
{ ...完整 JSON Schema 见 3.4... }
```

### 3.4 输出 JSON 结构

```json
{
  "score": 0,
  "level": "一类文|二类文|三类文",
  "dims": [
    { "key": "content", "score": 0, "comment": "80字以内，指出具体问题", "tagline": "8字内概括" }
  ],
  "overall": "总评 180–260 字，分 2–3 段，用 \\n\\n 分段；先肯定具体优点，再指出 2 个核心问题，最后给一条可执行的改进路径",
  "annotations": [
    {
      "para": 0,
      "page": 0,
      "sentence": "原文句子",
      "box": { "y": 0, "x1": 0, "x2": 0 },
      "type": "red|amber|green|violet",
      "tag": "错别字|病句|润色语句|优秀好句|修改建议",
      "note": "40-90字：问题在哪+为何这样改",
      "fix": "amber/violet 给25-80字可直接替换的改写句；red 只给正确写法（≤20字）"
    }
  ],
  "outline": {
    "begin": { "title": "开头思路", "text": "120字以内" },
    "middle": { "title": "中间思路", "text": "150字以内" },
    "end": { "title": "结尾思路", "text": "120字以内" },
    "keys": ["写作关键 4 条，每条 40 字以内"]
  },
  "drills": [
    { "no": 1, "title": "题目", "problem": "对应问题", "think": "思路引导", "material": "素材示例", "task": "任务要求" }
  ],
  "polished": {}
}
```

**做法要点**：把 JSON 结构用 `JSON.stringify(schema, null, 2)` 直接嵌进提示词，比用文字描述字段更可靠。

---

## 四、视觉直读：让模型直接给坐标

这是"批注能画回原图"的关键，**不需要 OCR**。

### 4.1 追加到 User Prompt 的位置说明

```
请先在心里逐字读完全图（含标题、分段、修改痕迹），再按下面的规则批改。
annotations 里的 sentence 必须逐字照抄图片中的原句，这样前端才能准确画线。

【最重要：给每条批注标位置】
每条 annotations 都要额外带 box 字段，用百分比描述这句原话在图片上的位置（原点在左上角）：
  "box": { "y": 数字, "x1": 数字, "x2": 数字 }
其中 y  = 该行文字的垂直中心占整图高度的百分比（0 顶 / 100 底）；
     x1 = 该句横向开始位置占整图宽度的百分比；
     x2 = 该句横向结束位置占整图宽度的百分比。
估法：先数这句话在第几行，用「行序号 ÷ 总行数」估 y；再按句中首字、末字在行内的位置估 x1、x2。
y 必须落在正确的行上，误差不超过一行。

【硬性要求：每条批注必须标 page】
page = 这句话所在的页序号，从 0 开始（第 1 页 = 0，第 2 页 = 1，第 3 页 = 2）。
必须严格按该句实际出现在哪一页来填，不允许省略、不允许全部填 0。
若某页没有可批注的句子，该页就不出批注；但每页的批注都必须落在它自己的页码上。

【输出前自检】
逐页清点：第 1 页几条、第 2 页几条、第 3 页几条……
确认每条批注的 page 与它实际所在的页一致，且批注顺序与原文页码顺序一致。
```

### 4.2 多图消息格式

OpenAI 兼容协议的 vision 消息，多页原稿逐张附带并标注页码：

```javascript
function visionMessages(systemText, userText, dataUrls) {
  var list = Array.isArray(dataUrls) ? dataUrls : [dataUrls];
  var parts = [{ type: "text", text: userText }];
  list.forEach(function (url, i) {
    if (list.length > 1) parts.push({ type: "text", text: "第 " + (i + 1) + " 页：" });
    parts.push({ type: "image_url", image_url: { url: url } });
  });
  return [
    { role: "system", content: systemText },
    { role: "user", content: parts }
  ];
}
```

### 4.3 图片预压缩分档

页数越多，单页分辨率越低，控制总 token：

| 页数 | 长边上限 |
|---|---|
| 1 页 | 1600px |
| 2–3 页 | 1280px |
| 4 页以上 | 1100px |

---

## 五、输出截断的三层兜底

长 JSON 输出必须有防护，这是最容易被忽略的一环。

### 第一层：判断 JSON 是否闭合

```javascript
// 不能只看 finish_reason === "length"，要检测 JSON 是否真的闭合
function jsonComplete(txt) {
  var s = String(txt || "");
  var a = s.indexOf("{"); if (a < 0) return false;
  var depth = 0, inStr = false, esc = false;
  for (var i = a; i < s.length; i++) {
    var ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;      // 处理 \" 这类转义
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") { depth--; if (depth === 0) return true; }
  }
  return false;
}
```

要点：
- 只统计字符串之外的括号，避免把正文里的 `{` `}` 当成结构
- `depth` 归零即视为闭合，立即返回（不必扫完全文）
- 从第一个 `{` 开始扫，容忍模型在 JSON 前多写了说明文字

### 第二层：续写

```javascript
async function continueIfTruncated(raw, msgs, maxTries, wasTruncated, signal) {
  var text = raw;
  var truncated = !!wasTruncated || !jsonComplete(text);

  for (var i = 0; i < maxTries; i++) {
    if (!truncated) break;
    var more = await chat(
      msgs.concat([
        { role: "assistant", content: text },
        { role: "user", content:
          "上一条输出被长度限制截断了。请只输出剩余部分，" +
          "直接接着上一次的最后一个字符继续，不要重复、不要解释、不要加代码块。" }
      ]),
      { temperature: 0.18, maxTokens: 6000 }
    );
    // 去掉可能被加上的代码围栏
    var seg = String(more).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    if (!seg.trim()) break;
    text += seg;
    truncated = !jsonComplete(text);
  }
  return text;
}
```

**关键点**：
- 续写时把已输出内容作为 `assistant` 消息回传，模型才知道从哪里接
- 续写温度调低（0.18），保证衔接连贯
- 明确禁止"不要重复"，否则模型会把前面内容重写一遍

### 第三层：解析容错 + 括号补齐

```javascript
function parseJSON(raw) {
  if (!raw) throw new Error("模型返回为空。");
  var s = String(raw).trim()
    .replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  var v = tryParse(s);
  if (v) return v;

  // 截取首个 { 到末个 } 之间（容忍 JSON 前后有说明文字）
  var a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) {
    v = tryParse(s.slice(a, b + 1));
    if (v) return v;
    // 去掉尾随逗号后重试
    v = tryParse(s.slice(a, b + 1).replace(/,\s*([}\]])/g, "$1"));
    if (v) return v;
  }

  // 被截断：补齐未闭合的字符串与括号后再试
  if (a >= 0) {
    var fixed = balanceJSON(s);
    v = tryParse(fixed) || tryParse(fixed.replace(/,\s*([}\]])/g, "$1"));
    if (v) return v;
  }

  // 不静默吞错：把真实开头带出来，便于定位
  var head = s.slice(0, 80).replace(/\s+/g, " ");
  throw new Error("模型返回的结果不是完整 JSON，无法解析。开头为：「" + head + "…」");
}
```

**括号补齐**（应对硬截断的最后一道防线）：

```javascript
function balanceJSON(txt) {
  var s = String(txt || "");
  var i = s.indexOf("{"); if (i < 0) return s;
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
  if (inStr) s += '"';                       // 补齐未闭合的字符串
  s = s.replace(/,\s*$/, "");                // 去掉尾部逗号
  while (stack.length) {                     // 按栈逆序补齐括号
    var open = stack.pop();
    s += (open === "{" ? "}" : "]");
  }
  return s;
}
```

**注意**：补齐只能救回结构化程度高的截断（如批注数组写到一半）。如果截断发生在关键字段中间，补出来的内容可能语义不完整——所以续写（第二层）才是主手段，补齐是兜底。

**错误信息要可操作**：不要只抛「解析失败」，要把模型返回的开头 80 字符带出来，便于判断是模型没按格式输出，还是被截断。

---

## 六、阶段二：升格范文

### 6.1 请求

```javascript
{
  temperature: 0.5,          // 比阶段一高，需要一定创造性
  max_completion_tokens: 4200,
  timeout: 180000
}
```

### 6.2 提示词

```
【任务】把下面这篇{年级}{体裁}改写成一篇升格范文。
要求：
1) 保留学生的原意、人物与事件，不换题材、不生造情节；
2) 补足细节与五感描写，删掉空泛议论，让画面更具体；
3) 字数严格落在 450-550 字之间，分 4-6 段；
4) 语言符合五年级水准，不生硬、不堆砌辞藻；
5) 只输出 JSON：{"title":"标题","paras":["第一段","第二段"]}

【学生原文】
{原文}
```

System：
```
你是语文教研员，擅长把学生习作改写成同龄优秀范文。只输出 JSON。
```

### 6.3 图片稿的处理

图片稿没有直接可用的正文文本，需要用批注的 `sentence` 按段落重建：

```javascript
var src = ctx.text.trim();
if (!src) {
  var byPara = {};
  norm.annotations.forEach(function (a) {
    (byPara[a.para] = byPara[a.para] || []).push(a.sentence);
  });
  src = Object.keys(byPara).sort(byNum).map(function (k) {
    return byPara[k].join("");
  }).join("\n");
}
```

### 6.4 失败不影响主流程

```javascript
try {
  var pol = await polishEssay(...);
  if (pol) norm.polished = pol;
} catch (e) {
  if (e.code === "ABORTED") throw e;   // 用户主动停止要透传
  /* 其他异常：范文失败不影响批改结果 */
}
```

---

## 七、结果归一化（normalize）

模型输出不能直接信，必须做归一化。

### 7.1 类型与数值容错

```javascript
// para 可能是 "0"、"第1段"、"1."
var para = parseInt(String(rawPara).replace(/[^0-9]/g, ""), 10);
if (!isFinite(para) || para < 0) para = 0;

// type 不在枚举内就归到 violet
var type = ["red","amber","green","violet"].indexOf(a.type) >= 0 ? a.type : "violet";

// 分数夹紧到 0–100
sc = Math.max(0, Math.min(100, Math.round(sc)));
```

### 7.2 页码兜底（重要）

图片稿没有正文段落，所有批注的 `para` 都是 0。如果按"每 4 段一页"兜底，所有批注都会被压到第 1 页。

```javascript
if (!isFinite(pg) || pg < 0) {
  var totalPages = ctx.pages || 1;
  // 有正文：按段落估；图片稿：按批注序号均分到各页
  pg = totalPages > 1 && hasText
    ? Math.floor(para / 4)
    : Math.floor(idx * totalPages / totalAnnCount);
}
if (ctx.pages) pg = Math.min(pg, ctx.pages - 1);   // 夹紧，防止越界
```

### 7.3 加权总分自算

不信任模型给的 `score`，用维度分自己算：

```javascript
var weighted = dims.reduce(function (s, x) {
  return s + x.score * (ctx.weights[x.key] || 0);
}, 0) / 100;
var score = Math.max(0, Math.min(100, Math.round(weighted)));
var level = levelOf(score, ctx.grade);   // 85/72 两档切分
```

---

## 八、并发与状态安全

多份作文可同时批改，必须防止结果串稿。

### 8.1 每份独立 AbortController

```javascript
var doc = S.docs[S.activeDoc];
var ctl = new AbortController();
doc.grading = { ctl: ctl, startedAt: Date.now(), trace: [] };
```

### 8.2 结果先写回发起批改的那份

```javascript
// 批改耗时较长，用户可能已切到别的作文
doc.result  = res;
doc.elapsed = elapsed;
if (res.text) doc.text = res.text;

// 再判断是否还停在这一份
var stillViewing = (S.activeDoc === docIndex && S.docs[S.activeDoc] === doc);
if (stillViewing) {
  /* 刷新画板与报告 */
} else {
  toast("该篇已在后台批改完成，不会覆盖你正在看的这份");
}
```

**这里最容易出 bug**：如果直接用全局 `S.result` 渲染，A 批完会画到正在查看的 B 上。

---

## 九、耗时与用量统计

在请求封装层记录每一步，用于分析成本：

```javascript
if (opt.trace) {
  var u = data.usage || {};
  opt.trace.push({
    step: opt.traceLabel,              // "读图批改" / "生成范文"
    ms: Date.now() - t0,
    prompt: u.prompt_tokens || 0,
    completion: u.completion_tokens || 0,
    total: u.total_tokens || 0,
    model: opt.model || config.model,
    ok: true
  });
}
```

前端展示时，如果某阶段没有真实计时（如模型一次返回），按权重把总耗时分配过去，避免出现 `0.0s`：

```javascript
var weight = { "读图批改": 0.62, "生成范文": 0.31, "整理报告": 0.07 };
```

---

## 十、年级配置（数据驱动）

提示词里的年级要求、字数区间、评分口径全部从配置读取，不写死在提示里：

```javascript
{
  id: "g5", name: "五年级", words: [450, 550],
  reqs: [
    "内容具体，感情真实，有自己的感受",
    "分段表述，层次清楚，详略得当",
    "语句通顺，用词准确，尝试多种修辞",
    "书写规范，标点正确，错别字少"
  ],
  dimReq: {
    content:   "中心明确，选材具体，有真实感受",
    structure: "段落清晰，有详有略，首尾呼应",
    language:  "用词准确生动，有细节与修辞意识",
    norm:      "错别字控制在 2 处以内，标点规范"
  },
  level: { first: 85, second: 72 },
  rule: "五年级按「内容具体 + 感情真实 + 分段清楚」三条硬线评：只写概括不写细节的，内容分不超过 70%；详略平均用力的，结构分不超过 75%。"
}
```

**`rule` 字段很关键**：给出"扣分红线"而不是抽象标准，评分一致性显著提升。

| 年级 | 字数 | 一类文 | 二类文 |
|---|---|---|---|
| 三年级 | 300–350 | ≥85 | 70–84 |
| 四年级 | 350–450 | ≥85 | 70–84 |
| 五年级 | 450–550 | ≥85 | 72–84 |
| 六年级 | 550–650 | ≥85 | 72–84 |

---

## 十一、四维评分体系

| key | 名称 | 默认权重 | 评什么 |
|---|---|---|---|
| content | 内容立意 | 30 | 主题明确、立意深刻、素材贴合题意 |
| structure | 结构逻辑 | 25 | 段落合理、层次清晰、详略得当 |
| language | 语言表达 | 25 | 用词准确生动、句式有变化 |
| norm | 规范书写 | 20 | 错别字、标点、书写规范 |

权重可在 UI 上调整，四维之和恒为 100。

---

## 十二、移植清单

移植到其他 AI 应用时，按此顺序实施：

### 必做

1. ☐ **关闭深度思考**（`thinking: {type:"disabled"}`），这是提速关键
2. ☐ **两阶段拆分**：结构化批改 / 升格范文 分开请求
3. ☐ **强制 JSON 模式** + 解析容错三层兜底
4. ☐ **低温度**（0.25–0.35）
5. ☐ **加权总分自算**，不信模型给的分数

### 视觉批改时必做

6. ☐ 提示词里给 `box`（y/x1/x2 百分比）和 `page` 要求
7. ☐ 图片按页数分档压缩
8. ☐ 页码缺失时**按批注序号均分**，不能按段落号（图片稿 `para` 全是 0）
9. ☐ 续写兜底（判断 JSON 闭合，不只是 `finish_reason`）

### 多任务时必做

10. ☐ 每份独立 `AbortController`
11. ☐ 结果先写回发起任务的那份，再判断是否仍在查看
12. ☐ 后台完成时给明确提示，不覆盖当前视图

### 可选

13. ☐ trace 记录每步耗时与 token
14. ☐ 年级/评分标准做成配置，不写死在提示词
15. ☐ 卡片固定宽度 + 单独侧栏承载，避免排版抖动

---

## 十三、常见问题

**Q：批改太慢怎么办？**
优先查是否开启了深度思考。其次看图片分辨率是否过大、是否用了非视觉模型读图（那会触发二次转录）。

**Q：批注位置总是不准？**
视觉模型对行位置的估计有天然误差（约一行以内）。缓解办法：
- 提示词里明确"先数行号再估 y"
- `sentence` 要求逐字照抄，前端可以用文本匹配二次校正
- 允许用户手工微调（本项目支持拖动，偏移量存进结果，刷新后保留）

**Q：模型返回的 JSON 解析失败？**
按顺序检查：是否有代码围栏、是否有尾随逗号、是否被截断未闭合。三层兜底覆盖大部分情况。

**Q：多页作文只批了第一页？**
先看模型是否漏给 `page`；再确认前端的兜底逻辑。图片稿没有段落号，按段落兜底必然全落第 1 页。

**Q：不同作文的批改结果串了？**
检查结果是否先写回 `doc` 再渲染。渲染必须基于「发起批改的那一份」，不是「当前查看的那一份」。

---

*文档基于智批作文 v1.0.0 实现整理，提示词为生产版本原文。*
