#!/usr/bin/env node

import assert from "node:assert/strict";

const { detectRequestProfile } = await import("../catalogTaxonomy.ts");
const { buildNoMatchResponse, getClarificationReply } = await import("../index.ts");

const cases = [
  ["Lululemon男士夏季运动服", { department: "apparel", brand: "Lululemon", gender: "male" }],
  ["Nike女士跑鞋", { department: "apparel", brand: "Nike", productType: "shoes", specificIntent: "running_shoe", gender: "female" }],
  ["男士运动鞋预算500", { department: "apparel", productType: "shoes", specificIntent: "sports_shoe", gender: "male", budget: 500 }],
  ["三星手机预算4000", { department: "digital", brand: "Samsung", productType: "phone", budget: 4000 }],
  ["格力空调", { department: "appliance", brand: "Gree 格力", productType: "air_conditioner" }],
  ["宜家沙发", { department: "furniture", brand: "IKEA", productType: "sofa" }],
  ["宜家餐具", { department: "home_goods", brand: "IKEA", productType: "tableware" }],
  ["个护美妆护手霜", { department: "personal_care", productType: "hand_care" }],
  ["咖啡预算100", { department: "food", productType: "snack", budget: 100 }],
  ["猫粮", { department: "pet", productType: "pet_food" }],
  ["婴儿用品", { department: "baby", productType: "baby_product" }],
  ["办公文具", { department: "stationery", productType: "stationery" }],
  ["台灯", { department: "lighting", productType: "lamp" }],
  ["儿童积木", { department: "toys", productType: "toy", gender: "child" }],
  ["动感单车", { department: "fitness", productType: "exercise_equipment" }],
];

for (const [message, expected] of cases) {
  const profile = detectRequestProfile(message);

  for (const [key, value] of Object.entries(expected)) {
    assert.equal(profile[key], value, `${message}: expected ${key}=${value}, got ${profile[key]}`);
  }
}

const budgetOnlyProfile = detectRequestProfile("手机预算4000");
assert.equal(budgetOnlyProfile.budget, 4000);
assert.equal(budgetOnlyProfile.size, null);

const clarificationCases = [
  ["给我推荐一款手机", "你想看哪个品牌或具体型号？预算大概多少？"],
  ["手机预算4000", "你想看哪个品牌或具体型号？"],
  ["小米手机", "预算大概多少？"],
  ["数码产品", "你想买手机、平板、电脑、耳机还是其他数码产品？预算大概多少？"],
  ["格力空调预算4000", "房间大概多大、安装位置有什么限制？"],
  ["咖啡机", "平时主要用它做什么？预算大概多少？"],
  ["吸尘器", "主要清洁地板、地毯还是宠物毛发？预算大概多少？"],
  ["宜家沙发", "准备放在哪个空间，尺寸大概多大？预算大概多少？"],
  ["台灯", "准备放在哪儿，主要是阅读照明还是氛围灯？预算大概多少？"],
  ["男士运动服", "预算大概多少？"],
  ["动感单车", "想练什么，家里能留出多大空间？预算大概多少？"],
  ["服饰", "你想找上衣、裤装、鞋、外套还是配件？预算大概多少？"],
  ["电器", "你想看空调、冰箱、洗衣机还是其他电器？预算大概多少？"],
  ["家居用品", "你想看餐厨、床品、装饰还是收纳用品？预算大概多少？"],
  ["个护美妆", "你想看护肤、洗护还是护手产品？预算大概多少？"],
  ["食品饮料", "预算大概多少？"],
  ["宠物用品", "家里养的是猫还是狗，年龄或体型怎样？预算大概多少？"],
  ["母婴用品", "宝宝多大了，准备给谁用？预算大概多少？"],
  ["文具办公", "预算大概多少？"],
  ["玩具", "给多大的孩子玩，更想要哪种玩法？预算大概多少？"],
  ["运动健身", "想练什么，准备在家里还是健身房使用？预算大概多少？"],
];

const forbiddenInternalPhrases = ["数码先确认", "只核对", "不追问", "只在", "还差一点关键信息"];
for (const [message, expected] of clarificationCases) {
  const reply = getClarificationReply(message);
  assert.equal(reply, expected, `${message}: unexpected clarification reply: ${reply}`);
  for (const phrase of forbiddenInternalPhrases) {
    assert.equal(reply.includes(phrase), false, `${message}: reply exposed internal phrase: ${phrase}`);
  }
}

const noMatchReply = buildNoMatchResponse("三星手机男士预算4000").chat_reply;
assert.equal(noMatchReply, "我查了下商品库，暂时没有找到符合Samsung、手机、男士、预算4000元以内的商品。你可以换个品牌、型号或预算，我再帮你看看。");
assert.equal(noMatchReply.includes("性别="), false);
assert.equal(noMatchReply.includes("不会用其他分类"), false);

const nearestReply = buildNoMatchResponse("男士跑步鞋预算500", {
  name: "Nike Free Run 5.0 Next Nature 男子透气轻盈跑步鞋",
  price_display: "CNY 799",
  price: 799,
}).chat_reply;
assert.equal(nearestReply, "我查了下商品库，500元以内暂时没有符合跑步鞋、男士的商品。最接近的是Nike Free Run 5.0 Next Nature 男子透气轻盈跑步鞋，价格为CNY 799；如果预算能提高到799元左右，我再帮你看。");

console.log(`Catalog intent regression passed: ${cases.length + 1} profile cases and ${clarificationCases.length} clarification cases.`);
