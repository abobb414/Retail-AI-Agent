#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const sourceFile = resolve(
  process.env.PRODUCTS_FILE ?? "frontend/server/data/realProductsEnriched.json",
);
const sourceFileLabel = process.env.PRODUCTS_FILE ?? "frontend/server/data/realProductsEnriched.json";
const outputFile = resolve(
  process.env.FACETS_FILE ?? "frontend/server/data/productFacets.json",
);

const source = JSON.parse(await readFile(sourceFile, "utf8"));
const products = Array.isArray(source) ? source : source.products;

if (!Array.isArray(products)) {
  throw new Error("Product file must be an array or contain a products array.");
}

const normalizedProducts = products.map(normalizeProduct);
const departmentCounts = countBy(normalizedProducts, (product) => product.department);
const productTypeCounts = countBy(normalizedProducts, (product) => product.product_type);
const unmapped = normalizedProducts.filter((product) => product.department === "other");

const output = {
  version: 1,
  source_file: sourceFileLabel,
  generated_at: new Date().toISOString(),
  summary: {
    total: normalizedProducts.length,
    department_counts: departmentCounts,
    product_type_counts: productTypeCounts,
    unmapped_count: unmapped.length,
    unmapped_samples: unmapped.slice(0, 40).map((product) => ({
      id: product.id,
      name: product.name,
      source_category: product.source_category,
      source_subcategory: product.source_subcategory,
    })),
  },
  products: normalizedProducts,
};

await mkdir(dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");

console.log(JSON.stringify(output.summary, null, 2));
console.log(`Wrote ${normalizedProducts.length} product facets to ${outputFile}`);

function normalizeProduct(product) {
  const sourceCategory = stringValue(product._mainCategory ?? product.category);
  const sourceSubcategory = stringValue(product._subCategory);
  const productIdentity = normalizeText(`${product.id} ${product.name}`);
  const text = normalizeText([
    product.name,
    product.brand,
    product.category,
    sourceCategory,
    sourceSubcategory,
    product.materials,
    product.craftsmanship,
    product.feature,
    product.keywords,
    product.signature_specs,
    product.style_tags,
    product.room_tags,
  ].flat().join(" "));

  const department = classifyDepartment({ sourceCategory, sourceSubcategory, text, name: productIdentity });
  const productType = classifyProductType({
    department,
    sourceCategory,
    sourceSubcategory,
    text,
    name: productIdentity,
  });
  const gender = department === "apparel" ? classifyGender(text) : null;
  const sizeOptions = extractSizeOptions(text);
  const attributes = extractAttributes(text);
  const priceCny = extractPrice(product);

  return {
    id: stringValue(product.id),
    department,
    product_type: productType,
    subcategory: getNormalizedSubcategory(productType, sourceSubcategory, sourceCategory),
    gender,
    size_options: sizeOptions,
    attributes,
    price_cny: priceCny,
    price_display: priceCny ? `CNY ${priceCny}` : isSuspiciousCnyPrice(product) ? "价格以官网为准" : stringValue(product.price_range),
    source_category: sourceCategory,
    source_subcategory: sourceSubcategory,
    name: stringValue(product.name),
  };
}

function getNormalizedSubcategory(productType, sourceSubcategory, sourceCategory) {
  const labels = {
    tops: "上衣",
    pants: "裤装",
    shoes: "鞋履",
    outerwear: "外套",
    dress: "裙装",
    underwear: "内衣",
    apparel_accessory: "服饰配件",
    phone: "手机",
    tablet: "平板电脑",
    computer: "电脑",
    monitor: "显示器",
    audio: "音频设备",
    wearable: "可穿戴设备",
    digital_accessory: "数码配件",
    television: "电视",
    storage_device: "存储设备",
    network_device: "网络设备",
    smart_display: "智能屏幕",
    media_player: "影音播放器",
    sofa: "沙发",
    bed: "床具",
    chair: "椅凳",
    table: "桌几",
    storage: "收纳家具",
    home_textile: "床品家纺",
    home_decor: "家居装饰",
    home_organization: "家居收纳",
    home_accessory: "家居配件",
    tableware: "餐厨用品",
    air_conditioner: "空调",
    refrigerator: "冰箱",
    washer: "洗衣机",
    dishwasher: "洗碗机",
    kitchen_appliance: "厨房电器",
    cleaning_appliance: "清洁电器",
    lamp: "灯具",
    toy: "玩具",
    exercise_equipment: "运动健身器材",
    hand_care: "手部护理",
  };
  return labels[productType] || sourceSubcategory || sourceCategory || "其他";
}

function classifyDepartment({ sourceCategory, sourceSubcategory, text, name }) {
  if (containsAny(text, ["laut ers", "lauters", "台灯", "落地灯", "吊灯", "壁灯", "灯具", "照明", "lamp", "lighting"])) {
    return "lighting";
  }

  if (containsAny(text, ["lillabo", "利乐宝", "玩具", "火车轨道", "积木"])) {
    return "toys";
  }

  if (containsAny(text, ["动感单车", "健身器材", "跑步机", "exercise bike", "fitness equipment"])) {
    return "fitness";
  }

  if (containsAny(text, ["护手霜", "护手", "洗发", "沐浴", "洁面", "护肤", "美妆", "润唇", "卸妆", "身体乳"])) {
    return "personal_care";
  }

  if (containsAny(text, ["床上用品", "床单", "被子", "被套", "褥垫", "床笠", "枕套"])) {
    return "home_goods";
  }

  if (containsAny(text, ["trofast", "舒法特", "askersund", "阿斯克松", "voxtorp", "沃托普", "enhet", "安纳特", "bergsbo", "伯尔思波", "skogsta", "斯古塔", "släkt", "斯莱克"])) {
    return "furniture";
  }

  if (containsAny(name, ["空调", "冰箱", "冰柜", "冰水分配", "洗衣机", "洗烘", "烘干机", "干衣机", "洗碗机", "烤箱", "微波炉", "咖啡机", "吸尘器", "扫地机", "空气净化器", "衣物护理机", "refrigerator", "washer", "dryer", "dishwasher", "air-conditioner", "airconditioner"])) {
    return "appliance";
  }

  if (containsAny(name, ["手机壳", "保护壳", "保护套", "携带包", "表带", "触控笔", "s pen", "screen protector", "memory card", "microsd", "sd card", "充电器", "数据线", "手机", "smartphone", "iphone", "redmi", "galaxy", "xiaomi", "显示器", "monitor", "电视", "mini led", "qled", "oled", "耳机", "耳塞", "headphone", "buds", "音箱", "音响", "soundbar", "条形音响", "watch", "手表", "手环", "ring", "fit3", "笔记本", "电脑", "laptop", "macbook", "book", "ssd", "固态硬盘", "blu-ray", "dvd", "投影仪"])) {
    return "digital";
  }

  if (containsAny(name, ["擦拭布", "清洁布"])) {
    return "home_goods";
  }

  if (containsAny(name, ["裤", "t恤", "短袖", "背心", "衬衫", "外套", "夹克", "裙", "连衣裙", "内衣", "内裤", "文胸", "鞋", "袜", "围巾", "口罩", "太阳镜", "眼镜", "women", "men"])) {
    return "apparel";
  }

  if (containsAny(name, ["沙发", "床", "床架", "床垫", "书桌", "餐桌", "椅", "凳", "chair", "lounge", "柜", "架", "收纳", "trofast", "askersund", "voxtorp", "enhet", "bergsbo"])) {
    return "furniture";
  }

  if (containsAny(name, ["床单", "被套", "被子", "褥垫", "枕套", "靠垫", "餐具", "厨具", "香薰", "扩香", "蜡烛", "衣架", "晾衣架", "护手霜", "护肤", "洗发", "沐浴"])) {
    return containsAny(name, ["护手霜", "护肤", "洗发", "沐浴"]) ? "personal_care" : "home_goods";
  }

  if (
    containsAny(sourceCategory, ["数码", "monitors", "audio-sound"]) ||
    containsAny(sourceSubcategory, ["手机", "平板", "显示器", "耳机", "音频", "智能手表", "手环", "相机", "数码"])
  ) {
    return "digital";
  }

  if (
    containsAny(sourceCategory, [
      "运动服饰",
      "户外服饰",
      "T恤",
      "外套",
      "裤装",
      "内衣",
      "幼儿服装",
      "新生儿",
      "连衣裙",
      "衬衫",
      "起居系列",
      "配件",
    ]) ||
    containsAny(sourceSubcategory, ["T恤", "裤装", "外套", "背心", "衬衫", "裙装", "内衣", "鞋", "袜", "服装", "泳衣"])
  ) {
    return "apparel";
  }

  if (containsAny(text, [
    "裤",
    "t恤",
    "短袖",
    "衬衫",
    "外套",
    "夹克",
    "裙",
    "内衣",
    "鞋",
    "袜",
    "帽",
    "背包",
    "围巾",
    "口罩",
    "太阳镜",
    "眼镜",
    "女式",
    "男式",
    "women",
    "men",
  ])) {
    return "apparel";
  }

  if (
    containsAny(sourceCategory, [
      "家具",
      "收纳家具",
      "storage furniture",
      "office furniture",
      "solid wood furniture",
      "bedroom furniture",
      "seating",
      "tables",
      "沙发床",
      "实木/成品家具",
    ]) ||
    containsAny(sourceSubcategory, ["沙发", "床", "椅凳", "桌子", "柜架", "收纳"])
  ) {
    return "furniture";
  }

  if (
    containsAny(sourceCategory, [
      "家用电器",
      "空调",
      "电器",
      "air-conditioners",
      "home-appliances",
      "kitchen-appliances",
      "cooking-baking",
      "dishwashers",
      "washers-and-dryers",
      "cleaning-and-care",
      "personal-care/home-appliances",
      "vacuum-cleaners",
      "refrigerators",
    ]) ||
    containsAny(sourceSubcategory, ["空调", "冰箱", "洗衣机", "烘干机", "洗碗机", "烤箱", "咖啡机", "剃须刀", "电动牙刷", "清洁用品", "家电"])
  ) {
    return "appliance";
  }

  if (containsAny(text, [
    "空气净化器",
    "净化器",
    "吸尘器",
    "扫地机",
    "风扇",
    "空调",
    "冰箱",
    "洗衣机",
    "烤箱",
    "咖啡机",
    "电动牙刷",
    "剃须刀",
    "家电",
  ])) {
    return "appliance";
  }

  if (containsAny(text, [
    "家具",
    "收纳",
    "地板",
    "露台",
    "阳台",
    "沙发",
    "沙发床",
    "床垫",
    "床头",
    "床尾",
    "床架",
    "书架",
    "书桌",
    "桌",
    "椅子",
    "脚凳",
    "靠垫",
    "衣柜",
    "餐桌",
    "办公桌",
    "餐边柜",
    "厨房系列",
    "储物组合",
    "椅",
    "凳",
    "柜",
  ])) {
    return "furniture";
  }

  if (containsAny(text, ["碗", "盘", "杯", "筷", "刀叉", "砧板", "锅", "餐具", "厨具", "香薰", "蜡烛", "扩香", "床品", "床上用品", "床单", "被套", "枕套", "褥垫", "被子", "靠垫", "毛巾", "衣架", "晾衣架", "木器护理", "木油", "bandfisk", "班德菲斯", "vårda", "瓦尔达"])) {
    return "home_goods";
  }

  if (containsAny(text, ["护肤", "美妆", "洁面", "洗发", "沐浴", "润唇", "卸妆", "身体乳", "护手霜", "护手", "牙膏", "漱口水"])) {
    return "personal_care";
  }

  if (containsAny(text, ["零食", "食品", "咖啡", "茶", "饮料", "饼干", "薯片", "果干", "肉脯", "海苔"])) {
    return "food";
  }

  if (containsAny(text, ["宠物", "猫粮", "狗粮", "宠物食品", "宠物零食"])) {
    return "pet";
  }

  if (containsAny(text, ["婴儿", "婴童", "母婴", "宝宝", "儿童用品", "婴儿床"])) {
    return "baby";
  }

  if (containsAny(text, ["文具", "笔袋", "圆珠笔", "文件夹", "票卡夹", "替芯", "便签"])) {
    return "stationery";
  }

  if (containsAny(text, ["手机", "平板电脑", "显示器", "galaxy", "xiaomi", "redmi"])) {
    return "digital";
  }

  return "other";
}

function classifyProductType({ department, sourceCategory, sourceSubcategory, text, name }) {
  const value = `${name} ${sourceCategory}`;
  const sourceValue = `${value} ${sourceSubcategory}`;
  const details = `${value} ${text}`;

  if (department === "lighting") return "lamp";
  if (department === "toys") return "toy";

  if (department === "digital") {
    if (containsAny(value, ["保护壳", "手机壳", "保护套", "携带包", "表带", "触控笔", "贴膜", "充电器", "数据线", "case", "cover", "stylus", "s pen", "watch band"])) return "digital_accessory";
    if (containsAny(value, ["memory card", "microsd", "sd card", "存储卡", "固态硬盘", "ssd", "硬盘"])) return "storage_device";
    if (containsAny(value, ["电视", "smart tv", "television", "qled", "oled", "mini led", "redmi max", "redmi a pro", "s mini"])) return "television";
    if (containsAny(value, ["路由", "router", "mesh"])) return "network_device";
    if (containsAny(value, ["手机", "smartphone", "iphone", "turbo", "note"]) || /(?:xiaomi|redmi|galaxy)\s*[a-z]?\d/.test(name)) return "phone";
    if (containsAny(value, ["平板", "tablet", "ipad", "pad", "galaxy tab"])) return "tablet";
    if (containsAny(value, ["显示器", "monitor"])) return "monitor";
    if (containsAny(value, ["耳机", "耳塞", "buds", "headphone", "audio", "音频", "音箱", "soundbar", "条形音响"])) return "audio";
    if (containsAny(value, ["智能手表", "手表", "watch", "手环", "ring", "fit3", "眼镜"])) return "wearable";
    if (containsAny(value, ["笔记本", "电脑", "laptop", "macbook", "redmibook", "book"])) return "computer";
    if (containsAny(value, ["智能家庭屏", "智能家居屏", "smart display"])) return "smart_display";
    if (containsAny(value, ["blu-ray", "dvd player", "dvd播放器"])) return "media_player";
    return "other_digital";
  }

  if (department === "apparel") {
    if (containsAny(name, ["背心", "t恤", "短袖", "半袖", "衬衫", "polo", "上衣", "shirt", "tee"])) return "tops";
    if (containsAny(name, ["裤", "pants", "trouser", "jeans", "shorts"])) return "pants";
    if (containsAny(name, ["裙", "dress", "skirt"])) return "dress";
    if (containsAny(name, ["外套", "夹克", "冲锋衣", "羽绒", "卫衣", "jacket", "coat"])) return "outerwear";
    if (containsAny(name, ["内衣", "内裤", "文胸", "bra", "睡衣", "家居服"])) return "underwear";
    if (containsAny(sourceValue, ["鞋", "sneaker", "shoe", "靴", "拖鞋"])) return "shoes";
    if (containsAny(sourceValue, ["裤", "pants", "trouser", "jeans", "shorts"])) return "pants";
    if (containsAny(sourceValue, ["裙", "dress", "skirt"])) return "dress";
    if (containsAny(sourceValue, ["外套", "夹克", "冲锋衣", "羽绒", "卫衣", "jacket", "coat"])) return "outerwear";
    if (containsAny(sourceValue, ["内衣", "内裤", "文胸", "bra", "睡衣", "家居服"])) return "underwear";
    if (containsAny(sourceValue, ["背心", "马甲", "T恤", "短袖", "半袖", "衬衫", "shirt", "polo", "上衣"])) return "tops";
    if (containsAny(sourceValue, ["帽", "包", "手套", "围巾", "口罩", "太阳镜", "眼镜", "配件", "cap", "bag", "accessory", "scarf", "sunglasses"])) return "apparel_accessory";
    return "other_apparel";
  }

  if (department === "appliance") {
    if (containsAny(sourceValue, ["空调", "air conditioner"])) return "air_conditioner";
    if (containsAny(sourceValue, ["冰箱", "refrigerator", "fridge"])) return "refrigerator";
    if (containsAny(sourceValue, ["洗衣机", "洗烘", "washer", "dryer", "烘干机"])) return "washer";
    if (containsAny(sourceValue, ["洗碗机", "dishwasher"])) return "dishwasher";
    if (containsAny(sourceValue, ["烤箱", "微波炉", "面包机", "咖啡机", "oven", "microwave", "coffee"])) return "kitchen_appliance";
    if (containsAny(sourceValue, ["剃须刀", "电动牙刷", "吹风机", "美容仪", "personal-care"])) return "personal_care";
    if (containsAny(sourceValue, ["吸尘器", "扫地机", "vacuum", "清洁"])) return "cleaning_appliance";
    return "other_appliance";
  }

  if (department === "furniture") {
    if (containsAny(sourceValue, ["沙发", "sofa"])) return "sofa";
    if (containsAny(sourceValue, ["床", "bed", "mattress"])) return "bed";
    if (containsAny(sourceValue, ["skogsta", "斯古塔"])) return "chair";
    if (containsAny(sourceValue, ["椅", "凳", "chair", "seating"])) return "chair";
    if (containsAny(sourceValue, ["桌", "table", "desk"])) return "table";
    if (containsAny(sourceValue, ["柜", "架", "收纳", "storage", "shelf", "cabinet"])) return "storage";
    return "other_furniture";
  }

  if (department === "home_goods") {
    if (containsAny(details, ["擦拭布", "清洁布"])) return "home_accessory";
    if (containsAny(sourceValue, ["碗", "盘", "杯", "筷", "刀叉", "砧板", "锅", "厨具", "餐具"])) return "tableware";
    if (containsAny(details, ["床品", "床上用品", "床单", "被套", "被子", "褥垫", "枕套", "靠垫", "毛巾"])) return "home_textile";
    if (containsAny(details, ["衣架", "晾衣架", "木器护理", "木油", "收纳", "vårda", "瓦尔达"])) return "home_organization";
    if (containsAny(details, ["香薰", "蜡烛", "扩香", "花瓶", "装饰", "地毯", "镜子"])) return "home_decor";
    if (containsAny(details, ["bandfisk", "班德菲斯"])) return "home_accessory";
    return "other_home_goods";
  }

  if (department === "personal_care") {
    if (containsAny(details, ["护手霜", "护手"])) return "hand_care";
    return "personal_care";
  }
  if (department === "fitness") return "exercise_equipment";
  if (department === "food") return "food";
  if (department === "pet") return "pet_food";
  if (department === "baby") return "baby_product";
  if (department === "stationery") return "stationery";

  return "other";
}

function classifyGender(text) {
  if (containsAny(text, ["男童", "女童", "儿童", "婴童", "幼儿", "大童", "小童", "童装", "baby", "kids"])) return "child";
  if (containsAny(text, ["中性", "男女", "unisex"])) return "unisex";
  if (containsAny(text, ["女子", "女式", "女士", "女款", "女性", "女装", "women", "womens"])) return "female";
  if (containsAny(text, ["男子", "男式", "男士", "男款", "男性", "男装", "men", "mens"])) return "male";
  return null;
}

function extractSizeOptions(text) {
  const values = new Set();
  for (const match of text.matchAll(/\b(?:xxxs|xxs|xs|s|m|l|xl|xxl|xxxl)\b/gi)) values.add(match[0].toUpperCase());
  for (const match of text.matchAll(/\b\d{2,3}(?:cm|厘米|mm|毫米|英寸|寸)\b/gi)) values.add(match[0]);
  return [...values].slice(0, 32);
}

function extractAttributes(text) {
  const attributes = {};
  const screen = text.match(/(\d+(?:\.\d+)?)\s*(?:英寸|寸)/);
  const storage = text.match(/(\d+(?:\.\d+)?)\s*(tb|gb|g)\b/i);
  const capacity = text.match(/(\d+(?:\.\d+)?)\s*((?:升|l|kg|匹))\b/i);
  const dimension = text.match(/\b\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?)?\s*(?:cm|厘米)?\b/i);

  if (screen) attributes.screen_size_inch = Number(screen[1]);
  if (storage) attributes.storage_gb = storage[2].toLowerCase() === "tb" ? Number(storage[1]) * 1024 : Number(storage[1]);
  if (capacity) attributes.capacity_value = `${capacity[1]}${capacity[2]}`;
  if (dimension) attributes.dimensions = dimension[0].replace(/\s+/g, "");

  return attributes;
}

function extractPrice(product) {
  const text = [product.name, product.keywords, product.price_range].flat().join(" ");
  const explicit = [...text.matchAll(/(\d{2,6}(?:\.\d+)?)\s*(?:元|块)(?:起)?/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));

  if (explicit.length) return Math.min(...explicit);

  const cny = stringValue(product.price_range).match(/CNY\s*(\d+(?:\.\d+)?)/i);
  if (!cny) return null;
  const value = Number(cny[1]);
  const numericNameTokens = String(product.name ?? "").match(/\d+(?:\.\d+)?/g) ?? [];
  return numericNameTokens.includes(String(value)) ? null : value;
}

function isSuspiciousCnyPrice(product) {
  return /CNY\s*\d+(?:\.\d+)?/i.test(stringValue(product.price_range)) && extractPrice(product) === null;
}

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = getKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function containsAny(value, candidates) {
  const text = normalizeText(value);
  return candidates.some((candidate) => text.includes(normalizeText(candidate)));
}

function normalizeText(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, "");
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}
