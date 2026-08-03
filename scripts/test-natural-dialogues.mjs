#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const endpoint = process.env.FRONTEND_CHAT_URL ?? "https://retail.abobb.site/api/chat";

const cases = [
  { id: "01", category: "服饰/跑步鞋", turns: ["我想找双男士跑步鞋，先控制在500以内", "如果800能买到合适的也可以"], budgetNumbers: [500, 800], product: /跑步鞋|跑鞋/, noProduct: false },
  { id: "02", category: "服饰/短袖", turns: ["夏天通勤穿的男士短袖，别超过300", "版型别太紧，平时上班穿"], budgetNumbers: [300], product: /短袖|T恤|tee|shirt/i },
  { id: "03", category: "服饰/瑜伽服", turns: ["想买套女士瑜伽服，预算600左右", "主要在家里练，舒服一点就行"], budgetNumbers: [600], product: /瑜伽|yoga/i, forbiddenProduct: /夹克|外套|jacket/i },
  { id: "04", category: "服饰/童鞋", turns: ["给孩子买双运动鞋，四百块以内，最好耐穿", "大童，平时上学和体育课穿"], budgetNumbers: [400], product: /鞋|shoe/i },
  { id: "05", category: "服饰/外套", turns: ["我平时穿M，想找件春秋通勤的外套，预算800", "不要太厚，短款就好"], budgetNumbers: [800], noProduct: true },
  { id: "06", category: "数码/手机", turns: ["最近想换个安卓手机，四千左右，三星小米都可以", "我更在意拍照，游戏需求不大"], budgetNumbers: [4000], product: /手机|redmi|xiaomi|galaxy|iphone/i, forbidden: /面积|安装条件/ },
  { id: "07", category: "数码/平板", turns: ["想买个平板给孩子上网课，预算两千", "屏幕别太小，重量轻一点"], budgetNumbers: [2000], noProduct: true, clarification: true },
  { id: "08", category: "数码/电脑", turns: ["办公用的笔记本，六千以内，别太重", "主要处理文档和开视频会议"], budgetNumbers: [6000], noProduct: true, clarification: true },
  { id: "09", category: "数码/显示器", turns: ["想配个27寸显示器，预算1500，写代码用", "不打游戏，眼睛舒服更重要"], budgetNumbers: [1500], noProduct: true, clarification: true },
  { id: "10", category: "数码/耳机", turns: ["通勤想买副耳机，预算500，最好有降噪", "地铁上用，戴久了耳朵别疼"], budgetNumbers: [500], product: /耳机|耳塞|buds|headphone/i, forbiddenProduct: /音箱|音响|speaker/i },
  { id: "11", category: "电器/空调", turns: ["客厅想换空调，预算5000，房间大概20平", "希望夏天制冷快一点"], budgetNumbers: [5000], product: /空调|air/i },
  { id: "12", category: "电器/冰箱", turns: ["家里两个人用冰箱，预算4000，厨房位置宽80厘米以内", "冷冻空间别太小"], budgetNumbers: [4000], product: /冰箱|refrigerator/i },
  { id: "13", category: "电器/洗衣机", turns: ["想买台洗衣机，预算3000，放阳台，最好十公斤", "主要洗衣服，偶尔洗床单"], budgetNumbers: [3000], product: /洗衣|washer/i },
  { id: "14", category: "电器/咖啡机", turns: ["早上想在家做拿铁，咖啡机预算2000", "操作别太复杂，我是新手"], budgetNumbers: [2000], noProduct: true },
  { id: "15", category: "电器/吸尘器", turns: ["吸尘器预算1000，家里有猫，主要吸猫毛", "地板和沙发都要能清理"], budgetNumbers: [1000], product: /吸尘|vacuum/i },
  { id: "16", category: "家具/沙发", turns: ["小户型客厅想买张沙发，预算5000，宽度别超过2米", "两三个人坐，最好别太软"], budgetNumbers: [5000], product: /沙发|sofa/i },
  { id: "17", category: "家具/床", turns: ["卧室想换个1.8米床架，预算3000", "喜欢简单一点的木质风格"], budgetNumbers: [3000], product: /床架|床|bed/i, forbiddenProduct: /床垫|mattress/i },
  { id: "18", category: "家具/办公椅", turns: ["书房想添把办公椅，1500以内，久坐舒服", "腰部支撑要好，外观简洁些"], budgetNumbers: [1500], product: /办公椅|转椅|chair/i },
  { id: "19", category: "家具/收纳", turns: ["玄关想放个窄一点的收纳柜，预算1000", "主要收鞋和钥匙，别太占地方"], budgetNumbers: [1000], product: /收纳|储物|柜|storage|cabinet/i },
  { id: "20", category: "家居/餐具", turns: ["想买套餐具，预算300，日常两个人用", "不要太花，简单耐看就行"], budgetNumbers: [300], product: /餐具|盘|碗|杯|壶|tableware/i },
  { id: "21", category: "家居/床品", turns: ["卧室想换四件套，预算500，最好是纯棉", "颜色想要浅一点，容易搭家具"], budgetNumbers: [500], product: /床品|薄被|枕套|被套|四件套/i },
  { id: "22", category: "家居/香薰", turns: ["客厅想放点香薰，预算200，不要太甜的味道", "清爽一点，平时待客也不会冲"], budgetNumbers: [200], product: /香薰|蜡烛|香味/i },
  { id: "23", category: "个护美妆/护肤", turns: ["换季脸容易干，想买保湿护肤品，预算500", "肤质偏敏感，别太刺激"], budgetNumbers: [500], product: /护肤|洁面|乳霜|保湿/i },
  { id: "24", category: "个护美妆/护手", turns: ["护手霜预算100，别太香，放办公室用", "吸收快一点，不要摸键盘油乎乎的"], budgetNumbers: [100], product: /护手/i },
  { id: "25", category: "食品饮料/咖啡", turns: ["想买点低糖咖啡或饮料，预算200，早上喝", "最好是方便带去公司的"], budgetNumbers: [200], noProduct: true },
  { id: "26", category: "宠物/猫粮", turns: ["家里一只成年猫，想换猫粮，预算300，别太油", "猫有点挑食，颗粒别太大"], budgetNumbers: [300], noProduct: true },
  { id: "27", category: "母婴/婴儿用品", turns: ["给六个月宝宝买睡袋，预算300，夏天用", "薄一点，最好方便换尿布"], budgetNumbers: [300], noProduct: true },
  { id: "28", category: "文具办公", turns: ["给孩子买写字用的文具，预算200，小学用", "不用太多花样，结实好用就行"], budgetNumbers: [200], noProduct: true },
  { id: "29", category: "照明/落地灯", turns: ["给我推荐一块室内照明灯具，预算300", "阅读照明，放在沙发旁边"], budgetNumbers: [300], product: /灯|lamp|TÅGARP/i, forbidden: /安装条件|面积/ },
  { id: "30", category: "运动健身", turns: ["想在家做有氧，预算2000，地方不大", "最好不用复杂安装，收起来别太占地"], budgetNumbers: [2000], product: /单车|健身|跑步|exercise/i, forbidden: /安装条件|面积/ },
];

assert.equal(cases.length, 30);

function makeMessages(turns) {
  return turns.flatMap((content, index) => [
    { role: "user", content },
    ...(index < turns.length - 1 ? [{ role: "assistant", content: "我记下了，继续帮你筛。" }] : []),
  ]);
}

async function runCase(testCase) {
  const body = JSON.stringify({ messages: makeMessages(testCase.turns) });
  const { stdout } = await execFileAsync(
    "curl",
    [
      "--retry", "4",
      "--retry-all-errors",
      "--retry-delay", "1",
      "-sS",
      "--max-time", "90",
      "-w", "\n__HTTP_STATUS__:%{http_code}",
      endpoint,
      "-H", "content-type: application/json",
      "--data-raw", body,
    ],
    { maxBuffer: 1024 * 1024 * 5 },
  );

  const statusMatch = stdout.match(/\n__HTTP_STATUS__:(\d+)\s*$/);
  const status = Number(statusMatch?.[1] ?? 0);
  const payload = statusMatch ? stdout.slice(0, statusMatch.index) : stdout;
  const text = [...payload.matchAll(/event: chunk\ndata: (.+)/g)]
    .map((match) => JSON.parse(match[1]).text)
    .join(" ");
  const products = [...payload.matchAll(/event: product\ndata: (.+)/g)]
    .map((match) => JSON.parse(match[1]).product)
    .filter(Boolean);
  const issues = [];

  if (status !== 200) issues.push(`HTTP ${status}`);
  if (/数码先确认|只核对|不追问|不会用其他分类|性别=/.test(payload)) issues.push("暴露内部话术");
  if (testCase.budgetNumbers.some((value) => new RegExp(`尺码\\s*${value}`).test(payload))) {
    issues.push("把预算识别成尺码");
  }
  if (testCase.forbidden?.test(payload)) issues.push("追问了不相关条件");
  if (testCase.noProduct && products.length > 0) issues.push(`无货请求却返回了商品：${products[0].name}`);
  if (testCase.product && products.length === 0) issues.push("有明确商品请求却没有商品卡");
  if (testCase.product && products.length > 0) {
    const productText = JSON.stringify(products[0]);
    const productIdentity = `${products[0].name} ${products[0].category ?? ""}`;
    if (!testCase.product.test(productText)) issues.push(`商品不符合期望：${products[0].name}`);
    if (testCase.forbiddenProduct?.test(productIdentity)) issues.push(`商品跨了具体品类：${products[0].name}`);
  }
  if (testCase.noProduct && !testCase.clarification && !/没有找到|暂时没有|查了下商品库/.test(text)) issues.push("无货回复不够明确");

  return { ...testCase, status, text, products, issues };
}

const results = [];
for (let index = 0; index < cases.length; index += 3) {
  results.push(...await Promise.all(cases.slice(index, index + 3).map(runCase)));
}

for (const result of results) {
  const state = result.issues.length ? "FAIL" : "PASS";
  console.log(`[${state}] ${result.id} ${result.category} | ${result.text || "(无文本)"} | 商品卡=${result.products.length ? result.products[0].name : "否"}`);
  if (result.issues.length) console.log(`       ${result.issues.join("；")}`);
}

const failures = results.filter((result) => result.issues.length > 0);
if (failures.length) {
  throw new Error(`${failures.length}/30 natural dialogue cases failed.`);
}

console.log(`Natural dialogue regression passed: ${results.length}/30 cases.`);
