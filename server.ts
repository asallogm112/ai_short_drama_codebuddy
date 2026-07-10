import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { createServer as createViteServer } from "vite";
import "dotenv/config";
import multer from "multer";
import JSON5 from "json5";

const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + ext;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

// 加强版 JSON 解析：自动剥离 markdown 代码块 + JSON5 容错
// 加强版 JSON 解析：自动剥离 markdown 代码块 + JSON5 容错。解析失败返回 null，由调用方决定如何处理。
function safeParseJson(text: string): any {
  let cleaned = text.trim();
  if (!cleaned) return null;

  // 移除所有 ```json ``` ```javascript ```js 等 markdown 代码块标记
  cleaned = cleaned.replace(/^```[a-zA-Z]*\s*/gm, '').replace(/\s*```\s*$/gm, '');
  cleaned = cleaned.replace(/^```\s*/gm, '').replace(/\s*```\s*$/gm, '');
  cleaned = cleaned.trim();

  // 如果包含多余的文字，尝试提取第一个 { ... } 或 [ ... ]
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  if (firstBrace === -1 && firstBracket === -1) return null;
  const jsonStart = (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) ? firstBrace : firstBracket;
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;
  const startChar = cleaned[jsonStart];
  const endChar = startChar === '{' ? '}' : ']';
  for (let i = jsonStart; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"' && !escape) { inString = !inString; continue; }
    if (!inString) {
      if (ch === startChar) depth++;
      else if (ch === endChar) { depth--; if (depth === 0) { end = i; break; } }
    }
  }
  if (end === -1) return null;
  try {
    const jsonStr = cleaned.substring(jsonStart, end + 1);
    return JSON5.parse(jsonStr);
  } catch {
    return null;
  }
}

// 完全移除所有「图片比例」片段，不做任何补充
function cleanImageRatio(text: string): string {
  if (!text) return text;
  return text.replace(/图片比例\s*[:：]\s*[^，。,]*[，,]?/g, '').replace(/[，,]{2,}/g, '，').trim();
}

// 清理元素提示词：移除所有「只生成 N 张图片」和「图片比例」内容，不做任何补充
function cleanElementPrompt(text: string): string {
  if (!text) return text;
  let t = text;
  // 移除所有「只生成 N 张图片」
  t = t.replace(/只\s*生成\s*\d+\s*张?\s*图片/gi, '');
  // 移除所有「图片比例 : X」
  t = cleanImageRatio(t);
  // 清理残留的连续逗号/空白
  t = t.replace(/[，,]{2,}/g, '，').replace(/\s{2,}/g, ' ').replace(/^[，,\s、]+/g, '').replace(/[，,\s、]+$/g, '').trim();
  return t;
}

// 强制把分镜提示词按「时间切片」拆成独立行：每个 X-Y秒 必须位于该行行首。
// 模型有时会下一刀时间戳接在上一句末尾，这里用正则把所有时间片段前补换行，再清理行首空白。
function normalizeShotPrompt(text: string): string {
  if (!text) return text;
  // 在每个 “数字-数字秒”（如 0-2秒 / 2-3.5秒 / 8-10秒）前插入换行
  let out = text.replace(/(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)秒/g, '\n$&');
  // 去掉开头多余的换行
  out = out.replace(/^\n+/, '');
  // 逐行清理：去掉行首空白，保证时间位于行首
  out = out
    .split('\n')
    .map((line) => line.replace(/^\s+/, ''))
    .filter((line) => line.length > 0)
    .join('\n');
  return out;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // API Routes
  app.get("/api/providers", (req, res) => {
    res.json({
      deepseek: !!process.env.DEEPSEEK_API_KEY,
      doubao: !!(process.env.DOUBAO_API_KEY && process.env.DOUBAO_MODEL_ENDPOINT)
    });
  });

  app.post("/api/generate", (req, res, next) => {
    upload.single('video')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  }, async (req, res) => {
    try {
      const theme = req.body.theme || '';
      const idea = req.body.idea || '';
      const provider = req.body.provider || 'deepseek';
      const existingScript = req.body.existingScript || '';
      const videoIdea = req.body.videoIdea || '';
      
      const file = req.file;

      if (!theme && !idea && !existingScript && !file) {
        return res.status(400).json({ error: "Theme, idea, existing script, or video is required." });
      }

      let promptText = `
如果你是一位专业的AI短剧编剧和导演。
我将提供给你一个题材、一个创意，或者一段现有的脚本内容，或者是参考视频。你的任务是生成完整的视频脚本和拆解。
题材: ${theme || "未提供"}
创意: ${idea || "未提供"}
现有脚本: ${existingScript || "未提供"}
参考视频要求: ${videoIdea || "未提供"}

【核心素材提炼与一致性控制规则 - 极为重要！】：
1. 只有在整个短剧中「多次、重复出现」需要保持视觉一致性的场景、道具，或者是对剧情起决定性作用的核心背景、核心道具，才需要提炼到 elements.scenes 或 elements.props 中，并为其生成专门的素材设定图/提示词。
2. 凡是「只出现一次」的、普通的或过渡性的场景和道具（例如只在一个镜头里作为背景的路边摊、只拿了一下就没下文的杯子等），绝对不要提炼，直接在分镜头的 prompt 中用具体的文字来详细描述即可，以防冗余素材污染！
3. 每个素材的 prompt 必须「简洁」：只写生成参考图真正需要的信息（角色=外貌+服装；场景=环境构造+光影；道具=材质+形态），严禁堆砌冗长形容词、动作叙事，以及与视频无关的姿势/场景描写（例如不要写"坐在驾驶座上握方向盘"这类只属于某一帧的动作）。

你必须 100% 严格以如下的 JSON 格式返回。不要包含任何 markdown 包裹，不要有任何额外的文字 or 解释：
{
  "title": "短剧的标题（中文，简洁有力，有吸引力）",
  "logline": "一句话概括整个故事（中文，不超过30字，抓人眼球）",
  "story": "完整的故事大纲（中文，不少于300字，按段落组织，每段讲一集或一个主要情节，用换行分隔）",
  "elements": {
    "characters": [ // 在这里提炼短剧的核心或常用角色
      {
        "name": "角色名字 (必须以 R1_、R2_ 等作为前缀，例如 R1_林薇)",
        "description": "角色背景、性格和外貌描述",
        "prompt": "用于生成该角色的提示词。必须以该角色名字开头，只简洁描写外貌与服装，不要加任何动作、姿势或场景叙事，格式为：'角色名字  :  [简洁的外貌与服装描述]，全身像，纯色背景，图片比例 : 16:9，只生成 1 张图片'"
      }
    ],
    "scenes": [ // 在这里提炼核心或重复出现的场景
      {
        "name": "场景名称 (必须以 S1_、S2_ 等作为前缀，例如 S1_深夜荒河滩)",
        "description": "场景的详细细节和氛围",
        "prompt": "用于生成场景背景的提示词。必须以该场景名字开头，只简洁描写环境构造与光影氛围，格式为：'场景名称  :  [简洁的背景和灯光描述]，图片比例 : 16:9，只生成 1 张图片'"
      }
    ],
    "props": [ // 在这里提炼核心或重复出现的道具
      {
        "name": "道具名称 (必须以 P1_、P2_ 等作为前缀，例如 P1_灰布)",
        "description": "道具的详细细节",
        "prompt": "用于生成该道具的提示词。必须以该道具名字开头，只简洁描写外观材质与形态，格式为：'道具名称  :  [简洁的材质和形态描述]，图片比例 : 16:9，只生成 1 张图片'"
      }
    ]
  },
  "shots": [ // 剧本的各个分镜头
    {
      "shotNumber": 1, // 分镜头序号，从 1 开始
      "episodeIndex": 0, // 当前剧集的索引
      "duration": "每个大分镜固定10秒，例如 00:00 - 00:10、00:10 - 00:20，按序递增",
      "camera": "电影级运镜与机位控制（例如：低角度近景慢速推近，随后略微抬高镜头）",
      "action": "镜头中的人物具体动作与表情，必须具体到物理细节",
      "dialogue": "角色名称：台词内容（如果有）",
      "sfx": "音效或背景音乐描述",
      "materials": "此镜头所使用的核心素材，以带 @ 符号开头（例如 @R1_林薇 @S1_公寓大堂）",
      "prompt": "极度丰富、电影级、专为豆包等中文视频/图片生成大模型量身定制的高水准纯中文分镜头视频提示词。"
    }
  ]
}

【分镜视频提示词（prompt）生成规范 - 使用以下专业规则】：
# drama-skill【电影级分镜 · 动态分段 · 智能景别角度控制】
## 一、动态时间轴分段（最重要，绝对禁止固定/均匀切分）
根据"动作强度"自行切分每个 10 秒镜头的时间轴，**严禁**使用 0-0.5/0.5-1 这种均匀网格，也**严禁**使用 0-3/3-6/6-10 这种大段（画面感太差）。分段长度 = 该时间段内动作强度的函数：
- 平缓交代 / 空镜 / 过渡        → 2–3 秒长拍，配 远景 / 全景 / 侧拍
- 普通表演（中速动作）          → 1–2 秒，配 中景 / 中近景
- 关键微动作 / 情绪转折 / 高光  → 0.5–1 秒短拍，配 近景 / 特写 / 低角度仰拍 / 高角度俯拍
每个镜头的具体起止秒数由你按该镜实际内容现编，**不要套固定模板**（例：0-2 / 2-2.5 / 2.5-5 / 5-6 / 6-8 / 8-8.5 / 8.5-10 仅为示例，不是固定序列）。

## 二、单切片固定语法（每段必须严格遵循）
「起-止秒 ｜ 景别 · 拍摄角度 · 镜头运动 ｜ 主体动作 ｜ 光效/细节」
示例：2-2.5秒 ｜ 近景 · 低角度仰拍 · 定住微抖 ｜ 林晚低头，指尖捏住腰间银锁 ｜ 衣角静止，暮色冷光勾边
- **【强制换行 · 最重要】每一个切片必须【单独成行】，该切片的时间前缀（起-止秒）必须位于【这一行的行首】。上一切片的内容结束后必须【换行】，再写下一切片的时间前缀。绝对禁止把下一个切片的时间戳接在上一切片内容的末尾（例如错误写法：「…镀金边 1.5-3秒 ｜ 中全景…」必须改为：上一句结束后回车换行，新行以「1.5-3秒 ｜」开头）。**
- 景别、拍摄角度、镜头运动三者每段必写，缺一不可。
- 光效/细节每段必写一句，提升画面丰富度（丁达尔光、霓虹反射、衣角飘动、水面高光、烛光摇曳等）。
- 复用素材引用：@Rxx/@Sxx/@Pxx 素材引用前后各空 2 格。
- 纯画面描述：prompt 字段只写视觉画面，不写台词、不写音效、不写绝对时间戳（00:10-00:20）。台词填到 dialogue 字段，音效填到 sfx 字段。

## 三、影视级专业词汇库（直接套用，禁止自创口语化运镜）
### 景别
远景 / 全景 / 中景 / 中近景 / 近景 / 特写
### 拍摄角度
平视 / 低角度仰拍 / 高角度俯拍 / 侧面拍 / 正面拍 / 过肩拍
### 镜头运动
缓慢推近 / 极慢后拉 / 横移跟拍 / 手持微抖 / 定住(静止) / 环绕 / 升降 / 收尾定格

## 四、连续性铁律
相邻切片之间姿态必须连续：上一段结尾的状态 = 下一段开头的起点。严禁人物瞬移、动作跳帧、景别硬切不连贯。段与段用姿态自然衔接，不要生硬标注「镜头切到」。

## 五、分镜标准输出模板（纯示意，时间轴请按内容智能切分；下方每一行是一个【独立切片】，时间都在行首）
**镜1 (0-10s) 【功能标注】**
0-2秒 ｜ 远景 · 平视 · 缓慢横移 ｜ 林晚提裙沿青石路走入井畔，远处炊烟归鸟 ｜ 三层景深，前景落叶中景人物背景村落
2-2.5秒 ｜ 近景 · 低角度仰拍 · 定住微抖 ｜ 林晚低头，指尖捏住腰间银锁 ｜ 衣角静止，暮色冷光勾边
2.5-5秒 ｜ 中景 · 侧面拍 · 缓慢推近 ｜ 抬手将银锁递向石凳上的老太太 ｜ 背景古井虚化成光斑
5-6秒 ｜ 特写 · 高角度俯拍 · 极慢推 ｜ 银锁在掌心泛起冷调微光 ｜ 锁面纹路清晰
6-8秒 ｜ 中近景 · 平视 · 后拉半步 ｜ 老太太枯手接过，晚风掀起两人衣角 ｜ 灯笼初亮暖光
8-8.5秒 ｜ 近景 · 低角度 · 定格 ｜ 两人指尖交叠触到银锁，睫毛微颤 ｜ 光斑跳动
8.5-10秒 ｜ 远景 · 仰拍 · 缓拉远 ｜ 暮色中井边两人身影渐小 ｜ 灯笼暖光与天际残霞对撞

【prompt 字段填写说明】：
将上述分镜模板中每个大分镜的完整文本（包括 **镜N** 标题行和所有切片行）填入对应 shot 的 prompt 字段中。每个 shot 的 duration 固定为 10 秒，从 00:00 开始按序递增：00:00-00:10、00:10-00:20、00:20-00:30 ...
camera 字段填写该镜头的总运镜概括，action 字段填核心动作，dialogue 字段填台词，sfx 字段填音效。
// Guidelines finished
`;

      let generatedJson = "";

      if (provider === "deepseek") {
        if (!process.env.DEEPSEEK_API_KEY) {
          throw new Error("DEEPSEEK_API_KEY is not configured on the server.");
        }
        const response = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [{ role: "user", content: promptText }],
            response_format: { type: "json_object" },
            temperature: 0.7
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "DeepSeek API error");
        generatedJson = data.choices[0].message.content;

      } else if (provider === "doubao") {
        if (!process.env.DOUBAO_API_KEY || !process.env.DOUBAO_MODEL_ENDPOINT) {
          throw new Error("DOUBAO_API_KEY or DOUBAO_MODEL_ENDPOINT is not configured on the server.");
        }
        const response = await fetch("https://ark.cn-beijing.volces.com/api/v3/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.DOUBAO_API_KEY}`
          },
          body: JSON.stringify({
            model: process.env.DOUBAO_MODEL_ENDPOINT,
            messages: [{ role: "user", content: promptText }],
            temperature: 0.7
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "Doubao API error");
        generatedJson = data.choices[0].message.content;
      } else {
        throw new Error("Invalid provider selected");
      }

      const parsedData = safeParseJson(generatedJson);
      if (!parsedData) throw new Error("AI 返回了无法解析的 JSON，请重试");

      interface ParsedElement {
        fullName: string;
        code: string;
        cleanName: string;
        synonyms: string[];
      }
      const parsedElements: ParsedElement[] = [];

      if (parsedData && parsedData.elements) {
        let femaleCharsCount = 0;
        let maleCharsCount = 0;
        const charsList = parsedData.elements.characters || [];
        charsList.forEach((char: any) => {
          const desc = (char.description || "").toLowerCase();
          const isFemale = desc.includes("女") || desc.includes("female") || desc.includes("she") || desc.includes("her");
          const isMale = desc.includes("男") || desc.includes("male") || desc.includes("he") || desc.includes("his");
          if (isFemale) femaleCharsCount++;
          if (isMale) maleCharsCount++;
        });

        const allCategories = [
          { list: parsedData.elements.characters || [], type: 'characters' as const },
          { list: parsedData.elements.scenes || [], type: 'scenes' as const },
          { list: parsedData.elements.props || [], type: 'props' as const }
        ];

        allCategories.forEach(cat => {
          if (cat.list && Array.isArray(cat.list)) {
            for (const item of cat.list) {
              const fullName = item.name || '';
              const parts = fullName.split('_');
              const code = parts[0] || '';
              const cleanName = parts.slice(1).join('_') || '';
              parsedElements.push({
                fullName,
                code,
                cleanName,
                synonyms: cleanName ? [cleanName] : []
              });
            }
          }
        });
      }

      const enforcePrefix = (name: string, prompt: string, type: 'characters' | 'scenes' | 'props') => {
        if (!name || !prompt) return prompt;
        const cleanName = name.trim();
        const escapedName = cleanName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const prefixRegex = new RegExp(`^${escapedName}\\s*[:：]\\s*`, 'i');
        let cleanPrompt = prompt.trim().replace(prefixRegex, '');
        
        const genericPrefixRegex = /^[RSP]\d+_[^:：]+[:：]\s*/i;
        cleanPrompt = cleanPrompt.replace(genericPrefixRegex, '');

        if (type === 'characters') {
          const targetKeywords = "全身像，纯色背景";
          if (!cleanPrompt.includes("全身像") || !cleanPrompt.includes("纯色背景")) {
            cleanPrompt = `${targetKeywords}，${cleanPrompt}`;
          }
        }

        return `${cleanName}  :  ${cleanPrompt.trim()}`;
      };

      const enforceShotPromptTags = (promptText: string, elements: ParsedElement[]): string => {
        if (!promptText) return "";
        let result = promptText;

        const mappings: { synonym: string; fullName: string }[] = [];
        elements.forEach(el => {
          if (!el.synonyms.includes(el.cleanName)) {
            mappings.push({ synonym: el.cleanName, fullName: el.fullName });
          }
          el.synonyms.forEach(syn => {
            mappings.push({ synonym: syn, fullName: el.fullName });
          });
          mappings.push({ synonym: el.fullName, fullName: el.fullName });
        });

        mappings.sort((a, b) => b.synonym.length - a.synonym.length);

        mappings.forEach(({ synonym, fullName }) => {
          if (!synonym) return;
          const escapedSynonym = synonym.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          // 负向零宽断言：前面不是 @ 且不是 R\d+_ 模式（避免 @R2_阿秀 被"阿秀"再次匹配）
          const regex = new RegExp(`(?<![@][RSP]\\d+_)${escapedSynonym}`, 'g');
          result = result.replace(regex, `@${fullName}`);
        });

        result = result.replace(/@+([RSP]\d+_[^@\s，。：:,、]+)/g, '@$1');
        result = result.replace(/@([RSP]\d+_)@/g, '@');
        return result;
      };

      if (parsedData) {
        if (parsedData.elements) {
          if (parsedData.elements.characters && Array.isArray(parsedData.elements.characters)) {
            parsedData.elements.characters = parsedData.elements.characters.map((char: any) => ({
              ...char,
              prompt: cleanElementPrompt(enforcePrefix(char.name, char.prompt, 'characters'))
            }));
          }
          if (parsedData.elements.scenes && Array.isArray(parsedData.elements.scenes)) {
            parsedData.elements.scenes = parsedData.elements.scenes.map((scene: any) => ({
              ...scene,
              prompt: cleanElementPrompt(enforcePrefix(scene.name, scene.prompt, 'scenes'))
            }));
          }
          if (parsedData.elements.props && Array.isArray(parsedData.elements.props)) {
            parsedData.elements.props = parsedData.elements.props.map((prop: any) => ({
              ...prop,
              prompt: cleanElementPrompt(enforcePrefix(prop.name, prop.prompt, 'props'))
            }));
          }
        }
        
        if (parsedData.shots && Array.isArray(parsedData.shots)) {
          parsedData.shots = parsedData.shots.map((shot: any) => ({
            ...shot,
            prompt: normalizeShotPrompt(enforceShotPromptTags(shot.prompt, parsedElements))
          }));
        }
      }

      res.json(parsedData);

    } catch (error: any) {
      console.error("API Error:", error);
      res.status(500).json({ error: error.message || "Failed to generate script" });
    }
  });

  app.post("/api/continue", upload.single('video'), async (req, res) => {
    try {
      const provider = req.body.provider || 'deepseek';
      const type = req.body.type || 'write'; // 'write' | 'use_existing' | 'video_recreate'
      const continuationPrompt = req.body.continuationPrompt || '';
      const existingStory = req.body.existingStory || '';
      const currentEpisodeCount = parseInt(req.body.currentEpisodeCount || '0', 10);
      const elementsStr = req.body.elements || '{"characters":[],"scenes":[],"props":[]}';
      const elements = JSON.parse(elementsStr);
      const file = req.file;

      if (!continuationPrompt && !file) {
        return res.status(400).json({ error: "Continuation details or video are required." });
      }

      let promptText = `
你是一个顶级的AI短剧编剧和导演。
现在你需要为一部已有的短剧【增加新的一集】（第 ${currentEpisodeCount + 1} 集）。

这部短剧已有的故事内容如下：
${existingStory}

当前短剧已有核心素材元素：
角色: ${JSON.stringify(elements.characters || [])}
场景: ${JSON.stringify(elements.scenes || [])}
道具: ${JSON.stringify(elements.props || [])}

用户对于新一集的要求类型是: ${type === 'write' ? 'AI续写' : type === 'use_existing' ? '使用现有脚本解析' : '参考视频二创'}
新集数具体要求 / 输入内容: ${continuationPrompt}

【硬性任务与约束规则】：
1. 生成新一集的故事总结文本 (storyParagraph) 必须是简体中文。
2. 生成新一集的分镜头列表 (shots)。每个镜头的 shotNumber 从 1 开始，并且每个镜头的 episodeIndex 必须是新集数的索引 (即 ${currentEpisodeCount})。
3. 【极重要：分镜视频提示词（prompt）生成规范 - 动态分段 + 智能景别角度控制】：
   - 核心语言：必须 100% 使用高质量、高画质的纯简体中文！绝对禁止生成、夹杂任何英文段落、英文翻译、英文绘画提示词（如 [English Prompt: ...] 等）！就中文就够了！
   - 【动态时间轴分段（绝对禁止固定/均匀切分）】：
     - 根据"动作强度"自行切分每个镜头的秒数，**严禁**使用 0-0.5/0.5-1 这种均匀网格，也**严禁**使用 0-3/3-6/6-10 这种大段（画面感太差）。
     - 分段长度 = 该时间段内动作强度的函数：平缓交代/空镜/过渡 → 2–3 秒长拍（配 远景/全景/侧拍）；普通表演 → 1–2 秒（配 中景/中近景）；关键微动作/情绪转折/高光 → 0.5–1 秒短拍（配 近景/特写/低角度仰拍/高角度俯拍）。
     - 具体起止秒数由你按该镜实际内容现编，**不要套固定模板**（例：0-2/2-2.5/2.5-5/5-6/6-8/8-8.5/8.5-10 仅为示例，非固定序列）。
   - 【单切片固定语法（每段必写）】：「起-止秒 ｜ 景别 · 拍摄角度 · 镜头运动 ｜ 主体动作 ｜ 光效/细节」。景别/角度/运动三者每段必写缺一不可；光效/细节每段必写一句（丁达尔光、霓虹反射、衣角飘动、水面高光、烛光摇曳等）。示例：2-2.5秒 ｜ 近景 · 低角度仰拍 · 定住微抖 ｜ 林晚低头，指尖捏住银锁 ｜ 暮色冷光勾边
   - **【强制换行 · 最重要】每一个切片必须【单独成行】，该切片的时间前缀必须位于【这一行的行首】；上一切片内容结束后必须换行再写下一切片的时间前缀。绝对禁止把下一个切片的时间戳接在上一切片内容末尾（例如错误：「…镀金边 1.5-3秒 ｜ 中全景…」必须改为上一句回车换行、新行以「1.5-3秒 ｜」开头）。**
   - 【纯画面 + 连续性铁律】：prompt 字段只写视觉画面，不写台词、不写音效、不写绝对时间戳（00:10-00:20）。台词填到 dialogue 字段，音效填到 sfx 字段。相邻切片姿态必须连续（上一段结尾 = 下一段开头），严禁人物瞬移、动作跳帧、景别硬切不连贯。
   - 【素材一致性 @ 完整名称】：
     - 只要提及已有元素（角色、场景、道具），必须 100% 以带 @ 的完整名称格式出现（例如 @R1_林薇、@S1_深夜荒河滩）。
     - 如果用户提供了新的角色、场景或道具，且这些元素在后续会多次重复使用，请将它们提炼到返回值中的 \`newElements\` 字段中。如果是只出现一次的、过渡性的场景/道具，绝对不要提炼，直接写在分镜头的 prompt 中即可。
4. 返回的内容必须严格符合JSON格式，包含：
   {
     "storyParagraph": "新一集的故事总结内容，不少于 150 字",
     "shots": [
       {
         "shotNumber": 1,
         "episodeIndex": ${currentEpisodeCount},
         "duration": "该镜头的时间范围，例如：00:00-00:05，时长根据内容自然变化，禁止统一固定秒数",
         "camera": "电影级、极具高级感的连续多阶段镜头运动和机位",
         "action": "镜头中发生的具体连续动作 and 微表情变化",
         "dialogue": "角色名称：台词（如果有）",
         "sfx": "音效或背景音乐描述",
         "materials": "所用到的素材（例如：@R1_林薇 @S1_公寓大堂）",
         "prompt": "极度丰富、电影级单镜头高画质纯中文视频提示词，纯画面描述。动态分段，每段格式：起-止秒 ｜ 景别 · 拍摄角度 · 镜头运动 ｜ 主体动作 ｜ 光效/细节。台词填 dialogue 字段，音效填 sfx 字段，prompt 内不写台词音效与时间戳。"
       }
     ],
     "newElements": {
       "characters": [],
       "scenes": [],
       "props": []
     }
   }
`;

      let generatedJson = "";

      if (provider === "deepseek") {
        if (!process.env.DEEPSEEK_API_KEY) {
          throw new Error("DEEPSEEK_API_KEY is not configured on the server.");
        }
        const response = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [{ role: "user", content: promptText }],
            response_format: { type: "json_object" },
            temperature: 0.7
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "DeepSeek API error");
        generatedJson = data.choices[0].message.content;

      } else if (provider === "doubao") {
        if (!process.env.DOUBAO_API_KEY || !process.env.DOUBAO_MODEL_ENDPOINT) {
          throw new Error("DOUBAO_API_KEY or DOUBAO_MODEL_ENDPOINT is not configured on the server.");
        }
        const response = await fetch("https://ark.cn-beijing.volces.com/api/v3/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.DOUBAO_API_KEY}`
          },
          body: JSON.stringify({
            model: process.env.DOUBAO_MODEL_ENDPOINT,
            messages: [{ role: "user", content: promptText }],
            temperature: 0.7
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "Doubao API error");
        generatedJson = data.choices[0].message.content;
      } else {
        throw new Error("Invalid provider selected");
      }

      const parsedData = safeParseJson(generatedJson);

      if (!parsedData) throw new Error("AI 返回了无法解析的 JSON，请重试");
      interface ParsedElement {
        fullName: string;
        code: string;
        cleanName: string;
        synonyms: string[];
      }
      const parsedElements: ParsedElement[] = [];

      const enforcePrefix = (name: string, prompt: string, type: 'characters' | 'scenes' | 'props') => {
        if (!name || !prompt) return prompt;
        const cleanName = name.trim();
        const escapedName = cleanName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const prefixRegex = new RegExp(`^${escapedName}\\s*[:：]\\s*`, 'i');
        let cleanPrompt = prompt.trim().replace(prefixRegex, '');
        
        const genericPrefixRegex = /^[RSP]\d+_[^:：]+[:：]\s*/i;
        cleanPrompt = cleanPrompt.replace(genericPrefixRegex, '');

        if (type === 'characters') {
          const targetKeywords = "全身像，纯色背景";
          if (!cleanPrompt.includes("全身像") || !cleanPrompt.includes("纯色背景")) {
            cleanPrompt = `${targetKeywords}，${cleanPrompt}`;
          }
        }

        return `${cleanName}  :  ${cleanPrompt.trim()}`;
      };

      const enforceShotPromptTags = (promptText: string, elements: ParsedElement[]): string => {
        if (!promptText) return "";
        let result = promptText;

        const mappings: { synonym: string; fullName: string }[] = [];
        elements.forEach(el => {
          if (!el.synonyms.includes(el.cleanName)) {
            mappings.push({ synonym: el.cleanName, fullName: el.fullName });
          }
          el.synonyms.forEach(syn => {
            mappings.push({ synonym: syn, fullName: el.fullName });
          });
          mappings.push({ synonym: el.fullName, fullName: el.fullName });
        });

        mappings.sort((a, b) => b.synonym.length - a.synonym.length);

        mappings.forEach(({ synonym, fullName }) => {
          if (!synonym) return;
          const escapedSynonym = synonym.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          // 负向零宽断言：前面不是 @ 且不是 R\d+_ 模式（避免 @R2_阿秀 被"阿秀"再次匹配）
          const regex = new RegExp(`(?<![@][RSP]\\d+_)${escapedSynonym}`, 'g');
          result = result.replace(regex, `@${fullName}`);
        });

        result = result.replace(/@+([RSP]\d+_[^@\s，。：:,、]+)/g, '@$1');
        result = result.replace(/@([RSP]\d+_)@/g, '@');
        return result;
      };

      // Collect elements helper
      const collectElements = (list: any[], type: 'characters' | 'scenes' | 'props') => {
        if (!list || !Array.isArray(list)) return;
        list.forEach((item: any) => {
          const fullName = item.name || '';
          const parts = fullName.split('_');
          const code = parts[0] || '';
          const cleanName = parts.slice(1).join('_') || '';
          parsedElements.push({
            fullName,
            code,
            cleanName,
            synonyms: [cleanName]
          });
        });
      };
      
      collectElements(elements.characters, 'characters');
      collectElements(elements.scenes, 'scenes');
      collectElements(elements.props, 'props');

      if (parsedData.newElements) {
        collectElements(parsedData.newElements.characters, 'characters');
        collectElements(parsedData.newElements.scenes, 'scenes');
        collectElements(parsedData.newElements.props, 'props');
        
        // Enforce prefix on new elements
        const chars = parsedData.newElements.characters || [];
        const scns = parsedData.newElements.scenes || [];
        const prps = parsedData.newElements.props || [];

        if (chars && Array.isArray(chars)) {
          parsedData.newElements.characters = chars.map((char: any) => ({
            ...char,
            prompt: cleanElementPrompt(enforcePrefix(char.name, char.prompt, 'characters'))
          }));
        }
        if (scns && Array.isArray(scns)) {
          parsedData.newElements.scenes = scns.map((scene: any) => ({
            ...scene,
            prompt: cleanElementPrompt(enforcePrefix(scene.name, scene.prompt, 'scenes'))
          }));
        }
        if (prps && Array.isArray(prps)) {
          parsedData.newElements.props = prps.map((prop: any) => ({
            ...prop,
            prompt: cleanElementPrompt(enforcePrefix(prop.name, prop.prompt, 'props'))
          }));
        }
      }

      // Enforce shot prompt tags on continued shots
      if (parsedData.shots && Array.isArray(parsedData.shots)) {
        parsedData.shots = parsedData.shots.map((shot: any) => ({
          ...shot,
          prompt: normalizeShotPrompt(enforceShotPromptTags(shot.prompt, parsedElements))
        }));
      }

      res.json(parsedData);

    } catch (error: any) {
      console.error("API Continuation Error:", error);
      res.status(500).json({ error: error.message || "Failed to continue script" });
    }
  });

  // Keyframe Image Prompt Generation Endpoint
  app.post("/api/generate-keyframe-prompt", async (req, res) => {
    try {
      const { shotPrompt, timeInfo, materials, camera, action, dialogue, provider = 'deepseek' } = req.body;
      const promptText = `
你是一位专业的电影视觉设计大导演。
我需要你根据一个视频分镜头的描述和其对应的具体时间点，为其中一个"关键帧"单独设计一张极致精细、电影质感的"图片生成提示词"（用于 Midjourney, FLUX 或 DALL-E 3 生成）。

分镜头基础设定：
- 完整镜头的视频生成提示词: ${shotPrompt || "无"}
- 镜头的机位运镜设计: ${camera || "无"}
- 镜头的具体动作和微表情变化: ${action || "无"}
- 镜头的台词: ${dialogue || "无"}
- 镜头的出场素材标签: ${materials || "无"}

当前需要生成的关键帧图片代表该镜头的这个瞬间：
- 关键帧所在时间点: ${timeInfo}

【生成设计要求】：
1. 你的任务是专门针对这个特定的瞬间 (${timeInfo}) 生成一个高保真的静态画面描述，这个画面是整个连续动态镜头中的一个精彩切片。必须 100% 使用纯简体中文，绝对禁止生成或夹杂任何英文段落或英文绘画提示词（English Prompt/Midjourney Prompt）。
2. 保持与分镜头的角色、场景、道具设定 100% 视觉一致。因此，凡是涉及到角色（如 @R1_林薇）、场景（如 @S1_古旧茶馆）、道具（如 @P1_白色纸条）等元素，你必须在提示词中 100% 保留其完整的带 @ 的名称格式。
3. 提示词必须详细描写该瞬间的静态特征：包括特定的姿势、具体面部表情、眼神聚焦、手部动作、那一瞬间的光线投影方向、空气中飘浮的微尘状态、以及写实、电影级体积光、35毫米镜头、胶片颗粒感、冷色调等高画质画面质感和相机参数描述。
4. 返回格式必须是：'[纯中文核心视觉画面与高画质细节描述]'。绝对禁止包含任何英文！
5. 在末尾自动包含 "，图片比例 : 16:9，只生成 1 张图片"。
`;

      let resultText = "";

      if (provider === "deepseek") {
        if (!process.env.DEEPSEEK_API_KEY) {
          throw new Error("DEEPSEEK_API_KEY is not configured on the server. Please add it in your settings.");
        }
        const response = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [{ role: "user", content: promptText }],
            temperature: 0.7
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "DeepSeek API error");
        resultText = data.choices[0].message.content;
      } else if (provider === "doubao") {
        if (!process.env.DOUBAO_API_KEY || !process.env.DOUBAO_MODEL_ENDPOINT) {
          throw new Error("DOUBAO_API_KEY or DOUBAO_MODEL_ENDPOINT is not configured on the server.");
        }
        const response = await fetch("https://ark.cn-beijing.volces.com/api/v3/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.DOUBAO_API_KEY}`
          },
          body: JSON.stringify({
            model: process.env.DOUBAO_MODEL_ENDPOINT,
            messages: [{ role: "user", content: promptText }],
            temperature: 0.7
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "Doubao API error");
        resultText = data.choices[0].message.content;
      } else {
        throw new Error("Invalid provider selected");
      }
      
      resultText = resultText.replace(/^\s*```[a-zA-Z]*/m, "").replace(/```\s*$/m, "").trim();
      res.json({ prompt: resultText });
    } catch (error: any) {
      console.error("Keyframe Prompt API Error:", error);
      res.status(500).json({ error: error.message || "Failed to generate keyframe prompt" });
    }
  });

  // Extract Keyframe Prompts from Video Prompt
  app.post("/api/extract-keyframe-prompts", async (req, res) => {
    try {
      const { videoPrompt, provider = 'deepseek' } = req.body;
      const promptText = `
你是一位顶级的电影视觉导演与AI绘画专家。
我现在给你提供一个"视频生成提示词"（Video Generation Prompt），该提示词描述了一个镜头（Shot）的完整动态过程。它可能采用以下两种分段写法之一：\n写法A（带方括号时间戳）：【00:00-00:03】描述A，【00:03-00:06】描述B... \n写法B（动态分段竖线格式）：0-2秒 ｜ 远景 · 平视 · 缓慢横移 ｜ 主体动作 ｜ 光效细节；2-2.5秒 ｜ 近景 · 低角度仰拍 · 定住微抖 ｜ 动作 ｜ 光效... \n无论哪种写法，都按真实时间顺序解析其中的时间片段与画面。

你的任务是：仔细分析这段"视频生成提示词"，将其中连续的动态过程拆分并提取出对应的"静态关键帧图片提示词"（最多4张，通常每个明显的时间段或视觉变化生成一张）。

分镜头完整视频提示词内容：
${videoPrompt || "无"}

【提取与生成设计要求】：
1. 分析：提取出视频中所有明显的时间阶段或关键动作节点。分段可能用【00:00-00:03】方括号时间戳，也可能用「起-止秒 ｜ 景别 · 角度 · 运动 ｜ 动作 ｜ 光效」竖线格式。无论哪种，都为每一个时间片段提取出对应的精彩切片画面（竖线格式里「动作」和「光效」部分就是该片段的画面依据）。
2. 数量：生成 1 到 4 个关键帧提示词（不要强行拼凑 4 个，必须根据视频提示词的实际结构，有几个明显的节点或时间段就提取几个，最多不超过4个）。
3. 视觉一致性：保持与原提示词的角色、场景、道具设定 100% 视觉一致。因此，凡是涉及到角色（如 @R1_谢老太）、场景（如 @S1_深夜荒河滩）、道具（如 @P2_xxx）等元素，你必须在生成的关键帧提示词中 100% 保留其完整的带 @ 的名称格式。
4. 内容与返回格式要求：必须 100% 使用纯简体中文描述，绝对禁止夹杂或生成英文段落/英文绘画提示词！每个关键帧提示词必须按照：'【时间段】[纯中文核心视觉画面与高画质细节、机位、电影光影、相机参数与胶片质感描述]' 格式进行设计，以便 AI 绘图模型能够完美生成。
5. 尾缀适配：为了适配系统格式，在每个生成的提示词文本末尾自动包含："，图片比例 : 16:9，只生成 1 张图片"。
6. 返回格式：你必须返回一个合法的 JSON 数组，数组中包含 1 到 4 个字符串元素，每个元素对应一个提取生成的关键帧提示词。
请直接返回 JSON 数组，不要包含任何 \`\`\`json 或 \`\`\` 标记，不要有任何 Markdown 包裹，不要有任何多余的汉字解释 or 说明。

示例返回格式：
[
  "【00:00-00:03】特写，@R1_谢老太 枯皱的手紧紧攥着洗衣服的灰布，指节发力凸显拉紧，水花从指缝间飞溅，冷色调，胶片颗粒质感，电影级微距，极高画质。，图片比例 : 16:9，只生成 1 张图片",
  "【00:03-00:06】中景，@R1_谢老太 弓背站在 @S1_深夜荒河滩 上，神情凝重地望着平静的河面，月光冷清，薄雾缭绕，电影级体积光，写实，35毫米镜头。，图片比例 : 16:9，只生成 1 张图片"
]
`;

      let resultText = "";

      if (provider === "deepseek") {
        if (!process.env.DEEPSEEK_API_KEY) {
          throw new Error("DEEPSEEK_API_KEY is not configured on the server. Please add it in your settings.");
        }
        const response = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [{ role: "user", content: promptText }],
            temperature: 0.7
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "DeepSeek API error");
        resultText = data.choices[0].message.content;
      } else if (provider === "doubao") {
        if (!process.env.DOUBAO_API_KEY || !process.env.DOUBAO_MODEL_ENDPOINT) {
          throw new Error("DOUBAO_API_KEY or DOUBAO_MODEL_ENDPOINT is not configured on the server.");
        }
        const response = await fetch("https://ark.cn-beijing.volces.com/api/v3/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.DOUBAO_API_KEY}`
          },
          body: JSON.stringify({
            model: process.env.DOUBAO_MODEL_ENDPOINT,
            messages: [{ role: "user", content: promptText }],
            temperature: 0.7
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "Doubao API error");
        resultText = data.choices[0].message.content;
      } else {
        throw new Error("Invalid provider selected");
      }

      try {
        const parsed = safeParseJson(resultText);
        const prompts = Array.isArray(parsed) ? parsed : [parsed];
        res.json({ prompts });
      } catch (parseError) {
        console.error("Failed to parse extracted keyframe JSON. Text was:", resultText);
        const fallbackPrompts = resultText
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 5 && !line.startsWith('[') && !line.startsWith(']'));
        res.json({ prompts: fallbackPrompts.slice(0, 4) });
      }
    } catch (error: any) {
      console.error("Extract Keyframe Prompts Error:", error);
      res.status(500).json({ error: error.message || "Failed to extract keyframe prompts" });
    }
  });

  // Prompt Regeneration Endpoint
  app.post("/api/regenerate-prompt", async (req, res) => {
    try {
      const { type, name, description, currentPrompt, shotContext, provider = 'deepseek', userRequirements = '' } = req.body;
      
      let systemInstruction = "";
      let userPrompt = "";
      
      if (type === 'characters' || type === 'scenes' || type === 'props') {
        systemInstruction = "你是一位专业的短剧视觉设定师。你的任务是为短剧中的一个素材（角色、场景或道具）重新生成一个极具画面感、高保真、电影级的静态图像生成提示词。";
        userPrompt = `
素材类别: ${type === 'characters' ? '角色设定' : type === 'scenes' ? '场景设定' : '关键道具'}
素材名称: ${name || "未提供"}
素材描述/背景: ${description || "未提供"}
当前旧的提示词 (参考使用): ${currentPrompt || "无"}

【生成要求】：
1. 重新生成一个简洁、精准的提示词，只描写「生成该素材参考图」真正需要的信息（角色=外貌+服装；场景=环境构造+光影；道具=材质+形态）。严禁冗长形容词、动作叙事，以及与视频无关的姿势/场景描写（例如不要写"坐在驾驶座上握方向盘"这类只属于某一帧的动作）。
2. 必须以该素材名称（例如：${name || 'R1_角色'}）开头，后面跟着两个空格、一个冒号、两个空格，然后是具体的提示词。
   - 如果是角色，格式示例：'${name || 'R1_角色'}  :  全身像，纯色背景，[简洁的外貌与服装描述]'
   - 如果是场景或道具，格式示例：'${name || 'S1_场景'}  :  [简洁的描述]'
3. 提示词必须用简体中文描写该角色的长相、衣着或者场景的具体构造、材质、光影氛围，保持精炼。
4. 返回的内容必须直接是生成结果，不要有任何多余的话或 markdown 块引用包围。
5. 不要在结尾添加"图片比例"或"只生成 X 张图片"之类的内容，这些由系统自动处理。${userRequirements ? `\n【用户额外需求（务必重点满足）】：\n${userRequirements}\n` : ''}`;
      } else if (type === 'shot') {
        systemInstruction = "你是一位顶级的电影导演和视频提示词专家。你的任务是为分镜头重新生成一个极致丰富、电影级、可直接交给 视频大模型的高水准【单镜头一镜到底】纯中文视频生成提示词。\n提示词只写纯视觉画面，不写台词、不写音效、不写绝对时间戳；台词与音效由系统从 dialogue/sfx 字段单独取用。";
        userPrompt = `
镜头时间范围 & 机位与动作设定：
- 镜头时间: ${shotContext?.duration || "00:00 - 00:05"}
- 镜头的运镜: ${shotContext?.camera || "无"}
- 镜头的动作 and 微表情: ${shotContext?.action || "无"}
- 镜头的台词: ${shotContext?.dialogue || "无"}
- 镜头的出场素材标签: ${shotContext?.materials || "无"}
- 当前旧的提示词: ${currentPrompt || "无"}
- 重要约定：以下所有时间描述必须从 0 秒开始。例如该镜头时间范围为 ${shotContext?.duration || "00:00-00:10"}，则内部切片秒数必须写为 0-2秒、2-5秒、5-10秒，绝对禁止使用 01:00-01:03 这类绝对时间！

【终极生成与优化要求】：
1. 必须是【一镜到底（One Continuous Shot）】。绝不能包含多阶段的剧情推进或画面剪切。
2. 绝对不写纯心理描写、听觉/音效、嗅觉等非视觉词汇，只能描述纯粹客观、可见的动作、表情、光影和运镜。
3. 核心语言：必须 100% 使用高质量、高画质的纯简体中文！绝对禁止生成、夹杂任何英文段落、英文翻译、英文绘画提示词（如 [English Prompt: ...] 等）！就中文就够了！
4. 【动态时间轴分段（绝对禁止固定/均匀切分）】：
   - 根据"动作强度"自行切分该镜头的秒数，**严禁** 0-0.5/0.5-1 均匀网格，也**严禁** 0-3/3-6/6-10 大段（画面感太差）。
   - 分段长度 = 动作强度函数：平缓交代/空镜/过渡 → 2–3 秒长拍（远景/全景/侧拍）；普通表演 → 1–2 秒（中景/中近景）；关键微动作/情绪转折/高光 → 0.5–1 秒短拍（近景/特写/低角度仰拍/高角度俯拍）。
   - 具体起止秒数按本镜内容现编，不套固定模板；必须写满整个镜头时长（${shotContext?.duration || "00:00-00:10"}）。
5. 【单切片固定语法（每段必写）】：「起-止秒 ｜ 景别 · 拍摄角度 · 镜头运动 ｜ 主体动作 ｜ 光效/细节」。景别/角度/运动三者每段必写缺一不可；光效/细节每段必写一句（丁达尔光、霓虹反射、衣角飘动、水面高光、烛光摇曳等）。
   - 示例：2-2.5秒 ｜ 近景 · 低角度仰拍 · 定住微抖 ｜ 林晚低头，指尖捏住银锁 ｜ 暮色冷光勾边
   - **【强制换行 · 最重要】每一个切片必须【单独成行】，该切片的时间前缀必须位于【这一行的行首】；上一切片内容结束后必须【换行】再写下一切片的时间前缀。绝对禁止把下一个切片的时间戳接在上一切片内容末尾（错误：「…镀金边 1.5-3秒 ｜ 中全景…」必须改为上一句回车换行、新行以「1.5-3秒 ｜」开头）。**
6. 【纯画面 + 连续性铁律】：提示词只写视觉画面，不写台词、不写音效、不写绝对时间戳。相邻切片姿态必须连续（上一段结尾 = 下一段开头），严禁人物瞬移、动作跳帧、景别硬切不连贯。禁止连续两段都是面部特写、禁止全程怼脸拍。
7. 只要提及在 elements 中提炼的人物、场景、道具，必须 100% 严格使用带 @ 的完整名称格式（如 @R1_林薇, @S1_公寓大堂），引用前后各空 2 格，绝对不准写简写，也绝对不能使用人称代词指代！
8. 返回的内容必须直接是生成的纯中文提示词，按上面「起-止秒 ｜ 景别 · 角度 · 运动 ｜ 动作 ｜ 光效」格式写满整个时长，不要有任何多余的解释、不要有 markdown 块引用包围。
`;
      } else {
        return res.status(400).json({ error: "Invalid type" });
      }

      let resultText = "";

      if (provider === "deepseek") {
        if (!process.env.DEEPSEEK_API_KEY) {
          throw new Error("DEEPSEEK_API_KEY is not configured on the server. Please add it in your settings.");
        }
        const response = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [
              { role: "system", content: systemInstruction },
              { role: "user", content: userPrompt }
            ],
            temperature: 0.4
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "DeepSeek API error");
        resultText = data.choices[0].message.content;
      } else if (provider === "doubao") {
        if (!process.env.DOUBAO_API_KEY || !process.env.DOUBAO_MODEL_ENDPOINT) {
          throw new Error("DOUBAO_API_KEY or DOUBAO_MODEL_ENDPOINT is not configured on the server.");
        }
        const response = await fetch("https://ark.cn-beijing.volces.com/api/v3/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.DOUBAO_API_KEY}`
          },
          body: JSON.stringify({
            model: process.env.DOUBAO_MODEL_ENDPOINT,
            messages: [
              { role: "system", content: systemInstruction },
              { role: "user", content: userPrompt }
            ],
            temperature: 0.4
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "Doubao API error");
        resultText = data.choices[0].message.content;
      } else {
        throw new Error("Invalid provider selected");
      }
      
      resultText = resultText.replace(/^\s*```[a-zA-Z]*/m, "").replace(/```\s*$/m, "").trim();
      // 仅基本清洗，不做任何后缀补充（图片比例、张数等全由系统别的环节处理）
      resultText = resultText.replace(/\s{2,}/g, ' ').trim();
      // 强制按时间切片换行，保证每个 X-Y秒 位于行首
      resultText = normalizeShotPrompt(resultText);
      res.json({ prompt: resultText });
    } catch (error: any) {
      console.error("Regenerate Prompt API Error:", error);
      res.status(500).json({ error: error.message || "Failed to regenerate prompt" });
    }
  });

  // 分镜配套图片导出到桌面
  app.post("/api/export-shot-assets", (req, res) => {
    try {
      const { folderName, files } = req.body;
      if (!folderName || !Array.isArray(files)) {
        return res.status(400).json({ error: "folderName and files array required" });
      }
      const safeName = folderName.replace(/[<>:"/\\|?*]/g, '_');
      const dir = path.join(os.homedir(), 'Desktop', safeName);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      for (const f of files) {
        if (!f.name || !f.dataUrl) continue;
        const base64 = f.dataUrl.split(',')[1] || f.dataUrl;
        const buf = Buffer.from(base64, 'base64');
        const safeFileName = f.name.replace(/[<>:"/\\|?*]/g, '_');
        fs.writeFileSync(path.join(dir, safeFileName), buf);
      }
      res.json({ ok: true, path: dir });
    } catch (e: any) {
      console.error("Export error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // 智能导入素材：将任意文本解析为结构化素材（角色/场景/道具）
  app.post("/api/parse-elements", async (req, res) => {
    try {
      const { text, provider = 'deepseek' } = req.body;
      if (!text || !text.trim()) {
        return res.status(400).json({ error: "缺少待解析文本" });
      }
      const promptText = `
你是一个专业的影视素材解析助手。用户会给你一段关于短剧素材的文字（可能是自然语言描述、列表、或半结构化文本），你需要从中智能识别出三类素材，并提取成结构化数据。

【素材类别】
- 角色（characters）：有名字的人物、拟人化角色等
- 场景（scenes）：故事发生的地点、环境
- 道具（props）：关键物品、器物

【提取规则】
1. 智能判断每个素材属于哪一类，不要漏掉文本中明确出现的素材。
2. 为每个素材生成一个简洁的「名称」(name)：
   - 角色名称格式：R1_简短名称、R2_简短名称……（按顺序编号，如 R1_林晚）
   - 场景名称格式：S1_简短名称、S2_简短名称……
   - 道具名称格式：P1_简短名称、P2_简短名称……
   - 名称要简短、能代表该素材，用中文或中英组合均可，但不要带空格。
3. 为每个素材生成一段「简洁」的「提示词」(prompt)：纯中文的视觉描述，只写生成参考图真正需要的信息（角色=外貌+服装；场景=环境构造+光影；道具=材质+形态），可直接用于 AI 绘图。严禁堆砌冗长形容词，严禁加入动作叙事或与视频无关的姿势/场景描写。
4. 如果用户原文已经带有可用的视觉描述，请提炼优化后填入 prompt；如果没有，请基于常识合理补全。

【返回格式】
只返回一个合法的 JSON 对象（不要任何 Markdown 代码块、不要多余解释），结构如下：
{
  "characters": [ { "name": "R1_林晚", "prompt": "黑长直发，苍白面容……" } ],
  "scenes": [ { "name": "S1_古井村老宅", "prompt": "老旧木结构……" } ],
  "props": [ { "name": "P1_银锁", "prompt": "古朴银色长命锁……" } ]
}
若某一类没有素材，返回空数组。
`;

      let resultText = "";
      const messages = [{ role: "user", content: promptText + "\n\n【用户原文】\n" + text }];

      if (provider === "deepseek") {
        if (!process.env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY is not configured on the server.");
        const response = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}` },
          body: JSON.stringify({ model: "deepseek-chat", messages, temperature: 0.4 })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "DeepSeek API error");
        resultText = data.choices[0].message.content;
      } else if (provider === "doubao") {
        if (!process.env.DOUBAO_API_KEY || !process.env.DOUBAO_MODEL_ENDPOINT) throw new Error("DOUBAO_API_KEY or DOUBAO_MODEL_ENDPOINT is not configured on the server.");
        const response = await fetch("https://ark.cn-beijing.volces.com/api/v3/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.DOUBAO_API_KEY}` },
          body: JSON.stringify({ model: process.env.DOUBAO_MODEL_ENDPOINT, messages, temperature: 0.4 })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "Doubao API error");
        resultText = data.choices[0].message.content;
      } else {
        throw new Error("Invalid provider selected");
      }

      resultText = resultText.replace(/^\s*```[a-zA-Z]*/m, "").replace(/```\s*$/m, "").trim();
      const parsed = safeParseJson(resultText);
      if (!parsed || typeof parsed !== 'object') throw new Error("模型返回无法解析为素材结构");
      const result = {
        characters: Array.isArray(parsed.characters) ? parsed.characters : [],
        scenes: Array.isArray(parsed.scenes) ? parsed.scenes : [],
        props: Array.isArray(parsed.props) ? parsed.props : [],
      };
      res.json(result);
    } catch (error: any) {
      console.error("Parse Elements API Error:", error);
      res.status(500).json({ error: error.message || "Failed to parse elements" });
    }
  });

  // 视频上传端点
  app.use("/api/videos", express.static(path.join(process.cwd(), 'uploads')));
  app.post("/api/upload-video", upload.single('video'), (req: any, res) => {
    if (!req.file) return res.status(400).json({ error: "No video file uploaded" });
    res.json({ filename: req.file.filename, originalName: req.file.originalname });
  });

  // 合并某一集的所有分镜视频
  app.post("/api/merge-episode-videos", async (req, res) => {
    try {
      const { filenames } = req.body;
      if (!Array.isArray(filenames) || filenames.length < 2) {
        return res.status(400).json({ error: "至少需要2个视频才能合并" });
      }
      const uploadsDir = path.join(process.cwd(), 'uploads');
      // 检查所有文件是否存在
      const validFiles = filenames.filter(f => fs.existsSync(path.join(uploadsDir, f)));
      if (validFiles.length < 2) {
        return res.status(400).json({ error: "有效视频文件不足2个" });
      }
      // 创建 ffmpeg concat 列表文件
      const concatList = validFiles.map(f => `file '${path.join(uploadsDir, f).replace(/'/g, "'\\''")}'`).join('\n');
      const listPath = path.join(uploadsDir, `concat_${Date.now()}.txt`);
      fs.writeFileSync(listPath, concatList, 'utf-8');
      const outName = `merged_${Date.now()}.mp4`;
      const outPath = path.join(uploadsDir, outName);
      const { execSync } = await import('child_process');
      execSync(`ffmpeg -f concat -safe 0 -i "${listPath}" -c copy -y "${outPath}"`, { stdio: 'pipe', timeout: 60000 });
      // 清理临时列表文件
      fs.unlinkSync(listPath);
      res.json({ filename: outName });
    } catch (err: any) {
      console.error("Merge error:", err);
      res.status(500).json({ error: `视频合并失败: ${err.message || err}。请确保已安装 ffmpeg (brew install ffmpeg)` });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });

  app.get("/api/system-prompts", (req, res) => { res.json(readJSON('system-prompts.json') || defaultPrompts); });
  app.put("/api/system-prompts", (req, res) => { writeJSON('system-prompts.json', req.body); res.json({ ok: true }); });

  // 脚本 CRUD
  app.get("/api/scripts", (req, res) => { res.json(readJSON('scripts.json') || []); });
  app.post("/api/scripts", (req, res) => {
    const s = req.body; const list = readJSON('scripts.json') || [];
    const i = list.findIndex((x: any) => x.id === s.id);
    if (i >= 0) list[i] = s; else list.unshift(s);
    writeJSON('scripts.json', list); res.json({ ok: true });
  });
  app.delete("/api/scripts/:id", (req, res) => {
    const list = readJSON('scripts.json') || [];
    writeJSON('scripts.json', list.filter((x: any) => x.id !== req.params.id));
    res.json({ ok: true });
  });

  // 素材库 CRUD
  app.get("/api/materials", (req, res) => { res.json(readJSON('materials.json') || []); });
  app.post("/api/materials", (req, res) => {
    const m = req.body.material; if (!m) return res.status(400).json({ error: 'material required' });
    const list = readJSON('materials.json') || [];
    const i = list.findIndex((x: any) => x.type === m.type && x.name === m.name);
    if (i >= 0) list[i] = { ...list[i], ...m }; else list.unshift(m);
    writeJSON('materials.json', list); res.json({ ok: true });
  });
  app.delete("/api/materials/:id", (req, res) => {
    const list = readJSON('materials.json') || [];
    writeJSON('materials.json', list.filter((x: any) => x.id !== req.params.id));
    res.json({ ok: true });
  });
  app.delete("/api/materials", (req, res) => { writeJSON('materials.json', []); res.json({ ok: true }); });

  // 迁移 localStorage 数据到服务器
  app.post("/api/migrate", (req, res) => {
    if (req.body.scripts) writeJSON('scripts.json', req.body.scripts);
    if (req.body.materials) writeJSON('materials.json', req.body.materials);
    res.json({ ok: true });
  });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Global error handler to prevent HTML error responses
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled Server Error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  });

  // ===== 数据存储 API（本地 ./data/ 目录） =====
  const DATA_DIR = path.join(process.cwd(), 'data');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const readJSON = (file: string) => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8')); } catch { return null; } };
  const writeJSON = (file: string, data: any) => { fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), 'utf-8'); };

  const defaultPrompts = {
  elementPrompt: "你是一位专业的短剧视觉设定师。任务是为短剧素材重新生成静态图像提示词。\n\n素材类别: ${type}  素材名称: ${name}  素材描述: ${description}  旧提示词: ${currentPrompt}\n\n【生成要求】：\n1. 重新生成简洁精准的提示词，只描写生成该素材参考图真正需要的信息。\n2. 必须以素材名称开头。\n3. 用简体中文描写，保持精炼。\n4. 不要加图片比例或只生成X张图片等内容。",
  shotPrompt: "你是一位顶级的电影导演和视频提示词专家。任务是为分镜头重新生成【单镜头一镜到底】纯中文视频生成提示词。提示词只写纯视觉画面，不写台词、不写音效、不写绝对时间戳。\n\n【drama-skill 规则】：\n## 一、动态时间轴分段\n根据动作强度切分：平缓交代→2-3秒长拍(远景)；普通表演→1-2秒(中景)；关键微动作→0.5-1秒短拍(近景/特写/低角度仰拍)。每个镜头具体起止秒数按内容现编。\n## 二、单切片固定语法\n「起-止秒 ｜ 景别·角度·运动 ｜ 主体动作 ｜ 光效/细节」每段必写。每个切片单独成行，时间前缀在行首。\n## 三、影视级词汇库\n景别：远景/全景/中景/中近景/近景/特写。角度：平视/低角度仰拍/高角度俯拍/侧面拍/正面拍/过肩拍。运动：缓慢推近/极慢后拉/横移跟拍/手持微抖/定住/环绕/升降/收尾定格。\n## 四、连续性铁律\n相邻切片姿态必须连续，严禁人物瞬移、动作跳帧、景别硬切不连贯。",
  fullMainPrompt: "如果你是一位专业的AI短剧编剧和导演。任务是生成完整的视频脚本和拆解。\n\n题裁/创意/现有脚本/参考视频作为输入。\n\n【核心素材提炼规则】：\n1. 只有多次重复出现的要素才提炼到 elements 中。\n2. 每个素材 prompt 必须简洁，只写参考图需要的信息。\n\n【返回 JSON 格式】：\n{\"title\":\"...\",\"logline\":\"...\",\"story\":\"...\",\"elements\":{\"characters\":[...],\"scenes\":[...],\"props\":[...]},\"shots\":[{\"shotNumber\":1,\"duration\":\"00:00-00:10\",\"camera\":\"...\",\"action\":\"...\",\"dialogue\":\"...\",\"sfx\":\"...\",\"materials\":\"@R1_...\",\"prompt\":\"...\"}]}\n\n【分镜视频提示词 drama-skill 规则】：\n一、动态时间轴分段（根据动作强度切分，严禁均匀/固定切分）\n二、单切片固定语法（「起-止秒 ｜ 景别·角度·运动 ｜ 动作 ｜ 光效/细节」）\n三、影视级词汇库（景别/角度/运动专业词汇）\n四、连续性铁律（相邻切片姿态连续，严禁瞬移跳帧）\n五、纯画面描述（prompt只写视觉，台词→dialogue，音效→sfx）",
  realElementSys: `你是一位专业的短剧视觉设定师。你的任务是为短剧中的一个素材（角色、场景或道具）重新生成一个极具画面感、高保真、电影级的静态图像生成提示词。`,
  realElementPrompt: `素材类别: ${'$'}{type === 'characters' ? '角色设定' : type === 'scenes' ? '场景设定' : '关键道具'}
素材名称: ${'$'}{name || "未提供"}
素材描述/背景: ${'$'}{description || "未提供"}
当前旧的提示词 (参考使用): ${'$'}{currentPrompt || "无"}

【生成要求】：
1. 重新生成一个简洁、精准的提示词，只描写「生成该素材参考图」真正需要的信息（角色=外貌+服装；场景=环境构造+光影；道具=材质+形态）。严禁冗长形容词、动作叙事，以及与视频无关的姿势/场景描写（例如不要写"坐在驾驶座上握方向盘"这类只属于某一帧的动作）。
2. 必须以该素材名称（例如：${'$'}{name || 'R1_角色'}）开头，后面跟着两个空格、一个冒号、两个空格，然后是具体的提示词。
   - 如果是角色，格式示例：'${'$'}{name || 'R1_角色'}  :  全身像，纯色背景，[简洁的外貌与服装描述]'
   - 如果是场景或道具，格式示例：'${'$'}{name || 'S1_场景'}  :  [简洁的描述]'
3. 提示词必须用简体中文描写该角色的长相、衣着或者场景的具体构造、材质、光影氛围，保持精炼。
4. 返回的内容必须直接是生成结果，不要有任何多余的话或 markdown 块引用包围。
5. 不要在结尾添加"图片比例"或"只生成 X 张图片"之类的内容，这些由系统自动处理。${'$'}{userRequirements ? '\n【用户额外需求（务必重点满足）】：\n' + userRequirements + '\n' : ''}`,
  realShotSys: `你是一位顶级的电影导演和视频提示词专家。你的任务是为分镜头重新生成一个极致丰富、电影级、可直接交给 视频大模型的高水准【单镜头一镜到底】纯中文视频生成提示词。\n提示词只写纯视觉画面，不写台词、不写音效、不写绝对时间戳；台词与音效由系统从 dialogue/sfx 字段单独取用。`,
  realShotPrompt: `镜头时间范围 & 机位与动作设定：
- 镜头时间: ${'$'}{shotContext?.duration || "00:00 - 00:05"}
- 镜头的运镜: ${'$'}{shotContext?.camera || "无"}
- 镜头的动作 and 微表情: ${'$'}{shotContext?.action || "无"}
- 镜头的台词: ${'$'}{shotContext?.dialogue || "无"}
- 镜头的出场素材标签: ${'$'}{shotContext?.materials || "无"}
- 当前旧的提示词: ${'$'}{currentPrompt || "无"}
- 重要约定：以下所有时间描述必须从 0 秒开始。例如该镜头时间范围为 ${'$'}{shotContext?.duration || "00:00-00:10"}，则内部切片秒数必须写为 0-2秒、2-5秒、5-10秒，绝对禁止使用 01:00-01:03 这类绝对时间！

【终极生成与优化要求】：
1. 必须是【一镜到底（One Continuous Shot）】。绝不能包含多阶段的剧情推进或画面剪切。
2. 绝对不写纯心理描写、听觉/音效、嗅觉等非视觉词汇，只能描述纯粹客观、可见的动作、表情、光影和运镜。
3. 核心语言：必须 100% 使用高质量、高画质的纯简体中文！绝对禁止生成、夹杂任何英文段落、英文翻译、英文绘画提示词（如 [English Prompt: ...] 等）！就中文就够了！
4. 【动态时间轴分段（绝对禁止固定/均匀切分）】：
   - 根据"动作强度"自行切分该镜头的秒数，**严禁** 0-0.5/0.5-1 均匀网格，也**严禁** 0-3/3-6/6-10 大段（画面感太差）。
   - 分段长度 = 动作强度函数：平缓交代/空镜/过渡 → 2-3 秒长拍（远景/全景/侧拍）；普通表演 → 1-2 秒（中景/中近景）；关键微动作/情绪转折/高光 → 0.5-1 秒短拍（近景/特写/低角度仰拍/高角度俯拍）。
   - 具体起止秒数按本镜内容现编，不套固定模板；必须写满整个镜头时长（${'$'}{shotContext?.duration || "00:00-00:10"}）。
5. 【单切片固定语法（每段必写）】：「起-止秒 ｜ 景别 · 拍摄角度 · 镜头运动 ｜ 主体动作 ｜ 光效/细节」。景别/角度/运动三者每段必写缺一不可；光效/细节每段必写一句（丁达尔光、霓虹反射、衣角飘动、水面高光、烛光摇曳等）。
   - 示例：2-2.5秒 ｜ 近景 · 低角度仰拍 · 定住微抖 ｜ 林晚低头，指尖捏住银锁 ｜ 暮色冷光勾边
   - **【强制换行 · 最重要】每一个切片必须【单独成行】，该切片的时间前缀必须位于【这一行的行首】；上一切片内容结束后必须【换行】再写下一切片的时间前缀。绝对禁止把下一个切片的时间戳接在上一切片内容末尾（错误：「…镀金边 1.5-3秒 ｜ 中全景…」必须改为上一句回车换行、新行以「1.5-3秒 ｜」开头）。**
6. 【纯画面 + 连续性铁律】：提示词只写视觉画面，不写台词、不写音效、不写绝对时间戳。相邻切片姿态必须连续（上一段结尾 = 下一段开头），严禁人物瞬移、动作跳帧、景别硬切不连贯。禁止连续两段都是面部特写、禁止全程怼脸拍。
7. 只要提及在 elements 中提炼的人物、场景、道具，必须 100% 严格使用带 @ 的完整名称格式（如 @R1_林薇, @S1_公寓大堂），引用前后各空 2 格，绝对不准写简写，也绝对不能使用人称代词指代！
8. 返回的内容必须直接是生成的纯中文提示词，按上面「起-止秒 ｜ 景别 · 角度 · 运动 ｜ 动作 ｜ 光效」格式写满整个时长，不要有任何多余的解释、不要有 markdown 块引用包围。`,
  realMainPrompt: `如果你是一位专业的AI短剧编剧和导演。
我将提供给你一个题材、一个创意，或者一段现有的脚本内容，或者是参考视频。你的任务是生成完整的视频脚本和拆解。
题材: ${'$'}{theme || "未提供"}
创意: ${'$'}{idea || "未提供"}
现有脚本: ${'$'}{existingScript || "未提供"}
参考视频要求: ${'$'}{videoIdea || "未提供"}

【核心素材提炼与一致性控制规则 - 极为重要！】：
1. 只有在整个短剧中「多次、重复出现」需要保持视觉一致性的场景、道具，或者是对剧情起决定性作用的核心背景、核心道具，才需要提炼到 elements.scenes 或 elements.props 中，并为其生成专门的素材设定图/提示词。
2. 凡是「只出现一次」的、普通的或过渡性的场景和道具（例如只在一个镜头里作为背景的路边摊、只拿了一下就没下文的杯子等），绝对不要提炼，直接在分镜头的 prompt 中用具体的文字来详细描述即可，以防冗余素材污染！
3. 每个素材的 prompt 必须「简洁」：只写生成参考图真正需要的信息（角色=外貌+服装；场景=环境构造+光影；道具=材质+形态），严禁堆砌冗长形容词、动作叙事，以及与视频无关的姿势/场景描写（例如不要写"坐在驾驶座上握方向盘"这类只属于某一帧的动作）。

你必须 100% 严格以如下的 JSON 格式返回。不要包含任何 markdown 包裹，不要有任何额外的文字 or 解释：
{
  "title": "短剧的标题（中文，简洁有力，有吸引力）",
  "logline": "一句话概括整个故事（中文，不超过30字，抓人眼球）",
  "story": "完整的故事大纲（中文，不少于300字，按段落组织，每段讲一集或一个主要情节，用换行分隔）",
  "elements": {
    "characters": [{ "name": "R1_角色名", "description": "...", "prompt": "..." }],
    "scenes": [{ "name": "S1_场景名", "description": "...", "prompt": "..." }],
    "props": [{ "name": "P1_道具名", "description": "...", "prompt": "..." }]
  },
  "shots": [{
    "shotNumber": 1, "episodeIndex": 0, "duration": "00:00-00:10",
    "camera": "电影级运镜与机位控制",
    "action": "具体动作与表情",
    "dialogue": "角色名称：台词",
    "sfx": "音效或背景音乐描述",
    "materials": "@R1_角色名 @S1_场景名",
    "prompt": "完整分镜头视频提示词"
  }]
}

【分镜视频提示词（prompt）生成规范 - 使用以下专业规则】：
# drama-skill【电影级分镜 · 动态分段 · 智能景别角度控制】
## 一、动态时间轴分段（最重要，绝对禁止固定/均匀切分）
根据"动作强度"自行切分每个 10 秒镜头的时间轴，**严禁**使用 0-0.5/0.5-1 这种均匀网格，也**严禁**使用 0-3/3-6/6-10 这种大段（画面感太差）。分段长度 = 该时间段内动作强度的函数：
- 平缓交代 / 空镜 / 过渡        → 2-3 秒长拍，配 远景 / 全景 / 侧拍
- 普通表演（中速动作）          → 1-2 秒，配 中景 / 中近景
- 关键微动作 / 情绪转折 / 高光  → 0.5-1 秒短拍，配 近景 / 特写 / 低角度仰拍 / 高角度俯拍
每个镜头的具体起止秒数由你按该镜实际内容现编，**不要套固定模板**（例：0-2 / 2-2.5 / 2.5-5 / 5-6 / 6-8 / 8-8.5 / 8.5-10 仅为示例，不是固定序列）。

## 二、单切片固定语法（每段必须严格遵循）
「起-止秒 ｜ 景别 · 拍摄角度 · 镜头运动 ｜ 主体动作 ｜ 光效/细节」
示例：2-2.5秒 ｜ 近景 · 低角度仰拍 · 定住微抖 ｜ 林晚低头，指尖捏住腰间银锁 ｜ 衣角静止，暮色冷光勾边
- **【强制换行 · 最重要】每一个切片必须【单独成行】，该切片的时间前缀（起-止秒）必须位于【这一行的行首】。**
- 景别、拍摄角度、镜头运动三者每段必写，缺一不可。
- 光效/细节每段必写一句（丁达尔光、霓虹反射、衣角飘动、水面高光、烛光摇曳等）。
- 复用素材引用：@Rxx/@Sxx/@Pxx 素材引用前后各空 2 格。
- 纯画面描述：prompt 字段只写视觉画面，不写台词、不写音效、不写绝对时间戳。

## 三、影视级专业词汇库（直接套用，禁止自创口语化运镜）
景别：远景 / 全景 / 中景 / 中近景 / 近景 / 特写
角度：平视 / 低角度仰拍 / 高角度俯拍 / 侧面拍 / 正面拍 / 过肩拍
运动：缓慢推近 / 极慢后拉 / 横移跟拍 / 手持微抖 / 定住(静止) / 环绕 / 升降 / 收尾定格

## 四、连续性铁律
相邻切片之间姿态必须连续：上一段结尾的状态 = 下一段开头的起点。严禁人物瞬移、动作跳帧、景别硬切不连贯。

【prompt 字段填写说明】：将分镜模板中每个大分镜的完整文本填入对应 shot 的 prompt 字段。每个 duration 固定 10 秒，从 00:00 开始按序递增。`,
};



  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
