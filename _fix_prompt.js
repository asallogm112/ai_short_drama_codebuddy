const fs = require("fs");
const f = "server.ts";
let s = fs.readFileSync(f, "utf8");
const before = s;

// 1) 角色关键词去掉"角色三视图设定图"（三视图设定图与视频无关）
const kOld = '        const targetKeywords = "全身像，角色三视图设定图，纯色背景";';
const kNew = '        const targetKeywords = "全身像，纯色背景";';
s = s.split(kOld).join(kNew);

// 2) includes 判断同步去掉 角色三视图
const iOld = '          if (!cleanPrompt.includes("全身像") || !cleanPrompt.includes("角色三视图") || !cleanPrompt.includes("纯色背景")) {';
const iNew = '          if (!cleanPrompt.includes("全身像") || !cleanPrompt.includes("纯色背景")) {';
s = s.split(iOld).join(iNew);

// 3) 结尾废话后缀：只保留"只生成 1 张图片"
const sOld = "        cleanPrompt = `${cleanPrompt}，只生成 1 张图片 , 如果 生成过 , 就不要再生成了 . 切记 切记 , 因为要 保证 一致性  !`;";
const sNew = "        cleanPrompt = `${cleanPrompt}，只生成 1 张图片`;";
s = s.split(sOld).join(sNew);

fs.writeFileSync(f, s);
console.log("角色三视图设定图 left:", (s.match(/角色三视图设定图/g) || []).length);
console.log("如果 生成过 left:", (s.match(/如果 生成过/g) || []).length);
console.log("changed chars:", before.length - s.length);
