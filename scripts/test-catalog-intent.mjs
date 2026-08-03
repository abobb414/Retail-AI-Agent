#!/usr/bin/env node

import assert from "node:assert/strict";

const { detectRequestProfile } = await import("../catalogTaxonomy.ts");

const cases = [
  ["Lululemon男士夏季运动服", { department: "apparel", brand: "Lululemon", gender: "male" }],
  ["Nike女士跑鞋", { department: "apparel", brand: "Nike", productType: "shoes", gender: "female" }],
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

console.log(`Catalog intent regression passed: ${cases.length + 1} cases.`);
