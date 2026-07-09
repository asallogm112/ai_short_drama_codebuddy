import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { createServer as createViteServer } from "vite";
import "dotenv/config";
import multer from "multer";
import JSON5 from "json5";

const upload = multer({ dest: 'uploads/' });

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
        "prompt": "用于生成该角色的提示词。必须以该角色名字开头，格式严格为：'角色名字  :  [详细的外貌与服装描述]，图片比例 : 16:9，只生成 1 张图片 , 如果 生成过 , 就不要再生成了 . 切记 切记 , 因为要 保证 一致性  !'"
      }
    ],
    "scenes": [ // 在这里提炼核心或重复出现的场景
      {
        "name": "场景名称 (必须以 S1_、S2_ 等作为前缀，例如 S1_深夜荒河滩)",
        "description": "场景的详细细节和氛围",
        "prompt": "用于生成场景背景的提示词。必须以该场景名字开头，格式严格为：'场景名称  :  [详细的背景和灯光描述]，图片比例 : 16:9，只生成 1 张图片 , 如果 生成过 , 就不要再生成了 . 切记 切记 , 因为要 保证 一致性  !'"
      }
    ],
    "props": [ // 在这里提炼核心或重复出现的道具
      {
        "name": "道具名称 (必须以 P1_、P2_ 等作为前缀，例如 P1_灰布)",
        "description": "道具的详细细节",
        "prompt": "用于生成该道具的提示词。必须以该道具名字开头，格式严格为：'道具名称  :  [详细的材质和形态描述]，图片比例 : 16:9，只生成 1 张图片 , 如果 生成过 , 就不要再生成了 . 切记 切记 , 因为要 保证 一致性  !'"
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
# drama-skill【纯专业分镜终版｜无任何素材规则+升级版影视运镜】
## 一、秒级分镜强制硬性规则
1. 10秒为1个大分镜，编号格式：镜N (起始总时长-结束总时长s) 【段落功能】，每个独立切片在所属大分镜内部时间统一从0秒重新计数
2. 大分镜内严格执行「全景定场→中景叙事→特写落点」景别递进，禁止颠倒景别顺序
3. 单切片固定语法：「切片内起始秒  景别  专业运镜术语 , 画面内容 , 台词: 对话内容 , 音效: 该时间段声音描述」。音效应按时间段拆分嵌入，禁止在末尾用独立段落或列表汇总。
4. 复用素材引用：@Rxx/@Sxx/@Pxx 素材引用前后各空2格
5. 台词格式： @R1_XX  说："台词内容"。无台词强制标注「台词：无」
6. 台词固定格式： @R1_XX  说："台词内容"
7. 镜头转场：必须标注「镜头切到/镜头切至」，光影氛围直接融入画面描述撰写
8. 禁止口语化运镜：删掉慢慢推、动一动镜头、凑近拍这类通俗话术，必须使用标准专业运镜术语
8. 禁止混用景别，禁止打乱全景→中景→特写递进逻辑
9. 复用素材必须挂载 @索引，零散临时物件、环境细节，禁止新增 P/S/R 编号
10. 空白字段禁止留白，统一填写「无」
11. 光影、环境质感全部并入画面描述，禁止单独拆分字段

## 二、影视级专业运镜词库（直接套用，禁止自创口语化运镜）
### 基础机位运镜
固定镜头、匀速向前推镜、慢速向后拉镜、极速变焦推镜、缓慢变焦拉镜
### 角度运镜
垂直俯拍、四十五度俯拍、低角度仰拍、极致仰拍、平视正拍、侧拍跟焦
### 动态运镜
环绕运镜、环绕缓推、横移跟拍、纵向升镜、镜头下沉、斜向滑移、摇镜扫视
### 特写精细化运镜
瞳孔微距推镜、指尖定点推镜、局部焦点锁焦、虚实焦切换运镜、微颤手持拍摄、平稳防抖手持
### 叙事运镜
过肩推拉、正反打运镜、前景遮挡运镜、景深压缩运镜、收尾定格运镜

## 三、分镜标准输出模板
**镜1 (0-10s) 【功能标注】**
0-2秒  全景  固定镜头， @S1_XX  空间与人物位置交代，台词：无，音效：环境音
3-6秒  中景  匀速向前推镜，镜头切到  @R1_XX  核心动作推进，台词：无，音效：动作音效
7-10秒 特写  瞳孔微距推镜，镜头切到  @R1_XX  情绪细节落点，台词:  @R1_XX  说："对话内容" , 音效：收尾音效

### 补充说明
每个大分镜内部切片计时独立重置，比如镜2(10-20s)里的镜头切片依旧从0秒算起，示例：
**镜2 (10-20s) 【功能标注】**
0-3秒  中景  横移跟拍，画面内容，台词：无，音效：环境声
3-6秒  中景 镜头上推 从 @R1_XX 脚部 慢慢推到头部  然后  全身景
6-10秒 近景  低角度仰拍，画面内容，台词: @R1_XX 说："台词"，音效：动作音

【prompt 字段填写说明】：
将上述分镜模板中每个大分镜的完整文本（包括 **镜N** 标题行和所有切片行）填入对应 shot 的 prompt 字段中。每个 shot 的 duration 固定为 10 秒，从 00:00 开始按序递增：00:00-00:10、00:10-00:20、00:20-00:30 ...
camera 字段填写该镜头的总运镜概括，action 字段填核心动作，dialogue 字段填台词。
【音效规范】：音效应按时间段分段嵌入（如"0-2秒 音效：环境音"），禁止在末尾用独立的「音效/背景音乐」段落或列表汇总。只能写纯视觉画面描述和对应时间段的音效描述。
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
          const targetKeywords = "全身像，角色三视图设定图，纯色背景";
          if (!cleanPrompt.includes("全身像") || !cleanPrompt.includes("角色三视图") || !cleanPrompt.includes("纯色背景")) {
            cleanPrompt = `${targetKeywords}，${cleanPrompt}`;
          }
          cleanPrompt = cleanPrompt.replace(/比例\s*为?\s*3\s*:\s*1/gi, '');
          cleanPrompt = cleanPrompt.replace(/3\s*:\s*1/g, '');
          cleanPrompt = cleanPrompt.replace(/(图片|比例)?\s*比例?\s*为?\s*16\s*:\s*9/gi, '');
          cleanPrompt = cleanPrompt.replace(/16\s*:\s*9/g, '');
          cleanPrompt = `${cleanPrompt}，图片比例 : 16:9`;
        }

        const suffixPattern = /[，,、]?\s*(生成|只生成)\s*1\s*张(图片)?\s*,\s*如果\s*生成过\s*,\s*就不要再生成了\s*\.?\s*(切记\s*切记\s*,\s*因为要\s*保证\s*一致性\s*!)?/gi;
        cleanPrompt = cleanPrompt.replace(suffixPattern, '');
        cleanPrompt = cleanPrompt.replace(/[，,、]?\s*切记\s*切记\s*,\s*因为要\s*保证\s*一致性\s*!/gi, '');
        cleanPrompt = cleanPrompt.trim().replace(/[，。,\.\s]+$/, '');
        cleanPrompt = `${cleanPrompt}，只生成 1 张图片 , 如果 生成过 , 就不要再生成了 . 切记 切记 , 因为要 保证 一致性  !`;

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
              prompt: enforcePrefix(char.name, char.prompt, 'characters')
            }));
          }
          if (parsedData.elements.scenes && Array.isArray(parsedData.elements.scenes)) {
            parsedData.elements.scenes = parsedData.elements.scenes.map((scene: any) => ({
              ...scene,
              prompt: enforcePrefix(scene.name, scene.prompt, 'scenes')
            }));
          }
          if (parsedData.elements.props && Array.isArray(parsedData.elements.props)) {
            parsedData.elements.props = parsedData.elements.props.map((prop: any) => ({
              ...prop,
              prompt: enforcePrefix(prop.name, prop.prompt, 'props')
            }));
          }
        }
        
        if (parsedData.shots && Array.isArray(parsedData.shots)) {
          parsedData.shots = parsedData.shots.map((shot: any) => ({
            ...shot,
            prompt: enforceShotPromptTags(shot.prompt, parsedElements)
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
3. 【极重要：分镜视频提示词（prompt）生成与时段/秒数划分规范】：
   - 核心语言：必须 100% 使用高质量、高画质的纯简体中文！绝对禁止生成、夹杂任何英文段落、英文翻译、英文绘画提示词（如 [English Prompt: ...] 等）！就中文就够了！
   - 【严格控制分镜头秒数，绝对禁止大跨度时间范围】：
     - 视频生成大模型每次只能生成 1 个单一的、连续的镜头 clip (通常为 3-6 秒)。
     - shots 列表中的每个分镜头，其 duration（持续时间范围）必须非常短（严格在 3 到 6 秒之间，例如 00:00 - 00:03，00:03 - 00:08，00:08 - 00:13）。
     - 绝对严禁生成任何持续时间大于 6 秒的分镜头（如 '00:09 - 00:25' 这种大跨度区间是绝对被禁止的！）。
     - 如果续写的某个场景段落很长，你必须将其主动分割成多个连续的、时间段在 3-6 秒之内的独立分镜头对象，并依次列在 shots 数组中！
   - 【时间段与动作一秒一画、精确对应，绝对禁止 AI 自由发挥】：
     - 绝对严禁写成如 '【00:09 - 00:25】水下POV第一视角，镜头以极缓慢游动...' 这样含糊大段、让 AI 自由发挥的写法！这是完全不能接受的，绝对禁止！
     - 正确的写法是：必须将整个镜头时间范围拆分成极其精确的子时间阶段（通常是3-6秒一个子区间），每个子区间必须精确写明几分几秒到几分几秒发生什么。
     - 格式必须写成如：'00:09 - 00:12 xxx 00:13 - 00:19 xxx 00:20 - 00:25 xxx'。
     - 必须在提示词内精确细分到每一秒的具体镜头、客观可见动作、画面细节，用连贯的微观节点组成一镜到底！
   - 【台词/对话 100% 融入到画面描述中（极为重要！）】：
     - 如果分镜头包含台词（dialogue 字段），你必须将台词、说话角色当时的面部微表情、肢体动作等视觉动作 100% 融合到该镜头的提示词（prompt）中。
     - 台词的书写格式必须严格为：'@角色名字 说 : \"台词内容\"' （例如：'此时，岸上 @R2_阿强 从远处走来，裹着旧夹克，脚步迟疑，远远望向河边，脸部肌肉微微抽动，眼神从疑惑逐渐转为不安，嘴唇微张。@R2_阿强 说 : \"这么晚，谁还在河边？\"'）。
     - 绝对严禁把台词 and 画面提示词剥离开来！
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
         "duration": "该镜头的时间范围，例如：00:00 - 00:05，绝对严禁超过6秒",
         "camera": "电影级、极具高级感的连续多阶段镜头运动和机位",
         "action": "镜头中发生的具体连续动作 and 微表情变化",
         "dialogue": "角色名称：台词（如果有）",
         "sfx": "音效或背景音乐描述",
         "materials": "所用到的素材（例如：@R1_林薇 @S1_公寓大堂）",
         "prompt": "极度丰富、电影级单镜头高画质纯中文视频提示词，格式如：'【00:00 - 00:05】[中文核心画面视觉描述（包含运镜、动作、融入的台词和镜头参数）]。'"
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
          const targetKeywords = "全身像，角色三视图设定图，纯色背景";
          if (!cleanPrompt.includes("全身像") || !cleanPrompt.includes("角色三视图") || !cleanPrompt.includes("纯色背景")) {
            cleanPrompt = `${targetKeywords}，${cleanPrompt}`;
          }
          cleanPrompt = cleanPrompt.replace(/比例\s*为?\s*3\s*:\s*1/gi, '');
          cleanPrompt = cleanPrompt.replace(/3\s*:\s*1/g, '');
          cleanPrompt = cleanPrompt.replace(/(图片|比例)?\s*比例?\s*为?\s*16\s*:\s*9/gi, '');
          cleanPrompt = cleanPrompt.replace(/16\s*:\s*9/g, '');
          cleanPrompt = `${cleanPrompt}，图片比例 : 16:9`;
        }

        const suffixPattern = /[，,、]?\s*(生成|只生成)\s*1\s*张(图片)?\s*,\s*如果\s*生成过\s*,\s*就不要再生成了\s*\.?\s*(切记\s*切记\s*,\s*因为要\s*保证\s*一致性\s*!)?/gi;
        cleanPrompt = cleanPrompt.replace(suffixPattern, '');
        cleanPrompt = cleanPrompt.replace(/[，,、]?\s*切记\s*切记\s*,\s*因为要\s*保证\s*一致性\s*!/gi, '');
        cleanPrompt = cleanPrompt.trim().replace(/[，。,\.\s]+$/, '');
        cleanPrompt = `${cleanPrompt}，只生成 1 张图片 , 如果 生成过 , 就不要再生成了 . 切记 切记 , 因为要 保证 一致性  !`;

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
            prompt: enforcePrefix(char.name, char.prompt, 'characters')
          }));
        }
        if (scns && Array.isArray(scns)) {
          parsedData.newElements.scenes = scns.map((scene: any) => ({
            ...scene,
            prompt: enforcePrefix(scene.name, scene.prompt, 'scenes')
          }));
        }
        if (prps && Array.isArray(prps)) {
          parsedData.newElements.props = prps.map((prop: any) => ({
            ...prop,
            prompt: enforcePrefix(prop.name, prop.prompt, 'props')
          }));
        }
      }

      // Enforce shot prompt tags on continued shots
      if (parsedData.shots && Array.isArray(parsedData.shots)) {
        parsedData.shots = parsedData.shots.map((shot: any) => ({
          ...shot,
          prompt: enforceShotPromptTags(shot.prompt, parsedElements)
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
5. 在末尾自动包含 "，图片比例 : 16:9，只生成 1 张图片 , 如果 生成过 , 就不要再生成了 . 切记 切记 , 因为要 保证 一致性  !"。
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
我现在给你提供一个"视频生成提示词"（Video Generation Prompt），该提示词描述了一个镜头（Shot）的完整动态过程、时长、机位、台词等内容，其中可能包含多个由时间段分写的片段（例如：【00:00-00:03】描述A，【00:03-00:06】描述B...）。

你的任务是：仔细分析这段"视频生成提示词"，将其中连续的动态过程拆分并提取出对应的"静态关键帧图片提示词"（最多4张，通常每个明显的时间段或视觉变化生成一张）。

分镜头完整视频提示词内容：
${videoPrompt || "无"}

【提取与生成设计要求】：
1. 分析：提取出视频中所有明显的时间阶段或关键动作节点。如果是分段结构（如 【00:00-00:03】、【00:03-00:06】等），直接为每一个时间段提取出对应的精彩切片画面。
2. 数量：生成 1 到 4 个关键帧提示词（不要强行拼凑 4 个，必须根据视频提示词的实际结构，有几个明显的节点或时间段就提取几个，最多不超过4个）。
3. 视觉一致性：保持与原提示词的角色、场景、道具设定 100% 视觉一致。因此，凡是涉及到角色（如 @R1_谢老太）、场景（如 @S1_深夜荒河滩）、道具（如 @P2_xxx）等元素，你必须在生成的关键帧提示词中 100% 保留其完整的带 @ 的名称格式。
4. 内容与返回格式要求：必须 100% 使用纯简体中文描述，绝对禁止夹杂或生成英文段落/英文绘画提示词！每个关键帧提示词必须按照：'【时间段】[纯中文核心视觉画面与高画质细节、机位、电影光影、相机参数与胶片质感描述]' 格式进行设计，以便 AI 绘图模型能够完美生成。
5. 尾缀适配：为了适配系统格式，在每个生成的提示词文本末尾自动包含："，图片比例 : 16:9，只生成 1 张图片 , 如果 生成过 ,就不要再生成了 . 切记 切记 , 因为要 保证 一致性  !"。
6. 返回格式：你必须返回一个合法的 JSON 数组，数组中包含 1 到 4 个字符串元素，每个元素对应一个提取生成的关键帧提示词。
请直接返回 JSON 数组，不要包含任何 \`\`\`json 或 \`\`\` 标记，不要有任何 Markdown 包裹，不要有任何多余的汉字解释 or 说明。

示例返回格式：
[
  "【00:00-00:03】特写，@R1_谢老太 枯皱的手紧紧攥着洗衣服的灰布，指节发力凸显拉紧，水花从指缝间飞溅，冷色调，胶片颗粒质感，电影级微距，极高画质。，图片比例 : 16:9，只生成 1 张图片 , 如果 生成过 , 就不要再生成了 . 切记 切记 , 因为要 保证 一致性  !",
  "【00:03-00:06】中景，@R1_谢老太 弓背站在 @S1_深夜荒河滩 上，神情凝重地望着平静的河面，月光冷清，薄雾缭绕，电影级体积光，写实，35毫米镜头。，图片比例 : 16:9，只生成 1 张图片 , 如果 生成过 , 就不要再生成了 . 切记 切记 , 因为要 保证 一致性  !"
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
      const { type, name, description, currentPrompt, shotContext, provider = 'deepseek' } = req.body;
      
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
1. 重新生成一个崭新、更具电影感和丰富细节的提示词。
2. 必须以该素材名称（例如：${name || 'R1_角色'}）开头，后面跟着两个空格、一个冒号、两个空格，然后是具体的提示词。
   - 如果是角色，格式必须严格以：'${name || 'R1_角色'}  :  全身像，角色三视图设定图，纯色背景，[具体描述]，图片比例 : 16:9，只生成 1 张图片 , 如果 生成过 , 就不要再生成了 . 切记 切记 , 因为要 保证 一致性  !' 的形式结尾。
   - 如果是场景或道具，格式必须严格以：'${name || 'S1_场景'}  :  [具体描述]，图片比例 : 16:9，只生成 1 张图片 , 如果 生成过 , 就不要再生成了 . 切记 切记 , 因为要 保证 一致性  !' 的形式结尾。
3. 提示词必须详细描写该角色的长相、衣着或者场景的具体构造、材质、光影氛围，必须使用简体中文。
4. 返回的内容必须直接是生成结果，不要有任何多余的话或 markdown 块引用包围。
`;
      } else if (type === 'shot') {
        systemInstruction = "你是一位顶级的电影导演和视频提示词专家。你的任务是为分镜头重新生成一个极致丰富、电影级、可直接交给 视频大模型的高水准【单镜头一镜到底】纯中文视频生成提示词。\n【音效规范】：音效应按时间段分段嵌入提示词中（如“0-2秒 音效：环境音”），禁止在末尾用独立的「音效/背景音乐」段落或区块汇总。";
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
4. 【台词/对话 100% 融入到画面描述中（极为重要！）】：
   - 如果分镜头包含台词，你必须将台词、说话角色当时的面部微表情、肢体动作等视觉动作 100% 融合到生成的提示词（prompt）中。
   - 台词的书写格式必须严格为：'@角色名字 说 : \"台词内容\"' （例如：'此时，岸上 @R2_阿强 从远处走来，裹着旧夹克，脚步迟疑，远远望向河边，脸部肌肉微微抽动，眼神从疑惑逐渐转为不安，嘴唇微张。@R2_阿强 说 : \"这么晚，谁还在河边？\"'）。
   - 绝对严禁把台词和画面提示词剥离开来！
5. 【时间段与动作一秒一画、精确对应，绝对禁止 AI 自由发挥】：
   - 绝对严禁写成如 '【${shotContext?.duration || "00:00 - 00:05"}】水下POV第一视角，镜头以极缓慢游动...' 这样含糊大段、让 AI 自由发挥的写法！这是完全不能接受的，绝对禁止！
   - 正确的写法是：必须将整个镜头时间范围拆分成极其精确的子时间阶段（通常是3-6秒一个子区间，例如：00:09 - 00:12 xxx 00:13 - 00:19 xxx 00:20 - 00:25 xxx），每个子区间必须精确写明该秒数阶段发生什么，并在最后合并成一个连续的提示词。
   - 必须在提示词内精确细分到每一秒的具体镜头、客观可见动作、画面细节，用连贯的微观节点组成一镜到底！
6. 只要提及在 elements 中提炼的人物、场景、道具，必须 100% 严格使用带 @ 的完整名称格式（如 @R1_林薇, @S1_公寓大堂），绝对不准写简写，也绝对不能使用人称代词指代！
7. 返回的内容必须直接是生成的纯中文提示词，格式包含精准切分的时间秒数说明，如：'00:09 - 00:12 [精确动作描述1] 00:13 - 00:19 [精确动作描述2] 00:20 - 00:25 [精确动作描述3]'（根据实际的镜头时间范围 ${shotContext?.duration || "00:00 - 00:05"} 进行相应的细分区间拆解书写，必须写满整个时长！），不要有任何多余的解释、不要有 markdown 块引用包围。
8. 【运镜层次与景别多样性——绝对禁止全程怼脸拍】：
   - 每一镜必须包含至少3种不同景别（全景/中景/近景/特写）的切换，禁止超过50%的时间停留在同一景别。
   - 每个子段必须写明：【起始景别→结束景别】【专业运镜术语】【环境/道具/人物动作】。严格执行全景→中景→特写递进。
   - 每段必须包含【环境背景描述】（如：@S1_地铁车厢 的灯光、座椅、车窗倒影），【人物全身/半身动作】（非脸部），【道具/手部细节】。禁止连续两段都是面部特写。
   - 禁止使用"怼脸拍、面部特写、脸部、微微、淡淡、一丝、略显"等词汇作为主要内容。观众要看的是故事和空间关系，不是脸。
   - 运镜术语必须从以下选择：固定镜头、缓慢推镜、急速推镜、慢速拉镜、匀速横移跟拍、环绕运镜、低角度仰拍、垂直俯拍、过肩推拉、极速变焦推、焦点锁焦、虚实焦切换、手持微颤跟拍、镜头下沉、斜向滑移、摇镜扫视。
   - 示例正确格式：0-2秒 全景→中景 固定镜头，@S1_地铁车厢 空荡车厢内日光灯闪烁，座椅反光。2-4秒 中景 横移跟拍，@R1_林薇 站在车门旁，@P1_耳机 线缆垂落晃动。4-6秒 中景→近景 过肩推拉，@R1_林薇 视线追随远去列车。6-8秒 近景 焦点锁焦，@R1_林薇 手指松开耳机线缆，线缆弹动落地。8-10秒 全景 缓慢拉镜，@S1_地铁车厢 渐暗，@R1_林薇 身影融入阴影。
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
      // 后置清洗：删尾巴块 + 删音效前时间前缀（支持相对时间 0-3秒 和 绝对时间 00:00 - 00:03）
      resultText = resultText
        .replace(/\[音效\s*\/\s*背景音乐[^\]]*\]/g, '')
        .replace(/\d{2}:\d{2}\s*-\s*\d{2}:\d{2}\s+音效：/g, '音效：')
        .replace(/\d+-\d+\s*秒\s*音效：/g, '音效：')
        .replace(/\s{2,}/g, ' ')
        .trim();
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

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
