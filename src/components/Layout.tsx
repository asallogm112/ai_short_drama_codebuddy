import { useState } from 'react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Clapperboard, LayoutGrid, Archive, FileText, Copy, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { createPortal } from 'react-dom';

const elementPrompt = `你是一位专业的短剧视觉设定师。你的任务是为短剧中的一个素材（角色、场景或道具）重新生成一个极具画面感、高保真、电影级的静态图像生成提示词。

【生成要求】：
1. 重新生成一个简洁、精准的提示词，只描写「生成该素材参考图」真正需要的信息（角色=外貌+服装；场景=环境构造+光影；道具=材质+形态）。严禁冗长形容词、动作叙事，以及与视频无关的姿势/场景描写。
2. 必须以该素材名称开头，后面跟着两个空格、一个冒号、两个空格，然后是具体的提示词。
   - 如果是角色，格式示例：'R1_角色名  :  全身像，纯色背景，[简洁的外貌与服装描述]'
   - 如果是场景或道具，格式示例：'S1_场景名  :  [简洁的描述]'
3. 提示词必须用简体中文描写，保持精炼。
4. 不要在结尾添加"图片比例"或"只生成 X 张图片"之类的内容，这些由系统自动处理。`;

const shotPrompt = `你是一位顶级的电影导演和视频提示词专家。你的任务是为分镜头重新生成一个极致丰富、电影级、可直接交给视频大模型的高水准纯中文视频生成提示词。提示词只写纯视觉画面，不写台词、不写音效、不写绝对时间戳。

【分镜视频提示词生成规范 - drama-skill】：
## 一、动态时间轴分段
根据动作强度切分每个 10 秒镜头的时间轴：平缓→2-3秒(远景/全景)，普通→1-2秒(中景)，关键微动作→0.5-1秒(近景/特写/低角度仰拍/高角度俯拍)

## 二、单切片固定语法
「起-止秒 ｜ 景别 · 拍摄角度 · 镜头运动 ｜ 主体动作 ｜ 光效/细节」
- 每个切片单独成行，时间前缀在行首
- 景别、角度、运动三者每段必写
- 光效/细节每段必写一句
- 复用素材引用：@Rxx/@Sxx/@Pxx 前后各空 2 格
- prompt 只写视觉，台词→dialogue，音效→sfx

## 三、影视级词汇库
景别：远景/全景/中景/中近景/近景/特写
角度：平视/低角度仰拍/高角度俯拍/侧面拍/正面拍/过肩拍
运动：缓慢推近/极慢后拉/横移跟拍/手持微抖/定住(静止)/环绕/升降/收尾定格

## 四、连续性铁律
相邻切片之间姿态必须连续，严禁人物瞬移、动作跳帧、景别硬切不连贯。`;

const fullMainPrompt = `如果你是一位专业的AI短剧编剧和导演。你的任务是生成完整的视频脚本和拆解。

【核心素材提炼规则】：
1. 只有「多次重复出现」的要素才提炼到 elements 中，过渡性场景直接写在分镜 prompt 里。
2. 每个素材 prompt 必须简洁，只写参考图需要的信息。

【JSON 返回格式】：
{"title":"...","logline":"...","story":"...","elements":{"characters":[...],"scenes":[...],"props":[...]},"shots":[{"shotNumber":1,"episodeIndex":0,"duration":"00:00-00:10","camera":"...","action":"...","dialogue":"...","sfx":"...","materials":"@R1_...","prompt":"..."}]}

【分镜提示词 drama-skill 规则】：
一、动态分段：平缓2-3秒(远景)｜普通1-2秒(中景)｜关键0.5-1秒(近景/特写)
二、切片语法：「起-止秒 ｜ 景别·角度·运动 ｜ 动作 ｜ 光效/细节」，每段单独成行，时间在行首
三、景别：远景/全景/中景/中近景/近景/特写
四、角度：平视/低角度仰拍/高角度俯拍/侧面拍/正面拍/过肩拍
五、运动：缓慢推近/极慢后拉/横移跟拍/手持微抖/定住/环绕/升降/收尾定格
六、连续性：相邻切片姿态连续，严禁瞬移跳帧`;

/* ----- 真实版：实际发送给 DeepSeek 的完整提示词 ----- */
const realElementSys = `你是一位专业的短剧视觉设定师。你的任务是为短剧中的一个素材（角色、场景或道具）重新生成一个极具画面感、高保真、电影级的静态图像生成提示词。`;

const realElementPrompt = `素材类别: \${type} (角色设定/场景设定/关键道具)
素材名称: \${name || "未提供"}
素材描述/背景: \${description || "未提供"}
当前旧的提示词 (参考使用): \${currentPrompt || "无"}

【生成要求】：
1. 重新生成一个简洁、精准的提示词，只描写「生成该素材参考图」真正需要的信息（角色=外貌+服装；场景=环境构造+光影；道具=材质+形态）。严禁冗长形容词、动作叙事，以及与视频无关的姿势/场景描写（例如不要写"坐在驾驶座上握方向盘"这类只属于某一帧的动作）。
2. 必须以该素材名称（例如：\${name || 'R1_角色'}）开头，后面跟着两个空格、一个冒号、两个空格，然后是具体的提示词。
   - 如果是角色，格式示例：'\${name || 'R1_角色'}  :  全身像，纯色背景，[简洁的外貌与服装描述]'
   - 如果是场景或道具，格式示例：'\${name || 'S1_场景'}  :  [简洁的描述]'
3. 提示词必须用简体中文描写该角色的长相、衣着或者场景的具体构造、材质、光影氛围，保持精炼。
4. 返回的内容必须直接是生成结果，不要有任何多余的话或 markdown 块引用包围。
5. 不要在结尾添加"图片比例"或"只生成 X 张图片"之类的内容，这些由系统自动处理。
\${userRequirements ? '\\n【用户额外需求（务必重点满足）】：\\n' + userRequirements + '\\n' : ''}`;

const realShotSys = `你是一位顶级的电影导演和视频提示词专家。你的任务是为分镜头重新生成一个极致丰富、电影级、可直接交给 视频大模型的高水准【单镜头一镜到底】纯中文视频生成提示词。\\n提示词只写纯视觉画面，不写台词、不写音效、不写绝对时间戳；台词与音效由系统从 dialogue/sfx 字段单独取用。`;

const realShotPrompt = `镜头时间范围 & 机位与动作设定：
- 镜头时间: \${shotContext?.duration || "00:00 - 00:05"}
- 镜头的运镜: \${shotContext?.camera || "无"}
- 镜头的动作 and 微表情: \${shotContext?.action || "无"}
- 镜头的台词: \${shotContext?.dialogue || "无"}
- 镜头的出场素材标签: \${shotContext?.materials || "无"}
- 当前旧的提示词: \${currentPrompt || "无"}
- 重要约定：以下所有时间描述必须从 0 秒开始。例如该镜头时间范围为 \${shotContext?.duration || "00:00-00:10"}，则内部切片秒数必须写为 0-2秒、2-5秒、5-10秒，绝对禁止使用 01:00-01:03 这类绝对时间！

【终极生成与优化要求】：
1. 必须是【一镜到底（One Continuous Shot）】。绝不能包含多阶段的剧情推进或画面剪切。
2. 绝对不写纯心理描写、听觉/音效、嗅觉等非视觉词汇，只能描述纯粹客观、可见的动作、表情、光影和运镜。
3. 核心语言：必须 100% 使用高质量、高画质的纯简体中文！绝对禁止生成、夹杂任何英文段落、英文翻译、英文绘画提示词！就中文就够了！
4. 【动态时间轴分段（绝对禁止固定/均匀切分）】：
   - 根据"动作强度"自行切分该镜头的秒数，严禁 0-0.5/0.5-1 均匀网格，也严禁 0-3/3-6/6-10 大段（画面感太差）。
   - 分段长度 = 动作强度函数：平缓交代/空镜/过渡 → 2-3 秒长拍（远景/全景/侧拍）；普通表演 → 1-2 秒（中景/中近景）；关键微动作/情绪转折/高光 → 0.5-1 秒短拍（近景/特写/低角度仰拍/高角度俯拍）。
   - 具体起止秒数按本镜内容现编，不套固定模板；必须写满整个镜头时长。
5. 【单切片固定语法（每段必写）】：「起-止秒 ｜ 景别 · 拍摄角度 · 镜头运动 ｜ 主体动作 ｜ 光效/细节」。景别/角度/运动三者每段必写缺一不可；光效/细节每段必写一句（丁达尔光、霓虹反射、衣角飘动、水面高光、烛光摇曳等）。
   - 示例：2-2.5秒 ｜ 近景 · 低角度仰拍 · 定住微抖 ｜ 林晚低头，指尖捏住银锁 ｜ 暮色冷光勾边
   - 【强制换行 · 最重要】每一个切片必须【单独成行】，该切片的时间前缀必须位于【这一行的行首】；上一切片内容结束后必须【换行】再写下一切片的时间前缀。绝对禁止把下一个切片的时间戳接在上一切片内容末尾！
6. 【纯画面 + 连续性铁律】：提示词只写视觉画面，不写台词、不写音效、不写绝对时间戳。相邻切片姿态必须连续（上一段结尾 = 下一段开头），严禁人物瞬移、动作跳帧、景别硬切不连贯。禁止连续两段都是面部特写、禁止全程怼脸拍。
7. 只要提及在 elements 中提炼的人物、场景、道具，必须 100% 严格使用带 @ 的完整名称格式（如 @R1_林薇, @S1_公寓大堂），引用前后各空 2 格，绝对不准写简写，也绝对不能使用人称代词指代！
8. 返回的内容必须直接是生成的纯中文提示词，按上面「起-止秒 ｜ 景别 · 角度 · 运动 ｜ 动作 ｜ 光效」格式写满整个时长，不要有任何多余的解释、不要有 markdown 块引用包围。`;

const realMainPrompt = `如果你是一位专业的AI短剧编剧和导演。
我将提供给你一个题材、一个创意，或者一段现有的脚本内容，或者是参考视频。你的任务是生成完整的视频脚本和拆解。
题材: \${theme || "未提供"}
创意: \${idea || "未提供"}
现有脚本: \${existingScript || "未提供"}
参考视频要求: \${videoIdea || "未提供"}

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
根据"动作强度"自行切分每个 10 秒镜头的时间轴，严禁使用 0-0.5/0.5-1 均匀网格，也严禁使用 0-3/3-6/6-10 大段。分段长度 = 动作强度函数：
- 平缓交代/空镜/过渡 → 2-3 秒长拍，配远景/全景/侧拍
- 普通表演（中速动作） → 1-2 秒，配中景/中近景
- 关键微动作/情绪转折/高光 → 0.5-1 秒短拍，配近景/特写/低角度仰拍/高角度俯拍
每个镜头具体起止秒数按内容现编，不要套固定模板。

## 二、单切片固定语法（每段必写）
「起-止秒 ｜ 景别 · 拍摄角度 · 镜头运动 ｜ 主体动作 ｜ 光效/细节」
示例：2-2.5秒 ｜ 近景 · 低角度仰拍 · 定住微抖 ｜ 林晚低头，指尖捏住腰间银锁 ｜ 衣角静止，暮色冷光勾边
- 【强制换行】每一个切片必须【单独成行】，时间前缀位于行首。绝对禁止把下一刀时间戳接在上一句末尾。
- 景别、拍摄角度、镜头运动三者每段必写，缺一不可。
- 光效/细节每段必写一句（丁达尔光、霓虹反射、衣角飘动、水面高光、烛光摇曳等）。
- 复用素材引用：@Rxx/@Sxx/@Pxx 前后各空 2 格。
- 纯画面描述：prompt 只写视觉，不写台词、不写音效、不写绝对时间戳。台词填 dialogue，音效填 sfx。

## 三、影视级专业词汇库（直接套用，禁止自创口语化运镜）
景别：远景/全景/中景/中近景/近景/特写
角度：平视/低角度仰拍/高角度俯拍/侧面拍/正面拍/过肩拍
运动：缓慢推近/极慢后拉/横移跟拍/手持微抖/定住(静止)/环绕/升降/收尾定格

## 四、连续性铁律
相邻切片之间姿态必须连续：上一段结尾的状态 = 下一段开头的起点。严禁人物瞬移、动作跳帧、景别硬切不连贯。段与段用姿态自然衔接。

## 五、分镜标准输出模板（纯示意，时间轴请按内容智能切分）
**镜1 (0-10s)【功能标注】**
0-2秒 ｜ 远景 · 平视 · 缓慢横移 ｜ 林晚提裙沿青石路走入井畔 ｜ 三层景深
2-2.5秒 ｜ 近景 · 低角度仰拍 · 定住微抖 ｜ 林晚低头，指尖捏住腰间银锁 ｜ 暮色冷光勾边
...

【prompt 字段填写说明】：将上述模板中每个大分镜的完整文本填入对应 shot 的 prompt 字段。每个 duration 固定 10 秒，从 00:00 按序递增。`;

export function Layout() {
  const location = useLocation();
  const [showPrompts, setShowPrompts] = useState(false);
  const [promptTab, setPromptTab] = useState<'simple' | 'real'>('simple');

  useBodyScrollLock(showPrompts);

  const copyPrompt = (text: string, label: string) => {
    try { navigator.clipboard.writeText(text); alert(label + ' 已复制'); } catch {}
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col font-sans selection:bg-indigo-500/30">
      {showPrompts && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40" onClick={() => setShowPrompts(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 shrink-0">
              <div className="flex items-center space-x-2">
                <FileText className="w-5 h-5 text-amber-500" />
                <span className="font-bold text-lg text-neutral-900">系统提示词</span>
                <span className="text-xs text-neutral-400">（可复制给豆包使用）</span>
              </div>
              <button type="button" onClick={() => setShowPrompts(false)} className="p-1.5 hover:bg-neutral-100 rounded-lg transition-colors">
                <X className="w-5 h-5 text-neutral-500" />
              </button>
            </div>
            {/* Tab 切换 */}
            <div className="flex border-b border-neutral-200 shrink-0">
              <button type="button" onClick={() => setPromptTab('simple')} className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${promptTab === 'simple' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-neutral-500 hover:text-neutral-700'}`}>简化版</button>
              <button type="button" onClick={() => setPromptTab('real')} className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${promptTab === 'real' ? 'text-amber-600 border-b-2 border-amber-600' : 'text-neutral-500 hover:text-neutral-700'}`}>真实版（实际发送 DeepSeek）</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {promptTab === 'simple' ? (
                <>
                  {[
                    { title: '素材生成提示词', content: elementPrompt },
                    { title: '分镜生成提示词', content: shotPrompt },
                    { title: '完整主流程提示词（素材 + 分镜）', content: fullMainPrompt },
                  ].map(section => (
                    <div key={section.title} className="border border-neutral-200 rounded-xl overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2.5 bg-neutral-50 border-b border-neutral-200">
                        <span className="text-sm font-bold text-neutral-700">{section.title}</span>
                        <button type="button" onClick={() => copyPrompt(section.content, section.title)} className="flex items-center space-x-1 text-xs text-indigo-500 hover:text-indigo-700 font-medium">
                          <Copy className="w-3.5 h-3.5" /><span>复制</span>
                        </button>
                      </div>
                      <pre className="text-[12px] leading-relaxed text-neutral-600 p-4 max-h-56 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all font-mono">{section.content}</pre>
                    </div>
                  ))}
                </>
              ) : (
                <>
                  {[
                    { title: '素材重生成 system message', content: realElementSys },
                    { title: '素材重生成 user prompt', content: realElementPrompt },
                    { title: '分镜重生成 system message', content: realShotSys },
                    { title: '分镜重生成 user prompt', content: realShotPrompt },
                    { title: '完整主流程生成完整 prompt', content: realMainPrompt },
                  ].map(section => (
                    <div key={section.title} className="border border-amber-200 rounded-xl overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2.5 bg-amber-50 border-b border-amber-200">
                        <span className="text-sm font-bold text-neutral-700">{section.title}</span>
                        <button type="button" onClick={() => copyPrompt(section.content, section.title)} className="flex items-center space-x-1 text-xs text-indigo-500 hover:text-indigo-700 font-medium">
                          <Copy className="w-3.5 h-3.5" /><span>复制</span>
                        </button>
                      </div>
                      <pre className="text-[12px] leading-relaxed text-neutral-600 p-4 max-h-64 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all font-mono">{section.content}</pre>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      <header className="border-b border-neutral-200 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center space-x-2 text-indigo-600 hover:text-indigo-500 transition-colors">
            <Clapperboard className="w-6 h-6" />
            <span className="font-bold text-lg tracking-tight text-neutral-900">AI 短剧工作室</span>
          </Link>
          
          <nav className="flex space-x-1">
            <button
              type="button"
              onClick={() => setShowPrompts(true)}
              className={cn(
                "px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center space-x-2",
                "text-neutral-500 hover:bg-neutral-100/50 hover:text-neutral-900"
              )}
            >
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">系统提示词</span>
            </button>
            <Link 
              to="/materials" 
              className={cn(
                "px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center space-x-2",
                location.pathname === '/materials' 
                  ? "bg-neutral-100 text-neutral-900" 
                  : "text-neutral-500 hover:bg-neutral-100/50 hover:text-neutral-900"
              )}
            >
              <Archive className="w-4 h-4" />
              <span className="hidden sm:inline">素材库</span>
            </Link>
            <Link 
              to="/" 
              className={cn(
                "px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center space-x-2",
                location.pathname === '/' 
                  ? "bg-neutral-100 text-neutral-900" 
                  : "text-neutral-500 hover:bg-neutral-100/50 hover:text-neutral-900"
              )}
            >
              <LayoutGrid className="w-4 h-4" />
              <span className="hidden sm:inline">我的剧本</span>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
    </div>
  );
}
