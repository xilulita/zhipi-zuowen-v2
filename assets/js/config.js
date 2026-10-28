/* ============================================================
   智批作文 · 基础配置
   年级写作要求、字数区间、四维评分模型、接口服务商
   ============================================================ */
window.ZP = window.ZP || {};

(function (ZP) {
  "use strict";

  ZP.DIMS = [
    {
      key: "content",
      name: "内容立意",
      short: "内容",
      color: "#a8452f",
      desc: "主题是否明确、立意是否深刻、素材是否贴合题意",
      hint: "看选材是否真实具体、中心是否清楚"
    },
    {
      key: "structure",
      name: "结构逻辑",
      short: "结构",
      color: "#c07a33",
      desc: "段落安排是否合理、层次是否清晰、详略是否得当",
      hint: "看开头结尾、段落衔接与详略处理"
    },
    {
      key: "language",
      name: "语言表达",
      short: "语言",
      color: "#6e7f4b",
      desc: "用词是否准确生动、句式是否流畅、修辞运用水平",
      hint: "看用词、句式变化与修辞手法"
    },
    {
      key: "norm",
      name: "规范书写",
      short: "规范",
      color: "#8a6b7d",
      desc: "错别字、病句、标点与书写规范",
      hint: "看错别字、病句、标点与格式"
    }
  ];

  /* 每个年级：字数区间、写作要求、四维侧重、一类/二类文分数线 */
  ZP.GRADES = [
    {
      id: "g3", name: "三年级", words: [300, 350],
      reqs: ["围绕一个意思写，把话说清楚", "学习分段，一段写一个内容", "语句通顺，标点基本正确"],
      dimReq: {
        content: "写清一件事或一个人，中心不跑偏",
        structure: "会分段，有开头和结尾",
        language: "用词准确，句子完整通顺",
        norm: "少写错别字，标点占格正确"
      },
      level: { first: 85, second: 70 },
      rule: "以“写清楚”为第一标准：一件事交代完整，时间地点人物清楚，允许语言朴素；不要求复杂的结构与修辞。"
    },
    {
      id: "g4", name: "四年级", words: [350, 450],
      reqs: ["按一定顺序写，条理比较清楚", "把过程写具体，不只写结果", "尝试运用比喻、拟人等修辞"],
      dimReq: {
        content: "选材贴近生活，中心比较明确",
        structure: "按事情发展顺序写，详略略有区分",
        language: "语句通顺，能有一两处生动表达",
        norm: "错别字少，标点使用基本规范"
      },
      level: { first: 85, second: 70 },
      rule: "重点看“写具体”：是否有过程描写与细节，能否按顺序组织材料，语言通顺即可，不苛求立意深刻。"
    },
    {
      id: "g5", name: "五年级", words: [450, 550],
      reqs: ["内容具体，感情真实，有自己的感受", "分段表述，层次清楚，详略得当", "语句通顺，用词准确，尝试多种修辞", "书写规范，标点正确，错别字少"],
      dimReq: {
        content: "中心明确，选材具体，有真实感受",
        structure: "段落清晰，有详有略，首尾呼应",
        language: "用词准确生动，有细节与修辞意识",
        norm: "错别字控制在 2 处以内，标点规范"
      },
      level: { first: 85, second: 72 },
      rule: "五年级按“内容具体 + 感情真实 + 分段清楚”三条硬线评：只写概括不写细节的，内容分不超过 70%；详略平均用力的，结构分不超过 75%。"
    },
    {
      id: "g6", name: "六年级", words: [550, 650],
      reqs: ["围绕中心选择材料，主次分明", "写出真情实感，能打动人", "语言有表现力，修辞自然不堆砌", "结构完整，过渡自然，首尾照应"],
      dimReq: {
        content: "立意清楚，材料典型，情感真挚",
        structure: "结构完整，过渡自然，详略分明",
        language: "表达有表现力，句式有变化",
        norm: "书写工整，错别字与标点错误极少"
      },
      level: { first: 85, second: 72 },
      rule: "六年级要求“有详有略 + 有真情”：平均分段、材料堆砌的扣结构分；空喊口号、无具体事例的扣内容分。"
    },
    {
      id: "g7", name: "七年级", words: [650, 750],
      reqs: ["中心明确，能从材料中提炼感受", "结构完整，注意伏笔与照应", "描写方法多样，细节服务主题", "语言通顺，标点与书写规范"],
      dimReq: {
        content: "立意较明确，材料与中心关联紧",
        structure: "线索清楚，有伏笔照应",
        language: "描写手法多样，语言有节奏",
        norm: "行款格式规范，错别字极少"
      },
      level: { first: 85, second: 72 },
      rule: "七年级起关注“写法自觉”：是否运用人物描写、环境描写服务于中心；只叙事不描写、只抒情不落地的，语言分受限。"
    },
    {
      id: "g8", name: "八年级", words: [750, 850],
      reqs: ["立意有思考，能写出自己的判断", "结构有设计，详略服务于表达意图", "语言有个人风格，修辞恰当", "卷面整洁，规范书写"],
      dimReq: {
        content: "立意有深度，材料有开掘",
        structure: "结构有设计感，节奏有变化",
        language: "语言有感染力，表达方式灵活",
        norm: "卷面整洁，无明显语病与错别字"
      },
      level: { first: 85, second: 72 },
      rule: "八年级要求“有思考”：停留在叙事表面的，内容分不超过 80%；结构套路化（三段式无变化）的，结构分不超过 78%。"
    },
    {
      id: "g9", name: "九年级", words: [850, 950],
      reqs: ["立意深刻，能由事及理", "结构严谨，线索清晰，收束有力", "语言凝练有文采，表达有分寸", "书写规范，卷面整洁"],
      dimReq: {
        content: "立意深刻，材料典型且有开掘",
        structure: "结构严谨，线索与照应讲究",
        language: "语言凝练，有文采而不浮华",
        norm: "全程规范，卷面干净"
      },
      level: { first: 85, second: 72 },
      rule: "九年级按考场一类文标准：要求由事及理、有思辨；仅叙述完整而无升华的，内容分不超过 78%。"
    }
  ];

  ZP.GENRES = ["记叙文", "写人", "写景", "状物", "想象作文", "读后感", "议论文"];

  ZP.DEFAULT_WEIGHTS = { content: 30, structure: 25, language: 25, norm: 20 };

  ZP.PROVIDERS = [
    { id: "deepseek", name: "DeepSeek", base: "https://api.deepseek.com/v1", model: "deepseek-chat", vision: "" },
    { id: "dashscope", name: "通义千问", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", vision: "qwen-vl-max" },
    { id: "moonshot", name: "Kimi 月之暗面", base: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k", vision: "moonshot-v1-8k-vision-preview" },
    { id: "zhipu", name: "智谱 GLM", base: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash", vision: "glm-4v-plus" },
    { id: "openai", name: "OpenAI", base: "https://api.openai.com/v1", model: "gpt-4o-mini", vision: "gpt-4o-mini" },
    { id: "doubao", name: "豆包（火山方舟）", base: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-2-1-pro-260915", vision: "doubao-seed-2-1-pro-260915" },
    { id: "custom", name: "自定义 / 本地", base: "http://127.0.0.1:11434/v1", model: "qwen2.5:7b", vision: "" }
  ];

  /* 视觉模型预设：用于「无本地 OCR 时直接读图批改」 */
  ZP.VISION_MODELS = [
    { id: "doubao", name: "豆包（火山方舟）", base: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-2-1-pro-260915", note: "与主接口一致时地址可留空；模型名可填 doubao-seed-2-1-pro-260915" },
    { id: "same", name: "同主接口（推荐）", base: "", model: "", note: "直接复用上面 AI 批改接口的地址与 Key，只改模型名" },
    { id: "qwen", name: "通义千问 VL", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-vl-max", note: "中文卷面识别最稳，推荐首选" },
    { id: "glm", name: "智谱 GLM-4V", base: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4v-plus", note: "中文手写兼容好，国内直连" },
    { id: "openai", name: "OpenAI GPT-4o", base: "https://api.openai.com/v1", model: "gpt-4o-mini", note: "综合能力强，需可访问的服务地址" },
    { id: "moonshot", name: "Kimi 视觉版", base: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k-vision-preview", note: "长图支持好" },
    { id: "siliconflow", name: "硅基流动 Qwen2.5-VL", base: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-VL-72B-Instruct", note: "国内多模态聚合平台，单价低" },
    { id: "custom", name: "自定义视觉模型", base: "", model: "", note: "填任意兼容 OpenAI 视觉协议的模型" }
  ];

  ZP.getGrade = function (id) {
    return ZP.GRADES.find(function (g) { return g.id === id; }) || ZP.GRADES[2];
  };

  ZP.countChars = function (text) {
    if (!text) return 0;
    return (text.replace(/\s/g, "") || "").length;
  };

  ZP.levelOf = function (score, grade) {
    var g = ZP.getGrade(grade);
    var cut = g.level || { first: 85, second: 72 };
    if (score >= cut.first) return { name: "一类文", cls: "l1" };
    if (score >= cut.second) return { name: "二类文", cls: "l2" };
    return { name: "三类文", cls: "l3" };
  };

  ZP.gradeWordLabel = function (id) {
    var g = ZP.getGrade(id);
    return g.words[0] + "–" + g.words[1] + " 字";
  };
})(window.ZP);
